package bookings

import (
	"context"
	"fmt"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerPolicies(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-policy-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/booking-policy", Summary: "Read workspace booking policy", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body BookingPolicy }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			policy, err := service.GetPolicy(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body BookingPolicy }{Body: *policy}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-policy-save", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/booking-policy", Summary: "Update workspace booking policy", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        BookingPolicy
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.SavePolicy(ctx, principal.UserID, workspaceID, in.Body); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-reminder-policy-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/reminder-policy", Summary: "Read workspace reminder policy", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body ReminderPolicy }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			policy, err := service.GetReminderPolicy(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body ReminderPolicy }{Body: *policy}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-reminder-policy-save", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/reminder-policy", Summary: "Update workspace reminder policy", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        struct {
				Enabled *bool `json:"enabled"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if in.Body.Enabled == nil {
				return nil, problem(fmt.Errorf("%w: reminder setting is required", ErrInvalid))
			}
			if err := service.SaveReminderPolicy(ctx, principal.UserID, workspaceID, *in.Body.Enabled); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-publish", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/booking-page", Summary: "Publish or unpublish a booking page", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        struct {
				Published *bool `json:"published"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if in.Body.Published == nil {
				return nil, problem(fmt.Errorf("%w: publication status is required", ErrInvalid))
			}
			if err := service.SetPublished(ctx, principal.UserID, workspaceID, *in.Body.Published); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})
}
