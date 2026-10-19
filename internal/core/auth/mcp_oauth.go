package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

const (
	MCPServiceScope  = "mcp:service"
	mcpOAuthTokenTTL = 15 * time.Minute
	mcpOAuthKeyAge   = 30 * 24 * time.Hour
)

// MCPOAuthConfig defines the one service-level OAuth client and resource exposed
// by this deployment. The client secret is only read by the API process.
type MCPOAuthConfig struct {
	ResourceURL  string
	ClientID     string
	ClientSecret string
}

func (c MCPOAuthConfig) Enabled() bool {
	return c.ResourceURL != "" && c.ClientID != "" && c.ClientSecret != ""
}

type OAuthAccessTokenVerifier interface {
	VerifyMCPAccessToken(context.Context, string, string) error
}

type oauthSigningKey struct {
	ID                  string
	PublicKey           ed25519.PublicKey
	EncryptedPrivateKey []byte
	CreatedAt           time.Time
	ExpiresAt           *time.Time
}

type oauthSigningKeyStore interface {
	Current(context.Context) (oauthSigningKey, error)
	ByID(context.Context, string) (oauthSigningKey, error)
	PublicKeys(context.Context) ([]oauthSigningKey, error)
	Insert(context.Context, oauthSigningKey, []byte) error
	Retire(context.Context, string, time.Time) error
}

type postgresOAuthSigningKeyStore struct{ pool *pgxpool.Pool }

func (s postgresOAuthSigningKeyStore) Current(ctx context.Context) (oauthSigningKey, error) {
	var key oauthSigningKey
	var publicJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT id, public_key, encrypted_private_key, created_at, expires_at
		FROM welio_oauth_signing_keys WHERE expires_at IS NULL OR expires_at > now()
		ORDER BY created_at DESC LIMIT 1`).Scan(&key.ID, &publicJSON, &key.EncryptedPrivateKey, &key.CreatedAt, &key.ExpiresAt)
	if err != nil {
		return oauthSigningKey{}, err
	}
	key.PublicKey, err = parseEd25519JWK(key.ID, publicJSON)
	return key, err
}

func (s postgresOAuthSigningKeyStore) ByID(ctx context.Context, id string) (oauthSigningKey, error) {
	var key oauthSigningKey
	var publicJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT id, public_key FROM welio_oauth_signing_keys
		WHERE id = $1 AND (expires_at IS NULL OR expires_at > now())`, id).Scan(&key.ID, &publicJSON)
	if err != nil {
		return oauthSigningKey{}, err
	}
	key.PublicKey, err = parseEd25519JWK(key.ID, publicJSON)
	return key, err
}

func (s postgresOAuthSigningKeyStore) PublicKeys(ctx context.Context) ([]oauthSigningKey, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, public_key, created_at, expires_at FROM welio_oauth_signing_keys
		WHERE expires_at IS NULL OR expires_at > now() ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]oauthSigningKey, 0)
	for rows.Next() {
		var key oauthSigningKey
		var publicJSON []byte
		if err := rows.Scan(&key.ID, &publicJSON, &key.CreatedAt, &key.ExpiresAt); err != nil {
			return nil, err
		}
		key.PublicKey, err = parseEd25519JWK(key.ID, publicJSON)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s postgresOAuthSigningKeyStore) Insert(ctx context.Context, key oauthSigningKey, publicJSON []byte) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO welio_oauth_signing_keys (id, public_key, encrypted_private_key)
		VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, key.ID, string(publicJSON), key.EncryptedPrivateKey)
	return err
}

func (s postgresOAuthSigningKeyStore) Retire(ctx context.Context, id string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE welio_oauth_signing_keys SET expires_at = $2
		WHERE id = $1 AND (expires_at IS NULL OR expires_at > now())`, id, expiresAt)
	return err
}

// MCPOAuthService issues narrowly scoped service tokens and publishes OAuth
// metadata for the configured MCP resource.
type MCPOAuthService struct {
	config  MCPOAuthConfig
	issuer  string
	secret  []byte
	keys    oauthSigningKeyStore
	limiter interface {
		Allow(string, int, time.Duration) bool
	}
}

func NewMCPOAuthService(database *db.DB, config MCPOAuthConfig, secret []byte, limiter interface {
	Allow(string, int, time.Duration) bool
}) *MCPOAuthService {
	var store oauthSigningKeyStore
	if database != nil && database.Pool != nil {
		store = postgresOAuthSigningKeyStore{pool: database.Pool}
	}
	return newMCPOAuthService(config, secret, store, limiter)
}

func newMCPOAuthService(config MCPOAuthConfig, secret []byte, keys oauthSigningKeyStore, limiter interface {
	Allow(string, int, time.Duration) bool
}) *MCPOAuthService {
	issuer := ""
	if parsed, err := url.Parse(config.ResourceURL); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		issuer = parsed.Scheme + "://" + parsed.Host
	}
	return &MCPOAuthService{config: config, issuer: issuer, secret: append([]byte(nil), secret...), keys: keys, limiter: limiter}
}

type mcpOAuthClaims struct {
	ClientID string `json:"client_id"`
	Scope    string `json:"scope"`
	Purpose  string `json:"purpose"`
	jwt.RegisteredClaims
}

func (s *MCPOAuthService) RegisterRoutes(router chi.Router) {
	if s == nil || !s.config.Enabled() {
		return
	}
	router.Get("/.well-known/oauth-authorization-server", s.serveAuthorizationServerMetadata)
	router.Head("/.well-known/oauth-authorization-server", s.serveAuthorizationServerMetadata)
	router.Get("/.well-known/oauth-authorization-server/api/auth", s.serveAuthorizationServerMetadata)
	router.Head("/.well-known/oauth-authorization-server/api/auth", s.serveAuthorizationServerMetadata)
	router.Get("/.well-known/oauth-protected-resource/*", s.serveProtectedResourceMetadata)
	router.Head("/.well-known/oauth-protected-resource/*", s.serveProtectedResourceMetadata)
	router.Get("/api/auth/.well-known/oauth-authorization-server", s.serveAuthorizationServerMetadata)
	router.Head("/api/auth/.well-known/oauth-authorization-server", s.serveAuthorizationServerMetadata)
	router.Post("/api/auth/oauth2/token", s.serveToken)
	router.Get("/api/auth/jwks", s.serveJWKS)
	router.Head("/api/auth/jwks", s.serveJWKS)
}

func (s *MCPOAuthService) serveAuthorizationServerMetadata(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, r, http.StatusOK, map[string]any{
		"issuer":                                s.issuer,
		"token_endpoint":                        s.issuer + "/api/auth/oauth2/token",
		"jwks_uri":                              s.issuer + "/api/auth/jwks",
		"grant_types_supported":                 []string{"client_credentials"},
		"response_types_supported":              []string{},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic"},
		"scopes_supported":                      []string{MCPServiceScope},
	})
}

func (s *MCPOAuthService) serveProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	resource, err := url.Parse(s.config.ResourceURL)
	if err != nil || strings.TrimPrefix(r.URL.Path, "/.well-known/oauth-protected-resource") != resource.Path {
		httpx.WriteProblem(w, r, httpx.E(http.StatusNotFound, "not_found", "OAuth metadata is not configured for this resource."))
		return
	}
	s.writeJSON(w, r, http.StatusOK, map[string]any{
		"resource":                 s.config.ResourceURL,
		"authorization_servers":    []string{s.issuer},
		"scopes_supported":         []string{MCPServiceScope},
		"bearer_methods_supported": []string{"header"},
	})
}

func (s *MCPOAuthService) serveToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	if s.limiter != nil && !s.limiter.Allow("mcp-oauth:token:"+httpx.ClientIP(false)(r), 20, time.Minute) {
		s.oauthError(w, http.StatusTooManyRequests, "slow_down", "Too many token requests.")
		return
	}
	if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-www-form-urlencoded;") {
		s.oauthError(w, http.StatusBadRequest, "invalid_request", "Use application/x-www-form-urlencoded.")
		return
	}
	if err := r.ParseForm(); err != nil {
		s.oauthError(w, http.StatusBadRequest, "invalid_request", "The token request is invalid.")
		return
	}
	clientID, clientSecret, ok := r.BasicAuth()
	if ok {
		decodedID, decodeErr := url.QueryUnescape(clientID)
		if decodeErr == nil {
			clientID = decodedID
			clientSecret, decodeErr = url.QueryUnescape(clientSecret)
		}
		ok = decodeErr == nil
	}
	if !ok || !secureStringEqual(clientID, s.config.ClientID) || !secureStringEqual(clientSecret, s.config.ClientSecret) {
		w.Header().Set("WWW-Authenticate", `Basic realm="Welio OAuth"`)
		s.oauthError(w, http.StatusUnauthorized, "invalid_client", "Client authentication failed.")
		return
	}
	if r.Form.Get("grant_type") != "client_credentials" {
		s.oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "Only client_credentials is supported.")
		return
	}
	if requestedScope := strings.TrimSpace(r.Form.Get("scope")); requestedScope != "" && requestedScope != MCPServiceScope {
		s.oauthError(w, http.StatusBadRequest, "invalid_scope", "The requested scope is not supported.")
		return
	}
	if requestedResource := r.Form.Get("resource"); requestedResource != "" && requestedResource != s.config.ResourceURL {
		s.oauthError(w, http.StatusBadRequest, "invalid_target", "The requested resource is not available to this client.")
		return
	}
	token, err := s.issueToken(r.Context())
	if err != nil {
		httpx.WriteProblem(w, r, httpx.E(http.StatusServiceUnavailable, "oauth_unavailable", "OAuth token service is temporarily unavailable."))
		return
	}
	s.writeJSON(w, r, http.StatusOK, map[string]any{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   int(mcpOAuthTokenTTL.Seconds()),
		"scope":        MCPServiceScope,
	})
}

func (s *MCPOAuthService) serveJWKS(w http.ResponseWriter, r *http.Request) {
	if s.keys == nil {
		httpx.WriteProblem(w, r, httpx.E(http.StatusServiceUnavailable, "oauth_unavailable", "OAuth signing keys are unavailable."))
		return
	}
	keys, err := s.keys.PublicKeys(r.Context())
	if err != nil {
		httpx.WriteProblem(w, r, httpx.E(http.StatusServiceUnavailable, "oauth_unavailable", "OAuth signing keys are temporarily unavailable."))
		return
	}
	public := make([]map[string]string, 0, len(keys))
	for _, key := range keys {
		public = append(public, map[string]string{
			"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(key.PublicKey),
			"alg": "EdDSA", "use": "sig", "kid": key.ID,
		})
	}
	s.writeJSON(w, r, http.StatusOK, map[string]any{"keys": public})
}

func (s *MCPOAuthService) issueToken(ctx context.Context) (string, error) {
	if s.keys == nil || s.issuer == "" || len(s.secret) < 32 {
		return "", errors.New("OAuth service is not configured")
	}
	key, err := s.currentSigningKey(ctx)
	if err != nil {
		return "", err
	}
	privateKey, err := decryptOAuthPrivateKey(s.secret, key.EncryptedPrivateKey)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	claims := mcpOAuthClaims{
		ClientID: s.config.ClientID,
		Scope:    MCPServiceScope,
		Purpose:  "mcp_access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   s.config.ClientID,
			Audience:  jwt.ClaimStrings{s.config.ResourceURL},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(mcpOAuthTokenTTL)),
			ID:        uuid.NewString(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = key.ID
	return token.SignedString(privateKey)
}

func (s *MCPOAuthService) VerifyMCPAccessToken(ctx context.Context, encoded, resourceURL string) error {
	if s.keys == nil || resourceURL != s.config.ResourceURL {
		return errors.New("OAuth resource mismatch")
	}
	claims := new(mcpOAuthClaims)
	parsed, err := jwt.ParseWithClaims(encoded, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodEdDSA {
			return nil, errors.New("unexpected OAuth signing method")
		}
		keyID, ok := token.Header["kid"].(string)
		if !ok || keyID == "" {
			return nil, errors.New("OAuth token has no signing key identifier")
		}
		key, err := s.keys.ByID(ctx, keyID)
		if err != nil {
			return nil, err
		}
		return key.PublicKey, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}), jwt.WithIssuer(s.issuer), jwt.WithAudience(resourceURL), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !parsed.Valid {
		return errors.New("OAuth access token is invalid")
	}
	if claims.Purpose != "mcp_access" || claims.ClientID != s.config.ClientID || claims.Subject != s.config.ClientID || claims.Scope != MCPServiceScope || claims.ID == "" {
		return errors.New("OAuth access token claims are invalid")
	}
	return nil
}

func (s *MCPOAuthService) currentSigningKey(ctx context.Context) (oauthSigningKey, error) {
	key, err := s.keys.Current(ctx)
	if err == nil {
		if time.Since(key.CreatedAt) < mcpOAuthKeyAge {
			return key, nil
		}
		if err := s.keys.Retire(ctx, key.ID, time.Now().UTC().Add(mcpOAuthTokenTTL)); err != nil {
			return oauthSigningKey{}, err
		}
		err = pgx.ErrNoRows
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return oauthSigningKey{}, err
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return oauthSigningKey{}, err
	}
	keyID := uuid.NewString()
	publicJSON, err := json.Marshal(map[string]string{
		"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(public),
		"alg": "EdDSA", "use": "sig", "kid": keyID,
	})
	if err != nil {
		return oauthSigningKey{}, err
	}
	encryptedPrivate, err := encryptOAuthPrivateKey(s.secret, private)
	if err != nil {
		return oauthSigningKey{}, err
	}
	key = oauthSigningKey{ID: keyID, PublicKey: public, EncryptedPrivateKey: encryptedPrivate, CreatedAt: time.Now().UTC()}
	if err := s.keys.Insert(ctx, key, publicJSON); err != nil {
		return oauthSigningKey{}, err
	}
	return key, nil
}

type ed25519JWK struct {
	KTY string `json:"kty"`
	CRV string `json:"crv"`
	X   string `json:"x"`
	KID string `json:"kid"`
}

func parseEd25519JWK(id string, encoded []byte) (ed25519.PublicKey, error) {
	var jwk ed25519JWK
	if err := json.Unmarshal(encoded, &jwk); err != nil {
		return nil, err
	}
	key, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil || jwk.KTY != "OKP" || jwk.CRV != "Ed25519" || jwk.KID != id || len(key) != ed25519.PublicKeySize {
		return nil, errors.New("stored OAuth JWK is invalid")
	}
	return ed25519.PublicKey(key), nil
}

func encryptOAuthPrivateKey(secret, privateKey []byte) ([]byte, error) {
	block, err := aes.NewCipher(oauthEncryptionKey(secret))
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return append(nonce, aead.Seal(nil, nonce, privateKey, []byte("welio-oauth-signing-key-v1"))...), nil
}

func decryptOAuthPrivateKey(secret, encrypted []byte) (ed25519.PrivateKey, error) {
	block, err := aes.NewCipher(oauthEncryptionKey(secret))
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(encrypted) < aead.NonceSize()+aead.Overhead() {
		return nil, errors.New("stored OAuth signing key is invalid")
	}
	nonce, ciphertext := encrypted[:aead.NonceSize()], encrypted[aead.NonceSize():]
	private, err := aead.Open(nil, nonce, ciphertext, []byte("welio-oauth-signing-key-v1"))
	if err != nil || len(private) != ed25519.PrivateKeySize {
		return nil, errors.New("stored OAuth signing key could not be decrypted")
	}
	return ed25519.PrivateKey(private), nil
}

func oauthEncryptionKey(secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("welio/oauth/signing-key/encryption/v1"))
	return mac.Sum(nil)
}

func (s *MCPOAuthService) writeJSON(w http.ResponseWriter, r *http.Request, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodHead {
		w.WriteHeader(status)
		return
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *MCPOAuthService) oauthError(w http.ResponseWriter, status int, code, description string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code, "error_description": description})
}

func secureStringEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return hmac.Equal([]byte(a), []byte(b))
}
