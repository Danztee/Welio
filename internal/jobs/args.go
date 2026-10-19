// Package jobs defines durable River job arguments and queue names shared by areas.
package jobs

import (
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

const (
	QueueEmail       = "email"
	QueueMaintenance = "maintenance"
	KindSystemEmail  = "mail.system"
	KindBookingEmail = "bookings.email"
)

// SystemEmailArgs sends verification, recovery, invitation, and other platform mail.
type SystemEmailArgs struct {
	To               string     `json:"to"`
	Subject          string     `json:"subject"`
	Text             string     `json:"text"`
	AuthTokenHash    string     `json:"auth_token_hash,omitempty"`
	AuthTokenPurpose string     `json:"auth_token_purpose,omitempty"`
	InvitationID     *uuid.UUID `json:"invitation_id,omitempty"`
}

func (SystemEmailArgs) Kind() string { return KindSystemEmail }

func (SystemEmailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueEmail, MaxAttempts: 8}
}

// BookingEmailArgs is persisted with a booking change and uniquely identifies each
// confirmation, cancellation, reschedule, or reminder delivery.
type BookingEmailArgs struct {
	EventKey           string    `json:"event_key" river:"unique"`
	WorkspaceID        uuid.UUID `json:"workspace_id"`
	AppointmentID      uuid.UUID `json:"appointment_id"`
	AppointmentVersion int       `json:"appointment_version"`
	ReminderGeneration int       `json:"reminder_generation,omitempty"`
	EventType          string    `json:"event_type"`
	To                 string    `json:"to"`
	Subject            string    `json:"subject"`
	Text               string    `json:"text"`
}

func (BookingEmailArgs) Kind() string { return KindBookingEmail }

func (BookingEmailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueEmail,
		MaxAttempts: 8,
		UniqueOpts:  river.UniqueOpts{ByArgs: true, ByState: rivertype.UniqueOptsByStateDefault()},
	}
}

// BookingReminderSweepArgs asks the booking area to enqueue reminders that are due.
type BookingReminderSweepArgs struct{}

func (BookingReminderSweepArgs) Kind() string { return "bookings.reminder_sweep" }

// ReceptionistRetentionSweepArgs asks the receptionist area to purge expired state.
type ReceptionistRetentionSweepArgs struct{}

func (ReceptionistRetentionSweepArgs) Kind() string { return "receptionist.retention_sweep" }

func (ReceptionistRetentionSweepArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueMaintenance,
		MaxAttempts: 3,
		UniqueOpts:  river.UniqueOpts{ByArgs: true, ByPeriod: 15 * time.Minute},
	}
}
