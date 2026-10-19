package receptionist

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestExternalMCPStreamableHTTP exercises the deployed endpoint with an MCP SDK
// client. Set WELIO_MCP_URL to the complete HTTPS endpoint and WELIO_MCP_TOKEN
// to that business's bearer secret to run it; otherwise it skips.
func TestExternalMCPStreamableHTTP(t *testing.T) {
	endpoint := strings.TrimSpace(os.Getenv("WELIO_MCP_URL"))
	token := strings.TrimSpace(os.Getenv("WELIO_MCP_TOKEN"))
	if endpoint == "" || token == "" {
		t.Skip("set WELIO_MCP_URL and WELIO_MCP_TOKEN to run the external MCP smoke test")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		t.Fatal("WELIO_MCP_URL must be a complete HTTPS MCP endpoint")
	}
	if len(token) < 32 {
		t.Fatal("WELIO_MCP_TOKEN must contain at least 32 characters")
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "welio-external-smoke", Version: "1"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		DisableStandaloneSSE: true,
		HTTPClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: externalMCPHeaders{token: token, next: http.DefaultTransport},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		t.Fatalf("connect to external MCP endpoint: %v", err)
	}
	defer session.Close()
	if version := session.InitializeResult().ProtocolVersion; version < MCPMinimumProtocolVersion {
		t.Fatalf("negotiated MCP protocol version = %q, want %s or later", version, MCPMinimumProtocolVersion)
	}
	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list external MCP tools: %v", err)
	}
	want := map[string]bool{"list_services": false, "check_availability": false, "prepare_booking": false, "confirm_booking": false}
	for _, tool := range listed.Tools {
		if _, ok := want[tool.Name]; ok {
			want[tool.Name] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("external tools/list did not include %q", name)
		}
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_services", Arguments: map[string]any{}})
	if err != nil {
		t.Fatalf("call external list_services: %v", err)
	}
	if result.IsError || len(result.Content) == 0 {
		t.Fatalf("external list_services failed: %s", mcpText(result))
	}
}

type externalMCPHeaders struct {
	token string
	next  http.RoundTripper
}

func (transport externalMCPHeaders) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("Authorization", "Bearer "+transport.token)
	return transport.next.RoundTrip(request)
}
