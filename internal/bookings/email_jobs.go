package bookings

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

const (
	EmailQueue        = jobs.QueueEmail
	bookingEmailKind  = jobs.KindBookingEmail
	reminderLeadTime  = 24 * time.Hour
	reminderBatchSize = 100
)

// BookingEmailArgs remains an area-level alias while the durable River payload lives
// in the shared jobs package, matching OpenDesk's job-argument ownership.
type BookingEmailArgs = jobs.BookingEmailArgs

type reminderSweepArgs = jobs.BookingReminderSweepArgs

type bookingEmailWorker struct {
	river.WorkerDefaults[BookingEmailArgs]
	service    *Service
	serviceFor func() *Service
	mailer     mailer.Sender
}

func (w *bookingEmailWorker) Work(ctx context.Context, job *river.Job[BookingEmailArgs]) error {
	service := w.service
	if w.serviceFor != nil {
		service = w.serviceFor()
	}
	if service == nil {
		return errors.New("booking service is not configured")
	}
	args := job.Args
	if args.EventType == "reminder" {
		eligible, err := service.reminderStillEligible(ctx, args)
		if err != nil {
			return err
		}
		if !eligible {
			return nil
		}
	}
	if w.mailer == nil {
		return errors.New("transactional email sender is not configured")
	}
	if err := w.mailer.Send(ctx, mailer.Message{To: args.To, Subject: args.Subject, Text: args.Text}); err != nil {
		return fmt.Errorf("send booking email %s: %w", args.EventKey, err)
	}
	if args.EventType == "reminder" {
		if _, err := service.DB.Pool.Exec(ctx, `UPDATE appointments
			SET reminder_sent_version = $1
			WHERE workspace_id = $2 AND id = $3 AND version = $1
			  AND reminder_queued_version = $1 AND reminder_generation = $4`,
			args.AppointmentVersion, args.WorkspaceID, args.AppointmentID, args.ReminderGeneration); err != nil {
			return fmt.Errorf("record delivered appointment reminder: %w", err)
		}
	}
	return nil
}

type reminderSweepWorker struct {
	river.WorkerDefaults[reminderSweepArgs]
	service    *Service
	serviceFor func() *Service
}

func (w *reminderSweepWorker) Work(ctx context.Context, _ *river.Job[reminderSweepArgs]) error {
	service := w.service
	if w.serviceFor != nil {
		service = w.serviceFor()
	}
	if service == nil {
		return errors.New("booking service is not configured")
	}
	_, err := service.EnqueueDueReminders(ctx)
	return err
}

func registerWorkers(workers *river.Workers, serviceFor func() *Service, sender mailer.Sender) {
	river.AddWorker(workers, &bookingEmailWorker{serviceFor: serviceFor, mailer: sender})
	river.AddWorker(workers, &reminderSweepWorker{serviceFor: serviceFor})
}

// RegisterWorkersForService installs workers bound to a test or standalone service.
func RegisterWorkersForService(workers *river.Workers, service *Service, sender mailer.Sender) {
	registerWorkers(workers, func() *Service { return service }, sender)
}

// PeriodicJobs asks River to scan for due reminders once a minute.
func PeriodicJobs() []*river.PeriodicJob {
	return []*river.PeriodicJob{
		river.NewPeriodicJob(river.PeriodicInterval(time.Minute), func() (river.JobArgs, *river.InsertOpts) {
			return reminderSweepArgs{}, &river.InsertOpts{
				Queue:       EmailQueue,
				MaxAttempts: 1,
				UniqueOpts:  river.UniqueOpts{ByArgs: true, ByPeriod: time.Minute},
			}
		}, &river.PeriodicJobOpts{RunOnStart: true}),
	}
}

func (service *Service) enqueueEmail(ctx context.Context, tx pgx.Tx, args BookingEmailArgs) error {
	if service.Jobs == nil {
		return errors.New("booking email job client is not configured")
	}
	opts := args.InsertOpts()
	if service.EmailQueue != "" {
		opts.Queue = service.EmailQueue
	}
	if _, err := service.Jobs.InsertTx(ctx, tx, args, &opts); err != nil {
		return fmt.Errorf("enqueue booking email: %w", err)
	}
	return nil
}

type reminderCandidate struct {
	WorkspaceID   uuid.UUID
	AppointmentID uuid.UUID
}

// EnqueueDueReminders claims due reminders and their River jobs in one transaction.
// Version and generation checks let a worker safely discard reminders made stale by edits.
func (service *Service) EnqueueDueReminders(ctx context.Context) (int, error) {
	now := service.now()
	rows, err := service.DB.Pool.Query(ctx, `SELECT a.workspace_id, a.id
		FROM appointments a
		JOIN workspaces w ON w.id = a.workspace_id
		WHERE w.reminders_enabled = true
		  AND a.notification_consent = true
		  AND a.status = 'confirmed'
		  AND a.starts_at > $1 AND a.starts_at <= $2
		  AND a.created_at <= a.starts_at - interval '24 hours'
		  AND a.reminder_sent_version IS DISTINCT FROM a.version
		  AND a.reminder_queued_version IS DISTINCT FROM a.version
		ORDER BY a.starts_at, a.id LIMIT $3`, now, now.Add(reminderLeadTime), reminderBatchSize)
	if err != nil {
		return 0, fmt.Errorf("find due appointment reminders: %w", err)
	}
	candidates := make([]reminderCandidate, 0, reminderBatchSize)
	for rows.Next() {
		var candidate reminderCandidate
		if err := rows.Scan(&candidate.WorkspaceID, &candidate.AppointmentID); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan due appointment reminder: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("iterate due appointment reminders: %w", err)
	}
	rows.Close()

	queued := 0
	for _, candidate := range candidates {
		wasQueued := false
		if err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
			w := &workspace{}
			err := tx.QueryRow(ctx, `SELECT id,name,slug,time_zone,currency,contact_email,phone,cancel_hours,reminders_enabled
				FROM workspaces WHERE id=$1 FOR UPDATE`, candidate.WorkspaceID).Scan(
				&w.ID, &w.Name, &w.Slug, &w.TimeZone, &w.Currency, &w.ContactEmail, &w.Phone, &w.CancelHours, &w.RemindersEnabled)
			if err != nil {
				if db.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("lock workspace for reminder: %w", err)
			}
			var appointment struct {
				ID                    uuid.UUID
				Version               int
				ReminderQueuedVersion int
				ReminderSentVersion   int
				ReminderGeneration    int
				StartsAt              time.Time
				CreatedAt             time.Time
				ServiceName           string
				CustomerEmail         string
				NotificationConsent   bool
				Status                string
				ServiceAddress        pgtype.Text
				PriceMinor            int64
			}
			err = tx.QueryRow(ctx, `SELECT id,version,COALESCE(reminder_queued_version,-1),COALESCE(reminder_sent_version,-1),reminder_generation,
				starts_at,created_at,service_name,customer_email,notification_consent,status,service_address,price_minor
				FROM appointments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, candidate.WorkspaceID, candidate.AppointmentID).Scan(
				&appointment.ID, &appointment.Version, &appointment.ReminderQueuedVersion, &appointment.ReminderSentVersion,
				&appointment.ReminderGeneration, &appointment.StartsAt, &appointment.CreatedAt, &appointment.ServiceName,
				&appointment.CustomerEmail, &appointment.NotificationConsent, &appointment.Status, &appointment.ServiceAddress,
				&appointment.PriceMinor)
			if err != nil {
				if db.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("lock appointment for reminder: %w", err)
			}
			if !reminderApplies(appointment.Status, appointment.NotificationConsent, appointment.CreatedAt,
				appointment.StartsAt, appointment.Version, appointment.ReminderQueuedVersion,
				appointment.ReminderSentVersion, w.RemindersEnabled, now) {
				return nil
			}
			generation := appointment.ReminderGeneration + 1
			_, err = tx.Exec(ctx, `UPDATE appointments SET reminder_queued_version=$1, reminder_generation=$2
				WHERE workspace_id=$3 AND id=$4`, appointment.Version, generation, candidate.WorkspaceID, candidate.AppointmentID)
			if err != nil {
				return fmt.Errorf("claim appointment reminder: %w", err)
			}
			when := appointment.StartsAt.In(mustLocation(w.TimeZone)).Format("Monday, 2 January 2006 at 15:04")
			body := fmt.Sprintf("Your upcoming appointment\n\n%s\n%s (%s)\n%s %s\nAppointment location: %s\n\nChanges and cancellations require %d hours’ notice. Use the private management link in your original confirmation email to manage this booking.\n\nContact: %s\nReference: %s",
				appointment.ServiceName, when, w.TimeZone, w.Currency, formatMinor(int(appointment.PriceMinor)), appointment.ServiceAddress.String,
				w.CancelHours, firstNonempty(value(w.ContactEmail), w.Phone), appointment.ID)
			args := BookingEmailArgs{
				EventKey:    fmt.Sprintf("%s:reminder:%d:%d", appointment.ID, appointment.Version, generation),
				WorkspaceID: candidate.WorkspaceID, AppointmentID: appointment.ID,
				AppointmentVersion: appointment.Version, ReminderGeneration: generation,
				EventType: "reminder", To: appointment.CustomerEmail,
				Subject: "Appointment reminder · " + w.Name, Text: body,
			}
			if err := service.enqueueEmail(ctx, tx, args); err != nil {
				return err
			}
			wasQueued = true
			return nil
		}); err != nil {
			return queued, err
		}
		if wasQueued {
			queued++
		}
	}
	return queued, nil
}

func reminderApplies(status string, consent bool, createdAt, startsAt time.Time, version int,
	queuedVersion, sentVersion int, enabled bool, now time.Time) bool {
	if status != "confirmed" || !consent || !enabled || !startsAt.After(now) || startsAt.After(now.Add(reminderLeadTime)) ||
		createdAt.After(startsAt.Add(-reminderLeadTime)) {
		return false
	}
	return queuedVersion != version && sentVersion != version
}

func (service *Service) reminderStillEligible(ctx context.Context, args BookingEmailArgs) (bool, error) {
	var status string
	var consent, enabled bool
	var version, queuedVersion, generation int
	err := service.DB.Pool.QueryRow(ctx, `SELECT a.status,a.notification_consent,w.reminders_enabled,a.version,
		COALESCE(a.reminder_queued_version,-1),a.reminder_generation
		FROM appointments a JOIN workspaces w ON w.id=a.workspace_id
		WHERE a.workspace_id=$1 AND a.id=$2`, args.WorkspaceID, args.AppointmentID).Scan(
		&status, &consent, &enabled, &version, &queuedVersion, &generation)
	if err != nil {
		if db.IsNotFound(err) {
			return false, nil
		}
		return false, fmt.Errorf("validate appointment reminder before sending: %w", err)
	}
	if status == "confirmed" && consent && enabled && version == args.AppointmentVersion &&
		queuedVersion == args.AppointmentVersion && generation == args.ReminderGeneration {
		return true, nil
	}
	if queuedVersion == args.AppointmentVersion && generation == args.ReminderGeneration && !enabled {
		if _, err := service.DB.Pool.Exec(ctx, `UPDATE appointments SET reminder_queued_version=NULL
			WHERE workspace_id=$1 AND id=$2 AND version=$3 AND reminder_generation=$4 AND reminder_sent_version IS DISTINCT FROM $3`,
			args.WorkspaceID, args.AppointmentID, args.AppointmentVersion, args.ReminderGeneration); err != nil {
			return false, fmt.Errorf("release disabled appointment reminder: %w", err)
		}
	}
	return false, nil
}
