package bookings

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerNotificationRetry(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-notification-retry", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/notifications/{notificationId}/retry", Summary: "Retry a failed booking notification", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID    string `path:"workspaceId"`
			NotificationID int64  `path:"notificationId"`
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.RetryNotification(ctx, principal.UserID, workspaceID, in.NotificationID); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})
}
