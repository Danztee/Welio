package auth

import (
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"

	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/httpx"
)

// For builds the authentication service from shared application dependencies.
func For(d *deps.Deps) *Service {
	limiter := d.Limiter
	if limiter == nil {
		limiter = httpx.NewLimiter()
	}
	return &Service{
		DB: d.DB, Tokens: NewTokens(d.Cfg.AuthSecret), Limiter: limiter,
		Cfg: d.Cfg, Log: d.Log, Jobs: d.Jobs,
	}
}

// OAuthFor builds the MCP OAuth service from the deployment's server-side config.
func OAuthFor(d *deps.Deps) *MCPOAuthService {
	var limiter interface {
		Allow(string, int, time.Duration) bool
	}
	if d.Limiter != nil {
		limiter = d.Limiter
	}
	return NewMCPOAuthService(d.DB, MCPOAuthConfig{
		ResourceURL:  d.Cfg.MCPOAuthResourceURL,
		ClientID:     d.Cfg.MCPOAuthClientID,
		ClientSecret: d.Cfg.MCPOAuthClientSecret,
	}, d.Cfg.AuthSecret, limiter)
}

// Register installs browser authentication and the MCP OAuth authorization endpoints.
func Register(d *deps.Deps, api huma.API, router chi.Router) {
	RegisterAPI(For(d), api)
	OAuthFor(d).RegisterRoutes(router)
}
