package bookings

import (
	"context"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/danztee/welio/internal/db"
)

func (service *Service) Booking(ctx context.Context, id uuid.UUID, actor Actor, workspaceID uuid.UUID) (*BookingView, error) {
	if id == uuid.Nil {
		return nil, ErrNotFound
	}
	var view *BookingView
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		booking, w, err := service.authorizedBooking(ctx, tx, id, actor, workspaceID)
		if err != nil {
			return err
		}
		var staffName string
		if err := tx.QueryRow(ctx, `SELECT name FROM staff WHERE workspace_id=$1 AND id=$2`, w.ID, booking.StaffID).Scan(&staffName); err != nil && !db.IsNotFound(err) {
			return fmt.Errorf("read appointment staff: %w", err)
		}
		if staffName == "" {
			staffName = "Team member"
		}
		view = booking.view(w, staffName, service.now())
		return nil
	})
	return view, err
}

func (service *Service) AvailabilityForBooking(ctx context.Context, id uuid.UUID, actor Actor, workspaceID uuid.UUID, date string) ([]Slot, error) {
	if !validDate(date) {
		return nil, fmt.Errorf("%w: choose a valid date", ErrInvalid)
	}
	var slots []Slot
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		booking, w, err := service.authorizedBooking(ctx, tx, id, actor, workspaceID)
		if err != nil {
			return err
		}
		now := service.now()
		if booking.Status != "confirmed" {
			return fmt.Errorf("%w: this appointment is already closed", ErrConflict)
		}
		if actor.Token != "" && !publicChangeAllowed(booking, w, now) {
			return fmt.Errorf("%w: contact the business to change this appointment inside the cancellation window", ErrConflict)
		}
		s := &serviceRecord{ID: booking.ServiceID, DurationMinutes: booking.DurationMinutes,
			BufferBeforeMinutes: booking.BufferBeforeMinutes, BufferAfterMinutes: booking.BufferAfterMinutes}
		slots, err = service.availability(ctx, tx, w, s, date, uuid.Nil, booking.ID)
		return err
	})
	return slots, err
}

func (service *Service) Change(ctx context.Context, id uuid.UUID, actor Actor, workspaceID uuid.UUID, input ChangeInput) (uuid.UUID, error) {
	if id == uuid.Nil || input.Key == uuid.Nil || input.Version < 0 {
		return uuid.Nil, fmt.Errorf("%w: check appointment details", ErrInvalid)
	}
	if actor.UserID == uuid.Nil && actor.Token == "" {
		return uuid.Nil, ErrForbidden
	}
	if actor.UserID != uuid.Nil && actor.Token != "" {
		return uuid.Nil, fmt.Errorf("%w: provide one authorization method", ErrInvalid)
	}
	if input.Action != "cancel" && input.Action != "reschedule" && input.Action != "completed" && input.Action != "no_show" {
		return uuid.Nil, fmt.Errorf("%w: choose a valid appointment action", ErrInvalid)
	}
	if input.Action == "reschedule" && (!validDate(input.Date) || !validClock(input.Time) || input.StaffID == uuid.Nil) {
		return uuid.Nil, fmt.Errorf("%w: choose a new date, time, and team member", ErrInvalid)
	}
	var changedID uuid.UUID
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		booking, w, err := service.authorizedBooking(ctx, tx, id, actor, workspaceID)
		if err != nil {
			return err
		}
		identity := actor.UserID.String()
		if actor.Token != "" {
			if booking.ManagementTokenHash != nil {
				identity = *booking.ManagementTokenHash
			}
		}
		fingerprint := hash(fmt.Sprintf("%s:%s:%d:%s:%s:%s:%s", id, identity, input.Version, input.Action, input.Date, input.Time, input.StaffID))
		var priorFingerprint string
		var priorID uuid.UUID
		err = tx.QueryRow(ctx, `SELECT fingerprint,appointment_id FROM booking_operations WHERE workspace_id=$1 AND key=$2`, w.ID, input.Key.String()).Scan(&priorFingerprint, &priorID)
		if err == nil {
			if priorFingerprint != fingerprint {
				return fmt.Errorf("%w: this request key was already used for another action", ErrConflict)
			}
			changedID = priorID
			return nil
		}
		if !db.IsNotFound(err) {
			return fmt.Errorf("read booking operation: %w", err)
		}
		if booking.Version != input.Version {
			return fmt.Errorf("%w: this appointment changed; reload its details before trying again", ErrConflict)
		}
		if booking.Status != "confirmed" {
			return fmt.Errorf("%w: this appointment is already closed", ErrConflict)
		}
		if actor.Token != "" {
			if input.Action != "cancel" && input.Action != "reschedule" {
				return ErrForbidden
			}
			if !publicChangeAllowed(booking, w, service.now()) {
				return fmt.Errorf("%w: contact the business to make changes inside the cancellation window", ErrConflict)
			}
		}
		updatedVersion := booking.Version + 1
		startsAt := booking.StartsAt
		endsAt := booking.EndsAt
		staffID := booking.StaffID
		status := booking.Status
		if input.Action == "reschedule" {
			s := &serviceRecord{ID: booking.ServiceID, DurationMinutes: booking.DurationMinutes,
				BufferBeforeMinutes: booking.BufferBeforeMinutes, BufferAfterMinutes: booking.BufferAfterMinutes}
			slots, err := service.availability(ctx, tx, w, s, input.Date, input.StaffID, booking.ID)
			if err != nil {
				return err
			}
			found := false
			for _, slot := range slots {
				if slot.Time == input.Time && slot.StaffID == input.StaffID {
					startsAt = slot.StartsAt
					endsAt = startsAt.Add(time.Duration(booking.DurationMinutes) * time.Minute)
					staffID = input.StaffID
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("%w: that time is no longer available; the original appointment is unchanged", ErrConflict)
			}
		} else {
			if (input.Action == "completed" || input.Action == "no_show") && service.now().Before(booking.StartsAt) {
				return fmt.Errorf("%w: wait until the appointment starts before marking it completed or no-show", ErrConflict)
			}
			switch input.Action {
			case "cancel":
				status = "cancelled"
			case "completed":
				status = "completed"
			case "no_show":
				status = "no_show"
			}
		}
		_, err = tx.Exec(ctx, `UPDATE appointments SET status=$1,starts_at=$2,ends_at=$3,staff_id=$4,version=$5,
			reminder_queued_version=NULL, reminder_sent_version=NULL,
			management_expires_at=CASE WHEN $6::boolean THEN ($2::timestamptz + interval '30 days') ELSE management_expires_at END
			WHERE workspace_id=$7 AND id=$8`, status, startsAt, endsAt, staffID, updatedVersion, input.Action == "reschedule", w.ID, id)
		if err != nil {
			return fmt.Errorf("update appointment: %w", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO booking_operations(workspace_id,key,appointment_id,fingerprint) VALUES($1,$2,$3,$4)`, w.ID, input.Key.String(), id, fingerprint)
		if err != nil {
			return fmt.Errorf("record booking operation: %w", err)
		}
		if input.Action == "reschedule" || input.Action == "cancel" {
			if err := service.enqueueChangeEmail(ctx, tx, w, booking, input.Action, updatedVersion, startsAt, actor.Token); err != nil {
				return err
			}
		}
		changedID = id
		return nil
	})
	return changedID, err
}

func (service *Service) authorizedBooking(ctx context.Context, tx pgx.Tx, id uuid.UUID, actor Actor, workspaceID uuid.UUID) (*storedAppointment, *workspace, error) {
	if actor.UserID == uuid.Nil && actor.Token == "" {
		return nil, nil, ErrNotFound
	}
	if actor.UserID != uuid.Nil && actor.Token != "" {
		return nil, nil, fmt.Errorf("%w: provide one authorization method", ErrInvalid)
	}
	if actor.Token != "" && !validManagementToken(actor.Token) {
		return nil, nil, ErrNotFound
	}
	var foundWorkspace uuid.UUID
	err := tx.QueryRow(ctx, `SELECT workspace_id FROM appointments WHERE id=$1`, id).Scan(&foundWorkspace)
	if db.IsNotFound(err) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("find appointment: %w", err)
	}
	if workspaceID != uuid.Nil && foundWorkspace != workspaceID {
		return nil, nil, ErrNotFound
	}
	if actor.UserID != uuid.Nil {
		if workspaceID == uuid.Nil {
			return nil, nil, fmt.Errorf("%w: workspace id is required", ErrInvalid)
		}
		var role string
		err := tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, workspaceID, actor.UserID).Scan(&role)
		if db.IsNotFound(err) {
			return nil, nil, ErrNotFound
		}
		if err != nil {
			return nil, nil, fmt.Errorf("check appointment access: %w", err)
		}
		if role != "owner" {
			return nil, nil, ErrForbidden
		}
	} else if actor.Token == "" {
		return nil, nil, ErrForbidden
	}
	w := &workspace{}
	err = tx.QueryRow(ctx, `SELECT id,name,logo,slug,time_zone,currency,contact_email,service_area,business_address,
		booking_location,is_published,phone,lead_hours,horizon_days,cancel_hours,slot_minutes FROM workspaces WHERE id=$1 FOR UPDATE`, foundWorkspace).
		Scan(&w.ID, &w.Name, &w.Logo, &w.Slug, &w.TimeZone, &w.Currency, &w.ContactEmail, &w.ServiceArea, &w.BusinessAddress,
			&w.BookingLocation, &w.Published, &w.Phone, &w.LeadHours, &w.HorizonDays, &w.CancelHours, &w.SlotMinutes)
	if err != nil {
		return nil, nil, fmt.Errorf("lock appointment workspace: %w", err)
	}
	b := &storedAppointment{}
	err = tx.QueryRow(ctx, `SELECT id,workspace_id,customer_id,service_id,staff_id,status,starts_at,ends_at,
		service_name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,service_address,
		customer_name,customer_email,customer_phone,notification_consent,time_zone,source,version,idempotency_key,
		created_at,management_token_hash,management_expires_at FROM appointments WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, id, foundWorkspace).
		Scan(&b.ID, &b.WorkspaceID, &b.CustomerID, &b.ServiceID, &b.StaffID, &b.Status, &b.StartsAt, &b.EndsAt, &b.ServiceName,
			&b.DurationMinutes, &b.BufferBeforeMinutes, &b.BufferAfterMinutes, &b.PriceMinor, &b.Currency, &b.ServiceAddress,
			&b.CustomerName, &b.CustomerEmail, &b.CustomerPhone, &b.NotificationConsent, &b.TimeZone, &b.Source, &b.Version,
			&b.IdempotencyKey, &b.CreatedAt, &b.ManagementTokenHash, &b.ManagementExpiresAt)
	if err != nil {
		return nil, nil, fmt.Errorf("lock appointment: %w", err)
	}
	if actor.Token != "" {
		if !validManagementToken(actor.Token) || b.ManagementTokenHash == nil || b.ManagementExpiresAt == nil || !b.ManagementExpiresAt.After(service.now()) {
			return nil, nil, ErrNotFound
		}
		expected := hash(actor.Token)
		if subtle.ConstantTimeCompare([]byte(expected), []byte(*b.ManagementTokenHash)) != 1 {
			return nil, nil, ErrNotFound
		}
	}
	return b, w, nil
}

type storedAppointment struct {
	ID                  uuid.UUID
	WorkspaceID         uuid.UUID
	CustomerID          uuid.UUID
	ServiceID           uuid.UUID
	StaffID             uuid.UUID
	Status              string
	StartsAt            time.Time
	EndsAt              time.Time
	ServiceName         string
	DurationMinutes     int
	BufferBeforeMinutes int
	BufferAfterMinutes  int
	PriceMinor          int
	Currency            string
	ServiceAddress      *string
	CustomerName        string
	CustomerEmail       string
	CustomerPhone       string
	NotificationConsent bool
	TimeZone            string
	Source              string
	Version             int
	IdempotencyKey      *string
	CreatedAt           time.Time
	ManagementTokenHash *string
	ManagementExpiresAt *time.Time
}

func (booking *storedAppointment) view(w *workspace, staffName string, now time.Time) *BookingView {
	canChange := booking.Status == "confirmed" && booking.StartsAt.After(now) && booking.StartsAt.Sub(now) >= time.Duration(w.CancelHours)*time.Hour
	return &BookingView{WorkspaceID: booking.WorkspaceID, ID: booking.ID, Version: booking.Version, Status: booking.Status,
		ServiceID: booking.ServiceID, StaffID: booking.StaffID, ServiceName: booking.ServiceName, StaffName: staffName,
		StartsAt: booking.StartsAt, EndsAt: booking.EndsAt, TimeZone: booking.TimeZone, PriceMinor: booking.PriceMinor, Currency: booking.Currency,
		Duration: booking.DurationMinutes, Name: booking.CustomerName, Email: booking.CustomerEmail, Phone: booking.CustomerPhone,
		Address: value(booking.ServiceAddress), Business: w.Name, ContactEmail: w.ContactEmail, BusinessPhone: w.Phone,
		CanChange: canChange, CancelHours: w.CancelHours, Slug: w.Slug}
}

func publicChangeAllowed(b *storedAppointment, w *workspace, now time.Time) bool {
	return b.Status == "confirmed" && b.StartsAt.After(now) && b.StartsAt.Sub(now) >= time.Duration(w.CancelHours)*time.Hour
}

func validManagementToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	for _, c := range token {
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func (service *Service) enqueueChangeEmail(ctx context.Context, tx pgx.Tx, w *workspace, b *storedAppointment, action string, version int, start time.Time, token string) error {
	label, kind := "Appointment rescheduled", "rescheduled"
	if action == "cancel" {
		label, kind = "Appointment cancelled", "cancelled"
	}
	when := start.In(mustLocation(w.TimeZone)).Format("Monday, 2 January 2006 at 15:04")
	body := fmt.Sprintf("%s\n\n%s\n%s (%s)\n%s %s.%s\n\nContact: %s", label, b.ServiceName, when, w.TimeZone, w.Currency, formatMinor(b.PriceMinor), "", firstNonempty(value(w.ContactEmail), w.Phone))
	if action == "cancel" {
		body = fmt.Sprintf("%s\n\n%s\nContact: %s", label, b.ServiceName, firstNonempty(value(w.ContactEmail), w.Phone))
	}
	if token != "" && action == "reschedule" {
		body += fmt.Sprintf("\n\nManage your booking privately:\n%s/booking/%s#%s", service.PublicURL, b.ID, token)
	}
	return service.enqueueEmail(ctx, tx, BookingEmailArgs{
		EventKey: fmt.Sprintf("%s:%s:%d", b.ID, kind, version), WorkspaceID: w.ID,
		AppointmentID: b.ID, AppointmentVersion: version, EventType: kind,
		To: b.CustomerEmail, Subject: label + " · " + w.Name, Text: body,
	})
}

func (service *Service) ListAppointments(ctx context.Context, userID, workspaceID uuid.UUID) ([]Appointment, error) {
	var result []Appointment
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT a.id,a.workspace_id,a.customer_id,a.service_id,a.staff_id,a.status,a.starts_at,a.ends_at,
			a.service_name,a.duration_minutes,a.buffer_before_minutes,a.buffer_after_minutes,a.price_minor,a.currency,a.service_address,
			a.customer_name,a.customer_email,a.customer_phone,a.notification_consent,a.time_zone,a.source,a.version,a.idempotency_key,a.created_at,st.name
			FROM appointments a LEFT JOIN staff st ON st.workspace_id=a.workspace_id AND st.id=a.staff_id
			WHERE a.workspace_id=$1 ORDER BY a.starts_at DESC LIMIT 1000`, workspaceID)
		if err != nil {
			return fmt.Errorf("list workspace appointments: %w", err)
		}
		result = make([]Appointment, 0)
		for rows.Next() {
			var a Appointment
			if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.CustomerID, &a.ServiceID, &a.StaffID, &a.Status, &a.StartsAt, &a.EndsAt, &a.ServiceName, &a.DurationMinutes, &a.BufferBeforeMinutes, &a.BufferAfterMinutes, &a.PriceMinor, &a.Currency, &a.ServiceAddress, &a.CustomerName, &a.CustomerEmail, &a.CustomerPhone, &a.NotificationConsent, &a.TimeZone, &a.Source, &a.Version, &a.IdempotencyKey, &a.CreatedAt, &a.StaffName); err != nil {
				rows.Close()
				return fmt.Errorf("scan appointment: %w", err)
			}
			if a.StaffName == "" {
				a.StaffName = "Team member"
			}
			result = append(result, a)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate appointments: %w", err)
		}
		rows.Close()
		return nil
	})
	return result, err
}

func (service *Service) ListCustomers(ctx context.Context, userID, workspaceID uuid.UUID) ([]Customer, error) {
	var result []Customer
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id,workspace_id,name,email,phone,created_at FROM customers WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1000`, workspaceID)
		if err != nil {
			return fmt.Errorf("list workspace customers: %w", err)
		}
		result = make([]Customer, 0)
		for rows.Next() {
			var customer Customer
			if err := rows.Scan(&customer.ID, &customer.WorkspaceID, &customer.Name, &customer.Email, &customer.Phone, &customer.CreatedAt); err != nil {
				rows.Close()
				return fmt.Errorf("scan customer: %w", err)
			}
			result = append(result, customer)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate customers: %w", err)
		}
		rows.Close()
		return nil
	})
	return result, err
}

func (service *Service) Customer(ctx context.Context, userID, workspaceID, customerID uuid.UUID) (*CustomerDetail, error) {
	var result *CustomerDetail
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false); err != nil {
			return err
		}
		detail := &CustomerDetail{}
		if err := tx.QueryRow(ctx, `SELECT id,workspace_id,name,email,phone,created_at FROM customers WHERE workspace_id=$1 AND id=$2`, workspaceID, customerID).
			Scan(&detail.ID, &detail.WorkspaceID, &detail.Name, &detail.Email, &detail.Phone, &detail.CreatedAt); db.IsNotFound(err) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("load customer: %w", err)
		}
		rows, err := tx.Query(ctx, `SELECT a.id,a.workspace_id,a.customer_id,a.service_id,a.staff_id,a.status,a.starts_at,a.ends_at,
			a.service_name,a.duration_minutes,a.buffer_before_minutes,a.buffer_after_minutes,a.price_minor,a.currency,a.service_address,
			a.customer_name,a.customer_email,a.customer_phone,a.notification_consent,a.time_zone,a.source,a.version,a.idempotency_key,a.created_at,coalesce(st.name,'Team member')
			FROM appointments a LEFT JOIN staff st ON st.workspace_id=a.workspace_id AND st.id=a.staff_id
			WHERE a.workspace_id=$1 AND a.customer_id=$2 ORDER BY a.starts_at DESC`, workspaceID, customerID)
		if err != nil {
			return fmt.Errorf("list customer appointments: %w", err)
		}
		detail.Appointments = make([]Appointment, 0)
		for rows.Next() {
			var a Appointment
			if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.CustomerID, &a.ServiceID, &a.StaffID, &a.Status, &a.StartsAt, &a.EndsAt, &a.ServiceName, &a.DurationMinutes, &a.BufferBeforeMinutes, &a.BufferAfterMinutes, &a.PriceMinor, &a.Currency, &a.ServiceAddress, &a.CustomerName, &a.CustomerEmail, &a.CustomerPhone, &a.NotificationConsent, &a.TimeZone, &a.Source, &a.Version, &a.IdempotencyKey, &a.CreatedAt, &a.StaffName); err != nil {
				rows.Close()
				return fmt.Errorf("scan customer appointment: %w", err)
			}
			detail.Appointments = append(detail.Appointments, a)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("iterate customer appointments: %w", err)
		}
		rows.Close()
		result = detail
		return nil
	})
	return result, err
}

func normalizeEmail(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
