package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

type configuredMailer struct{}

func (configuredMailer) Send(context.Context, mailer.Message) error { return nil }

func newIntegrationService(t *testing.T) *Service {
	t.Helper()
	database := dbtest.OpenTestDB(t)
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(nil), &river.Config{})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	cfg := config.Config{Env: "test", PublicURL: "http://localhost:3000", SignupEnabled: true,
		AuthCookiePath: "/v1/auth", CookieSecure: true, AuthSecret: []byte(strings.Repeat("s", 32))}
	return &Service{DB: database, Tokens: NewTokens(cfg.AuthSecret), Limiter: httpx.NewLimiter(), Cfg: cfg,
		Log: slog.Default(), Mailer: configuredMailer{}, Jobs: jobs}
}

func TestAuthRegistrationVerificationResetAndSessions(t *testing.T) {
	service := newIntegrationService(t)
	ctx := context.Background()
	meta := httpx.RequestMeta{IP: "127.0.0.1", UserAgent: "Welio test", Origin: "http://localhost:3000"}
	emailAddress := "auth-" + uuid.NewString() + "@example.test"
	password := "Welio-Example-Password-2026"

	registered, err := service.Register(ctx, RegisterInput{FirstName: "Ada", LastName: "Lovelace", Email: emailAddress, Password: password}, meta)
	if err != nil || !registered.VerificationRequired || registered.User.EmailVerified {
		t.Fatalf("Register() = %+v, %v", registered, err)
	}
	verifyToken := tokenFromMail(t, latestQueuedMail(t, service, emailAddress))
	if err := service.VerifyEmail(ctx, verifyToken); err != nil {
		t.Fatalf("VerifyEmail() = %v", err)
	}
	if err := service.VerifyEmail(ctx, verifyToken); err == nil {
		t.Fatal("accepted a consumed verification token")
	}

	firstSession, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: password}, meta)
	if err != nil {
		t.Fatalf("Login() = %v", err)
	}
	assertSecureSessionCookies(t, firstSession.SetCookie)
	firstRefresh := cookieValue(t, firstSession.SetCookie, RefreshCookieName)
	rotated, err := service.Refresh(ctx, firstRefresh, meta)
	if err != nil {
		t.Fatalf("Refresh() = %v", err)
	}
	assertSecureSessionCookies(t, rotated.SetCookie)
	if cookieValue(t, rotated.SetCookie, RefreshCookieName) == firstRefresh {
		t.Fatal("refresh token was not rotated")
	}

	secondSession, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: password}, meta)
	if err != nil {
		t.Fatalf("second Login() = %v", err)
	}
	secondAccess := cookieValue(t, secondSession.SetCookie, AccessCookieName)
	claims, err := service.Tokens.Verify(secondAccess, PurposeAccess)
	if err != nil {
		t.Fatal(err)
	}
	principal := &Principal{UserID: registered.User.ID}
	principal.SessionID, err = uuid.Parse(claims.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	currentSession, err := service.GetCurrentSession(ctx, principal)
	if err != nil || currentSession.ID != principal.SessionID || !currentSession.Current {
		t.Fatalf("GetCurrentSession() = %+v, %v", currentSession, err)
	}
	sessions, err := service.ListSessions(ctx, principal)
	if err != nil || len(sessions) != 2 {
		t.Fatalf("ListSessions() = %d, %v", len(sessions), err)
	}
	if err := service.RevokeOtherSessions(ctx, principal); err != nil {
		t.Fatalf("RevokeOtherSessions() = %v", err)
	}
	sessions, err = service.ListSessions(ctx, principal)
	if err != nil || len(sessions) != 1 || !sessions[0].Current {
		t.Fatalf("sessions after revoke others = %+v, %v", sessions, err)
	}

	if err := service.RequestPasswordReset(ctx, emailAddress, meta); err != nil {
		t.Fatal(err)
	}
	resetToken := tokenFromMail(t, latestQueuedMail(t, service, emailAddress))
	newPassword := "Welio-Updated-Password-2026!"
	if err := service.ResetPassword(ctx, resetToken, newPassword); err != nil {
		t.Fatalf("ResetPassword() = %v", err)
	}
	if sessions, err = service.ListSessions(ctx, principal); err != nil || len(sessions) != 0 {
		t.Fatalf("sessions after password reset = %+v, %v", sessions, err)
	}
	if _, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: password}, meta); err == nil {
		t.Fatal("old password still works after reset")
	}
	if _, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: newPassword}, meta); err != nil {
		t.Fatalf("new password login = %v", err)
	}
}

func TestRefreshReplayRevokesSession(t *testing.T) {
	service := newIntegrationService(t)
	ctx := context.Background()
	meta := httpx.RequestMeta{IP: "127.0.0.2", UserAgent: "Welio test"}
	emailAddress := "session-" + uuid.NewString() + "@example.test"
	const password = "Correct Horse Battery Staple 2026!"
	if _, err := service.Register(ctx, RegisterInput{FirstName: "Test", LastName: "User", Email: emailAddress, Password: password}, meta); err != nil {
		t.Fatal(err)
	}
	if err := service.VerifyEmail(ctx, tokenFromMail(t, latestQueuedMail(t, service, emailAddress))); err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: password}, meta)
	if err != nil {
		t.Fatalf("Login() = %v", err)
	}

	oldRefresh := cookieValue(t, login.SetCookie, RefreshCookieName)
	rotated, err := service.Refresh(ctx, oldRefresh, meta)
	if err != nil {
		t.Fatalf("first refresh = %v", err)
	}
	if _, err := service.Refresh(ctx, oldRefresh, meta); err == nil {
		t.Fatal("concurrent refresh reuse should return a retry response")
	}
	if _, err := service.DB.Pool.Exec(ctx, `UPDATE welio_auth_sessions SET rotated_at = now() - interval '31 seconds' WHERE previous_refresh_hash = $1`, hashToken(oldRefresh)); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(ctx, oldRefresh, meta); err == nil {
		t.Fatal("replayed refresh token should fail")
	}
	var revoked bool
	if err := service.DB.Pool.QueryRow(ctx, `SELECT revoked_at IS NOT NULL FROM welio_auth_sessions WHERE previous_refresh_hash = $1`, hashToken(oldRefresh)).Scan(&revoked); err != nil || !revoked {
		t.Fatalf("replay revocation = %v, %v", revoked, err)
	}
	if _, err := service.Refresh(ctx, cookieValue(t, rotated.SetCookie, RefreshCookieName), meta); err == nil {
		t.Fatal("session still refreshed after replay revocation")
	}
}

func TestLoginFailuresUseSameProblemAndUnverifiedAccountsAreBlocked(t *testing.T) {
	service := newIntegrationService(t)
	ctx := context.Background()
	meta := httpx.RequestMeta{IP: "127.0.0.3"}
	emailAddress := "unverified-" + uuid.NewString() + "@example.test"
	if _, err := service.Register(ctx, RegisterInput{FirstName: "Grace", LastName: "Hopper", Email: emailAddress,
		Password: "Welio-Example-Password-2026"}, meta); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Login(ctx, LoginInput{Email: emailAddress, Password: "Welio-Example-Password-2026"}, meta); err == nil || errorCode(err) != "email_not_verified" {
		t.Fatalf("unverified login error = %v", err)
	}
	_, unknownErr := service.Login(ctx, LoginInput{Email: "absent-" + uuid.NewString() + "@example.test", Password: "Welio-Example-Password-2026"}, meta)
	_, wrongPasswordErr := service.Login(ctx, LoginInput{Email: emailAddress, Password: "Not the account password"}, meta)
	if errorCode(unknownErr) != "invalid_credentials" || errorCode(wrongPasswordErr) != "invalid_credentials" {
		t.Fatalf("login errors differ: unknown=%v wrong=%v", unknownErr, wrongPasswordErr)
	}
}

func tokenFromMail(t *testing.T, message mailer.Message) string {
	t.Helper()
	for _, line := range strings.Split(message.Text, "\n") {
		if strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") {
			parsed, err := url.Parse(line)
			if err != nil {
				t.Fatal(err)
			}
			return parsed.Query().Get("token")
		}
	}
	t.Fatal("auth email did not contain a link")
	return ""
}

func latestQueuedMail(t *testing.T, service *Service, to string) mailer.Message {
	t.Helper()
	var raw []byte
	err := service.DB.Pool.QueryRow(context.Background(), `SELECT args FROM river_job
		WHERE kind=$1 AND args->>'to'=$2 ORDER BY id DESC LIMIT 1`, "mail.system", to).Scan(&raw)
	if err != nil {
		t.Fatalf("load queued system email: %v", err)
	}
	var args jobs.SystemEmailArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		t.Fatalf("decode queued system email: %v", err)
	}
	return mailer.Message{To: args.To, Subject: args.Subject, Text: args.Text}
}

func cookieValue(t *testing.T, cookies []string, name string) string {
	t.Helper()
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie, name+"=") {
			return strings.SplitN(strings.TrimPrefix(cookie, name+"="), ";", 2)[0]
		}
	}
	t.Fatalf("cookie %q missing from %v", name, cookies)
	return ""
}

func assertSecureSessionCookies(t *testing.T, cookies []string) {
	t.Helper()
	if len(cookies) != 2 {
		t.Fatalf("session cookies = %v", cookies)
	}
	for _, raw := range cookies {
		if !strings.Contains(raw, "HttpOnly") || !strings.Contains(raw, "Secure") || !strings.Contains(raw, "SameSite=Lax") {
			t.Errorf("insecure session cookie: %s", raw)
		}
	}
	if !strings.Contains(cookies[1], "Path=/v1/auth") {
		t.Errorf("refresh cookie path is not scoped to auth routes: %s", cookies[1])
	}
}

func errorCode(err error) string {
	var problem *httpx.Error
	if errors.As(err, &problem) {
		return problem.Code
	}
	return ""
}
