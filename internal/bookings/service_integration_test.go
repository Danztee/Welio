package bookings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
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
)

func TestPublicAndOwnerBookingFlows(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, fixture.userID)
	})

	service := NewService(database, "https://welio.example")
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(nil), &river.Config{})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	service.Jobs = jobs
	service.Now = func() time.Time { return time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC) }
	catalog, err := service.Catalog(ctx, fixture.slug)
	if err != nil {
		t.Fatalf("Catalog() error = %v", err)
	}
	if len(catalog.Services) != 1 || len(catalog.Staff) != 1 {
		t.Fatalf("Catalog() returned %d services and %d staff, want one each", len(catalog.Services), len(catalog.Staff))
	}
	serviceID := catalog.Services[0].ID
	staffID := catalog.Staff[0].ID
	slots, err := service.Availability(ctx, PublicScope(fixture.slug), SlotInput{ServiceID: serviceID, Date: "2026-10-20"})
	if err != nil {
		t.Fatalf("Availability() error = %v", err)
	}
	if !containsSlot(slots, "09:00", staffID) {
		t.Fatalf("availability did not include 09:00 slot: %+v", slots)
	}

	input := BookingInput{Key: uuid.New(), ServiceID: serviceID, StaffID: staffID, Date: "2026-10-20", Time: "09:00",
		ServiceLocation: "customer_address", Quote: catalog.Services[0].Quote, Name: "Jane Customer", Email: "JANE@example.com",
		Phone: "+2348012345678", Address: "12 Main Street, Lagos", Consent: true}
	createdID, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: input, Channel: ChannelForm})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	duplicateID, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: input, Channel: ChannelForm})
	if err != nil || duplicateID != createdID {
		t.Fatalf("idempotent Create() = %s, %v; want %s, nil", duplicateID, err, createdID)
	}
	changedPayload := input
	changedPayload.Name = "Another Customer"
	if _, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: changedPayload, Channel: ChannelForm}); !errors.Is(err, ErrConflict) {
		t.Fatalf("reused key with different booking details error = %v, want ErrConflict", err)
	}
	withoutConsent := input
	withoutConsent.Key = uuid.New()
	withoutConsent.Consent = false
	if _, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: withoutConsent, Channel: ChannelForm}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("booking without explicit notification consent error = %v, want ErrInvalid", err)
	}
	conflicting := input
	conflicting.Key = uuid.New()
	if _, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: conflicting, Channel: ChannelForm}); err == nil {
		t.Fatal("Create() accepted a conflicting appointment")
	} else if !errorsIs(err, ErrConflict) {
		t.Fatalf("conflicting Create() error = %v, want ErrConflict", err)
	}

	appointments, err := service.AppointmentsPage(ctx, fixture.userID, fixture.workspaceID, ListOptions{})
	if err != nil || len(appointments.Items) != 1 || appointments.Items[0].ID != createdID {
		t.Fatalf("ListAppointments() = %+v, %v; want created appointment", appointments, err)
	}
	customers, err := service.CustomersPage(ctx, fixture.userID, fixture.workspaceID, ListOptions{})
	if err != nil || len(customers.Items) != 1 || customers.Items[0].Email == nil || *customers.Items[0].Email != "jane@example.com" {
		t.Fatalf("ListCustomers() = %+v, %v; want one customer", customers, err)
	}
	detail, err := service.Customer(ctx, fixture.userID, fixture.workspaceID, customers.Items[0].ID, ListOptions{})
	if err != nil || len(detail.Appointments) != 1 || detail.Appointments[0].ID != createdID {
		t.Fatalf("Customer() = %+v, %v; want appointment history", detail, err)
	}

	var queuedArgs []byte
	if err := database.Pool.QueryRow(ctx, `SELECT args FROM river_job WHERE kind=$1 AND args->>'event_key'=$2`, jobargs.KindBookingEmail, createdID.String()+":confirmed:0").Scan(&queuedArgs); err != nil {
		t.Fatalf("read confirmation job: %v", err)
	}
	var confirmation jobargs.BookingEmailArgs
	if err := json.Unmarshal(queuedArgs, &confirmation); err != nil {
		t.Fatalf("decode confirmation job: %v", err)
	}
	tokenPattern := regexp.MustCompile(`/booking/` + regexp.QuoteMeta(createdID.String()) + `#([A-Za-z0-9_-]{43})`)
	match := tokenPattern.FindStringSubmatch(confirmation.Text)
	if len(match) != 2 {
		t.Fatalf("confirmation job did not contain private management token: %q", confirmation.Text)
	}
	token := match[1]
	if _, err := service.Booking(ctx, createdID, Actor{Token: "invalid"}, uuid.Nil); !errorsIs(err, ErrNotFound) {
		t.Fatalf("invalid management token error = %v, want ErrNotFound", err)
	}
	publicView, err := service.Booking(ctx, createdID, Actor{Token: token}, uuid.Nil)
	if err != nil || publicView.Email != "jane@example.com" {
		t.Fatalf("Booking() with valid token = %+v, %v", publicView, err)
	}

	changed := ChangeInput{Key: uuid.New(), Version: publicView.Version, Action: "reschedule", Date: "2026-10-20", Time: "10:00", StaffID: staffID}
	changedID, err := service.Change(ctx, createdID, Actor{Token: token}, uuid.Nil, changed)
	if err != nil || changedID != createdID {
		t.Fatalf("Change(reschedule) = %s, %v", changedID, err)
	}
	if _, err := service.Change(ctx, createdID, Actor{Token: token}, uuid.Nil, changed); err != nil {
		t.Fatalf("idempotent Change() error = %v", err)
	}
	updated, err := service.Booking(ctx, createdID, Actor{UserID: fixture.userID}, fixture.workspaceID)
	if err != nil || updated.Version != publicView.Version+1 || updated.StartsAt.Hour() != 9 {
		t.Fatalf("updated Booking() = %+v, %v; expected rescheduled Lagos 10:00", updated, err)
	}

	outsiderID := uuid.New()
	if _, err := database.Pool.Exec(ctx, `INSERT INTO users(id,name,email,email_verified,password_hash) VALUES($1,$2,$3,true,'test-password-hash')`, outsiderID, "Other Owner", "other-"+uuid.NewString()+"@example.com"); err != nil {
		t.Fatalf("insert outsider: %v", err)
	}
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, outsiderID) })
	if _, err := service.AppointmentsPage(ctx, outsiderID, fixture.workspaceID, ListOptions{}); !errorsIs(err, ErrNotFound) {
		t.Fatalf("cross-workspace appointment access error = %v, want ErrNotFound", err)
	}
	staffUserID := uuid.New()
	if _, err := database.Pool.Exec(ctx, `INSERT INTO users(id,name,email,email_verified,password_hash) VALUES($1,$2,$3,true,'test-password-hash')`, staffUserID, "Staff User", "staff-"+uuid.NewString()+"@example.com"); err != nil {
		t.Fatalf("insert staff user: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'staff')`, fixture.workspaceID, staffUserID); err != nil {
		t.Fatalf("insert staff membership: %v", err)
	}
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, staffUserID) })
	if _, err := service.AppointmentsPage(ctx, staffUserID, fixture.workspaceID, ListOptions{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("staff appointment access error = %v, want ErrForbidden", err)
	}

	concurrent := make([]BookingInput, 2)
	for i := range concurrent {
		concurrent[i] = input
		concurrent[i].Key = uuid.New()
		concurrent[i].Date = "2026-10-21"
		concurrent[i].Time = "09:00"
		concurrent[i].Email = fmt.Sprintf("concurrent-%d-%s@example.com", i, uuid.NewString())
	}
	var wait sync.WaitGroup
	results := make(chan error, len(concurrent))
	for _, candidate := range concurrent {
		wait.Add(1)
		go func(candidate BookingInput) {
			defer wait.Done()
			_, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Booking: candidate, Channel: ChannelForm})
			results <- err
		}(candidate)
	}
	wait.Wait()
	close(results)
	succeeded, conflicted := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else if errors.Is(err, ErrConflict) {
			conflicted++
		} else {
			t.Fatalf("concurrent booking error = %v, want one success and one conflict", err)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent slot requests: successes=%d conflicts=%d, want 1 each", succeeded, conflicted)
	}
}

type bookingFixture struct {
	workspaceID uuid.UUID
	userID      uuid.UUID
	serviceID   uuid.UUID
	staffID     uuid.UUID
	slug        string
}

func seedBookingFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) bookingFixture {
	fixture := bookingFixture{workspaceID: uuid.New(), userID: uuid.New(), serviceID: uuid.New(), staffID: uuid.New(), slug: "test-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]}
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,email_verified,password_hash) VALUES($1,$2,$3,true,'test-password-hash')`, fixture.userID, "Owner User", "owner-"+uuid.NewString()+"@example.com"); err != nil {
		t.Fatalf("insert owner: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces(id,name,slug,is_published,booking_location,business_address,phone)
		VALUES($1,'Test Business',$2,true,'both','20 Business Road, Lagos','+2348000000000')`, fixture.workspaceID, fixture.slug); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, fixture.workspaceID, fixture.userID); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO services(id,workspace_id,name,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,is_active)
		VALUES($1,$2,'Standard cleaning','A test service',60,0,0,1500000,true)`, fixture.serviceID, fixture.workspaceID); err != nil {
		t.Fatalf("insert service: %v", err)
	}
	schedule := `{"start":"08:00","end":"18:00","breakStart":"12:00","breakEnd":"13:00","days":[1,2,3,4,5,6,0]}`
	if _, err := pool.Exec(ctx, `INSERT INTO staff(id,workspace_id,name,schedule,is_active) VALUES($1,$2,'Taylor Staff',$3::jsonb,true)`, fixture.staffID, fixture.workspaceID, schedule); err != nil {
		t.Fatalf("insert staff: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO staff_services(workspace_id,staff_id,service_id,is_active) VALUES($1,$2,$3,true)`, fixture.workspaceID, fixture.staffID, fixture.serviceID); err != nil {
		t.Fatalf("assign service: %v", err)
	}
	return fixture
}

func containsSlot(slots []Slot, clock string, staffID uuid.UUID) bool {
	for _, slot := range slots {
		if slot.Time == clock && slot.StaffID == staffID {
			return true
		}
	}
	return false
}

func errorsIs(err, target error) bool { return errors.Is(err, target) }
