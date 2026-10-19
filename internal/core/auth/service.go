package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/jobs"
)

const (
	RefreshCookieName = "welio_refresh"
	AccessCookieName  = "welio_access"
	refreshReuseGrace = 30 * time.Second
	verifyTokenTTL    = 24 * time.Hour
	resetTokenTTL     = 30 * time.Minute
)

type Service struct {
	DB      *db.DB
	Tokens  *Tokens
	Limiter *httpx.Limiter
	Cfg     config.Config
	Log     *slog.Logger
	Jobs    *river.Client[pgx.Tx]
}

type User struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	FirstName     string    `json:"first_name"`
	LastName      string    `json:"last_name"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	Image         *string   `json:"image,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type AuthResult struct {
	User                 *User    `json:"user,omitempty"`
	VerificationRequired bool     `json:"verification_required,omitempty"`
	ExpiresIn            int      `json:"expires_in,omitempty"`
	SetCookie            []string `json:"-"`
}

type RegisterInput struct {
	FirstName string
	LastName  string
	Email     string
	Password  string
}

type LoginInput struct {
	Email    string
	Password string
}

func (s *Service) Register(ctx context.Context, input RegisterInput, meta httpx.RequestMeta) (*AuthResult, error) {
	if !s.Cfg.SignupEnabled {
		return nil, httpx.E(403, "signup_disabled", "New account creation is currently disabled.")
	}
	if !s.Limiter.Allow("register:ip:"+meta.IP, 10, time.Hour) {
		return nil, rateLimited()
	}
	input.FirstName = strings.TrimSpace(input.FirstName)
	input.LastName = strings.TrimSpace(input.LastName)
	if !validPersonName(input.FirstName) || !validPersonName(input.LastName) {
		return nil, httpx.E(422, "invalid_name", "Enter a first and last name of 1–50 characters each.")
	}
	emailAddress, err := normalizeEmail(input.Email)
	if err != nil {
		return nil, httpx.E(422, "invalid_email", "Enter a valid email address.")
	}
	if err := CheckPassword(input.Password); err != nil {
		return nil, httpx.E(422, "weak_password", err.Error())
	}
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return nil, err
	}
	name := input.FirstName + " " + input.LastName
	var user User
	var token string
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `INSERT INTO users (name, first_name, last_name, email, email_verified, password_hash)
			VALUES ($1, $2, $3, $4, false, $5)
			RETURNING id, name, first_name, last_name, email, email_verified, image, created_at`,
			name, input.FirstName, input.LastName, emailAddress, passwordHash)
		if err := row.Scan(&user.ID, &user.Name, &user.FirstName, &user.LastName, &user.Email, &user.EmailVerified, &user.Image, &user.CreatedAt); err != nil {
			if db.IsUniqueViolation(err, "users_email_unique") {
				return httpx.E(409, "email_in_use", "An account already exists for this email address.")
			}
			return err
		}
		var err error
		token, err = s.createToken(ctx, tx, user.ID, user.Email, "verify_email", verifyTokenTTL)
		if err != nil {
			return err
		}
		return s.enqueueTokenMail(ctx, tx, user.Email, "verify_email", token)
	})
	if err != nil {
		return nil, err
	}
	return &AuthResult{User: &user, VerificationRequired: true}, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput, meta httpx.RequestMeta) (*AuthResult, error) {
	if !s.Limiter.Allow("login:ip:"+meta.IP, 30, 15*time.Minute) {
		return nil, rateLimited()
	}
	emailAddress, err := normalizeEmail(input.Email)
	if err != nil {
		DummyVerify(input.Password)
		return nil, invalidCredentials()
	}
	if !s.Limiter.Allow("login:email:"+emailAddress, 10, 15*time.Minute) {
		return nil, rateLimited()
	}
	var user User
	var passwordHash *string
	err = s.DB.Pool.QueryRow(ctx, `SELECT u.id, u.name, COALESCE(u.first_name, ''), COALESCE(u.last_name, ''),
		u.email, u.email_verified, u.image, u.created_at, u.password_hash
		FROM users u WHERE lower(u.email) = $1`, emailAddress).
		Scan(&user.ID, &user.Name, &user.FirstName, &user.LastName, &user.Email, &user.EmailVerified, &user.Image, &user.CreatedAt, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		DummyVerify(input.Password)
		return nil, invalidCredentials()
	}
	if err != nil {
		return nil, err
	}
	if passwordHash == nil || *passwordHash == "" {
		DummyVerify(input.Password)
		return nil, invalidCredentials()
	}
	if !VerifyPassword(input.Password, *passwordHash) {
		return nil, invalidCredentials()
	}
	if !user.EmailVerified {
		return nil, httpx.E(403, "email_not_verified", "Verify your email address before signing in.")
	}
	refresh, err := randomToken()
	if err != nil {
		return nil, err
	}
	sessionID := uuid.New()
	now := time.Now().UTC()
	access, _, err := s.Tokens.Sign(Claims{Purpose: PurposeAccess, SessionID: sessionID.String()}, user.ID.String(), AccessTTL)
	if err != nil {
		return nil, err
	}
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO welio_auth_sessions
			(id, user_id, refresh_hash, ip_address, user_agent, expires_at, max_expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, sessionID, user.ID, hashToken(refresh), meta.IP,
			meta.UserAgent, now.Add(RefreshTTL), now.Add(SessionMaxAge))
		return err
	})
	if err != nil {
		return nil, err
	}
	return &AuthResult{User: &user, ExpiresIn: int(AccessTTL.Seconds()), SetCookie: s.sessionCookies(access, refresh)}, nil
}

func (s *Service) Refresh(ctx context.Context, refresh string, meta httpx.RequestMeta) (*AuthResult, error) {
	if refresh == "" {
		return nil, invalidSession()
	}
	var result *AuthResult
	var failure error
	err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var user User
		var sessionID uuid.UUID
		var createdAt, expiresAt, maxExpiresAt time.Time
		query := `SELECT s.id, s.created_at, s.expires_at, s.max_expires_at,
			u.id, u.name, COALESCE(u.first_name, ''), COALESCE(u.last_name, ''), u.email, u.email_verified, u.image, u.created_at
			FROM welio_auth_sessions s JOIN users u ON u.id = s.user_id
			WHERE s.refresh_hash = $1 AND s.revoked_at IS NULL FOR UPDATE OF s`
		err := tx.QueryRow(ctx, query, hashToken(refresh)).Scan(&sessionID, &createdAt, &expiresAt, &maxExpiresAt,
			&user.ID, &user.Name, &user.FirstName, &user.LastName, &user.Email, &user.EmailVerified, &user.Image, &user.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			var previousSessionID uuid.UUID
			var rotatedAt *time.Time
			err = tx.QueryRow(ctx, `SELECT id, rotated_at FROM welio_auth_sessions
				WHERE previous_refresh_hash = $1 AND revoked_at IS NULL FOR UPDATE`, hashToken(refresh)).Scan(&previousSessionID, &rotatedAt)
			if errors.Is(err, pgx.ErrNoRows) {
				failure = invalidSession()
				return nil
			}
			if err != nil {
				return err
			}
			if rotatedAt != nil && time.Since(*rotatedAt) <= refreshReuseGrace {
				failure = httpx.E(401, "refresh_race", "Your session was refreshed in another request. Retry with the latest session cookie.")
				return nil
			}
			if _, err := tx.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now() WHERE id = $1`, previousSessionID); err != nil {
				return err
			}
			failure = invalidSession()
			return nil
		}
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if !expiresAt.After(now) || !maxExpiresAt.After(now) || now.Sub(createdAt) > SessionMaxAge {
			if _, err := tx.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now() WHERE id = $1`, sessionID); err != nil {
				return err
			}
			failure = invalidSession()
			return nil
		}
		nextRefresh, err := randomToken()
		if err != nil {
			return err
		}
		access, _, err := s.Tokens.Sign(Claims{Purpose: PurposeAccess, SessionID: sessionID.String()}, user.ID.String(), AccessTTL)
		if err != nil {
			return err
		}
		nextExpiry := now.Add(RefreshTTL)
		if nextExpiry.After(maxExpiresAt) {
			nextExpiry = maxExpiresAt
		}
		if _, err := tx.Exec(ctx, `UPDATE welio_auth_sessions SET previous_refresh_hash = refresh_hash,
			refresh_hash = $2, rotated_at = now(), last_used_at = now(), expires_at = $3,
			ip_address = $4, user_agent = $5 WHERE id = $1`, sessionID, hashToken(nextRefresh), nextExpiry, meta.IP, meta.UserAgent); err != nil {
			return err
		}
		result = &AuthResult{User: &user, ExpiresIn: int(AccessTTL.Seconds()), SetCookie: s.sessionCookies(access, nextRefresh)}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if failure != nil {
		return nil, failure
	}
	return result, nil
}

func (s *Service) Logout(ctx context.Context, principal *Principal, refresh string) ([]string, error) {
	if principal != nil {
		_, err := s.DB.Pool.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now()
			WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, principal.SessionID, principal.UserID)
		if err != nil {
			return nil, err
		}
	} else if refresh != "" {
		if _, err := s.DB.Pool.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now()
			WHERE refresh_hash = $1 AND revoked_at IS NULL`, hashToken(refresh)); err != nil {
			return nil, err
		}
	}
	return s.clearCookies(), nil
}

func (s *Service) GetMe(ctx context.Context, principal *Principal) (*User, error) {
	var user User
	err := s.DB.Pool.QueryRow(ctx, `SELECT id, name, COALESCE(first_name, ''), COALESCE(last_name, ''),
		email, email_verified, image, created_at FROM users WHERE id = $1`, principal.UserID).
		Scan(&user.ID, &user.Name, &user.FirstName, &user.LastName, &user.Email, &user.EmailVerified, &user.Image, &user.CreatedAt)
	return &user, err
}

func (s *Service) GetCurrentSession(ctx context.Context, principal *Principal) (*Session, error) {
	var session Session
	err := s.DB.Pool.QueryRow(ctx, `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at
		FROM welio_auth_sessions
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() AND max_expires_at > now()`,
		principal.SessionID, principal.UserID).
		Scan(&session.ID, &session.UserAgent, &session.IPAddress, &session.CreatedAt, &session.LastUsedAt, &session.ExpiresAt)
	if err != nil {
		return nil, err
	}
	session.Current = true
	return &session, nil
}

func (s *Service) UpdateMe(ctx context.Context, principal *Principal, firstName, lastName string) (*User, error) {
	firstName, lastName = strings.TrimSpace(firstName), strings.TrimSpace(lastName)
	if !validPersonName(firstName) || !validPersonName(lastName) {
		return nil, httpx.E(422, "invalid_name", "Enter a first and last name of 1–50 characters each.")
	}
	var user User
	err := s.DB.Pool.QueryRow(ctx, `UPDATE users SET first_name = $2, last_name = $3, name = $2 || ' ' || $3, updated_at = now()
		WHERE id = $1 RETURNING id, name, first_name, last_name, email, email_verified, image, created_at`,
		principal.UserID, firstName, lastName).Scan(&user.ID, &user.Name, &user.FirstName, &user.LastName, &user.Email, &user.EmailVerified, &user.Image, &user.CreatedAt)
	return &user, err
}

func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	return s.consumeToken(ctx, token, "verify_email", func(tx pgx.Tx, userID uuid.UUID) error {
		_, err := tx.Exec(ctx, `UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1`, userID)
		return err
	})
}

func (s *Service) ResendVerification(ctx context.Context, email string, meta httpx.RequestMeta) error {
	emailAddress, err := normalizeEmail(email)
	if err != nil {
		return nil
	}
	if !s.Limiter.Allow("verify:ip:"+meta.IP, 10, time.Hour) || !s.Limiter.Allow("verify:email:"+emailAddress, 3, time.Hour) {
		return nil
	}
	var userID uuid.UUID
	var verified bool
	err = s.DB.Pool.QueryRow(ctx, `SELECT id, email_verified FROM users WHERE lower(email) = $1`, emailAddress).Scan(&userID, &verified)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && verified {
		return nil
	}
	if err != nil {
		return err
	}
	var token string
	if err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		token, err = s.createToken(ctx, tx, userID, emailAddress, "verify_email", verifyTokenTTL)
		if err != nil {
			return err
		}
		return s.enqueueTokenMail(ctx, tx, emailAddress, "verify_email", token)
	}); err != nil {
		return err
	}
	return nil
}

func (s *Service) RequestPasswordReset(ctx context.Context, email string, meta httpx.RequestMeta) error {
	if !s.Limiter.Allow("reset:ip:"+meta.IP, 10, time.Hour) {
		return nil
	}
	emailAddress, err := normalizeEmail(email)
	if err != nil || !s.Limiter.Allow("reset:email:"+emailAddress, 3, time.Hour) {
		return nil
	}
	var userID uuid.UUID
	err = s.DB.Pool.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = $1`, emailAddress).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var token string
	if err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		token, err = s.createToken(ctx, tx, userID, emailAddress, "reset_password", resetTokenTTL)
		if err != nil {
			return err
		}
		return s.enqueueTokenMail(ctx, tx, emailAddress, "reset_password", token)
	}); err != nil {
		return err
	}
	return nil
}

func (s *Service) ResetPassword(ctx context.Context, token, password string) error {
	if err := CheckPassword(password); err != nil {
		return httpx.E(422, "weak_password", err.Error())
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	return s.consumeToken(ctx, token, "reset_password", func(tx pgx.Tx, userID uuid.UUID) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, userID, hash); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
		return err
	})
}

func (s *Service) ListSessions(ctx context.Context, principal *Principal) ([]Session, error) {
	rows, err := s.DB.Pool.Query(ctx, `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at
		FROM welio_auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
		ORDER BY last_used_at DESC`, principal.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := make([]Session, 0)
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.ID, &session.UserAgent, &session.IPAddress, &session.CreatedAt, &session.LastUsedAt, &session.ExpiresAt); err != nil {
			return nil, err
		}
		session.Current = session.ID == principal.SessionID
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

type Session struct {
	ID         uuid.UUID `json:"id"`
	UserAgent  *string   `json:"user_agent,omitempty"`
	IPAddress  *string   `json:"ip_address,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt time.Time `json:"last_used_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	Current    bool      `json:"current"`
}

func (s *Service) RevokeSession(ctx context.Context, principal *Principal, sessionID uuid.UUID) error {
	result, err := s.DB.Pool.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, sessionID, principal.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return httpx.E(404, "not_found", "Session not found.")
	}
	return nil
}

func (s *Service) RevokeOtherSessions(ctx context.Context, principal *Principal) error {
	_, err := s.DB.Pool.Exec(ctx, `UPDATE welio_auth_sessions SET revoked_at = now()
		WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, principal.UserID, principal.SessionID)
	return err
}

func (s *Service) createToken(ctx context.Context, tx pgx.Tx, userID uuid.UUID, emailAddress, purpose string, ttl time.Duration) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE welio_auth_tokens SET consumed_at = now()
		WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`, emailAddress, purpose); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO welio_auth_tokens (user_id, email, purpose, token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5)`, userID, emailAddress, purpose, hashToken(token), time.Now().UTC().Add(ttl))
	return token, err
}

func (s *Service) consumeToken(ctx context.Context, token, purpose string, action func(pgx.Tx, uuid.UUID) error) error {
	if token == "" || len(token) > 200 {
		return invalidToken()
	}
	var failure error
	err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var userID uuid.UUID
		var nullableUserID *uuid.UUID
		rowErr := tx.QueryRow(ctx, `SELECT user_id FROM welio_auth_tokens
			WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, hashToken(token), purpose).
			Scan(&nullableUserID)
		if errors.Is(rowErr, pgx.ErrNoRows) || nullableUserID == nil {
			failure = invalidToken()
			return nil
		}
		if rowErr != nil {
			return rowErr
		}
		userID = *nullableUserID
		if _, err := tx.Exec(ctx, `UPDATE welio_auth_tokens SET consumed_at = now() WHERE token_hash = $1`, hashToken(token)); err != nil {
			return err
		}
		return action(tx, userID)
	})
	if err != nil {
		return err
	}
	if failure != nil {
		return failure
	}
	return nil
}

func (s *Service) enqueueTokenMail(ctx context.Context, tx pgx.Tx, emailAddress, purpose, token string) error {
	path, subject, instruction := "/verify-email", "Verify your Welio email", "Confirm your email address"
	if purpose == "reset_password" {
		path, subject, instruction = "/reset-password", "Reset your Welio password", "Choose a new password"
	}
	base, err := url.Parse(strings.TrimSuffix(s.Cfg.PublicURL, "/") + path)
	if err != nil {
		return fmt.Errorf("build auth email URL: %w", err)
	}
	query := base.Query()
	query.Set("token", token)
	if purpose == "verify_email" {
		query.Set("email", emailAddress)
	}
	base.RawQuery = query.Encode()
	return jobs.EnqueueSystemEmailTx(ctx, tx, s.Jobs, jobs.SystemEmailArgs{
		To: emailAddress, Subject: subject,
		Text:          fmt.Sprintf("%s by opening this link:\n\n%s\n\nIf you did not request this, you can ignore this email.", instruction, base.String()),
		AuthTokenHash: hashToken(token), AuthTokenPurpose: purpose,
	})
}

func (s *Service) sessionCookies(access, refresh string) []string {
	return []string{cookie(AccessCookieName, access, "/", 15*time.Minute, s.Cfg),
		cookie(RefreshCookieName, refresh, s.Cfg.AuthCookiePath, RefreshTTL, s.Cfg)}
}

func (s *Service) clearCookies() []string {
	return []string{clearCookie(AccessCookieName, "/", s.Cfg), clearCookie(RefreshCookieName, s.Cfg.AuthCookiePath, s.Cfg)}
}

func cookie(name, value, path string, ttl time.Duration, cfg config.Config) string {
	return (&http.Cookie{Name: name, Value: value, Path: path, Domain: cfg.CookieDomain, HttpOnly: true,
		Secure: cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds())}).String()
}

func clearCookie(name, path string, cfg config.Config) string {
	return (&http.Cookie{Name: name, Value: "", Path: path, Domain: cfg.CookieDomain, HttpOnly: true,
		Secure: cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(0, 0)}).String()
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 254 || strings.ContainsAny(value, "\r\n") {
		return "", errors.New("invalid email")
	}
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || !strings.Contains(value, "@") {
		return "", errors.New("invalid email")
	}
	return value, nil
}

func validPersonName(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 1 && length <= 50 && !strings.ContainsAny(value, "\r\n")
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate auth token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashToken(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func invalidCredentials() *httpx.Error {
	return httpx.E(401, "invalid_credentials", "The email or password is incorrect.")
}

func invalidSession() *httpx.Error {
	return httpx.E(401, "unauthenticated", "Your session has ended. Sign in again.")
}

func invalidToken() *httpx.Error {
	return httpx.E(400, "invalid_token", "This link is invalid or has expired.")
}

func rateLimited() *httpx.Error {
	return httpx.E(429, "rate_limited", "Too many attempts. Please wait a minute and try again.")
}
