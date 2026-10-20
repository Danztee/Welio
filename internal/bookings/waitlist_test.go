package bookings

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/dbtest"
	jobargs "github.com/danztee/welio/internal/jobs"
)

func TestWaitlistRequiresFullDateAndNotifiesFirstEligibleEntry(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()

	for _, tc := range []struct {
		name          string
		expireFirst   bool
		closeSchedule bool
		wantRecipient string
	}{
		{name: "oldest request first", wantRecipient: "first@example.com"},
		{name: "expired request skipped", expireFirst: true, wantRecipient: "second@example.com"},
		{name: "no bookable slot after cancellation", closeSchedule: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
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
			catalog, err := service.Catalog(ctx, fixture.slug)
			if err != nil {
				t.Fatalf("Catalog() error = %v", err)
			}
			date, err := addDays(catalog.Today, 2)
			if err != nil {
				t.Fatalf("choose test date: %v", err)
			}
			first := WaitlistInput{ServiceID: fixture.serviceID, RequestDate: date, Email: "FIRST@example.com", Name: "First Customer"}
			if _, _, err := service.JoinWaitlist(ctx, PublicScope(fixture.slug), first); !errors.Is(err, ErrConflict) {
				t.Fatalf("JoinWaitlist() with open slots error = %v, want ErrConflict", err)
			}
			if _, _, err := service.JoinWaitlist(ctx, PublicScope(fixture.slug), WaitlistInput{ServiceID: fixture.serviceID, RequestDate: date, Email: "invalid"}); !errors.Is(err, ErrInvalid) {
				t.Fatalf("JoinWaitlist() with invalid email error = %v, want ErrInvalid", err)
			}

			// One hour of opening time and a one-hour service leave a single slot.
			if _, err := database.Pool.Exec(ctx, `UPDATE staff SET schedule=$1::jsonb WHERE id=$2`,
				`{"start":"08:00","end":"09:00","breakStart":"","breakEnd":"","days":[0,1,2,3,4,5,6]}`, fixture.staffID); err != nil {
				t.Fatalf("limit staff schedule: %v", err)
			}
			bookingID, err := service.Create(ctx, CreateInput{Scope: PublicScope(fixture.slug), Channel: ChannelForm,
				Booking: BookingInput{Key: uuid.New(), ServiceID: fixture.serviceID, StaffID: fixture.staffID,
					Date: date, Time: "08:00", ServiceLocation: "customer_address", Quote: catalog.Services[0].Quote,
					Name: "Booked Customer", Email: "booked@example.com", Address: "12 Main Street, Lagos", Consent: true}})
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			entry, created, err := service.JoinWaitlist(ctx, PublicScope(fixture.slug), first)
			if err != nil || !created {
				t.Fatalf("JoinWaitlist() = %+v, %t, %v; want created entry", entry, created, err)
			}
			duplicate, created, err := service.JoinWaitlist(ctx, PublicScope(fixture.slug), first)
			if err != nil || created || duplicate.ID != entry.ID {
				t.Fatalf("duplicate JoinWaitlist() = %+v, %t, %v; want same entry", duplicate, created, err)
			}
			second := WaitlistInput{ServiceID: fixture.serviceID, StaffID: fixture.staffID,
				RequestDate: date, Email: "second@example.com"}
			secondEntry, created, err := service.JoinWaitlist(ctx, PublicScope(fixture.slug), second)
			if err != nil || !created {
				t.Fatalf("second JoinWaitlist() = %+v, %t, %v", secondEntry, created, err)
			}
			if tc.expireFirst {
				if _, err := database.Pool.Exec(ctx, `UPDATE waitlist_entries SET expires_at=$1 WHERE id=$2`,
					time.Now().Add(-time.Minute), entry.ID); err != nil {
					t.Fatalf("expire first entry: %v", err)
				}
			}
			if tc.closeSchedule {
				if _, err := database.Pool.Exec(ctx, `UPDATE staff SET is_active=false WHERE id=$1`, fixture.staffID); err != nil {
					t.Fatalf("deactivate staff: %v", err)
				}
			}

			view, err := service.Booking(ctx, bookingID, Actor{UserID: fixture.userID}, fixture.workspaceID)
			if err != nil {
				t.Fatalf("Booking() error = %v", err)
			}
			if _, err := service.Change(ctx, bookingID, Actor{UserID: fixture.userID}, fixture.workspaceID,
				ChangeInput{Key: uuid.New(), Version: view.Version, Action: "cancel"}); err != nil {
				t.Fatalf("Change(cancel) error = %v", err)
			}
			if tc.closeSchedule {
				var count int
				if err := database.Pool.QueryRow(ctx, `SELECT count(*) FROM river_job WHERE kind=$1
					AND args->>'event_type'='waitlist' AND args->>'appointment_id'=$2`,
					jobargs.KindBookingEmail, bookingID.String()).Scan(&count); err != nil {
					t.Fatalf("count waitlist email jobs: %v", err)
				}
				if count != 0 {
					t.Fatalf("waitlist email jobs = %d, want none without a bookable slot", count)
				}
				return
			}
			var argsJSON []byte
			if err := database.Pool.QueryRow(ctx, `SELECT args FROM river_job WHERE kind=$1 AND args->>'event_type'='waitlist'
				AND args->>'appointment_id'=$2`, jobargs.KindBookingEmail, bookingID.String()).Scan(&argsJSON); err != nil {
				t.Fatalf("read waitlist email job: %v", err)
			}
			var args jobargs.BookingEmailArgs
			if err := json.Unmarshal(argsJSON, &args); err != nil {
				t.Fatalf("decode waitlist email job: %v", err)
			}
			if args.To != tc.wantRecipient || !strings.Contains(args.Text, "service="+fixture.serviceID.String()+"&date="+date) {
				t.Fatalf("waitlist email = %+v; want recipient %s and booking link", args, tc.wantRecipient)
			}
		})
	}
}
