package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"github.com/danztee/welio/internal/config"
)

func TestAuthOutputDeliversSeparateSessionCookiesOverHTTP(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "test"))
	huma.Register(api, huma.Operation{OperationID: "cookie-fixture", Method: http.MethodPost, Path: "/fixture"}, func(context.Context, *struct{}) (*authOutput, error) {
		return output(&AuthResult{SetCookie: []string{"welio_access=access; Path=/; HttpOnly", "welio_refresh=refresh; Path=/v1/auth; HttpOnly"}}), nil
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/fixture", nil))
	cookies := response.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != AccessCookieName || cookies[1].Name != RefreshCookieName {
		t.Fatalf("HTTP session cookies missing: names/count=%v", len(cookies))
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("account output is cacheable")
	}
}

func TestLogoutDeliversCookieDeletionHeaders(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "test"))
	RegisterAPI(&Service{Cfg: config.Config{AuthCookiePath: "/v1/auth"}}, api)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil))
	cookies := response.Result().Cookies()
	if response.Code != 204 || len(cookies) != 2 {
		t.Fatalf("logout status=%d cookie count=%d", response.Code, len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.MaxAge >= 0 {
			t.Fatalf("cookie %s was not deleted", cookie.Name)
		}
	}
}
