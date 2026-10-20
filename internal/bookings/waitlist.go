package bookings

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/danztee/welio/internal/db"
	jobargs "github.com/danztee/welio/internal/jobs"
)

const waitlistBatchSize = 100

// WaitlistInput is the public request to join a waitlist.
type WaitlistInput struct {
	ServiceID   uuid.UUID `json:"service_id"`
	StaffID     uuid.UUID `json:"staff_id,omitempty"`
	RequestDate string    `json:"request_date"`
	Email       string    `json:"email"`
	Name        string    `json:"name,omitempty"`
}

// WaitlistEntry is a full waitlist record returned to workspace owners.
type WaitlistEntry struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	ServiceID     uuid.UUID  `json:"service_id"`
	StaffID       *uuid.UUID `json:"staff_id,omitempty"`
	RequestDate   string     `json:"request_date"`
	CustomerName  string     `json:"customer_name"`
	CustomerEmail string     `json:"customer_email"`
	Status        string     `json:"status"`
	NotifiedAt    *time.Time `json:"notified_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// WaitlistDateSummary is returned on the public list endpoint. It contains no
// customer PII — only the date, service name, and count of active entries.
type WaitlistDateSummary struct {
	RequestDate string `json:"request_date"`
	ServiceName string `json:"service_name"`
	Count       int    `json:"count"`
}

// JoinWaitlist adds or returns an existing active entry for the same request.
// The scope must be a published public page. Returns the entry and true when a
// new entry was created, false when an existing one was returned (deduplicated).
func (service *Service) JoinWaitlist(ctx context.Context, scope Scope, input WaitlistInput) (*WaitlistEntry, bool, error) {
	email := normalizeEmail(input.Email)
	input.Name = strings.TrimSpace(input.Name)
	if input.ServiceID == uuid.Nil || !validDate(input.RequestDate) {
		return nil, false, fmt.Errorf("%w: choose a service and valid date", ErrInvalid)
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 {
		return nil, false, fmt.Errorf("%w: enter a valid email address", ErrInvalid)
	}
	if input.Name != "" && len([]rune(input.Name)) > 100 {
		return nil, false, fmt.Errorf("%w: name is too long", ErrInvalid)
	}
	var entry *WaitlistEntry
	created := false
	err = service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, scope, true)
		if err != nil {
			return err
		}
		// Validate the date is within the booking horizon.
		today := service.now().In(mustLocation(w.TimeZone)).Format("2006-01-02")
		if input.RequestDate < today {
			return fmt.Errorf("%w: choose a date in the future", ErrInvalid)
		}
		maxDate, err := addDays(today, w.HorizonDays)
		if err != nil {
			return err
		}
		if input.RequestDate > maxDate {
			return fmt.Errorf("%w: choose a date within the booking window", ErrInvalid)
		}
		// Validate the service is in the published catalog (active, has staff).
		s, err := service.service(ctx, tx, w.ID, input.ServiceID)
		if err != nil {
			return err
		}
		var staffCount int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM staff_services ss
			JOIN staff st ON st.id=ss.staff_id AND st.workspace_id=ss.workspace_id
			WHERE ss.workspace_id=$1 AND ss.service_id=$2 AND ss.is_active=true AND st.is_active=true`,
			w.ID, s.ID).Scan(&staffCount); err != nil {
			return fmt.Errorf("check service staff: %w", err)
		}
		if staffCount == 0 {
			return fmt.Errorf("%w: this service is not taking bookings", ErrConflict)
		}
		// Validate optional staff belongs to the service.
		if input.StaffID != uuid.Nil {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM staff_services ss
				JOIN staff st ON st.id=ss.staff_id AND st.workspace_id=ss.workspace_id
				WHERE ss.workspace_id=$1 AND ss.service_id=$2 AND ss.staff_id=$3
				AND ss.is_active=true AND st.is_active=true)`,
				w.ID, s.ID, input.StaffID).Scan(&exists); err != nil {
				return fmt.Errorf("check waitlist staff: %w", err)
			}
			if !exists {
				return fmt.Errorf("%w: that team member does not offer this service", ErrConflict)
			}
		}
		slots, err := service.availability(ctx, tx, w, s, input.RequestDate, input.StaffID, uuid.Nil)
		if err != nil {
			return err
		}
		if len(slots) != 0 {
			return fmt.Errorf("%w: this date still has available times", ErrConflict)
		}
		// Compute expires_at: end of the request date in the workspace time zone.
		loc := mustLocation(w.TimeZone)
		dayStart, err := time.ParseInLocation("2006-01-02", input.RequestDate, loc)
		if err != nil {
			return fmt.Errorf("parse waitlist date: %w", err)
		}
		expiresAt := dayStart.AddDate(0, 0, 1)
		if !expiresAt.After(service.now()) {
			return fmt.Errorf("%w: that date has already passed", ErrInvalid)
		}
		// Try to return an existing active entry (deduplicate).
		var staffID *uuid.UUID
		if input.StaffID != uuid.Nil {
			id := input.StaffID
			staffID = &id
		}
		existing := &WaitlistEntry{}
		queryErr := scanWaitlistEntry(tx.QueryRow(ctx, `SELECT id, workspace_id, service_id, staff_id, request_date::text,
			customer_name, customer_email, status, notified_at, created_at
			FROM waitlist_entries
			WHERE workspace_id=$1 AND service_id=$2 AND request_date=$3
			AND staff_id IS NOT DISTINCT FROM $4::uuid
			AND lower(customer_email) = lower($5) AND status = 'active'`,
			w.ID, s.ID, input.RequestDate, staffID, email), existing)
		if queryErr == nil {
			entry = existing
			return nil
		}
		if !db.IsNotFound(queryErr) {
			return fmt.Errorf("find waitlist entry: %w", queryErr)
		}
		// Insert a new entry.
		var staffVal any
		if input.StaffID != uuid.Nil {
			staffVal = input.StaffID
		}
		newEntry := &WaitlistEntry{}
		insertErr := scanWaitlistEntry(tx.QueryRow(ctx, `INSERT INTO waitlist_entries
			(workspace_id, service_id, staff_id, request_date, customer_email, customer_name, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT DO NOTHING
			RETURNING id, workspace_id, service_id, staff_id, request_date::text,
				customer_name, customer_email, status, notified_at, created_at`,
			w.ID, s.ID, staffVal, input.RequestDate, email, input.Name, expiresAt), newEntry)
		if db.IsNotFound(insertErr) {
			// Another request inserted the same active entry. Re-read it.
			if err := scanWaitlistEntry(tx.QueryRow(ctx, `SELECT id, workspace_id, service_id, staff_id, request_date::text,
					customer_name, customer_email, status, notified_at, created_at
					FROM waitlist_entries
					WHERE workspace_id=$1 AND service_id=$2 AND request_date=$3
					AND staff_id IS NOT DISTINCT FROM $4::uuid
					AND lower(customer_email) = lower($5) AND status = 'active'`,
				w.ID, s.ID, input.RequestDate, staffID, email), newEntry); err != nil {
				return fmt.Errorf("reread waitlist entry after race: %w", err)
			}
			entry = newEntry
			return nil
		}
		if insertErr != nil {
			return fmt.Errorf("create waitlist entry: %w", insertErr)
		}
		entry = newEntry
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return entry, created, nil
}

func scanWaitlistEntry(row pgx.Row, e *WaitlistEntry) error {
	return row.Scan(&e.ID, &e.WorkspaceID, &e.ServiceID, &e.StaffID,
		&e.RequestDate, &e.CustomerName, &e.CustomerEmail, &e.Status,
		&e.NotifiedAt, &e.CreatedAt)
}

// WaitlistForOwner lists active entries for a workspace, ordered by date then
// creation time. The caller must have already verified workspace membership.
func (service *Service) WaitlistForOwner(ctx context.Context, userID, workspaceID uuid.UUID) ([]WaitlistEntry, error) {
	entries := []WaitlistEntry{}
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id, workspace_id, service_id, staff_id, request_date::text,
			customer_name, customer_email, status, notified_at, created_at
			FROM waitlist_entries
			WHERE workspace_id=$1 AND status='active' AND expires_at > $3
			ORDER BY request_date, created_at LIMIT $2`,
			workspaceID, waitlistBatchSize, service.now())
		if err != nil {
			return fmt.Errorf("list waitlist entries: %w", err)
		}
		for rows.Next() {
			var e WaitlistEntry
			if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.ServiceID, &e.StaffID,
				&e.RequestDate, &e.CustomerName, &e.CustomerEmail, &e.Status,
				&e.NotifiedAt, &e.CreatedAt); err != nil {
				rows.Close()
				return fmt.Errorf("scan waitlist entry: %w", err)
			}
			entries = append(entries, e)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate waitlist entries: %w", err)
		}
		rows.Close()
		return nil
	})
	return entries, err
}

// PublicWaitlistSummary returns a PII-free summary of active waitlist demand for
// a published workspace's catalog.
func (service *Service) PublicWaitlistSummary(ctx context.Context, slug string) ([]WaitlistDateSummary, error) {
	summary := []WaitlistDateSummary{}
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, PublicScope(slug), false)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT we.request_date::text, s.name, count(*)
			FROM waitlist_entries we
			JOIN services s ON s.id = we.service_id AND s.workspace_id = we.workspace_id
			WHERE we.workspace_id=$1 AND we.status='active' AND we.request_date >= $2::date
			AND we.expires_at > $3
			GROUP BY we.request_date, s.name
			ORDER BY we.request_date, s.name`,
			w.ID, service.now().In(mustLocation(w.TimeZone)).Format("2006-01-02"), service.now())
		if err != nil {
			return fmt.Errorf("summarize waitlist: %w", err)
		}
		for rows.Next() {
			var item WaitlistDateSummary
			if err := rows.Scan(&item.RequestDate, &item.ServiceName, &item.Count); err != nil {
				rows.Close()
				return fmt.Errorf("scan waitlist summary: %w", err)
			}
			summary = append(summary, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate waitlist summary: %w", err)
		}
		rows.Close()
		return nil
	})
	return summary, err
}

// cancelledAppointment carries the details NotifyWaitlistOnCancellation needs.
type cancelledAppointment struct {
	ID        uuid.UUID
	ServiceID uuid.UUID
	StaffID   uuid.UUID
	StartsAt  time.Time
}

// NotifyWaitlistOnCancellation finds the first active waitlist entry matching a
// cancelled appointment and enqueues a notification email in the same transaction.
// The caller must already hold the workspace lock. Returns true if notified.
func (service *Service) NotifyWaitlistOnCancellation(ctx context.Context, tx pgx.Tx, w *workspace, appt cancelledAppointment) (bool, error) {
	if !appt.StartsAt.After(service.now()) {
		return false, nil
	}
	requestDate := appt.StartsAt.In(mustLocation(w.TimeZone)).Format("2006-01-02")
	today := service.now().In(mustLocation(w.TimeZone)).Format("2006-01-02")
	maxDate, err := addDays(today, w.HorizonDays)
	if err != nil {
		return false, err
	}
	if requestDate < today || requestDate > maxDate {
		return false, nil
	}
	s, err := service.service(ctx, tx, w.ID, appt.ServiceID)
	if errors.Is(err, ErrConflict) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	slots, err := service.availability(ctx, tx, w, s, requestDate, appt.StaffID, uuid.Nil)
	if err != nil {
		return false, err
	}
	if len(slots) == 0 {
		return false, nil
	}
	// The workspace is already locked, so cancellation and notification are
	// serialized. Among matching entries, the oldest request goes first.
	var entryID uuid.UUID
	var customerEmail string
	err = tx.QueryRow(ctx, `SELECT id, customer_email
		FROM waitlist_entries
		WHERE workspace_id=$1 AND service_id=$2 AND request_date=$3 AND status='active' AND expires_at > $5
		AND (staff_id = $4 OR staff_id IS NULL)
		ORDER BY created_at, id LIMIT 1`,
		w.ID, appt.ServiceID, requestDate, optionalUUID(appt.StaffID), service.now()).
		Scan(&entryID, &customerEmail)
	if db.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("find waitlist match: %w", err)
	}
	// Load the service name for the email body.
	var serviceName string
	if err := tx.QueryRow(ctx, `SELECT name FROM services WHERE workspace_id=$1 AND id=$2`, w.ID, appt.ServiceID).Scan(&serviceName); err != nil {
		return false, fmt.Errorf("load service name for waitlist notification: %w", err)
	}
	// Mark the entry as notified.
	if _, err := tx.Exec(ctx, `UPDATE waitlist_entries SET status='notified', notified_at=now()
		WHERE workspace_id=$1 AND id=$2 AND status='active'`, w.ID, entryID); err != nil {
		return false, fmt.Errorf("claim waitlist entry: %w", err)
	}
	// Build the notification email and enqueue it in the same transaction.
	bookingURL := fmt.Sprintf("%s/book/%s?service=%s&date=%s", service.PublicURL, w.Slug, appt.ServiceID, requestDate)
	if appt.StaffID != uuid.Nil {
		bookingURL += "&staff=" + appt.StaffID.String()
	}
	when := appt.StartsAt.In(mustLocation(w.TimeZone)).Format("Monday, 2 January 2006")
	body := fmt.Sprintf("A slot opened for %s\n\n%s on %s (%s) now has availability.\n\nBook before it fills up:\n%s\n\nContact: %s",
		serviceName, serviceName, when, w.TimeZone, bookingURL, firstNonempty(value(w.ContactEmail), w.Phone))
	args := jobargs.BookingEmailArgs{
		EventKey:      fmt.Sprintf("%s:waitlist:%s", appt.ID, entryID),
		WorkspaceID:   w.ID,
		AppointmentID: appt.ID,
		EventType:     "waitlist",
		To:            customerEmail,
		Subject:       "A slot opened · " + w.Name,
		Text:          body,
	}
	if err := service.enqueueEmail(ctx, tx, args); err != nil {
		return false, err
	}
	return true, nil
}

// ExpireWaitlist marks entries whose request date has passed as expired.
// Called by the periodic sweep worker alongside EnqueueDueReminders.
func (service *Service) ExpireWaitlist(ctx context.Context) (int, error) {
	now := service.now()
	tag, err := service.DB.Pool.Exec(ctx, `UPDATE waitlist_entries SET status='expired'
		WHERE id IN (
			SELECT id FROM waitlist_entries
			WHERE status='active' AND expires_at < $1
			LIMIT $2
		)`, now, waitlistBatchSize)
	if err != nil {
		return 0, fmt.Errorf("expire waitlist entries: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
