package bookings

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerTimeOff(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/time-off", Summary: "List workspace team time off", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body []TimeOff }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.ListTimeOff(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []TimeOff }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-create", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/time-off", Summary: "Schedule team time off", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        TimeOffInput
		}) (*struct{ Body bookingReceipt }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			id, err := service.CreateTimeOff(ctx, principal.UserID, workspaceID, in.Body)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body bookingReceipt }{Body: bookingReceipt{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-delete", Method: http.MethodDelete,
		Path: "/v1/workspaces/{workspaceId}/time-off/{timeOffId}", Summary: "Remove scheduled team time off", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			TimeOffID   string `path:"timeOffId"`
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			timeOffID, err := uuid.Parse(in.TimeOffID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.DeleteTimeOff(ctx, principal.UserID, workspaceID, timeOffID); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})
}
