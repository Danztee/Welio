package bookings

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/dbtest"
)

func TestBookingPoliciesPublicationAndTimeOff(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})

	service := NewService(database, "https://welio.example")
	service.Jobs = newBookingTestJobs(t, database, service, "policy_test")
	service.Now = func() time.Time { return time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC) }
	policy, err := service.GetPolicy(ctx, fixture.userID, fixture.workspaceID)
	if err != nil || *policy != (BookingPolicy{LeadHours: 1, HorizonDays: 60, CancelHours: 24, SlotMinutes: 30}) {
		t.Fatalf("GetPolicy() = %+v, %v; want workspace policy defaults", policy, err)
	}
	wantPolicy := BookingPolicy{LeadHours: 2, HorizonDays: 45, CancelHours: 12, SlotMinutes: 15}
	if err := service.SavePolicy(ctx, fixture.userID, fixture.workspaceID, wantPolicy); err != nil {
		t.Fatalf("SavePolicy() error = %v", err)
	}
	policy, err = service.GetPolicy(ctx, fixture.userID, fixture.workspaceID)
	if err != nil || *policy != wantPolicy {
		t.Fatalf("GetPolicy() after save = %+v, %v; want %+v", policy, err, wantPolicy)
	}
	if err := service.SavePolicy(ctx, fixture.userID, fixture.workspaceID, BookingPolicy{LeadHours: 1, HorizonDays: 0, CancelHours: 24, SlotMinutes: 30}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("SavePolicy() with invalid horizon error = %v, want ErrInvalid", err)
	}

	if err := service.SetPublished(ctx, fixture.userID, fixture.workspaceID, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("SetPublished() without contact email error = %v, want ErrInvalid", err)
	}
	if _, err := database.Pool.Exec(ctx, `UPDATE workspaces SET contact_email='contact@example.test',service_area='Lagos' WHERE id=$1`, fixture.workspaceID); err != nil {
		t.Fatalf("complete publish settings: %v", err)
	}
	if err := service.SetPublished(ctx, fixture.userID, fixture.workspaceID, true); err != nil {
		t.Fatalf("SetPublished(true) with valid catalog error = %v", err)
	}
	var published bool
	if err := database.Pool.QueryRow(ctx, `SELECT is_published FROM workspaces WHERE id=$1`, fixture.workspaceID).Scan(&published); err != nil || !published {
		t.Fatalf("published state = %v, %v; want true", published, err)
	}
	if err := service.SetPublished(ctx, fixture.userID, fixture.workspaceID, false); err != nil {
		t.Fatalf("SetPublished(false) error = %v", err)
	}
	if err := database.Pool.QueryRow(ctx, `SELECT is_published FROM workspaces WHERE id=$1`, fixture.workspaceID).Scan(&published); err != nil || published {
		t.Fatalf("published state after unpublish = %v, %v; want false", published, err)
	}
	if err := service.SetPublished(ctx, fixture.userID, fixture.workspaceID, true); err != nil {
		t.Fatalf("republish booking page for public booking test: %v", err)
	}

	if err := service.SaveReminderPolicy(ctx, fixture.userID, fixture.workspaceID, true); err != nil {
		t.Fatalf("SaveReminderPolicy(true) error = %v", err)
	}
	reminderPolicy, err := service.GetReminderPolicy(ctx, fixture.userID, fixture.workspaceID)
	if err != nil || !reminderPolicy.Enabled {
		t.Fatalf("GetReminderPolicy() = %+v, %v; want enabled", reminderPolicy, err)
	}

	outsiderID := createBookingTestUser(t, ctx, database.Pool, "Outsider User", "time-off-outsider")
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, outsiderID) })
	if err := service.SavePolicy(ctx, outsiderID, fixture.workspaceID, wantPolicy); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace SavePolicy() error = %v, want ErrNotFound", err)
	}
	if _, err := service.ListTimeOff(ctx, outsiderID, fixture.workspaceID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace ListTimeOff() error = %v, want ErrNotFound", err)
	}
	staffUserID := createBookingTestUser(t, ctx, database.Pool, "Staff User", "booking-policy-staff")
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, staffUserID) })
	if _, err := database.Pool.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'staff')`, fixture.workspaceID, staffUserID); err != nil {
		t.Fatalf("add staff membership: %v", err)
	}
	if err := service.SavePolicy(ctx, staffUserID, fixture.workspaceID, wantPolicy); !errors.Is(err, ErrForbidden) {
		t.Fatalf("staff SavePolicy() error = %v, want ErrForbidden", err)
	}
	if _, err := service.ListTimeOff(ctx, staffUserID, fixture.workspaceID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("staff ListTimeOff() error = %v, want ErrForbidden", err)
	}

	first, err := service.CreateTimeOff(ctx, fixture.userID, fixture.workspaceID, TimeOffInput{
		StaffID: fixture.staffID, From: "2026-10-22", To: "2026-10-23", Reason: "Annual leave",
	})
	if err != nil || first == uuid.Nil {
		t.Fatalf("CreateTimeOff() = %s, %v; want a created time-off range", first, err)
	}
	items, err := service.ListTimeOff(ctx, fixture.userID, fixture.workspaceID)
	if err != nil || len(items) != 1 || items[0].ID != first || items[0].StaffName != "Taylor Staff" || items[0].From != "2026-10-22" || items[0].To != "2026-10-23" {
		t.Fatalf("ListTimeOff() = %+v, %v; want created range", items, err)
	}
	if _, err := service.CreateTimeOff(ctx, fixture.userID, fixture.workspaceID, TimeOffInput{
		StaffID: fixture.staffID, From: "2026-10-24", To: "2026-10-23", Reason: "Invalid range",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("CreateTimeOff() with reversed range error = %v, want ErrInvalid", err)
	}

	catalog, err := service.Catalog(ctx, fixture.slug)
	if err != nil {
		t.Fatalf("Catalog() error = %v", err)
	}
	booking := BookingInput{Key: uuid.New(), ServiceID: fixture.serviceID, StaffID: fixture.staffID,
		Date: "2026-10-26", Time: "09:00", ServiceLocation: "customer_address", Quote: catalog.Services[0].Quote,
		Name: "Time Off Conflict", Email: "time-off-conflict@example.test", Address: "12 Main Street, Lagos", Consent: true}
	if _, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: booking, Channel: ChannelForm}); err != nil {
		t.Fatalf("Create() for time-off conflict fixture: %v", err)
	}
	if _, err := service.CreateTimeOff(ctx, fixture.userID, fixture.workspaceID, TimeOffInput{
		StaffID: fixture.staffID, From: "2026-10-26", To: "2026-10-26", Reason: "Away",
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("CreateTimeOff() overlapping confirmed appointment error = %v, want ErrConflict", err)
	}

	if err := service.DeleteTimeOff(ctx, outsiderID, fixture.workspaceID, first); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace DeleteTimeOff() error = %v, want ErrNotFound", err)
	}
	if err := service.DeleteTimeOff(ctx, fixture.userID, fixture.workspaceID, first); err != nil {
		t.Fatalf("DeleteTimeOff() error = %v", err)
	}
	items, err = service.ListTimeOff(ctx, fixture.userID, fixture.workspaceID)
	if err != nil || len(items) != 0 {
		t.Fatalf("ListTimeOff() after delete = %+v, %v; want empty", items, err)
	}
}

func TestRetryNotificationRequiresOwnedDiscardedBookingJob(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})

	service := NewService(database, "https://welio.example")
	service.EmailQueue = "notification_retry_test"
	workers := river.NewWorkers()
	RegisterWorkersForService(workers, service, nil)
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), &river.Config{
		Workers: workers,
		Queues:  map[string]river.QueueConfig{service.EmailQueue: {MaxWorkers: 1}},
	})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	service.Jobs = jobs

	args := BookingEmailArgs{EventKey: "failed-email-" + uuid.NewString(), WorkspaceID: fixture.workspaceID,
		AppointmentID: uuid.New(), AppointmentVersion: 0, EventType: "confirmed", To: "customer@example.test",
		Subject: "Booking confirmed", Text: "Your appointment is confirmed"}
	var jobID int64
	if err := database.Tx(ctx, func(tx pgx.Tx) error {
		result, err := jobs.InsertTx(ctx, tx, args, &river.InsertOpts{Queue: service.EmailQueue, MaxAttempts: 1})
		if err != nil {
			return err
		}
		jobID = result.Job.ID
		_, err = tx.Exec(ctx, `UPDATE river_job SET state='discarded',attempt=1,finalized_at=now() WHERE id=$1`, jobID)
		return err
	}); err != nil {
		t.Fatalf("seed discarded River job: %v", err)
	}
	notifications, err := service.ListNotifications(ctx, fixture.userID, fixture.workspaceID)
	if err != nil {
		t.Fatalf("ListNotifications() error = %v", err)
	}
	var foundNotification bool
	for _, notification := range notifications {
		if notification.ID == strconv.FormatInt(jobID, 10) {
			foundNotification = notification.Status == "failed" && notification.Kind == "confirmed" && notification.Recipient == "customer@example.test"
		}
	}
	if !foundNotification {
		t.Fatalf("ListNotifications() = %+v; want failed booking notification %d", notifications, jobID)
	}

	if err := service.RetryNotification(ctx, fixture.userID, fixture.workspaceID, jobID); err != nil {
		t.Fatalf("RetryNotification() error = %v", err)
	}
	var state string
	var maxAttempts, attempt int
	if err := database.Pool.QueryRow(ctx, `SELECT state::text,max_attempts,attempt FROM river_job WHERE id=$1`, jobID).Scan(&state, &maxAttempts, &attempt); err != nil {
		t.Fatalf("read retried River job: %v", err)
	}
	if state != "available" || maxAttempts != 2 || attempt != 1 {
		t.Fatalf("retried River job state=%s max_attempts=%d attempt=%d; want available, 2, 1", state, maxAttempts, attempt)
	}
	if err := service.RetryNotification(ctx, fixture.userID, fixture.workspaceID, jobID); !errors.Is(err, ErrConflict) {
		t.Fatalf("RetryNotification() repeated while queued error = %v, want ErrConflict", err)
	}

	outsiderID := createBookingTestUser(t, ctx, database.Pool, "Notification Outsider", "notification-outsider")
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, outsiderID) })
	if err := database.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE river_job SET state='discarded',finalized_at=now() WHERE id=$1`, jobID)
		return err
	}); err != nil {
		t.Fatalf("re-discard job for auth test: %v", err)
	}
	if err := service.RetryNotification(ctx, outsiderID, fixture.workspaceID, jobID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace RetryNotification() error = %v, want ErrNotFound", err)
	}
	if err := service.RetryNotification(ctx, fixture.userID, fixture.workspaceID, jobID+1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("RetryNotification() for unknown job error = %v, want ErrNotFound", err)
	}
}

func TestTimeOffServiceRejectsInvalidReason(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})
	service := NewService(database, "https://welio.example")
	if _, err := service.CreateTimeOff(ctx, fixture.userID, fixture.workspaceID, TimeOffInput{
		StaffID: fixture.staffID, From: "2026-10-22", To: "2026-10-22", Reason: strings.Repeat("a", 201),
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("CreateTimeOff() with a long reason error = %v, want ErrInvalid", err)
	}
}

func createBookingTestUser(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, name, prefix string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := prefix + "-" + uuid.NewString() + "@example.test"
	if err := pool.QueryRow(ctx, `INSERT INTO users(name,email,email_verified,password_hash)
		VALUES($1,$2,true,'test-password-hash') RETURNING id`, name, email).Scan(&id); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	return id
}

func newBookingTestJobs(t *testing.T, database *db.DB, service *Service, queue string) *river.Client[pgx.Tx] {
	t.Helper()
	service.EmailQueue = queue
	workers := river.NewWorkers()
	RegisterWorkersForService(workers, service, nil)
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), &river.Config{
		Workers: workers,
		Queues:  map[string]river.QueueConfig{queue: {MaxWorkers: 1}},
	})
	if err != nil {
		t.Fatalf("create test River client: %v", err)
	}
	return jobs
}
