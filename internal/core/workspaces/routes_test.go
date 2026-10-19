package workspaces

import (
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func TestRegisterAPIRegistersWorkspaceOperations(t *testing.T) {
	api := humachi.New(chi.NewRouter(), huma.DefaultConfig("test", "1"))
	RegisterAPI(&Service{}, api)
	for _, path := range []string{
		"/v1/workspaces",
		"/v1/workspaces/{workspaceID}",
		"/v1/workspaces/{workspaceID}/setup/complete",
		"/v1/workspaces/{workspaceID}/team-access",
		"/v1/workspaces/{workspaceID}/invitations",
		"/v1/workspaces/{workspaceID}/members/{userID}",
		"/v1/workspaces/{workspaceID}/invitations/{invitationID}",
		"/v1/invitations/inspect",
		"/v1/invitations/accept",
	} {
		if api.OpenAPI().Paths[path] == nil {
			t.Errorf("OpenAPI is missing %s", path)
		}
	}
}
