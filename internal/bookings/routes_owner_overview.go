package bookings

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerOverview(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-overview", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/overview", Summary: "Read complete business metrics", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body Overview }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			result, err := service.Overview(ctx, principal.UserID, id)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Overview }{Body: result}, nil
		})
}
