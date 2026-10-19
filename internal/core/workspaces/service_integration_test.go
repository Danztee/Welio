package workspaces

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/httpx"
)

func TestWorkspaceCreationSettingsAndTenantAuthorization(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	userID := createTestUser(t, database, "Workspace Owner", "workspace-owner")
	var workspaceID uuid.UUID
	var otherUserID uuid.UUID
	t.Cleanup(func() {
		if workspaceID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		}
		if otherUserID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, otherUserID)
		}
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	principal := &auth.Principal{UserID: userID, EmailVerified: true}
	service := &Service{DB: database}

	var err error
	workspaceID, err = service.Create(ctx, principal, validWorkspaceInput("workspace-"+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("Create() = %v", err)
	}
	var role, staffName, staffTitle string
	if err := database.Pool.QueryRow(ctx, `SELECT m.role, st.name, st.job_title
		FROM memberships m JOIN staff st ON st.workspace_id=m.workspace_id AND st.user_id=m.user_id
		WHERE m.workspace_id=$1 AND m.user_id=$2`, workspaceID, userID).Scan(&role, &staffName, &staffTitle); err != nil {
		t.Fatal(err)
	}
	if role != "owner" || staffTitle != "Owner" || staffName != "Workspace Owner" {
		t.Fatalf("creator membership/staff = %q / %q / %q", role, staffName, staffTitle)
	}

	principal.WorkspaceID, principal.Role = workspaceID, role
	workspace, err := service.Get(ctx, principal, workspaceID)
	if err != nil || workspace.Name != "A Clean Business" || workspace.ServiceArea == nil || *workspace.ServiceArea != "Ikeja" {
		t.Fatalf("Get() = %+v, %v", workspace, err)
	}
	input := validWorkspaceInput("workspace-" + uuid.NewString()[:8])
	input.Name = "Updated Business"
	input.BookingLocation = "both"
	input.BusinessAddress = "12 Allen Avenue"
	if err := service.SaveBusiness(ctx, principal, workspaceID, input); err != nil {
		t.Fatalf("SaveBusiness() = %v", err)
	}
	workspace, err = service.Get(ctx, principal, workspaceID)
	if err != nil || workspace.Name != "Updated Business" || workspace.BookingLocation != "both" || workspace.BusinessAddress == nil {
		t.Fatalf("saved business settings = %+v, %v", workspace, err)
	}
	if err := service.SaveReminderPolicy(ctx, principal, workspaceID, true); err != nil {
		t.Fatalf("enable appointment reminders: %v", err)
	}
	workspace, err = service.Get(ctx, principal, workspaceID)
	if err != nil || !workspace.RemindersEnabled {
		t.Fatalf("reminder setting after enable = %+v, %v", workspace, err)
	}

	otherUserID = createTestUser(t, database, "Other Staff", "workspace-staff")
	if _, err := database.Pool.Exec(ctx, `INSERT INTO memberships (workspace_id,user_id,role) VALUES ($1,$2,'staff')`, workspaceID, otherUserID); err != nil {
		t.Fatal(err)
	}
	staffPrincipal := &auth.Principal{UserID: otherUserID, WorkspaceID: workspaceID, Role: "staff", EmailVerified: true}
	if err := service.SaveBusiness(ctx, staffPrincipal, workspaceID, input); errorCode(err) != "forbidden" {
		t.Fatalf("staff SaveBusiness() error = %v", err)
	}
	if err := service.SaveReminderPolicy(ctx, staffPrincipal, workspaceID, false); errorCode(err) != "forbidden" {
		t.Fatalf("staff SaveReminderPolicy() error = %v", err)
	}
	if err := service.FinishSetup(ctx, principal, uuid.New()); errorCode(err) != "workspace_forbidden" {
		t.Fatalf("cross-workspace setup access = %v", err)
	}
	items, err := service.List(ctx, principal)
	if err != nil || len(items) != 1 || items[0].Workspace.ID != workspaceID || items[0].Role != "owner" {
		t.Fatalf("List() = %+v, %v", items, err)
	}
}

func TestWorkspaceBusinessRules(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	userID := createTestUser(t, database, "Policy Owner", "workspace-policy")
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, userID) })
	service := &Service{DB: database}
	principal := &auth.Principal{UserID: userID, EmailVerified: true}
	workspaceID, err := service.Create(ctx, principal, validWorkspaceInput("policy-"+uuid.NewString()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, workspaceID)
	})
	principal.WorkspaceID, principal.Role = workspaceID, "owner"
	var serviceID, staffID, customerID uuid.UUID
	err = database.Pool.QueryRow(ctx, `INSERT INTO services (workspace_id,name,duration_minutes,price_minor)
		VALUES ($1,'Cleaning',60,1000) RETURNING id`, workspaceID).Scan(&serviceID)
	if err != nil {
		t.Fatal(err)
	}
	err = database.Pool.QueryRow(ctx, `SELECT id FROM staff WHERE workspace_id=$1 AND user_id=$2`, workspaceID, userID).Scan(&staffID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Pool.Exec(ctx, `INSERT INTO staff_services (workspace_id,staff_id,service_id)
		VALUES ($1,$2,$3)`, workspaceID, staffID, serviceID); err != nil {
		t.Fatal(err)
	}
	err = database.Pool.QueryRow(ctx, `INSERT INTO customers (workspace_id,name) VALUES ($1,'Demo Customer') RETURNING id`, workspaceID).Scan(&customerID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Pool.Exec(ctx, `INSERT INTO appointments (workspace_id,customer_id,service_id,staff_id,
		starts_at,ends_at,service_name,duration_minutes,price_minor,currency)
		VALUES ($1,$2,$3,$4,now()+interval '1 day',now()+interval '1 day 1 hour','Cleaning',60,1000,'NGN')`,
		workspaceID, customerID, serviceID, staffID)
	if err != nil {
		t.Fatal(err)
	}
	input := validWorkspaceInput("policy-" + uuid.NewString()[:8])
	input.Currency = "USD"
	if err := service.SaveBusiness(ctx, principal, workspaceID, input); errorCode(err) != "booking_policy_locked" {
		t.Fatalf("currency change after booking = %v", err)
	}
	input.Currency = "NGN"
	input.TimeZone = "UTC"
	if err := service.SaveBusiness(ctx, principal, workspaceID, input); errorCode(err) != "booking_policy_locked" {
		t.Fatalf("time zone change after booking = %v", err)
	}
}

func validWorkspaceInput(slug string) WorkspaceInput {
	return WorkspaceInput{Name: "A Clean Business", Slug: slug, ContactEmail: "business@example.test",
		Phone: "+234 800 000 0000", ServiceArea: "Ikeja", BookingLocation: "customer_address",
		TimeZone: "Africa/Lagos", Currency: "NGN"}
}

func createTestUser(t *testing.T, database *db.DB, name, prefix string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := database.Pool.QueryRow(context.Background(), `INSERT INTO users (name,first_name,last_name,email,email_verified,password_hash)
		VALUES ($1,$2,'Test',$3,true,'test-password-hash') RETURNING id`, name, strings.Split(name, " ")[0], fmt.Sprintf("%s-%s@example.test", prefix, uuid.NewString())).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func errorCode(err error) string {
	var problem *httpx.Error
	if errors.As(err, &problem) {
		return problem.Code
	}
	return ""
}
