package bookings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (service *Service) availability(ctx context.Context, tx pgx.Tx, w *workspace, s *serviceRecord, date string, staffID, excludeID uuid.UUID) ([]Slot, error) {
	today := service.now().In(mustLocation(w.TimeZone)).Format("2006-01-02")
	maxDate, err := addDays(today, w.HorizonDays)
	if err != nil {
		return nil, err
	}
	if date < today || date > maxDate {
		return nil, fmt.Errorf("%w: choose a date within the booking window", ErrInvalid)
	}
	location, err := time.LoadLocation(w.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("load workspace time zone: %w", err)
	}
	workers := make([]worker, 0)
	rows, err := tx.Query(ctx, `SELECT st.id,st.name,st.schedule FROM staff st
		JOIN staff_services ss ON ss.workspace_id=st.workspace_id AND ss.staff_id=st.id
		WHERE st.workspace_id=$1 AND st.is_active=true AND ss.service_id=$2 AND ss.is_active=true
		AND ($3::uuid IS NULL OR st.id=$3) ORDER BY st.id`, w.ID, s.ID, optionalUUID(staffID))
	if err != nil {
		return nil, fmt.Errorf("list available staff: %w", err)
	}
	for rows.Next() {
		var person worker
		var rawSchedule []byte
		if err := rows.Scan(&person.ID, &person.Name, &rawSchedule); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan staff schedule: %w", err)
		}
		if err := jsonUnmarshalSchedule(rawSchedule, &person.Schedule); err != nil {
			rows.Close()
			return nil, fmt.Errorf("decode staff schedule: %w", err)
		}
		workers = append(workers, person)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate available staff: %w", err)
	}
	rows.Close()

	dayStart, err := localInstant(date, "00:00", location)
	if err != nil {
		return nil, fmt.Errorf("resolve booking day start: %w", err)
	}
	nextDate, err := addDays(date, 1)
	if err != nil {
		return nil, err
	}
	dayEnd, err := localInstant(nextDate, "00:00", location)
	if err != nil {
		return nil, fmt.Errorf("resolve booking day end: %w", err)
	}
	leave := make(map[uuid.UUID]bool)
	leaveRows, err := tx.Query(ctx, `SELECT staff_id FROM staff_time_off
		WHERE workspace_id=$1 AND from_date <= $2::date AND to_date >= $2::date`, w.ID, date)
	if err != nil {
		return nil, fmt.Errorf("list staff time off: %w", err)
	}
	for leaveRows.Next() {
		var id uuid.UUID
		if err := leaveRows.Scan(&id); err != nil {
			leaveRows.Close()
			return nil, fmt.Errorf("scan staff time off: %w", err)
		}
		leave[id] = true
	}
	if err := leaveRows.Err(); err != nil {
		leaveRows.Close()
		return nil, fmt.Errorf("iterate staff time off: %w", err)
	}
	leaveRows.Close()

	occupiedAppointments := make([]occupied, 0)
	bookingRows, err := tx.Query(ctx, `SELECT id,staff_id,starts_at,ends_at,buffer_before_minutes,buffer_after_minutes
		FROM appointments WHERE workspace_id=$1 AND status IN ('confirmed','completed')
		AND starts_at - buffer_before_minutes * interval '1 minute' < $3
		AND ends_at + buffer_after_minutes * interval '1 minute' > $2`, w.ID, dayStart, dayEnd)
	if err != nil {
		return nil, fmt.Errorf("list occupied appointment slots: %w", err)
	}
	for bookingRows.Next() {
		var item occupied
		if err := bookingRows.Scan(&item.ID, &item.StaffID, &item.StartsAt, &item.EndsAt, &item.BufferBeforeMinutes, &item.BufferAfterMinutes); err != nil {
			bookingRows.Close()
			return nil, fmt.Errorf("scan occupied appointment: %w", err)
		}
		occupiedAppointments = append(occupiedAppointments, item)
	}
	if err := bookingRows.Err(); err != nil {
		bookingRows.Close()
		return nil, fmt.Errorf("iterate occupied appointment slots: %w", err)
	}
	bookingRows.Close()

	weekday, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, fmt.Errorf("parse booking date: %w", err)
	}
	weekDay := int(weekday.Weekday())
	now := service.now()
	cutoff := now.Add(time.Duration(w.LeadHours) * time.Hour)
	result := make([]Slot, 0)
	for minute := 0; minute < 24*60; minute += w.SlotMinutes {
		clock := fmt.Sprintf("%02d:%02d", minute/60, minute%60)
		start, err := localInstant(date, clock, location)
		if err != nil || start.Before(cutoff) {
			continue
		}
		blockedFrom := start.Add(-time.Duration(s.BufferBeforeMinutes) * time.Minute)
		blockedTo := start.Add(time.Duration(s.DurationMinutes+s.BufferAfterMinutes) * time.Minute)
		for _, person := range workers {
			if leave[person.ID] || !includesDay(person.Schedule.Days, weekDay) {
				continue
			}
			opens, err := localInstant(date, person.Schedule.Start, location)
			if err != nil {
				continue
			}
			closes, err := localInstant(date, person.Schedule.End, location)
			if err != nil || blockedFrom.Before(opens) || blockedTo.After(closes) {
				continue
			}
			if person.Schedule.BreakStart != "" && person.Schedule.BreakEnd != "" {
				breakStart, errStart := localInstant(date, person.Schedule.BreakStart, location)
				breakEnd, errEnd := localInstant(date, person.Schedule.BreakEnd, location)
				if errStart != nil || errEnd != nil || (blockedFrom.Before(breakEnd) && blockedTo.After(breakStart)) {
					continue
				}
			}
			conflict := false
			for _, appointment := range occupiedAppointments {
				if appointment.ID == excludeID || appointment.StaffID != person.ID {
					continue
				}
				appointmentFrom := appointment.StartsAt.Add(-time.Duration(appointment.BufferBeforeMinutes) * time.Minute)
				appointmentTo := appointment.EndsAt.Add(time.Duration(appointment.BufferAfterMinutes) * time.Minute)
				if blockedFrom.Before(appointmentTo) && blockedTo.After(appointmentFrom) {
					conflict = true
					break
				}
			}
			if !conflict {
				result = append(result, Slot{Time: clock, StaffID: person.ID, StartsAt: start.UTC()})
			}
		}
	}
	return result, nil
}

func localInstant(date, clock string, location *time.Location) (time.Time, error) {
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}, err
	}
	parsedClock, err := time.Parse("15:04", clock)
	if err != nil {
		return time.Time{}, err
	}
	// Temporal's disambiguation="reject" rejects both repeated and skipped local
	// clock times. Search the offsets around the date and accept exactly one UTC
	// instant that round-trips to the requested wall clock.
	naive := time.Date(parsedDate.Year(), parsedDate.Month(), parsedDate.Day(), parsedClock.Hour(), parsedClock.Minute(), 0, 0, time.UTC)
	offsets := make(map[int]struct{})
	for hour := -36; hour <= 36; hour++ {
		_, offset := naive.Add(time.Duration(hour) * time.Hour).In(location).Zone()
		offsets[offset] = struct{}{}
	}
	var match time.Time
	matches := 0
	for offset := range offsets {
		candidate := naive.Add(-time.Duration(offset) * time.Second)
		local := candidate.In(location)
		if local.Year() == parsedDate.Year() && local.Month() == parsedDate.Month() && local.Day() == parsedDate.Day() && local.Hour() == parsedClock.Hour() && local.Minute() == parsedClock.Minute() {
			match = candidate
			matches++
		}
	}
	if matches != 1 {
		return time.Time{}, fmt.Errorf("local time is missing or ambiguous in %s", location.String())
	}
	return match, nil
}

func includesDay(days []int, want int) bool {
	for _, day := range days {
		if day == want {
			return true
		}
	}
	return false
}

func optionalUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
