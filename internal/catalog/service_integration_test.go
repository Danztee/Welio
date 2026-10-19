package catalog

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/core/workspaces"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/httpx"
)

func TestCatalogServiceStaffAssignmentsAndTenantAuthorization(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	ownerID := addUser(t, database, "Catalog Owner")
	var workspaceID uuid.UUID
	var secondUserID uuid.UUID
	t.Cleanup(func() {
		if workspaceID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, workspaceID)
		}
		if secondUserID != uuid.Nil {
			_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, secondUserID)
		}
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, ownerID)
	})
	owner := &auth.Principal{UserID: ownerID, EmailVerified: true}
	inputWorkspace := workspaces.WorkspaceInput{Name: "Catalog Business", Slug: "catalog-" + uuid.NewString()[:8],
		ContactEmail: "business@example.test", ServiceArea: "Ikeja", BookingLocation: "customer_address",
		TimeZone: "Africa/Lagos", Currency: "NGN"}
	var err error
	workspaceID, err = (&workspaces.Service{DB: database}).Create(ctx, owner, inputWorkspace)
	if err != nil {
		t.Fatalf("create workspace fixture: %v", err)
	}
	owner.WorkspaceID, owner.Role = workspaceID, "owner"
	ownerStaffID := readOwnerStaffID(t, database, workspaceID, ownerID)
	catalogService := &Service{DB: database}

	employee, err := catalogService.SaveStaff(ctx, owner, workspaceID, nil, StaffInput{
		Name: "  Ada Cleaner ", Email: "ADA@example.test", JobTitle: "Cleaner", IsActive: true,
		Schedule: Schedule{Start: "09:00", End: "17:00", BreakStart: "12:00", BreakEnd: "12:30", Days: []int{5, 1, 3}},
	})
	if err != nil {
		t.Fatalf("SaveStaff() = %v", err)
	}
	serviceID, err := catalogService.SaveService(ctx, owner, workspaceID, nil, ServiceInput{
		Name: " Standard cleaning ", Description: "Home cleaning", DurationMinutes: 60,
		Price: 30000, IsActive: true, StaffIDs: &[]uuid.UUID{ownerStaffID, employee, employee},
	})
	if err != nil {
		t.Fatalf("SaveService() = %v", err)
	}
	snapshot, err := catalogService.Get(ctx, owner, workspaceID)
	if err != nil {
		t.Fatalf("Get() = %v", err)
	}
	if len(snapshot.Services) != 1 || snapshot.Services[0].Name != "Standard cleaning" || snapshot.Services[0].PriceMinor != 3_000_000 {
		t.Fatalf("service snapshot = %+v", snapshot.Services)
	}
	if len(snapshot.Staff) != 2 || len(snapshot.Assignments) != 2 {
		t.Fatalf("staff/assignments = %d/%d", len(snapshot.Staff), len(snapshot.Assignments))
	}
	var employeeRecord *StaffMember
	for index := range snapshot.Staff {
		if snapshot.Staff[index].ID == employee {
			employeeRecord = &snapshot.Staff[index]
		}
	}
	if employeeRecord == nil || employeeRecord.Name != "Ada Cleaner" || employeeRecord.Email != "ada@example.test" || fmt.Sprint(employeeRecord.Schedule.Days) != "[1 3 5]" {
		t.Fatalf("normalized staff snapshot = %+v", employeeRecord)
	}

	if err := catalogService.AssignServiceStaff(ctx, owner, workspaceID, serviceID, []uuid.UUID{employee}); err != nil {
		t.Fatalf("AssignServiceStaff() = %v", err)
	}
	serviceName := "Standard deep cleaning"
	if _, err := catalogService.SaveService(ctx, owner, workspaceID, &serviceID, ServiceInput{
		Name: serviceName, Description: "Updated", DurationMinutes: 75,
		Price: 30000.29, IsActive: true,
	}); err != nil {
		t.Fatalf("update service without changing assignments: %v", err)
	}
	if _, err := catalogService.SaveStaff(ctx, owner, workspaceID, &employee, StaffInput{
		Name: "Ada Cleaner", Email: "ada@example.test", JobTitle: "Senior cleaner", IsActive: true,
		Schedule: Schedule{Start: "08:30", End: "17:30", Days: []int{2, 4}},
	}); err != nil {
		t.Fatalf("update staff schedule: %v", err)
	}
	if err := catalogService.AssignServiceStaff(ctx, owner, workspaceID, serviceID, []uuid.UUID{uuid.New()}); errorCode(err) != "invalid_staff_assignment" {
		t.Fatalf("cross-workspace assignment = %v", err)
	}
	snapshot, err = catalogService.Get(ctx, owner, workspaceID)
	if err != nil || len(snapshot.Assignments) != 1 || snapshot.Assignments[0].StaffID != employee || snapshot.Services[0].Name != serviceName || snapshot.Services[0].PriceMinor != 3_000_029 {
		t.Fatalf("assignments after replacement failure = %+v, %v", snapshot.Assignments, err)
	}

	wrongTenant := &auth.Principal{UserID: ownerID, WorkspaceID: uuid.New(), Role: "owner", EmailVerified: true}
	if _, err := catalogService.Get(ctx, wrongTenant, workspaceID); errorCode(err) != "workspace_forbidden" {
		t.Fatalf("cross-tenant catalog read = %v", err)
	}
	staffPrincipal := *owner
	staffPrincipal.Role = "staff"
	if _, err := catalogService.SaveService(ctx, &staffPrincipal, workspaceID, &serviceID, ServiceInput{
		Name: serviceName, DurationMinutes: 60, Price: 30000, IsActive: true,
	}); errorCode(err) != "forbidden" {
		t.Fatalf("staff service write = %v", err)
	}
	if _, err := catalogService.SaveStaff(ctx, owner, workspaceID, nil, StaffInput{
		Name: "Another Cleaner", Email: "ada@EXAMPLE.test", JobTitle: "Cleaner", IsActive: true,
		Schedule: Schedule{Start: "09:00", End: "17:00", Days: []int{1}},
	}); errorCode(err) != "staff_email_taken" {
		t.Fatalf("duplicate staff email = %v", err)
	}

	secondUserID = addUser(t, database, "Second Workspace Owner")
	secondOwner := &auth.Principal{UserID: secondUserID, EmailVerified: true}
	secondWorkspaceID, err := (&workspaces.Service{DB: database}).Create(ctx, secondOwner, workspaces.WorkspaceInput{
		Name: "Other Business", Slug: "other-" + uuid.NewString()[:8], ContactEmail: "other@example.test",
		ServiceArea: "Yaba", BookingLocation: "customer_address", TimeZone: "Africa/Lagos", Currency: "NGN",
	})
	if err != nil {
		t.Fatalf("create second workspace fixture: %v", err)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, secondWorkspaceID)
	})
	otherStaffID := readOwnerStaffID(t, database, secondWorkspaceID, secondUserID)
	if err := catalogService.AssignServiceStaff(ctx, owner, workspaceID, serviceID, []uuid.UUID{otherStaffID}); errorCode(err) != "invalid_staff_assignment" {
		t.Fatalf("assign staff from another workspace = %v", err)
	}
	if _, err := catalogService.SaveService(ctx, owner, secondWorkspaceID, nil, ServiceInput{
		Name: "Cross tenant", DurationMinutes: 60, Price: 30000, IsActive: true,
	}); errorCode(err) != "workspace_forbidden" {
		t.Fatalf("cross-tenant service creation = %v", err)
	}
}

func addUser(t *testing.T, database *db.DB, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := database.Pool.QueryRow(context.Background(), `INSERT INTO users (name,first_name,last_name,email,email_verified,password_hash)
		VALUES ($1,$2,'Test',$3,true,'test-password-hash') RETURNING id`, name, name, uuid.NewString()+"@example.test").Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func readOwnerStaffID(t *testing.T, database *db.DB, workspaceID, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := database.Pool.QueryRow(context.Background(), `SELECT id FROM staff WHERE workspace_id=$1 AND user_id=$2`, workspaceID, userID).Scan(&id)
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
