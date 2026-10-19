package receptionist

import (
	"context"
	"testing"
	"time"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/core/workspaces"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOwnerSettingsPersistInPostgresForTheSameWorkspace(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	userID := createReceptionistTestUser(t, database.Pool, "owner-settings")
	var workspaceID uuid.UUID
	t.Cleanup(func() {
		if workspaceID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		}
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	workspaceID, err := (&workspaces.Service{DB: database}).Create(ctx, &auth.Principal{UserID: userID, EmailVerified: true}, workspaces.WorkspaceInput{
		Name: "Receptionist Settings Test", Slug: "receptionist-" + uuid.NewString()[:8],
		ContactEmail: "owner@example.test", Phone: "+2348012345678", ServiceArea: "Ikeja",
		BookingLocation: "customer_address", TimeZone: "Africa/Lagos", Currency: "NGN",
	})
	if err != nil {
		t.Fatalf("create test workspace: %v", err)
	}
	principal := &auth.Principal{UserID: userID, WorkspaceID: workspaceID, Role: "owner", EmailVerified: true}
	service := NewService(NewPostgresRepository(database), nil, nil, Config{})
	ctx = auth.WithPrincipal(ctx, principal)
	initial, err := service.OwnerSettings(ctx, workspaceID)
	if err != nil {
		t.Fatalf("read owner settings: %v", err)
	}
	if initial.Greeting != defaultSettings().Greeting {
		t.Fatalf("initial greeting=%q, want default greeting", initial.Greeting)
	}
	updated := Settings{Enabled: false, Greeting: "Welcome to the salon.", Instructions: "Keep answers concise.",
		FAQs: []FAQ{{Question: "Do you serve Ikeja?", Answer: "Yes, we serve Ikeja."}}, AllowAvailability: true, AllowBooking: true}
	if _, err := service.SaveOwnerSettings(ctx, workspaceID, updated); err != nil {
		t.Fatalf("save owner settings: %v", err)
	}
	loaded, err := service.OwnerSettings(ctx, workspaceID)
	if err != nil {
		t.Fatalf("reload owner settings: %v", err)
	}
	if loaded.Enabled || loaded.Greeting != updated.Greeting || len(loaded.FAQs) != 1 || loaded.FAQs[0] != updated.FAQs[0] {
		t.Fatalf("persisted settings=%+v, want %+v", loaded, updated)
	}
	if _, err := service.OwnerSettings(auth.WithPrincipal(context.Background(), &auth.Principal{
		UserID: uuid.New(), WorkspaceID: workspaceID, Role: "owner", EmailVerified: true,
	}), workspaceID); err == nil {
		t.Fatal("a user without workspace membership read receptionist settings")
	}
}

func TestPurgeExpiredSessionsPreservesActiveLeases(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	userID := createReceptionistTestUser(t, database.Pool, "session-retention")
	var workspaceID uuid.UUID
	t.Cleanup(func() {
		if workspaceID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		}
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	workspaceID, err := (&workspaces.Service{DB: database}).Create(ctx, &auth.Principal{UserID: userID, EmailVerified: true}, workspaces.WorkspaceInput{
		Name: "Session Retention Test", Slug: "receptionist-retention-" + uuid.NewString()[:8],
		ContactEmail: "owner@example.test", Phone: "+2348012345678", ServiceArea: "Ikeja",
		BookingLocation: "customer_address", TimeZone: "Africa/Lagos", Currency: "NGN",
	})
	if err != nil {
		t.Fatalf("create test workspace: %v", err)
	}

	repository := NewPostgresRepository(database)
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	expiredID, err := repository.CreateSession(ctx, workspaceID.String(), hashToken("expired-session"), now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("create expired session: %v", err)
	}
	activeID, err := repository.CreateSession(ctx, workspaceID.String(), hashToken("active-session"), now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("create active session: %v", err)
	}
	validID, err := repository.CreateSession(ctx, workspaceID.String(), hashToken("valid-session"), now.Add(time.Hour))
	if err != nil {
		t.Fatalf("create valid session: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `UPDATE chat_sessions SET lease_until = $2 WHERE id = $1`, activeID, now.Add(time.Minute)); err != nil {
		t.Fatalf("set active session lease: %v", err)
	}

	if err := repository.PurgeExpiredSessions(ctx, now); err != nil {
		t.Fatalf("purge expired sessions: %v", err)
	}
	for id, want := range map[string]bool{expiredID: false, activeID: true, validID: true} {
		var exists bool
		if err := database.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = $1)`, id).Scan(&exists); err != nil {
			t.Fatalf("check session %s: %v", id, err)
		}
		if exists != want {
			t.Errorf("session %s exists=%t, want %t", id, exists, want)
		}
	}
}

func createReceptionistTestUser(t *testing.T, database *pgxpool.Pool, prefix string) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	if err := database.QueryRow(context.Background(), `INSERT INTO users (name,first_name,last_name,email,email_verified,password_hash)
		VALUES ('Receptionist Owner','Receptionist','Owner',$1,true,'test-password-hash') RETURNING id`,
		prefix+"-"+uuid.NewString()+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	return userID
}
