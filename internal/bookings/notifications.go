package bookings

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	jobargs "github.com/danztee/welio/internal/jobs"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

type Notification struct {
	ID        string    `json:"id"`
	Recipient string    `json:"recipient"`
	Subject   string    `json:"subject"`
	Kind      string    `json:"kind"`
	Status    string    `json:"status"`
	Attempts  int       `json:"attempts"`
	CreatedAt time.Time `json:"created_at"`
}

func (service *Service) ListNotifications(ctx context.Context, userID, workspaceID uuid.UUID) ([]Notification, error) {
	items := make([]Notification, 0)
	if err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id, args->>'to', args->>'subject',
			coalesce(args->>'event_type', 'booking'),
			CASE state::text
				WHEN 'running' THEN 'sending'
				WHEN 'completed' THEN 'sent'
				WHEN 'discarded' THEN 'failed'
				WHEN 'cancelled' THEN 'skipped'
				ELSE 'queued'
			END,
			attempt, created_at
			FROM river_job
			WHERE kind=$1 AND args->>'workspace_id'=$2
			ORDER BY created_at DESC, id DESC LIMIT 200`, jobargs.KindBookingEmail, workspaceID.String())
		if err != nil {
			return fmt.Errorf("list workspace booking notifications: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var item Notification
			var id int64
			if err := rows.Scan(&id, &item.Recipient, &item.Subject, &item.Kind, &item.Status, &item.Attempts, &item.CreatedAt); err != nil {
				return fmt.Errorf("scan workspace booking notification: %w", err)
			}
			item.ID = strconv.FormatInt(id, 10)
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate workspace booking notifications: %w", err)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return items, nil
}

func RegisterNotificationAPI(service *Service, api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "workspace-notifications-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/notifications", Summary: "List recent booking email delivery status", Tags: []string{"Appointments and customers"}},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
		}) (*struct{ Body []Notification }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(httpx.E(http.StatusNotFound, "workspace_not_found", "Workspace not found."))
			}
			items, err := service.ListNotifications(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []Notification }{Body: items}, nil
		})
}
