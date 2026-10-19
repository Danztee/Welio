package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/receptionist"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAppRouterMCPBooksThroughPostgresAndSharedBookingService(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedMCPFixture(t, ctx, database)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})

	const secret = "test-only-mcp-secret-with-at-least-32-bytes"
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for app integration test: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	databaseURL := strings.TrimSpace(os.Getenv("WELIO_TEST_DATABASE_URL"))
	cfg := config.Config{
		Env: "test", Role: "api", HTTPAddr: ":0", DatabaseURL: databaseURL,
		DatabaseURLDirect: databaseURL, PublicURL: "https://api.welio.example",
		AuthSecret: []byte(strings.Repeat("a", 32)), AWSRegion: "eu-north-1",
		BedrockModelID: "eu.anthropic.claude-sonnet-4-6", AIDailyCallLimit: 200,
		TrustedOrigins: []string{"https://app.welio.example"},
		MCPSecrets:     map[string]string{fixture.slug: secret}, MCPOrigins: []string{"https://mcp-client.example"},
		MCPConfirmationEnabled: true,
		MCPHosts:               []string{listener.Addr().String()},
	}
	apiDeps, closeApp, err := Build(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("build Go API with receptionist: %v", err)
	}
	t.Cleanup(closeApp)
	server := httptest.NewUnstartedServer(Router(apiDeps))
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)

	chatResponse := postChatAction(t, server.Client(), server.URL+"/api/chat/"+fixture.slug, `{"action":"start"}`, nil)
	if chatResponse.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(chatResponse.Body)
		chatResponse.Body.Close()
		t.Fatalf("start Go chat route: status=%d body=%s", chatResponse.StatusCode, body)
	}
	chatCookies := chatResponse.Cookies()
	chatResponse.Body.Close()
	if len(chatCookies) == 0 || !strings.HasPrefix(chatCookies[0].Name, "welio-chat-") || !chatCookies[0].HttpOnly {
		t.Fatalf("Go chat route did not issue a private HttpOnly session cookie: %#v", chatCookies)
	}
	listResponse := postChatAction(t, server.Client(), server.URL+"/api/chat/"+fixture.slug, `{"action":"list"}`, chatCookies)
	if listResponse.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(listResponse.Body)
		listResponse.Body.Close()
		t.Fatalf("list Go chat sessions: status=%d body=%s", listResponse.StatusCode, body)
	}
	var sessions []receptionist.ChatSummary
	if err := json.NewDecoder(listResponse.Body).Decode(&sessions); err != nil {
		listResponse.Body.Close()
		t.Fatalf("decode Go chat session list: %v", err)
	}
	listResponse.Body.Close()
	if len(sessions) != 1 {
		t.Fatalf("Go chat route returned %d sessions, want one", len(sessions))
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "welio-go-app-integration", Version: "1"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint:             server.URL + "/api/mcp/" + fixture.slug,
		DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: mcpBearerTransport{
			token: secret, origin: "https://mcp-client.example", next: http.DefaultTransport,
		}},
	}
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		t.Fatalf("connect to mounted Go MCP endpoint: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	if got := session.InitializeResult().ProtocolVersion; got < receptionist.MCPMinimumProtocolVersion {
		t.Fatalf("negotiated protocol version = %q, want %s or later", got, receptionist.MCPMinimumProtocolVersion)
	}

	services, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_services", Arguments: map[string]any{}})
	if err != nil || services.IsError {
		t.Fatalf("list_services: err=%v result=%s", err, integrationMCPText(services))
	}
	var catalog receptionist.BookingCatalog
	if err := json.Unmarshal([]byte(integrationMCPText(services)), &catalog); err != nil {
		t.Fatalf("decode list_services: %v", err)
	}
	if len(catalog.Services) != 1 || len(catalog.Staff) != 1 {
		t.Fatalf("catalog has %d services and %d staff, want one each", len(catalog.Services), len(catalog.Staff))
	}

	availability, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "check_availability", Arguments: map[string]any{
		"serviceId": catalog.Services[0].ID, "date": "2026-10-20",
	}})
	if err != nil || availability.IsError {
		t.Fatalf("check_availability: err=%v result=%s", err, integrationMCPText(availability))
	}

	prepared, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "prepare_booking", Arguments: map[string]any{
		"serviceId": catalog.Services[0].ID, "staffId": catalog.Staff[0].ID,
		"date": "2026-10-20", "time": "09:00", "serviceLocation": "business_address",
		"name": "MCP Demo Customer", "email": "mcp-demo@example.test", "phone": "+2348012345678",
	}})
	if err != nil || prepared.IsError {
		t.Fatalf("prepare_booking: err=%v result=%s", err, integrationMCPText(prepared))
	}
	var proposal struct {
		ProposalID        string `json:"proposalId"`
		ConfirmationToken string `json:"confirmationToken"`
	}
	if err := json.Unmarshal([]byte(integrationMCPText(prepared)), &proposal); err != nil {
		t.Fatalf("decode prepared booking: %v", err)
	}
	if proposal.ProposalID == "" || proposal.ConfirmationToken == "" {
		t.Fatalf("proposal is missing confirmation fields: %+v", proposal)
	}

	denied, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "confirm_booking", Arguments: map[string]any{
		"proposalId": proposal.ProposalID, "confirmationToken": proposal.ConfirmationToken,
		"customerApproved": false, "emailConsent": true,
	}})
	if err != nil || !denied.IsError {
		t.Fatalf("confirmation without customer approval should fail: err=%v result=%s", err, integrationMCPText(denied))
	}
	var beforeApproval int
	if err := database.Pool.QueryRow(ctx, `SELECT count(*) FROM appointments WHERE workspace_id=$1`, fixture.workspaceID).Scan(&beforeApproval); err != nil {
		t.Fatal(err)
	}
	if beforeApproval != 0 {
		t.Fatalf("unapproved proposal created %d appointments", beforeApproval)
	}

	confirmation := map[string]any{
		"proposalId": proposal.ProposalID, "confirmationToken": proposal.ConfirmationToken,
		"customerApproved": true, "emailConsent": true,
	}
	confirmed, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "confirm_booking", Arguments: confirmation})
	if err != nil || confirmed.IsError {
		_, directErr := receptionist.For(apiDeps).ConfirmMCP(ctx, fixture.slug, receptionist.MCPConfirmInput{
			ProposalID: proposal.ProposalID, ConfirmationToken: proposal.ConfirmationToken,
			CustomerApproved: true, EmailConsent: true,
		})
		t.Fatalf("confirm_booking: err=%v result=%s direct error=%v", err, integrationMCPText(confirmed), directErr)
	}
	var first receptionist.BookingResult
	if err := json.Unmarshal([]byte(integrationMCPText(confirmed)), &first); err != nil {
		t.Fatalf("decode confirmed booking: %v", err)
	}
	repeated, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "confirm_booking", Arguments: confirmation})
	if err != nil || repeated.IsError {
		t.Fatalf("repeat confirm_booking: err=%v result=%s", err, integrationMCPText(repeated))
	}
	var second receptionist.BookingResult
	if err := json.Unmarshal([]byte(integrationMCPText(repeated)), &second); err != nil {
		t.Fatalf("decode repeated booking: %v", err)
	}
	if first.ID == "" || first.ID != second.ID {
		t.Fatalf("confirmation was not idempotent: first=%+v second=%+v", first, second)
	}
	var appointmentCount int
	if err := database.Pool.QueryRow(ctx, `SELECT count(*) FROM appointments WHERE workspace_id=$1`, fixture.workspaceID).Scan(&appointmentCount); err != nil {
		t.Fatal(err)
	}
	if appointmentCount != 1 {
		t.Fatalf("appointment count = %d, want exactly one after repeated confirmation", appointmentCount)
	}
}

type mcpFixture struct {
	workspaceID uuid.UUID
	userID      uuid.UUID
	serviceID   uuid.UUID
	staffID     uuid.UUID
	slug        string
}

func seedMCPFixture(t *testing.T, ctx context.Context, database *db.DB) mcpFixture {
	t.Helper()
	fixture := mcpFixture{workspaceID: uuid.New(), userID: uuid.New(), serviceID: uuid.New(), staffID: uuid.New(), slug: "mcp-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO users(id,name,email,email_verified,password_hash)
		VALUES($1,'MCP Owner',$2,true,'test-password-hash')`, fixture.userID, "mcp-owner-"+uuid.NewString()+"@example.test"); err != nil {
		t.Fatalf("insert MCP fixture owner: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO workspaces(id,name,slug,is_published,booking_location,business_address,phone)
		VALUES($1,'MCP Test Business',$2,true,'both','20 Business Road, Lagos','+2348000000000')`, fixture.workspaceID, fixture.slug); err != nil {
		t.Fatalf("insert MCP fixture workspace: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, fixture.workspaceID, fixture.userID); err != nil {
		t.Fatalf("insert MCP fixture membership: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO services(id,workspace_id,name,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,is_active)
		VALUES($1,$2,'Standard cleaning','A test service',60,0,0,1500000,true)`, fixture.serviceID, fixture.workspaceID); err != nil {
		t.Fatalf("insert MCP fixture service: %v", err)
	}
	schedule := `{"start":"08:00","end":"18:00","breakStart":"12:00","breakEnd":"13:00","days":[1,2,3,4,5,6,0]}`
	if _, err := database.Pool.Exec(ctx, `INSERT INTO staff(id,workspace_id,name,schedule,is_active) VALUES($1,$2,'Taylor Staff',$3::jsonb,true)`, fixture.staffID, fixture.workspaceID, schedule); err != nil {
		t.Fatalf("insert MCP fixture staff: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO staff_services(workspace_id,staff_id,service_id,is_active) VALUES($1,$2,$3,true)`, fixture.workspaceID, fixture.staffID, fixture.serviceID); err != nil {
		t.Fatalf("assign MCP fixture service: %v", err)
	}
	return fixture
}

type mcpBearerTransport struct {
	token  string
	origin string
	next   http.RoundTripper
}

func (transport mcpBearerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("Authorization", "Bearer "+transport.token)
	if transport.origin != "" {
		request.Header.Set("Origin", transport.origin)
	}
	return transport.next.RoundTrip(request)
}

func postChatAction(t *testing.T, client *http.Client, endpoint, body string, cookies []*http.Cookie) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "https://app.welio.example")
	request.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("POST %s: %v", endpoint, err)
	}
	return response
}

func integrationMCPText(result *mcp.CallToolResult) string {
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
