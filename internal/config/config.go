// Package config owns validated configuration for the Welio API and worker.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const minAuthSecretBytes = 32

// Config is parsed once at process startup. Provider secrets stay in this server-only
// structure and are never returned from API endpoints.
type Config struct {
	Env                    string
	Role                   string
	HTTPAddr               string
	DatabaseURL            string
	DatabaseURLDirect      string
	PublicURL              string
	APIServerURL           string
	AuthSecret             []byte
	CookieDomain           string
	AuthCookiePath         string
	CookieSecure           bool
	TrustProxy             bool
	TrustedOrigins         []string
	ZeptoMailToken         string
	EmailFrom              string
	AWSRegion              string
	BedrockModelID         string
	AIDailyCallLimit       int
	MCPSecrets             map[string]string
	MCPOrigins             []string
	MCPHosts               []string
	MCPConfirmationEnabled bool
	MCPOAuthResourceURL    string
	MCPOAuthClientID       string
	MCPOAuthClientSecret   string
}

// Load validates environment values through getenv, which keeps config tests independent
// of the process environment.
func Load(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, errors.New("configuration environment reader is required")
	}
	value := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}

	c := Config{
		Env:                  value("WELIO_ENV", "development"),
		Role:                 value("WELIO_ROLE", "all"),
		HTTPAddr:             value("HTTP_ADDR", ":8081"),
		DatabaseURL:          value("DATABASE_URL", ""),
		DatabaseURLDirect:    value("DATABASE_URL_DIRECT", ""),
		PublicURL:            value("PUBLIC_URL", ""),
		APIServerURL:         value("API_SERVER_URL", ""),
		CookieDomain:         value("COOKIE_DOMAIN", ""),
		AuthCookiePath:       value("AUTH_COOKIE_PATH", "/v1/auth"),
		ZeptoMailToken:       value("ZEPTOMAIL_SEND_MAIL_TOKEN", ""),
		EmailFrom:            value("EMAIL_FROM", ""),
		MCPOAuthResourceURL:  value("MCP_OAUTH_RESOURCE_URL", ""),
		MCPOAuthClientID:     value("MCP_OAUTH_CLIENT_ID", ""),
		MCPOAuthClientSecret: value("MCP_OAUTH_CLIENT_SECRET", ""),
		AWSRegion:            value("AWS_REGION", "eu-north-1"),
		BedrockModelID:       value("BEDROCK_MODEL_ID", "eu.anthropic.claude-sonnet-4-6"),
		AIDailyCallLimit:     200,
	}
	c.AuthSecret = []byte(getenv("AUTH_SECRET"))
	if c.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if c.DatabaseURLDirect == "" {
		c.DatabaseURLDirect = c.DatabaseURL
	}
	if c.Env != "development" && c.Env != "test" && c.Env != "production" {
		return Config{}, errors.New("WELIO_ENV must be development, test, or production")
	}
	if c.Role != "all" && c.Role != "api" && c.Role != "worker" {
		return Config{}, errors.New("WELIO_ROLE must be all, api, or worker")
	}
	if c.Role != "worker" && len(c.AuthSecret) < minAuthSecretBytes {
		return Config{}, fmt.Errorf("AUTH_SECRET must be at least %d bytes", minAuthSecretBytes)
	}
	if c.HTTPAddr == "" {
		return Config{}, errors.New("HTTP_ADDR must not be empty")
	}
	if !strings.HasPrefix(c.AuthCookiePath, "/") || strings.ContainsAny(c.AuthCookiePath, "?#;\r\n") {
		return Config{}, errors.New("AUTH_COOKIE_PATH must be an absolute cookie path without query, fragment, or separators")
	}
	publicURL, err := url.Parse(c.PublicURL)
	if err != nil || publicURL.Scheme == "" || publicURL.Host == "" || (publicURL.Scheme != "http" && publicURL.Scheme != "https") {
		return Config{}, errors.New("PUBLIC_URL must be an absolute http or https URL")
	}
	if c.Env == "production" && publicURL.Scheme != "https" {
		return Config{}, errors.New("PUBLIC_URL must use https in production")
	}
	if c.APIServerURL == "" && c.Role == "worker" {
		c.APIServerURL = c.PublicURL
	}
	apiServerURL, err := url.Parse(c.APIServerURL)
	if err != nil || apiServerURL.Scheme == "" || apiServerURL.Host == "" || apiServerURL.User != nil || apiServerURL.Path != "" && apiServerURL.Path != "/" || apiServerURL.RawQuery != "" || apiServerURL.Fragment != "" || (apiServerURL.Scheme != "http" && apiServerURL.Scheme != "https") {
		return Config{}, errors.New("API_SERVER_URL must be an absolute http or https origin")
	}
	if c.Env == "production" && apiServerURL.Scheme != "https" {
		return Config{}, errors.New("API_SERVER_URL must use https in production")
	}
	c.CookieSecure = c.Env == "production"
	if raw := strings.TrimSpace(getenv("COOKIE_SECURE")); raw != "" {
		parsed, err := parseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("COOKIE_SECURE: %w", err)
		}
		if c.Env == "production" && !parsed {
			return Config{}, errors.New("COOKIE_SECURE must be true in production")
		}
		c.CookieSecure = parsed
	}
	c.TrustProxy, err = parseBoolDefault(getenv("TRUST_PROXY"), false)
	if err != nil {
		return Config{}, fmt.Errorf("TRUST_PROXY: %w", err)
	}
	c.TrustedOrigins, err = parseOrigins(getenv("TRUSTED_ORIGINS"), publicURL, c.Env == "production")
	if err != nil {
		return Config{}, err
	}
	c.MCPSecrets, err = parseMCPSecrets(getenv("MCP_API_SECRETS_JSON"))
	if err != nil {
		return Config{}, err
	}
	c.MCPOrigins, err = parseOptionalOrigins(getenv("MCP_ALLOWED_ORIGINS"), publicURL, c.Env == "production")
	if err != nil {
		return Config{}, fmt.Errorf("MCP_ALLOWED_ORIGINS: %w", err)
	}
	c.MCPHosts, err = parseHosts(getenv("MCP_ALLOWED_HOSTS"), apiServerURL.Host)
	if err != nil {
		return Config{}, err
	}
	c.MCPConfirmationEnabled, err = parseBoolDefault(getenv("MCP_BOOKING_CONFIRMATION_ENABLED"), false)
	if err != nil {
		return Config{}, fmt.Errorf("MCP_BOOKING_CONFIRMATION_ENABLED: %w", err)
	}
	if err := validateMCPOAuth(c); err != nil {
		return Config{}, err
	}
	if raw := strings.TrimSpace(getenv("AI_DAILY_CALL_LIMIT")); raw != "" {
		c.AIDailyCallLimit, err = strconv.Atoi(raw)
		if err != nil || c.AIDailyCallLimit < 1 || c.AIDailyCallLimit > 1_000_000 {
			return Config{}, errors.New("AI_DAILY_CALL_LIMIT must be an integer between 1 and 1000000")
		}
	}
	return c, nil
}

func validateMCPOAuth(c Config) error {
	configured := c.MCPOAuthResourceURL != "" || c.MCPOAuthClientID != "" || c.MCPOAuthClientSecret != ""
	if !configured {
		return nil
	}
	if c.MCPOAuthResourceURL == "" || c.MCPOAuthClientID == "" || c.MCPOAuthClientSecret == "" {
		return errors.New("MCP_OAUTH_RESOURCE_URL, MCP_OAUTH_CLIENT_ID, and MCP_OAUTH_CLIENT_SECRET must be configured together")
	}
	if len(c.MCPOAuthClientID) > 128 || strings.ContainsAny(c.MCPOAuthClientID, " \t\r\n\x00") {
		return errors.New("MCP_OAUTH_CLIENT_ID must be a printable value up to 128 characters")
	}
	if len(c.MCPOAuthClientSecret) < 32 {
		return errors.New("MCP_OAUTH_CLIENT_SECRET must contain at least 32 characters")
	}
	resource, err := url.Parse(c.MCPOAuthResourceURL)
	if err != nil || resource.Scheme == "" || resource.Host == "" || resource.User != nil || resource.RawQuery != "" || resource.Fragment != "" || c.MCPOAuthResourceURL != resource.String() {
		return errors.New("MCP_OAUTH_RESOURCE_URL must be a canonical absolute MCP URL")
	}
	isLocalHTTP := resource.Scheme == "http" && (resource.Hostname() == "localhost" || resource.Hostname() == "127.0.0.1")
	if resource.Scheme != "https" && !isLocalHTTP {
		return errors.New("MCP_OAUTH_RESOURCE_URL must use HTTPS except for local loopback development")
	}
	parts := strings.Split(resource.Path, "/")
	if len(parts) != 4 || parts[1] != "api" || parts[2] != "mcp" || !slugPattern.MatchString(parts[3]) || resource.EscapedPath() != resource.Path {
		return errors.New("MCP_OAUTH_RESOURCE_URL must point to one business endpoint at /api/mcp/<slug>")
	}
	return nil
}

func parseMCPSecrets(raw string) (map[string]string, error) {
	secrets := make(map[string]string)
	if strings.TrimSpace(raw) == "" {
		return secrets, nil
	}
	if err := json.Unmarshal([]byte(raw), &secrets); err != nil {
		return nil, errors.New("MCP_API_SECRETS_JSON must be a JSON object mapping business slugs to secrets")
	}
	for slug, secret := range secrets {
		if !slugPattern.MatchString(slug) || len(strings.TrimSpace(secret)) < 32 {
			return nil, errors.New("MCP_API_SECRETS_JSON keys must be business slugs and every secret must be at least 32 characters")
		}
	}
	return secrets, nil
}

func parseOptionalOrigins(raw string, publicURL *url.URL, production bool) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{publicURL.Scheme + "://" + publicURL.Host}, nil
	}
	return parseOrigins(raw, publicURL, production)
}

func parseHosts(raw, defaultHost string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{defaultHost}, nil
	}
	var hosts []string
	seen := make(map[string]struct{})
	for _, host := range strings.Split(raw, ",") {
		host = strings.ToLower(strings.TrimSpace(host))
		if host == "" || strings.ContainsAny(host, "/?#@ \t\r\n") {
			return nil, errors.New("MCP_ALLOWED_HOSTS must be comma-separated hostnames with optional ports")
		}
		if _, exists := seen[host]; !exists {
			seen[host] = struct{}{}
			hosts = append(hosts, host)
		}
	}
	return hosts, nil
}

func parseOrigins(raw string, publicURL *url.URL, production bool) ([]string, error) {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		u, err := url.Parse(part)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("TRUSTED_ORIGINS must contain comma-separated origins without paths")
		}
		if production && u.Scheme != "https" {
			return nil, errors.New("TRUSTED_ORIGINS must use https in production")
		}
		origin := u.Scheme + "://" + u.Host
		if _, ok := seen[origin]; !ok {
			seen[origin] = struct{}{}
			origins = append(origins, origin)
		}
	}
	if len(origins) == 0 {
		origin := publicURL.Scheme + "://" + publicURL.Host
		origins = append(origins, origin)
	}
	return origins, nil
}

func parseBool(value string) (bool, error) {
	switch strings.ToLower(value) {
	case "true", "1", "yes", "on":
		return true, nil
	case "false", "0", "no", "off":
		return false, nil
	default:
		return false, errors.New("must be a boolean value")
	}
}

func parseBoolDefault(raw string, fallback bool) (bool, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	return parseBool(strings.TrimSpace(raw))
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
