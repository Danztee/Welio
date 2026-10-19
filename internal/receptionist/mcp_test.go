package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/danztee/welio/internal/bookings"
	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type fakeMCPTokenVerifier struct {
	allowedToken string
	resourceURL  string
}

func (verifier fakeMCPTokenVerifier) VerifyMCPAccessToken(_ context.Context, token, resourceURL string) error {
	if token != verifier.allowedToken || resourceURL != verifier.resourceURL {
		return errors.New("invalid service token")
	}
	return nil
}

func TestMCPInitializeAndToolDiscovery(t *testing.T) {
	t.Parallel()
	repository, bookingService := newFakeRepository(), &fakeBookings{catalog: sampleBookingCatalog()}
	secret := strings.Repeat("s", 40)
	service := NewService(repository, bookingService, &fakeModel{}, Config{
		AppOrigin: "https://welio.example", MCPSecrets: map[string]string{"sample-business": secret},
		MCPConfirmationEnabled: true,
	})
	definitions, err := service.toolDefinitions(context.Background(), repository.business.Slug, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, definition := range definitions {
		if !json.Valid(definition.InputSchema) {
			t.Fatalf("tool %s has an invalid JSON schema: %s", definition.Name, definition.InputSchema)
		}
	}

	session := connectTestMCP(t, service, secret, "")
	if version := session.InitializeResult().ProtocolVersion; version < MCPMinimumProtocolVersion {
		t.Fatalf("negotiated protocol version = %q, want %s or later", version, MCPMinimumProtocolVersion)
	}
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("SDK ListTools: %v", err)
	}
	got := make(map[string]struct{}, len(listed.Tools))
	for _, tool := range listed.Tools {
		got[tool.Name] = struct{}{}
	}
	for _, name := range []string{"list_services", "check_availability", "prepare_booking", "confirm_booking"} {
		if _, ok := got[name]; !ok {
			t.Errorf("tools/list missing %q", name)
		}
	}
	services, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_services", Arguments: map[string]any{}})
	if err != nil {
		t.Fatalf("SDK CallTool list_services: %v", err)
	}
	if services.IsError || len(services.Content) == 0 {
		t.Fatalf("list_services returned no data: %#v", services)
	}
}

func TestMCPAuthorizationAndTransportPolicy(t *testing.T) {
	t.Parallel()
	repository := newFakeRepository()
	secret := strings.Repeat("t", 40)
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, &fakeModel{}, Config{
		AppOrigin: "https://welio.example", MCPSecrets: map[string]string{"sample-business": secret},
	})
	router := chi.NewRouter()
	RegisterRoutes(router, service)

	tests := []struct {
		name   string
		token  string
		origin string
		accept string
		method string
		body   string
		want   int
	}{
		{name: "missing bearer", accept: "application/json, text/event-stream", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, want: http.StatusUnauthorized},
		{name: "wrong origin", token: secret, origin: "https://evil.example", accept: "application/json, text/event-stream", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, want: http.StatusForbidden},
		{name: "missing stream accept", token: secret, accept: "application/json", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, want: http.StatusNotAcceptable},
		{name: "GET is unsupported", token: secret, accept: "application/json, text/event-stream", method: http.MethodGet, want: http.StatusMethodNotAllowed},
		{name: "JSON content type required", token: secret, accept: "application/json, text/event-stream", method: http.MethodPost, body: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, want: http.StatusUnsupportedMediaType},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(test.method, "https://welio.example/api/mcp/sample-business", strings.NewReader(test.body))
			request.Header.Set("Accept", test.accept)
			if test.method == http.MethodPost {
				contentType := "application/json"
				if test.name == "JSON content type required" {
					contentType = "text/plain"
				}
				request.Header.Set("Content-Type", contentType)
			}
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Errorf("status = %d, want %d; body: %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestMCPAcceptsOnlyGoVerifiedOAuthBearerForConfiguredResource(t *testing.T) {
	repository := newFakeRepository()
	resourceURL := "https://welio.example/api/mcp/sample-business"
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, &fakeModel{}, Config{
		AppOrigin: "https://welio.example", MCPResourceURL: resourceURL,
		MCPTokenVerifier: fakeMCPTokenVerifier{allowedToken: "signed-service-token", resourceURL: resourceURL},
	})
	if !service.authorizedMCP(context.Background(), "sample-business", "Bearer signed-service-token") {
		t.Fatal("Go-verified service token was rejected")
	}
	if service.authorizedMCP(context.Background(), "other-business", "Bearer signed-service-token") {
		t.Fatal("OAuth token was accepted for a different business slug")
	}
	if service.authorizedMCP(context.Background(), "sample-business", "Bearer forged-token") {
		t.Fatal("forged service token was accepted")
	}
	if service.authorizedMCP(context.Background(), "sample-business", "Basic signed-service-token") {
		t.Fatal("non-Bearer authorization was accepted")
	}
}

func TestMCPPrepareAndConfirmIsExplicitAndIdempotent(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	repository := newFakeRepository()
	bookingService := &fakeBookings{catalog: sampleBookingCatalog(), slots: []AvailableSlot{{Time: "13:00", StaffID: sampleBookingCatalog().Staff[0].ID}}}
	secret := strings.Repeat("m", 40)
	service := NewService(repository, bookingService, &fakeModel{}, Config{AppOrigin: "https://welio.example", MCPSecrets: map[string]string{"sample-business": secret}, MCPConfirmationEnabled: true})
	service.Now = func() time.Time { return now }
	session := connectTestMCP(t, service, secret, "")
	arguments := map[string]any{
		"serviceId": "131ef2e8-91a1-4f6d-8fe2-5c3dc2a5c2da", "staffId": "3991113f-7e0b-42af-8532-cf4d2b199acb",
		"date": "2026-10-20", "time": "13:00", "name": "John Doe", "email": "john@example.com",
		"phone": "08012345678", "address": "Ikeja, Lagos",
	}
	prepared, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "prepare_booking", Arguments: arguments})
	if err != nil {
		t.Fatalf("SDK prepare_booking: %v", err)
	}
	if prepared.IsError {
		t.Fatalf("prepare_booking failed: %s", mcpText(prepared))
	}
	var proposal struct {
		ProposalID        string `json:"proposalId"`
		ConfirmationToken string `json:"confirmationToken"`
	}
	if err := json.Unmarshal([]byte(mcpText(prepared)), &proposal); err != nil {
		t.Fatalf("decode prepared proposal: %v", err)
	}
	if proposal.ProposalID == "" || proposal.ConfirmationToken == "" {
		t.Fatalf("proposal response was incomplete: %s", mcpText(prepared))
	}
	if bookingService.createCalls != 0 {
		t.Fatal("preparing a proposal must not create a booking")
	}
	if _, found := repository.proposals[proposal.ProposalID]; !found {
		t.Fatal("proposal was not durably persisted through the repository")
	}

	denied, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "confirm_booking", Arguments: map[string]any{
		"proposalId": proposal.ProposalID, "confirmationToken": proposal.ConfirmationToken, "customerApproved": false, "emailConsent": true,
	}})
	if err != nil {
		t.Fatalf("SDK confirmation without approval: %v", err)
	}
	if !denied.IsError || bookingService.createCalls != 0 {
		t.Fatal("an unapproved proposal must not create a booking")
	}
	confirmation := map[string]any{"proposalId": proposal.ProposalID, "confirmationToken": proposal.ConfirmationToken, "customerApproved": true, "emailConsent": true}
	first, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "confirm_booking", Arguments: confirmation})
	if err != nil || first.IsError {
		t.Fatalf("SDK confirm_booking: err=%v result=%s", err, mcpText(first))
	}
	second, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "confirm_booking", Arguments: confirmation})
	if err != nil || second.IsError {
		t.Fatalf("SDK repeated confirm_booking: err=%v result=%s", err, mcpText(second))
	}
	var firstResult, secondResult BookingResult
	if err := json.Unmarshal([]byte(mcpText(first)), &firstResult); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(mcpText(second)), &secondResult); err != nil {
		t.Fatal(err)
	}
	if firstResult.ID != secondResult.ID || bookingService.createCalls != 1 {
		t.Fatalf("repeat confirmation was not idempotent: first=%#v second=%#v calls=%d", firstResult, secondResult, bookingService.createCalls)
	}
	if !bookingService.created.Consent {
		t.Fatal("booking email consent was not passed to shared booking logic")
	}
}

func TestMCPProposalErrorsAndConflictRelease(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	t.Run("expired proposal", func(t *testing.T) {
		repository := newFakeRepository()
		proposalID := "a9f36682-32fb-45d6-b0c4-d5193d38ce38"
		token := "secret-token"
		repository.proposals[proposalID] = fakeProposal{tokenHash: hashToken(token), proposal: ExternalProposal{ID: proposalID}, expiresAt: now.Add(-time.Second)}
		service := NewService(repository, &fakeBookings{}, nil, Config{})
		service.Now = func() time.Time { return now }
		_, err := service.ConfirmMCP(context.Background(), repository.business.Slug, MCPConfirmInput{ProposalID: proposalID, ConfirmationToken: token, CustomerApproved: true, EmailConsent: true})
		if !errors.Is(err, ErrExpired) {
			t.Fatalf("error = %v, want expired", err)
		}
	})
	t.Run("invalid proposal", func(t *testing.T) {
		service := NewService(newFakeRepository(), &fakeBookings{}, nil, Config{})
		_, err := service.ConfirmMCP(context.Background(), "sample-business", MCPConfirmInput{ProposalID: "not-there", ConfirmationToken: "token", CustomerApproved: true, EmailConsent: true})
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("error = %v, want not found", err)
		}
	})
	t.Run("booking conflict releases proposal lease", func(t *testing.T) {
		repository := newFakeRepository()
		bookingService := &fakeBookings{createErr: bookings.ErrConflict}
		proposalID, token := "a9f36682-32fb-45d6-b0c4-d5193d38ce38", "external-approval-token"
		proposal := ExternalProposal{ID: proposalID, Input: sampleProposalInput(), ExpiresAt: now.Add(time.Minute)}
		repository.proposals[proposalID] = fakeProposal{tokenHash: hashToken(token), proposal: proposal, expiresAt: proposal.ExpiresAt}
		service := NewService(repository, bookingService, nil, Config{})
		service.Now = func() time.Time { return now }
		_, err := service.ConfirmMCP(context.Background(), repository.business.Slug, MCPConfirmInput{ProposalID: proposalID, ConfirmationToken: token, CustomerApproved: true, EmailConsent: true})
		if !errors.Is(err, bookings.ErrConflict) {
			t.Fatalf("error = %v, want booking conflict", err)
		}
		if repository.releasedProposals != 1 {
			t.Fatalf("released leases = %d, want 1", repository.releasedProposals)
		}
	})
}

type mcpTestHeaders struct {
	values map[string]string
	next   http.RoundTripper
}

func (transport mcpTestHeaders) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	for key, value := range transport.values {
		request.Header.Set(key, value)
	}
	return transport.next.RoundTrip(request)
}

func connectTestMCP(t *testing.T, service *Service, token, origin string) *mcp.ClientSession {
	t.Helper()
	router := chi.NewRouter()
	RegisterRoutes(router, service)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	service.Config.MCPHosts = []string{parsed.Host}
	values := map[string]string{"Authorization": "Bearer " + token}
	if origin != "" {
		values["Origin"] = origin
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "welio-receptionist-test", Version: "1"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint:             server.URL + "/api/mcp/" + service.Repository.(*fakeRepository).business.Slug,
		DisableStandaloneSSE: true,
		HTTPClient:           &http.Client{Transport: mcpTestHeaders{values: values, next: http.DefaultTransport}},
	}
	session, err := client.Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatalf("connect MCP SDK client: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func mcpText(result *mcp.CallToolResult) string {
	if result == nil {
		return ""
	}
	var text strings.Builder
	for _, content := range result.Content {
		if value, ok := content.(*mcp.TextContent); ok {
			text.WriteString(value.Text)
		}
	}
	return text.String()
}
