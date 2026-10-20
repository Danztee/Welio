package bookings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (service *Service) AppointmentCalendar(ctx context.Context, userID, workspaceID uuid.UUID, options AppointmentCalendarOptions) (AppointmentCalendar, error) {
	calendar := AppointmentCalendar{Appointments: []AppointmentCalendarItem{}}
	fromDate, err := time.Parse("2006-01-02", options.From)
	if err != nil || !validDate(options.From) || !validDate(options.To) || options.From > options.To ||
		len(options.Search) > 200 || !validAppointmentStatus(options.Status) {
		return calendar, fmt.Errorf("%w: invalid appointment calendar filters", ErrInvalid)
	}
	toDate, err := time.Parse("2006-01-02", options.To)
	if err != nil || toDate.Sub(fromDate) > 41*24*time.Hour {
		return calendar, fmt.Errorf("%w: appointment calendar range must be 42 days or less", ErrInvalid)
	}

	err = service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false)
		if err != nil {
			return err
		}
		location, err := time.LoadLocation(w.TimeZone)
		if err != nil {
			return fmt.Errorf("load workspace time zone: %w", err)
		}

		start := time.Date(fromDate.Year(), fromDate.Month(), fromDate.Day(), 0, 0, 0, 0, location)
		lastDate := toDate.AddDate(0, 0, 1)
		end := time.Date(lastDate.Year(), lastDate.Month(), lastDate.Day(), 0, 0, 0, 0, location)
		rows, err := tx.Query(ctx, `SELECT a.id,a.status,a.starts_at,a.ends_at,a.customer_name,a.service_name,COALESCE(st.name,'Team member')
			FROM appointments a LEFT JOIN staff st ON st.workspace_id=a.workspace_id AND st.id=a.staff_id
			WHERE a.workspace_id=$1 AND a.starts_at >= $2 AND a.starts_at < $3
			AND ($4='' OR strpos(lower(a.customer_name || ' ' || a.customer_email || ' ' || a.service_name),lower($4))>0)
			AND ($5='' OR a.status=$5)
			ORDER BY a.starts_at,a.id`, workspaceID, start, end, options.Search, options.Status)
		if err != nil {
			return fmt.Errorf("list appointment calendar events: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var appointment AppointmentCalendarItem
			if err := rows.Scan(&appointment.ID, &appointment.Status, &appointment.StartsAt, &appointment.EndsAt,
				&appointment.CustomerName, &appointment.ServiceName, &appointment.StaffName); err != nil {
				return fmt.Errorf("scan appointment calendar event: %w", err)
			}
			calendar.Appointments = append(calendar.Appointments, appointment)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate appointment calendar events: %w", err)
		}
		return nil
	})
	return calendar, err
}

func validAppointmentStatus(status string) bool {
	switch status {
	case "", "confirmed", "completed", "cancelled", "no_show":
		return true
	default:
		return false
	}
}
