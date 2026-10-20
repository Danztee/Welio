package httpx

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCORSRejectsUntrustedOrigin(t *testing.T) {
	handler := CORS([]string{"https://app.example"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/workspaces", nil)
	req.Header.Set("Origin", "https://attacker.example")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden || !strings.Contains(res.Body.String(), "origin_not_allowed") {
		t.Fatalf("response = %d %s", res.Code, res.Body.String())
	}
}

func TestCORSExposesSessionLifetimeToTrustedBrowser(t *testing.T) {
	t.Parallel()
	handler := CORS([]string{"https://app.example"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(AccessTTLHeader, "30")
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.Header.Set("Origin", "https://app.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Header().Get(AccessTTLHeader) != "30" || !strings.Contains(response.Header().Get("Access-Control-Expose-Headers"), AccessTTLHeader) {
		t.Fatal("browser cannot read the session lifetime from the API response")
	}
}

func TestCORSRequiresOriginForCookieAuthenticatedWrites(t *testing.T) {
	handler := CORS([]string{"https://app.example"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, test := range []struct {
		name       string
		origin     string
		fetchSite  string
		wantStatus int
	}{
		{name: "missing origin", wantStatus: http.StatusForbidden},
		{name: "cross site", origin: "https://app.example", fetchSite: "cross-site", wantStatus: http.StatusForbidden},
		{name: "trusted same origin", origin: "https://app.example", fetchSite: "same-origin", wantStatus: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/me", nil)
			req.AddCookie(&http.Cookie{Name: "welio_access", Value: "token"})
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", test.fetchSite)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != test.wantStatus {
				t.Fatalf("response = %d %s, want %d", res.Code, res.Body.String(), test.wantStatus)
			}
		})
	}
}

func TestLimiterUsesBoundedFixedWindows(t *testing.T) {
	limiter := NewLimiter()
	clock := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return clock }
	if !limiter.Allow("ip:1", 2, time.Minute) || !limiter.Allow("ip:1", 2, time.Minute) || limiter.Allow("ip:1", 2, time.Minute) {
		t.Fatal("fixed window did not enforce its limit")
	}
	clock = clock.Add(time.Minute)
	if !limiter.Allow("ip:1", 2, time.Minute) {
		t.Fatal("fixed window did not reset")
	}
}

func TestClientIPTrustsForwardedHeadersOnlyWhenConfigured(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "10.0.0.8:443"
	request.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	request.Header.Set("CF-Connecting-IP", "198.51.100.7")
	if got := ClientIP(false)(request); got != "10.0.0.8" {
		t.Fatalf("untrusted forwarded headers produced %q, want remote address", got)
	}
	if got := ClientIP(true)(request); got != "198.51.100.7" {
		t.Fatalf("trusted Cloudflare address = %q, want 198.51.100.7", got)
	}

	request.Header.Del("CF-Connecting-IP")
	if got := ClientIP(true)(request); got != "203.0.113.9" {
		t.Fatalf("trusted forwarded address = %q, want first X-Forwarded-For address", got)
	}

	request.Header.Set("X-Forwarded-For", "not-an-ip")
	if got := ClientIP(true)(request); got != "10.0.0.8" {
		t.Fatalf("invalid forwarded address = %q, want remote address", got)
	}
}

func TestHTTPMiddlewarePreservesFlusher(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := http.Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("HTTP middleware removed http.Flusher")
		}
		flusher.Flush()
	}))
	handler = MaxBodyBytes(1024)(handler)
	handler = CORS(nil)(handler)
	handler = SecurityHeaders(false)(handler)
	handler = Recover(log)(handler)
	handler = Logger(log)(handler)
	handler = RequestMetaMiddleware(handler)
	handler = RequestID(handler)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/stream", nil))
	if !response.Flushed {
		t.Fatal("flush was not forwarded to the underlying response writer")
	}
}

func TestRecoverWritesProblemBeforeResponseIsCommitted(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := Recover(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("unexpected failure")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"internal"`) {
		t.Fatalf("response = %d %s, want an internal problem response", response.Code, response.Body.String())
	}
}

func TestRecoverDoesNotWriteAfterResponseIsCommitted(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := Recover(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, "accepted")
		panic("unexpected failure after commit")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusAccepted || response.Body.String() != "accepted" {
		t.Fatalf("response = %d %q, want the already committed response", response.Code, response.Body.String())
	}
}
