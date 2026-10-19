package bookings

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/danztee/welio/internal/db"
)

func (service *Service) GetPolicy(ctx context.Context, userID, workspaceID uuid.UUID) (*BookingPolicy, error) {
	var policy *BookingPolicy
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false)
		if err != nil {
			return err
		}
		policy = &BookingPolicy{LeadHours: w.LeadHours, HorizonDays: w.HorizonDays,
			CancelHours: w.CancelHours, SlotMinutes: w.SlotMinutes}
		return nil
	})
	return policy, err
}

func (service *Service) GetReminderPolicy(ctx context.Context, userID, workspaceID uuid.UUID) (*ReminderPolicy, error) {
	var policy *ReminderPolicy
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false)
		if err != nil {
			return err
		}
		policy = &ReminderPolicy{Enabled: w.RemindersEnabled}
		return nil
	})
	return policy, err
}

func (service *Service) SavePolicy(ctx context.Context, userID, workspaceID uuid.UUID, input BookingPolicy) error {
	if input.LeadHours < 0 || input.LeadHours > 168 || input.HorizonDays < 1 || input.HorizonDays > 365 ||
		input.CancelHours < 0 || input.CancelHours > 168 ||
		(input.SlotMinutes != 15 && input.SlotMinutes != 30 && input.SlotMinutes != 60) {
		return fmt.Errorf("%w: check the booking policy values", ErrInvalid)
	}
	return service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE workspaces SET lead_hours=$1,horizon_days=$2,cancel_hours=$3,slot_minutes=$4 WHERE id=$5`,
			input.LeadHours, input.HorizonDays, input.CancelHours, input.SlotMinutes, workspaceID); err != nil {
			return fmt.Errorf("save booking policy: %w", err)
		}
		return nil
	})
}

func (service *Service) SaveReminderPolicy(ctx context.Context, userID, workspaceID uuid.UUID, enabled bool) error {
	return service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE workspaces SET reminders_enabled=$1 WHERE id=$2`, enabled, workspaceID); err != nil {
			return fmt.Errorf("save reminder policy: %w", err)
		}
		return nil
	})
}

func (service *Service) SetPublished(ctx context.Context, userID, workspaceID uuid.UUID, published bool) error {
	return service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true)
		if err != nil {
			return err
		}
		if published {
			locationConfigured := w.ServiceArea
			if w.BookingLocation != "customer_address" {
				locationConfigured = w.BusinessAddress
			}
			if strings.TrimSpace(value(w.ContactEmail)) == "" || strings.TrimSpace(value(locationConfigured)) == "" {
				return fmt.Errorf("%w: add a contact email and service area or business address in Settings before publishing", ErrInvalid)
			}

			var activeServices int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM services WHERE workspace_id=$1 AND is_active=true`, workspaceID).Scan(&activeServices); err != nil {
				return fmt.Errorf("check active services before publishing: %w", err)
			}
			if activeServices == 0 {
				return fmt.Errorf("%w: add an active service before publishing", ErrInvalid)
			}

			catalog, err := service.catalog(ctx, tx, w)
			if err != nil {
				return err
			}
			if len(catalog.Staff) == 0 {
				return fmt.Errorf("%w: add an active team member before publishing", ErrInvalid)
			}
			if len(catalog.Services) == 0 {
				return fmt.Errorf("%w: assign an active team member to at least one active service before publishing", ErrInvalid)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE workspaces SET is_published=$1 WHERE id=$2`, published, workspaceID); err != nil {
			return fmt.Errorf("update booking page publication: %w", err)
		}
		return nil
	})
}

func (service *Service) ListTimeOff(ctx context.Context, userID, workspaceID uuid.UUID) ([]TimeOff, error) {
	items := make([]TimeOff, 0)
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT t.id,t.workspace_id,t.staff_id,s.name,t.from_date::text,t.to_date::text,t.reason
			FROM staff_time_off t JOIN staff s ON s.workspace_id=t.workspace_id AND s.id=t.staff_id
			WHERE t.workspace_id=$1 ORDER BY t.from_date,t.to_date,s.name,t.id`, workspaceID)
		if err != nil {
			return fmt.Errorf("list workspace time off: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var item TimeOff
			if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.StaffID, &item.StaffName, &item.From, &item.To, &item.Reason); err != nil {
				return fmt.Errorf("scan workspace time off: %w", err)
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate workspace time off: %w", err)
		}
		return nil
	})
	return items, err
}

func (service *Service) CreateTimeOff(ctx context.Context, userID, workspaceID uuid.UUID, input TimeOffInput) (uuid.UUID, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if input.StaffID == uuid.Nil || !validDate(input.From) || !validDate(input.To) || input.From > input.To || len([]rune(input.Reason)) < 1 || len([]rune(input.Reason)) > 200 {
		return uuid.Nil, fmt.Errorf("%w: check the team member, dates, and reason", ErrInvalid)
	}
	var id uuid.UUID
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true)
		if err != nil {
			return err
		}
		var staffID uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id FROM staff WHERE workspace_id=$1 AND id=$2`, workspaceID, input.StaffID).Scan(&staffID)
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("find time-off team member: %w", err)
		}
		location, err := time.LoadLocation(w.TimeZone)
		if err != nil {
			return fmt.Errorf("load workspace time zone: %w", err)
		}
		nextDate, err := addDays(input.To, 1)
		if err != nil {
			return err
		}
		from, err := localInstant(input.From, "00:00", location)
		if err != nil {
			return fmt.Errorf("resolve time-off start: %w", err)
		}
		to, err := localInstant(nextDate, "00:00", location)
		if err != nil {
			return fmt.Errorf("resolve time-off end: %w", err)
		}
		var conflict bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM appointments
			WHERE workspace_id=$1 AND staff_id=$2 AND status='confirmed' AND ends_at>$3
			AND starts_at - (buffer_before_minutes * interval '1 minute') < $4
			AND ends_at + (buffer_after_minutes * interval '1 minute') > $5
		)`, workspaceID, staffID, service.now(), to, from).Scan(&conflict); err != nil {
			return fmt.Errorf("check appointments against time off: %w", err)
		}
		if conflict {
			return fmt.Errorf("%w: reschedule existing appointments in this period before adding time off", ErrConflict)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO staff_time_off(workspace_id,staff_id,from_date,to_date,reason)
			VALUES($1,$2,$3::date,$4::date,$5) RETURNING id`, workspaceID, staffID, input.From, input.To, input.Reason).Scan(&id); err != nil {
			return fmt.Errorf("create time off: %w", err)
		}
		return nil
	})
	return id, err
}

func (service *Service) DeleteTimeOff(ctx context.Context, userID, workspaceID, id uuid.UUID) error {
	if id == uuid.Nil {
		return ErrNotFound
	}
	return service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM staff_time_off WHERE workspace_id=$1 AND id=$2`, workspaceID, id); err != nil {
			return fmt.Errorf("delete time off: %w", err)
		}
		return nil
	})
}

// RetryNotification uses River's supported retry operation after verifying the
// failed job belongs to the authorized workspace. The update and authorization
// check share a transaction, so the job cannot be retried across tenants.
func (service *Service) RetryNotification(ctx context.Context, userID, workspaceID uuid.UUID, jobID int64) error {
	if jobID < 1 {
		return fmt.Errorf("%w: choose a valid notification", ErrInvalid)
	}
	if service.Jobs == nil {
		return fmt.Errorf("%w: notification delivery is not configured", ErrUnavailable)
	}
	return service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), true); err != nil {
			return err
		}
		var state string
		err := tx.QueryRow(ctx, `SELECT state::text FROM river_job
			WHERE id=$1 AND kind=$2 AND args->>'workspace_id'=$3 FOR UPDATE`, jobID, bookingEmailKind, workspaceID.String()).Scan(&state)
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("find booking notification: %w", err)
		}
		if state != "discarded" {
			return fmt.Errorf("%w: only a failed notification can be retried", ErrConflict)
		}
		if _, err := service.Jobs.JobRetryTx(ctx, tx, jobID); err != nil {
			return fmt.Errorf("retry booking notification: %w", err)
		}
		return nil
	})
}
