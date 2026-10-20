package app

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/httpx"
)

// HandlerForRole keeps the worker process probeable while preventing it from
// serving customer or workspace APIs.
func HandlerForRole(d *deps.Deps) http.Handler {
	if d.Cfg.Role == "worker" {
		return WorkerRouter(d)
	}
	return Router(d)
}

func Router(d *deps.Deps) http.Handler {
	httpx.Install(d.Log)
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(httpx.RequestMetaMiddlewareWithClientIP(httpx.ClientIP(d.Cfg.TrustProxy)))
	router.Use(httpx.Logger(d.Log))
	router.Use(httpx.Recover(d.Log))
	router.Use(httpx.SecurityHeaders(d.Cfg.CookieSecure))
	// MCP has a separate origin policy and bearer-based transport. Let its handler
	// apply that policy instead of granting MCP client origins browser access to
	// the rest of the authenticated API.
	router.Use(httpx.CORSExceptPathPrefix(d.Cfg.TrustedOrigins, "/api/mcp/"))
	router.Use(httpx.MaxBodyBytes(1 << 20))
	resolver := &auth.Resolver{DB: d.DB, Tokens: auth.NewTokens(d.Cfg.AuthSecret), Log: d.Log}
	router.Use(resolver.Middleware)
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteProblem(w, r, httpx.E(http.StatusNotFound, "not_found", "No route matches this request."))
	})

	registerHealthRoutes(router, d)
	openAPI := huma.DefaultConfig("Welio API", "0.1.0")
	openAPI.Info.Description = "The API used by the Welio web app and Alexa+ MCP adapter."
	openAPI.OpenAPIPath = "/v1/openapi"
	openAPI.DocsPath = "/docs"
	openAPI.SchemasPath = "/v1/schemas"
	openAPI.CreateHooks = nil
	apiServerURL := d.Cfg.APIServerURL
	if apiServerURL == "" {
		// Router tests and embedded callers may construct Config directly. A
		// loaded production Config always requires API_SERVER_URL explicitly.
		apiServerURL = d.Cfg.PublicURL
	}
	openAPI.Servers = []*huma.Server{{URL: strings.TrimSuffix(apiServerURL, "/")}}
	openAPI.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {Type: "http", Scheme: "bearer", Description: "Welio access token"},
	}
	openAPI.Security = []map[string][]string{{"bearer": {}}}
	api := humachi.New(router, openAPI)
	registerAreas(d, api, router)
	return router
}

// WorkerRouter exposes only health probes. Business routes stay in the API
// process even when a worker shares the same listener port for orchestration.
func WorkerRouter(d *deps.Deps) http.Handler {
	httpx.Install(d.Log)
	router := chi.NewRouter()
	router.Use(httpx.RequestID)
	router.Use(httpx.RequestMetaMiddlewareWithClientIP(httpx.ClientIP(d.Cfg.TrustProxy)))
	router.Use(httpx.Logger(d.Log))
	router.Use(httpx.Recover(d.Log))
	router.Use(httpx.SecurityHeaders(d.Cfg.CookieSecure))
	registerHealthRoutes(router, d)
	return router
}

func registerHealthRoutes(router chi.Router, d *deps.Deps) {
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "welio-api", "requestId": httpx.RequestIDFrom(r.Context())})
	})
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := d.DB.Ping(r.Context()); err != nil {
			d.Log.Error("readiness database check failed", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
			httpx.WriteProblem(w, r, httpx.E(http.StatusServiceUnavailable, "not_ready", "The service is not ready."))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "requestId": httpx.RequestIDFrom(r.Context())})
	})
}
