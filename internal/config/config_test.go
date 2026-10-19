package config

import (
	"strings"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func validEnv() map[string]string {
	return map[string]string{
		"DATABASE_URL":   "postgres://localhost/welio",
		"AUTH_SECRET":    strings.Repeat("s", 32),
		"PUBLIC_URL":     "http://localhost:3000",
		"API_SERVER_URL": "http://localhost:8081",
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	values := validEnv()
	delete(values, "DATABASE_URL")
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("Load() error = %v, want DATABASE_URL validation error", err)
	}
}

func TestLoadRejectsShortAuthSecret(t *testing.T) {
	values := validEnv()
	values["AUTH_SECRET"] = "short"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "AUTH_SECRET") {
		t.Fatalf("Load() error = %v, want AUTH_SECRET validation error", err)
	}
}

func TestLoadRejectsInvalidRole(t *testing.T) {
	values := validEnv()
	values["WELIO_ROLE"] = "api-worker"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "WELIO_ROLE") {
		t.Fatalf("Load() error = %v, want WELIO_ROLE validation error", err)
	}
}

func TestLoadRejectsInvalidTrustedProxySetting(t *testing.T) {
	values := validEnv()
	values["TRUST_PROXY"] = "maybe"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "TRUST_PROXY") {
		t.Fatalf("Load() error = %v, want TRUST_PROXY validation error", err)
	}
}

func TestLoadRejectsInvalidAuthCookiePath(t *testing.T) {
	values := validEnv()
	values["AUTH_COOKIE_PATH"] = "/auth?unsafe=true"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "AUTH_COOKIE_PATH") {
		t.Fatalf("Load() error = %v, want AUTH_COOKIE_PATH validation error", err)
	}
}

func TestLoadRejectsInsecureProductionURL(t *testing.T) {
	values := validEnv()
	values["WELIO_ENV"] = "production"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "PUBLIC_URL") {
		t.Fatalf("Load() error = %v, want PUBLIC_URL validation error", err)
	}
}

func TestLoadRequiresAPIOriginAndKeepsItSeparateFromPublicURL(t *testing.T) {
	values := validEnv()
	values["API_SERVER_URL"] = "https://api.example.com"
	values["PUBLIC_URL"] = "https://app.example.com"
	cfg, err := Load(env(values))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PublicURL != "https://app.example.com" || cfg.APIServerURL != "https://api.example.com" {
		t.Fatalf("public/API origins were conflated: public=%q api=%q", cfg.PublicURL, cfg.APIServerURL)
	}
	if len(cfg.MCPHosts) != 1 || cfg.MCPHosts[0] != "api.example.com" {
		t.Fatalf("default MCP host allowlist = %v, want API host api.example.com", cfg.MCPHosts)
	}

	for name, value := range map[string]string{
		"missing API origin": "",
		"API URL with path":  "https://api.example.com/v1",
		"API URL with query": "https://api.example.com?x=1",
	} {
		t.Run(name, func(t *testing.T) {
			caseEnv := validEnv()
			caseEnv["API_SERVER_URL"] = value
			if _, err := Load(env(caseEnv)); err == nil || !strings.Contains(err.Error(), "API_SERVER_URL") {
				t.Fatalf("Load() error = %v, want API_SERVER_URL validation error", err)
			}
		})
	}
}

func TestLoadWorkerDoesNotRequireAPIOnlyConfiguration(t *testing.T) {
	values := validEnv()
	values["WELIO_ROLE"] = "worker"
	delete(values, "AUTH_SECRET")
	delete(values, "API_SERVER_URL")

	cfg, err := Load(env(values))
	if err != nil {
		t.Fatalf("Load() error = %v, want worker configuration without API-only values", err)
	}
	if len(cfg.AuthSecret) != 0 {
		t.Fatal("worker config unexpectedly loaded an auth secret")
	}
	if cfg.APIServerURL != cfg.PublicURL {
		t.Fatalf("worker API origin = %q, want public origin %q", cfg.APIServerURL, cfg.PublicURL)
	}
}

func TestLoadRejectsInsecureProductionAPIServerURL(t *testing.T) {
	values := validEnv()
	values["WELIO_ENV"] = "production"
	values["PUBLIC_URL"] = "https://app.example.com"
	values["API_SERVER_URL"] = "http://api.example.com"
	if _, err := Load(env(values)); err == nil || !strings.Contains(err.Error(), "API_SERVER_URL") {
		t.Fatalf("Load() error = %v, want API_SERVER_URL production validation error", err)
	}
}

func TestLoadValidDevelopmentAndProduction(t *testing.T) {
	values := validEnv()
	values["TRUST_PROXY"] = "true"
	cfg, err := Load(env(values))
	if err != nil {
		t.Fatalf("development config: %v", err)
	}
	if cfg.Role != "all" || cfg.HTTPAddr != ":8081" || !cfg.SignupEnabled || !cfg.TrustProxy || cfg.AWSRegion != "eu-north-1" || cfg.BedrockModelID != "eu.anthropic.claude-sonnet-4-6" {
		t.Fatalf("development defaults: %+v", cfg)
	}
	if cfg.AuthCookiePath != "/v1/auth" {
		t.Fatalf("default auth cookie path = %q, want /v1/auth", cfg.AuthCookiePath)
	}

	values["WELIO_ENV"] = "production"
	values["PUBLIC_URL"] = "https://api.example.com"
	values["API_SERVER_URL"] = "https://api.example.com"
	values["TRUSTED_ORIGINS"] = "https://app.example.com,https://api.example.com"
	values["COOKIE_SECURE"] = "true"
	cfg, err = Load(env(values))
	if err != nil {
		t.Fatalf("production config: %v", err)
	}
	if !cfg.CookieSecure || len(cfg.TrustedOrigins) != 2 {
		t.Fatalf("production fields: %+v", cfg)
	}
}

func TestLoadValidatesMCPServiceOAuthConfiguration(t *testing.T) {
	values := validEnv()
	values["MCP_OAUTH_RESOURCE_URL"] = "http://127.0.0.1:8081/api/mcp/sample-business"
	values["MCP_OAUTH_CLIENT_ID"] = "service-client"
	values["MCP_OAUTH_CLIENT_SECRET"] = strings.Repeat("c", 40)
	if _, err := Load(env(values)); err != nil {
		t.Fatalf("valid local OAuth configuration: %v", err)
	}

	for name, override := range map[string]map[string]string{
		"partial configuration": {"MCP_OAUTH_CLIENT_SECRET": ""},
		"short secret":          {"MCP_OAUTH_CLIENT_SECRET": "short"},
		"non-loopback http":     {"MCP_OAUTH_RESOURCE_URL": "http://example.com/api/mcp/sample-business"},
		"wrong resource path":   {"MCP_OAUTH_RESOURCE_URL": "https://example.com/book/sample-business"},
		"noncanonical resource": {"MCP_OAUTH_RESOURCE_URL": "https://example.com/api/mcp/sample-business?x=1"},
	} {
		t.Run(name, func(t *testing.T) {
			caseEnv := validEnv()
			caseEnv["MCP_OAUTH_RESOURCE_URL"] = values["MCP_OAUTH_RESOURCE_URL"]
			caseEnv["MCP_OAUTH_CLIENT_ID"] = values["MCP_OAUTH_CLIENT_ID"]
			caseEnv["MCP_OAUTH_CLIENT_SECRET"] = values["MCP_OAUTH_CLIENT_SECRET"]
			for key, value := range override {
				caseEnv[key] = value
			}
			if _, err := Load(env(caseEnv)); err == nil {
				t.Fatal("invalid OAuth configuration was accepted")
			}
		})
	}
}
