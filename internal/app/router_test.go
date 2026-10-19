package app

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/deps"
)

func TestRouterMountsReceptionistEndpointsWhenServiceIsUnavailable(t *testing.T) {
	router := Router(&deps.Deps{
		Cfg: config.Config{
			PublicURL:      "https://api.welio.example",
			MCPOrigins:     []string{"https://mcp-client.example"},
			TrustedOrigins: []string{"https://app.welio.example"},
		},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	tests := []struct {
		name string
		path string
	}{
		{name: "chat", path: "/api/chat/lagos-cleaning"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(`{}`))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d; body: %s", response.Code, http.StatusServiceUnavailable, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "not configured") {
				t.Fatalf("response should explain that the receptionist is unavailable: %s", response.Body.String())
			}
		})
	}
}

func TestRouterMountsGoMCPAuthorizationServerMetadata(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	router := Router(&deps.Deps{
		Cfg: config.Config{
			PublicURL: "https://welio.example", AuthSecret: []byte(secret),
			MCPOAuthResourceURL: "https://welio.example/api/mcp/lagos-cleaning",
			MCPOAuthClientID:    "alexa-service-client", MCPOAuthClientSecret: secret,
		},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-authorization-server", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"token_endpoint":"https://welio.example/api/auth/oauth2/token"`) {
		t.Fatalf("Go OAuth metadata response = %d %s", response.Code, response.Body.String())
	}
}

func TestOpenAPIServerUsesAPIOrigin(t *testing.T) {
	router := Router(&deps.Deps{
		Cfg: config.Config{PublicURL: "https://app.welio.example", APIServerURL: "https://api.welio.example"},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodGet, "/v1/openapi.json", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("OpenAPI response = %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"url":"https://api.welio.example"`) {
		t.Fatalf("OpenAPI server URL must use API origin: %s", response.Body.String())
	}
}

func TestOpenAPIUsesSnakeCaseRESTContract(t *testing.T) {
	router := Router(&deps.Deps{
		Cfg: config.Config{PublicURL: "https://api.welio.example", APIServerURL: "https://api.welio.example"},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/openapi.json", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("OpenAPI response = %d: %s", response.Code, response.Body.String())
	}
	if !strings.HasPrefix(response.Body.String(), "{") || !strings.Contains(response.Body.String(), `"openapi":"3.1.`) {
		t.Fatalf("OpenAPI document is not OpenAPI 3.1: %s", response.Body.String())
	}
	for _, field := range []string{`"first_name"`, `"allow_availability"`, `"service_id"`, `"application/problem+json"`} {
		if !strings.Contains(response.Body.String(), field) {
			t.Errorf("OpenAPI document is missing %s", field)
		}
	}
	for _, field := range []string{`"firstName"`, `"allowAvailability"`, `"serviceId"`} {
		if strings.Contains(response.Body.String(), field) {
			t.Errorf("OpenAPI document still exposes camelCase field %s", field)
		}
	}
}

func TestRouterReturnsRFC9457ValidationDetails(t *testing.T) {
	router := Router(&deps.Deps{
		Cfg: config.Config{PublicURL: "https://api.welio.example"},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"first_name":12}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("validation response = %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/problem+json" {
		t.Fatalf("validation content type = %q, want application/problem+json", contentType)
	}
	for _, field := range []string{`"status":422`, `"code":"validation_failed"`, `"request_id":`, `"errors":[`} {
		if !strings.Contains(response.Body.String(), field) {
			t.Errorf("validation problem is missing %s: %s", field, response.Body.String())
		}
	}
	if strings.Contains(response.Body.String(), "$schema") {
		t.Fatalf("validation problem leaked Huma's internal schema field: %s", response.Body.String())
	}
}

func TestRouterDispatchesMCPRequestsToReceptionistHandler(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef01234567"
	router := Router(&deps.Deps{
		Cfg: config.Config{
			PublicURL:  "https://api.welio.example",
			MCPHosts:   []string{"api.welio.example"},
			MCPSecrets: map[string]string{"lagos-cleaning": secret},
		},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "https://api.welio.example/api/mcp/lagos-cleaning", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want MCP bearer rejection %d; body: %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "MCP bearer authorization is required") {
		t.Fatalf("request did not reach MCP authorization: %s", response.Body.String())
	}
}

func TestRouterUsesMCPOriginPolicyForPreflight(t *testing.T) {
	router := Router(&deps.Deps{
		Cfg: config.Config{
			PublicURL:      "https://api.welio.example",
			MCPOrigins:     []string{"https://mcp-client.example"},
			TrustedOrigins: []string{"https://app.welio.example"},
		},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodOptions, "https://api.welio.example/api/mcp/lagos-cleaning", nil)
	request.Header.Set("Origin", "https://mcp-client.example")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "authorization, content-type, mcp-protocol-version")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want the receptionist MCP handler to accept preflight; body: %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "https://mcp-client.example" {
		t.Fatalf("MCP CORS should reflect its allowed origin, got Access-Control-Allow-Origin %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("MCP CORS must not allow ambient credentials, got Access-Control-Allow-Credentials %q", got)
	}
}

func TestHandlerForWorkerRoleExposesOnlyHealthRoutes(t *testing.T) {
	handler := HandlerForRole(&deps.Deps{
		Cfg: config.Config{Role: "worker"},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	for _, path := range []string{"/api/chat/lagos-cleaning", "/api/mcp/lagos-cleaning", "/v1/auth/session", "/v1/workspaces"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusNotFound {
				t.Fatalf("worker response for %s = %d, want %d; body: %s", path, response.Code, http.StatusNotFound, response.Body.String())
			}
		})
	}

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("worker health response = %d, want %d; body: %s", response.Code, http.StatusOK, response.Body.String())
	}
}

func TestHandlerForAPIRoleRegistersBusinessRoutes(t *testing.T) {
	handler := HandlerForRole(&deps.Deps{
		Cfg: config.Config{Role: "api", PublicURL: "https://api.welio.example"},
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "/api/chat/lagos-cleaning", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("API receptionist route response = %d, want %d; body: %s", response.Code, http.StatusServiceUnavailable, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "not configured") {
		t.Fatalf("API role did not dispatch to the registered receptionist route: %s", response.Body.String())
	}
}
