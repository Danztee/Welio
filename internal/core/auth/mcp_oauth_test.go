package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/danztee/welio/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

type memoryOAuthKeys struct {
	mu   sync.RWMutex
	keys map[string]oauthSigningKey
}

func (store *memoryOAuthKeys) Current(context.Context) (oauthSigningKey, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	var current *oauthSigningKey
	for _, key := range store.keys {
		if key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now()) {
			continue
		}
		if current == nil || key.CreatedAt.After(current.CreatedAt) {
			copy := key
			current = &copy
		}
	}
	if current != nil {
		return *current, nil
	}
	return oauthSigningKey{}, pgx.ErrNoRows
}

func (store *memoryOAuthKeys) ByID(_ context.Context, id string) (oauthSigningKey, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	key, ok := store.keys[id]
	if !ok || (key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now())) {
		return oauthSigningKey{}, pgx.ErrNoRows
	}
	return key, nil
}

func (store *memoryOAuthKeys) PublicKeys(context.Context) ([]oauthSigningKey, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	keys := make([]oauthSigningKey, 0, len(store.keys))
	for _, key := range store.keys {
		if key.ExpiresAt == nil || key.ExpiresAt.After(time.Now()) {
			keys = append(keys, oauthSigningKey{ID: key.ID, PublicKey: key.PublicKey})
		}
	}
	return keys, nil
}

func (store *memoryOAuthKeys) Insert(_ context.Context, key oauthSigningKey, _ []byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if key.CreatedAt.IsZero() {
		key.CreatedAt = time.Now().UTC()
	}
	store.keys[key.ID] = key
	return nil
}

func (store *memoryOAuthKeys) Retire(_ context.Context, id string, expiresAt time.Time) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	key, ok := store.keys[id]
	if !ok {
		return pgx.ErrNoRows
	}
	key.ExpiresAt = &expiresAt
	store.keys[id] = key
	return nil
}

func oauthTestService() (*MCPOAuthService, *memoryOAuthKeys) {
	keys := &memoryOAuthKeys{keys: make(map[string]oauthSigningKey)}
	config := MCPOAuthConfig{
		ResourceURL:  "https://bookings.example/api/mcp/lagos-cleaning",
		ClientID:     "alexa-service-client",
		ClientSecret: strings.Repeat("c", 48),
	}
	return newMCPOAuthService(config, []byte(strings.Repeat("s", 40)), keys, httpx.NewLimiter()), keys
}

func TestMCPOAuthMetadataAndTokenExchange(t *testing.T) {
	service, _ := oauthTestService()
	router := chi.NewRouter()
	service.RegisterRoutes(router)

	metadata := httptest.NewRecorder()
	router.ServeHTTP(metadata, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-authorization-server", nil))
	if metadata.Code != http.StatusOK {
		t.Fatalf("authorization metadata status = %d, body = %s", metadata.Code, metadata.Body.String())
	}
	var document map[string]any
	if err := json.Unmarshal(metadata.Body.Bytes(), &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document["issuer"] != "https://bookings.example" || document["token_endpoint"] != "https://bookings.example/api/auth/oauth2/token" {
		t.Fatalf("metadata endpoints = %#v", document)
	}
	if document["grant_types_supported"].([]any)[0] != "client_credentials" {
		t.Fatalf("grant metadata = %#v", document["grant_types_supported"])
	}

	resourceMetadata := httptest.NewRecorder()
	router.ServeHTTP(resourceMetadata, httptest.NewRequest(http.MethodGet,
		"/.well-known/oauth-protected-resource/api/mcp/lagos-cleaning", nil))
	if resourceMetadata.Code != http.StatusOK || !strings.Contains(resourceMetadata.Body.String(), service.config.ResourceURL) {
		t.Fatalf("protected resource metadata = %d %s", resourceMetadata.Code, resourceMetadata.Body.String())
	}

	unauthorized := oauthTokenRequest(router, "other", service.config.ClientSecret, "client_credentials", "", service.config.ResourceURL)
	if unauthorized.Code != http.StatusUnauthorized || !strings.Contains(unauthorized.Body.String(), "invalid_client") {
		t.Fatalf("invalid client status/body = %d %s", unauthorized.Code, unauthorized.Body.String())
	}

	wrongResource := oauthTokenRequest(router, service.config.ClientID, service.config.ClientSecret, "client_credentials", MCPServiceScope, "https://other.example/api/mcp/lagos-cleaning")
	if wrongResource.Code != http.StatusBadRequest || !strings.Contains(wrongResource.Body.String(), "invalid_target") {
		t.Fatalf("wrong resource status/body = %d %s", wrongResource.Code, wrongResource.Body.String())
	}

	response := oauthTokenRequest(router, service.config.ClientID, service.config.ClientSecret, "client_credentials", MCPServiceScope, service.config.ResourceURL)
	if response.Code != http.StatusOK {
		t.Fatalf("token status/body = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Pragma") != "no-cache" {
		t.Fatalf("token cache headers = %#v", response.Header())
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	if tokenResponse.AccessToken == "" || tokenResponse.TokenType != "Bearer" || tokenResponse.ExpiresIn != int(mcpOAuthTokenTTL.Seconds()) || tokenResponse.Scope != MCPServiceScope {
		t.Fatalf("token response = %+v", tokenResponse)
	}
	if err := service.VerifyMCPAccessToken(context.Background(), tokenResponse.AccessToken, service.config.ResourceURL); err != nil {
		t.Fatalf("issued token did not verify: %v", err)
	}
	if err := service.VerifyMCPAccessToken(context.Background(), tokenResponse.AccessToken, "https://other.example/api/mcp/lagos-cleaning"); err == nil {
		t.Fatal("token verified for a different resource")
	}

	jwks := httptest.NewRecorder()
	router.ServeHTTP(jwks, httptest.NewRequest(http.MethodGet, "/api/auth/jwks", nil))
	if jwks.Code != http.StatusOK || !strings.Contains(jwks.Body.String(), `"alg":"EdDSA"`) || !strings.Contains(jwks.Body.String(), `"kty":"OKP"`) {
		t.Fatalf("JWKS response = %d %s", jwks.Code, jwks.Body.String())
	}
}

func TestMCPOAuthRejectsUnsupportedGrantScopeAndBadCredentials(t *testing.T) {
	service, _ := oauthTestService()
	router := chi.NewRouter()
	service.RegisterRoutes(router)

	tests := []struct {
		name       string
		client     string
		secret     string
		grant      string
		scope      string
		wantStatus int
		wantError  string
	}{
		{name: "bad secret", client: "alexa-service-client", secret: strings.Repeat("x", 48), grant: "client_credentials", wantStatus: http.StatusUnauthorized, wantError: "invalid_client"},
		{name: "unsupported grant", client: "alexa-service-client", secret: strings.Repeat("c", 48), grant: "authorization_code", wantStatus: http.StatusBadRequest, wantError: "unsupported_grant_type"},
		{name: "unsupported scope", client: "alexa-service-client", secret: strings.Repeat("c", 48), grant: "client_credentials", scope: "mcp:service other", wantStatus: http.StatusBadRequest, wantError: "invalid_scope"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := oauthTokenRequest(router, test.client, test.secret, test.grant, test.scope, "")
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) {
				t.Fatalf("status/body = %d %s, want %d with %s", response.Code, response.Body.String(), test.wantStatus, test.wantError)
			}
		})
	}
	badContentType := httptest.NewRequest(http.MethodPost, "/api/auth/oauth2/token", strings.NewReader("grant_type=client_credentials"))
	badContentType.Header.Set("Content-Type", "application/json")
	badContentType.SetBasicAuth("alexa-service-client", strings.Repeat("c", 48))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, badContentType)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_request") {
		t.Fatalf("content type status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestMCPOAuthRejectsExpiredAndForgedTokens(t *testing.T) {
	service, _ := oauthTestService()
	key, err := service.currentSigningKey(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	private, err := decryptOAuthPrivateKey(service.secret, key.EncryptedPrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	claims := mcpOAuthClaims{ClientID: service.config.ClientID, Scope: MCPServiceScope, Purpose: "mcp_access", RegisteredClaims: jwt.RegisteredClaims{
		Issuer: service.issuer, Subject: service.config.ClientID, Audience: jwt.ClaimStrings{service.config.ResourceURL},
		IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)), ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)), ID: "expired-token",
	}}
	expired := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	expired.Header["kid"] = key.ID
	encodedExpired, err := expired.SignedString(private)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.VerifyMCPAccessToken(context.Background(), encodedExpired, service.config.ResourceURL); err == nil {
		t.Fatal("expired access token was accepted")
	}
	if err := service.VerifyMCPAccessToken(context.Background(), "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhdHRhY2tlciJ9.invalid", service.config.ResourceURL); err == nil {
		t.Fatal("forged access token was accepted")
	}
	if _, err := decryptOAuthPrivateKey([]byte("different server secret"), key.EncryptedPrivateKey); err == nil {
		t.Fatal("private OAuth key decrypted with an unrelated auth secret")
	}
}

func TestMCPOAuthRotatesSigningKeysAndKeepsOverlapForActiveTokens(t *testing.T) {
	service, keys := oauthTestService()
	old, err := service.currentSigningKey(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	keys.mu.Lock()
	stored := keys.keys[old.ID]
	stored.CreatedAt = time.Now().Add(-mcpOAuthKeyAge)
	keys.keys[old.ID] = stored
	keys.mu.Unlock()

	current, err := service.currentSigningKey(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if current.ID == old.ID {
		t.Fatal("old signing key was not rotated")
	}
	retired, err := keys.ByID(context.Background(), old.ID)
	if err != nil || retired.ExpiresAt == nil || time.Until(*retired.ExpiresAt) > mcpOAuthTokenTTL || time.Until(*retired.ExpiresAt) <= 0 {
		t.Fatalf("retired key expiry = %v, err = %v", retired.ExpiresAt, err)
	}
	publicKeys, err := keys.PublicKeys(context.Background())
	if err != nil || len(publicKeys) != 2 {
		t.Fatalf("JWKS overlap keys = %d, err = %v; want active plus overlap", len(publicKeys), err)
	}
}

func oauthTokenRequest(router http.Handler, clientID, clientSecret, grant, scope, resource string) *httptest.ResponseRecorder {
	form := "grant_type=" + grant
	if scope != "" {
		form += "&scope=" + scope
	}
	if resource != "" {
		form += "&resource=" + resource
	}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/oauth2/token", strings.NewReader(form))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth(clientID, clientSecret)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

var _ oauthSigningKeyStore = (*memoryOAuthKeys)(nil)
