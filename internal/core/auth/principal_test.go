package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

func TestResolverDatabaseFailureDoesNotExpireSession(t *testing.T) {
	t.Parallel()
	pool, err := pgxpool.New(t.Context(), "postgres://unused:unused@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	tokens := NewTokens([]byte(strings.Repeat("s", 32)))
	token, _, err := tokens.Sign(Claims{Purpose: PurposeAccess, SessionID: uuid.NewString()}, uuid.NewString(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	resolver := &Resolver{DB: &db.DB{Pool: pool}, Tokens: tokens}
	called := false
	handler := httpx.RequestMetaMiddleware(resolver.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, err := RequireUser(r.Context()); err != nil {
			httpx.WriteProblem(w, r, httpx.E(http.StatusUnauthorized, "unauthenticated", err.Error()))
		}
	})))
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: AccessCookieName, Value: token})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("database failure returned %d, want 503; body=%s", response.Code, response.Body.String())
	}
	if called {
		t.Fatal("unavailable authentication reached the protected handler")
	}
	if len(response.Result().Cookies()) != 0 {
		t.Fatal("a database outage must not clear the browser session")
	}
}
