package bookings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type DailyBookings struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type BookingActivity struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
}

type Overview struct {
	Today             string            `json:"today"`
	Customers         int               `json:"customers"`
	TodayCount        int               `json:"today_count"`
	Confirmed         int               `json:"confirmed"`
	Completed         int               `json:"completed"`
	Daily             []DailyBookings   `json:"daily"`
	TodayAppointments []Appointment     `json:"today_appointments"`
	Activity          []BookingActivity `json:"activity"`
}

// Overview computes metrics over the whole tenant, independent of list pages.
func (s *Service) Overview(ctx context.Context, userID, workspaceID uuid.UUID) (Overview, error) {
	result := Overview{Daily: []DailyBookings{}, Activity: []BookingActivity{}, TodayAppointments: []Appointment{}}
	err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := s.workspace(ctx, tx, OwnerScope(userID, workspaceID), false)
		if err != nil {
			return err
		}
		result.Today = s.now().In(mustLocation(w.TimeZone)).Format("2006-01-02")
		if err := tx.QueryRow(ctx, `SELECT
    (SELECT count(*) FROM customers WHERE workspace_id=$1),
    count(*) FILTER (WHERE status <> 'cancelled' AND (starts_at AT TIME ZONE $2)::date=$3::date),
    count(*) FILTER (WHERE status='confirmed'),count(*) FILTER (WHERE status='completed')
    FROM appointments WHERE workspace_id=$1`, workspaceID, w.TimeZone, result.Today).
			Scan(&result.Customers, &result.TodayCount, &result.Confirmed, &result.Completed); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT to_char(starts_at AT TIME ZONE $2,'YYYY-MM-DD'),count(*)
    FROM appointments WHERE workspace_id=$1 AND status <> 'cancelled'
    AND starts_at >= (($3::date - 29)::timestamp AT TIME ZONE $2) AND starts_at < (($3::date + 1)::timestamp AT TIME ZONE $2)
    GROUP BY 1 ORDER BY 1`, workspaceID, w.TimeZone, result.Today)
		if err != nil {
			return err
		}
		for rows.Next() {
			var day DailyBookings
			if err := rows.Scan(&day.Date, &day.Count); err != nil {
				rows.Close()
				return err
			}
			result.Daily = append(result.Daily, day)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT id,customer_name || ' · ' || service_name,created_at FROM appointments WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 4`, workspaceID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item BookingActivity
			if err := rows.Scan(&item.ID, &item.Title, &item.CreatedAt); err != nil {
				rows.Close()
				return err
			}
			result.Activity = append(result.Activity, item)
		}
		rows.Close()
		return rows.Err()
	})
	if err != nil {
		return result, fmt.Errorf("load business overview: %w", err)
	}
	page, err := s.AppointmentsPage(ctx, userID, workspaceID, ListOptions{Limit: 5, ExcludeCancelled: true, From: result.Today, To: result.Today})
	for _, a := range page.Items {
		if a.Status != "cancelled" {
			result.TodayAppointments = append(result.TodayAppointments, a)
		}
	}
	return result, err
}
