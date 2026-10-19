package bookings

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerCatalog(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-catalog", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/booking-catalog", Summary: "Read the active catalog for booking setup", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body Catalog }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			catalog, err := service.CatalogForOwner(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Catalog }{Body: *catalog}, nil
		})
}
