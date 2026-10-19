package bookings

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/dbtest"
	jobargs "github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

type recordingEmailSender struct {
	mu       sync.Mutex
	messages []mailer.Message
}

func (s *recordingEmailSender) Send(_ context.Context, message mailer.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, message)
	return nil
}

func (s *recordingEmailSender) messagesSnapshot() []mailer.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]mailer.Message(nil), s.messages...)
}

func TestBookingEmailJobsAndReminderLifecycle(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})

	testQueue := "email_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	service := NewService(database, "https://welio.example")
	service.EmailQueue = testQueue
	sender := &recordingEmailSender{}
	workers := river.NewWorkers()
	RegisterWorkersForService(workers, service, sender)
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), &river.Config{
		Workers:           workers,
		Queues:            map[string]river.QueueConfig{testQueue: {MaxWorkers: 1}},
		FetchPollInterval: 20 * time.Millisecond,
		FetchCooldown:     20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	service.Jobs = jobs
	if err := jobs.Start(ctx); err != nil {
		t.Fatalf("start River worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := jobs.Stop(stopCtx); err != nil {
			t.Errorf("stop River worker: %v", err)
		}
	})
	now := time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC)
	service.Now = func() time.Time { return now }
	if _, err := database.Pool.Exec(ctx, `UPDATE workspaces SET reminders_enabled=true WHERE id=$1`, fixture.workspaceID); err != nil {
		t.Fatalf("enable reminders: %v", err)
	}
	catalog, err := service.Catalog(ctx, fixture.slug)
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	input := BookingInput{Key: uuid.New(), ServiceID: fixture.serviceID, StaffID: fixture.staffID,
		Date: "2026-10-19", Time: "09:00", ServiceLocation: "customer_address",
		Quote: catalog.Services[0].Quote, Name: "Reminder Customer", Email: "reminder@example.test",
		Phone: "+2348000000000", Address: "12 Main Street, Lagos", Consent: true}
	appointmentID, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: input, Channel: ChannelForm})
	if err != nil {
		t.Fatalf("create appointment: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `UPDATE appointments SET created_at=$2 WHERE workspace_id=$1 AND id=$3`, fixture.workspaceID, now.Add(-48*time.Hour), appointmentID); err != nil {
		t.Fatalf("backdate appointment for reminder policy: %v", err)
	}

	confirmationArgs := readBookingEmailJob(t, ctx, database.Pool, appointmentID.String()+":confirmed:0")
	confirmationMessages := waitForEmailCount(t, sender, 1)
	if confirmationArgs.EventType != "confirmed" || confirmationMessages[0].To != input.Email || confirmationMessages[0].Subject == "" {
		t.Fatalf("confirmation delivery = %+v with args %+v, want one message to %q", confirmationMessages, confirmationArgs, input.Email)
	}

	queued, err := service.EnqueueDueReminders(ctx)
	if err != nil || queued != 1 {
		t.Fatalf("EnqueueDueReminders() = %d, %v; want one job", queued, err)
	}
	queued, err = service.EnqueueDueReminders(ctx)
	if err != nil || queued != 0 {
		t.Fatalf("second EnqueueDueReminders() = %d, %v; want no duplicate", queued, err)
	}
	reminderArgs := readBookingEmailJob(t, ctx, database.Pool, appointmentID.String()+":reminder:0:1")
	reminderMessages := waitForEmailCount(t, sender, 2)
	if reminderArgs.EventType != "reminder" || reminderMessages[1].To != input.Email {
		t.Fatalf("email deliveries = %+v with reminder args %+v, want confirmation and reminder", reminderMessages, reminderArgs)
	}
	if sentVersion := waitForReminderSentVersion(t, ctx, database.Pool, appointmentID); sentVersion != 0 {
		t.Fatalf("reminder sent version = %d; want current version 0", sentVersion)
	}
}

func waitForReminderSentVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, appointmentID uuid.UUID) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var version int
		err := pool.QueryRow(ctx, `SELECT COALESCE(reminder_sent_version,-1) FROM appointments WHERE id=$1`, appointmentID).Scan(&version)
		if err == nil && version >= 0 {
			return version
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("River did not record reminder delivery")
	return -1
}

func waitForEmailCount(t *testing.T, sender *recordingEmailSender, count int) []mailer.Message {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		messages := sender.messagesSnapshot()
		if len(messages) >= count {
			return messages
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("River delivered %d email messages, want at least %d", len(sender.messagesSnapshot()), count)
	return nil
}

func readBookingEmailJob(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventKey string) jobargs.BookingEmailArgs {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT args FROM river_job WHERE kind=$1 AND args->>'event_key'=$2`, jobargs.KindBookingEmail, eventKey).Scan(&raw); err != nil {
		t.Fatalf("read River booking email job %q: %v", eventKey, err)
	}
	var args jobargs.BookingEmailArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		t.Fatalf("decode River booking email job %q: %v", eventKey, err)
	}
	return args
}
