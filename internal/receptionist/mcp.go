package receptionist

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const MCPMinimumProtocolVersion = "2025-11-25"

type mcpServerContextKey struct{}

// MCPHandler authenticates and scopes a request before passing it to the official
// Go MCP SDK's stateless Streamable HTTP transport.
type MCPHandler struct {
	service   *Service
	transport *mcp.StreamableHTTPHandler
}

// NewMCPHandler creates an externally callable, stateless Streamable HTTP MCP
// endpoint. The caller must keep its MCP bearer secrets server-side.
func NewMCPHandler(service *Service) *MCPHandler {
	handler := &MCPHandler{service: service}
	handler.transport = mcp.NewStreamableHTTPHandler(func(request *http.Request) *mcp.Server {
		server, _ := request.Context().Value(mcpServerContextKey{}).(*mcp.Server)
		return server
	}, &mcp.StreamableHTTPOptions{
		Stateless:                    true,
		JSONResponse:                 true,
		DisableLocalhostProtection:   true, // Explicit host allow-listing is enforced below for reverse proxies.
		MaxRequestBodyBytes:          1 << 20,
		PropagateRequestCancellation: true,
	})
	return handler
}

// RegisterRoutes mounts the public receptionist chat API and external MCP server.
func RegisterRoutes(router chi.Router, service *Service) {
	router.HandleFunc("/api/chat/{slug}", func(w http.ResponseWriter, request *http.Request) {
		if service == nil || service.Repository == nil {
			writeChatJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "The receptionist is not configured."})
			return
		}
		service.serveChat(w, request)
	})
	router.Handle("/api/mcp/{slug}", NewMCPHandler(service))
}

func (handler *MCPHandler) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	service := handler.service
	if service == nil || handler.transport == nil {
		writeMCPProblem(w, http.StatusServiceUnavailable, "unavailable", "The receptionist MCP server is not configured.")
		return
	}
	slug := chi.URLParam(request, "slug")
	if !validSlug(slug) {
		writeMCPProblem(w, http.StatusNotFound, "not_found", "Business not found.")
		return
	}
	if !service.allowedMCPHost(request.Host) {
		writeMCPProblem(w, http.StatusForbidden, "host_not_allowed", "This host is not allowed for the MCP endpoint.")
		return
	}
	origin := strings.TrimSpace(request.Header.Get("Origin"))
	if origin != "" {
		if !service.allowedMCPOrigin(origin) {
			writeMCPProblem(w, http.StatusForbidden, "origin_not_allowed", "This origin is not allowed for the MCP endpoint.")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
	}
	if !service.allowRequest(requestRateKey("mcp", slug, requestClientAddress(request)), 120, time.Minute) {
		writeMCPProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many MCP requests. Try again shortly.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	switch request.Method {
	case http.MethodOptions:
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version")
		w.WriteHeader(http.StatusNoContent)
		return
	case http.MethodPost:
		// Continue through auth and the SDK transport.
	case http.MethodGet, http.MethodDelete, http.MethodHead:
		if !service.authorizedMCP(request.Context(), slug, request.Header.Get("Authorization")) {
			writeMCPProblem(w, http.StatusUnauthorized, "unauthorized", "MCP bearer authorization is required.")
			return
		}
		w.Header().Set("Allow", "POST, OPTIONS")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	default:
		w.Header().Set("Allow", "POST, GET, OPTIONS")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !service.authorizedMCP(request.Context(), slug, request.Header.Get("Authorization")) {
		writeMCPProblem(w, http.StatusUnauthorized, "unauthorized", "MCP bearer authorization is required.")
		return
	}
	if request.ContentLength > 1<<20 {
		writeMCPProblem(w, http.StatusRequestEntityTooLarge, "request_too_large", "The MCP request is too large.")
		return
	}
	request.Body = http.MaxBytesReader(w, request.Body, 1<<20)
	if contentType := request.Header.Get("Content-Type"); !isJSONContentType(contentType) {
		writeMCPProblem(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Use application/json.")
		return
	}
	if !acceptsMCPResponse(request.Header.Get("Accept")) {
		writeMCPProblem(w, http.StatusNotAcceptable, "not_acceptable", "Accept application/json and text/event-stream.")
		return
	}
	if _, err := service.publicBusiness(request.Context(), slug); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeMCPProblem(w, http.StatusNotFound, "not_found", "This business is not available for receptionist tools.")
		} else {
			writeMCPProblem(w, http.StatusServiceUnavailable, "unavailable", "Receptionist tools are temporarily unavailable.")
		}
		return
	}
	definitions, err := service.toolDefinitions(request.Context(), slug, true)
	if err != nil {
		writeMCPProblem(w, http.StatusServiceUnavailable, "unavailable", "Receptionist tools are temporarily unavailable.")
		return
	}
	server := newMCPServer(service, slug, definitions)
	ctx := context.WithValue(request.Context(), mcpServerContextKey{}, server)
	handler.transport.ServeHTTP(w, request.WithContext(ctx))
}

func newMCPServer(service *Service, slug string, definitions []ToolDefinition) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name: "welio-receptionist", Title: "Welio Receptionist", Version: "1.0.0",
	}, &mcp.ServerOptions{
		Instructions: "Use these tools to answer questions about one service business, check live availability, and prepare a booking for customer review. Preparing a booking does not create an appointment. Call confirm_booking only after the customer explicitly approves the exact proposal and separately consents to booking emails.",
		Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{ListChanged: false}},
	})
	for _, definition := range definitions {
		definition := definition
		readOnly := definition.Name == "list_services" || definition.Name == "check_availability"
		destructive := false
		openWorld := false
		tool := &mcp.Tool{
			Name:        definition.Name,
			Title:       toolTitle(definition.Name),
			Description: definition.Description,
			InputSchema: definition.InputSchema,
			Annotations: &mcp.ToolAnnotations{
				Title:           toolTitle(definition.Name),
				ReadOnlyHint:    readOnly,
				DestructiveHint: &destructive,
				IdempotentHint:  readOnly || definition.Name == "confirm_booking",
				OpenWorldHint:   &openWorld,
			},
		}
		server.AddTool(tool, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			arguments := json.RawMessage(`{}`)
			if request != nil && request.Params != nil && len(request.Params.Arguments) > 0 {
				arguments = request.Params.Arguments
			}
			value, err := service.callTool(ctx, slug, definition.Name, arguments, true)
			if err != nil {
				return mcpToolResult(map[string]string{"error": publicToolError(err)}, true), nil
			}
			return mcpToolResult(value, false), nil
		})
	}
	return server
}

func mcpToolResult(value any, isError bool) *mcp.CallToolResult {
	encoded, err := json.Marshal(value)
	if err != nil {
		value = map[string]string{"error": "The tool result could not be encoded."}
		encoded, _ = json.Marshal(value)
		isError = true
	}
	return &mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: string(encoded)}},
		StructuredContent: value,
		IsError:           isError,
	}
}

func toolTitle(name string) string {
	switch name {
	case "list_services":
		return "List services"
	case "check_availability":
		return "Check availability"
	case "prepare_booking":
		return "Prepare a booking"
	case "confirm_booking":
		return "Confirm a booking"
	default:
		return name
	}
}

func (service *Service) authorizedMCP(ctx context.Context, slug, authorization string) bool {
	secret := strings.TrimSpace(service.Config.MCPSecrets[slug])
	scheme, token, ok := strings.Cut(strings.TrimSpace(authorization), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return false
	}
	token = strings.TrimSpace(token)
	if len(secret) >= 32 && len(token) == len(secret) && subtle.ConstantTimeCompare([]byte(token), []byte(secret)) == 1 {
		return true
	}
	resourceURL := strings.TrimSpace(service.Config.MCPResourceURL)
	verifier := service.Config.MCPTokenVerifier
	if token == "" || resourceURL == "" || verifier == nil {
		return false
	}
	resource, err := url.Parse(resourceURL)
	if err != nil || resource.Path != "/api/mcp/"+slug {
		return false
	}
	return verifier.VerifyMCPAccessToken(ctx, token, resourceURL) == nil
}

func (service *Service) allowedMCPHost(requestHost string) bool {
	requestHost = normalizeHost(requestHost)
	if requestHost == "" {
		return false
	}
	hosts := service.Config.MCPHosts
	if len(hosts) == 0 {
		hosts = append(hosts, hostFromOrigin(service.Config.AppOrigin))
	}
	for _, host := range hosts {
		if requestHost == normalizeHost(host) {
			return true
		}
	}
	return false
}

func (service *Service) allowedMCPOrigin(origin string) bool {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return false
	}
	origins := service.Config.MCPOrigins
	if len(origins) == 0 && service.Config.AppOrigin != "" {
		origins = []string{service.Config.AppOrigin}
	}
	for _, allowed := range origins {
		if normalized == normalizeOrigin(allowed) {
			return true
		}
	}
	return false
}

func writeMCPProblem(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "title": http.StatusText(status), "code": code, "detail": message})
}

func isJSONContentType(value string) bool {
	mediaType, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(value)), ";")
	return strings.TrimSpace(mediaType) == "application/json"
}

func acceptsMCPResponse(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	jsonAccepted, eventAccepted := false, false
	for _, part := range strings.Split(value, ",") {
		mediaType := strings.TrimSpace(strings.ToLower(strings.SplitN(part, ";", 2)[0]))
		jsonAccepted = jsonAccepted || mediaType == "application/json" || mediaType == "*/*"
		eventAccepted = eventAccepted || mediaType == "text/event-stream" || mediaType == "*/*"
	}
	return jsonAccepted && eventAccepted
}

func normalizeHost(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if parsed, err := url.Parse("//" + value); err == nil && parsed.Hostname() != "" {
		return parsed.Host
	}
	return value
}

func normalizeOrigin(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme + "://" + parsed.Host)
}

func hostFromOrigin(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	return parsed.Host
}
