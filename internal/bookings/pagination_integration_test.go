package bookings

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/dbtest"
)

func TestListsAndOverviewIncludeRecordsBeyondOneThousand(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	f := seedBookingFixture(t, ctx, database.Pool)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, f.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, f.userID)
	})
	service := NewService(database, "https://welio.example")
	service.Now = func() time.Time { return time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC) }
	_, err := database.Pool.Exec(ctx, `INSERT INTO customers(workspace_id,name,email,created_at)
  SELECT $1,'Customer ' || lpad(n::text,4,'0'),'c-' || n || '@example.test','2026-10-19T08:00:00Z'::timestamptz FROM generate_series(1,1005) n`, f.workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[uuid.UUID]bool{}
	cursor := ""
	for {
		page, err := service.CustomersPage(ctx, f.userID, f.workspaceID, ListOptions{Limit: 200, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != 1005 || len(page.Items) > 200 {
			t.Fatalf("unexpected page: total=%d len=%d", page.Total, len(page.Items))
		}
		for _, c := range page.Items {
			if seen[c.ID] {
				t.Fatal("cursor repeated a customer")
			}
			seen[c.ID] = true
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 1005 {
		t.Fatalf("listed %d customers", len(seen))
	}
	filtered, err := service.CustomersPage(ctx, f.userID, f.workspaceID, ListOptions{Search: "Customer 1005"})
	if err != nil || filtered.Total != 1 || len(filtered.Items) != 1 {
		t.Fatalf("search result=%+v err=%v", filtered, err)
	}
	catalog, err := service.Catalog(ctx, f.slug)
	if err != nil {
		t.Fatal(err)
	}
	customerID := filtered.Items[0].ID
	_, err = database.Pool.Exec(ctx, `INSERT INTO appointments(workspace_id,customer_id,service_id,staff_id,starts_at,ends_at,service_name,duration_minutes,price_minor,currency,customer_name,customer_email)
  SELECT $1,$2,$3,$4,'2026-10-19T08:00:00Z'::timestamptz + n*interval '1 hour','2026-10-19T09:00:00Z'::timestamptz + n*interval '1 hour','Service',60,1000,'NGN','Customer 1005','c-1005@example.test' FROM generate_series(0,1004) n`, f.workspaceID, customerID, catalog.Services[0].ID, catalog.Staff[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.AppointmentsPage(ctx, f.userID, f.workspaceID, ListOptions{Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 1005 || len(first.Items) != 200 || first.NextCursor == "" {
		t.Fatalf("unexpected appointments page: %+v", first)
	}
	second, err := service.AppointmentsPage(ctx, f.userID, f.workspaceID, ListOptions{Limit: 200, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if !second.Items[0].StartsAt.Before(first.Items[199].StartsAt) {
		t.Fatal("appointments cursor repeated a page")
	}
	overview, err := service.Overview(ctx, f.userID, f.workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []any{overview, first, countedPageForSchema(t, service, ctx, f)} {
		raw, err := json.Marshal(model)
		if err != nil {
			t.Fatal(err)
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		if errs := huma.NewModelValidator().Validate(reflect.TypeOf(model), value); len(errs) > 0 {
			t.Fatalf("published contract disagrees with JSON: %v", errs)
		}
	}
	if overview.Customers != 1005 || overview.Confirmed != 1005 || overview.TodayCount != 15 {
		t.Fatalf("incorrect overview: %+v", overview)
	}
	if len(overview.Daily) != 1 || overview.Daily[0].Count != 15 {
		t.Fatalf("incorrect daily totals: %+v", overview.Daily)
	}
	counted, err := service.CustomersPage(ctx, f.userID, f.workspaceID, ListOptions{Search: "Customer 1005"})
	if err != nil {
		t.Fatal(err)
	}
	assertCustomerHistoryHTTPPagination(t, service, f, customerID)
	if counted.Items[0].AppointmentCount != 1005 {
		t.Fatalf("customer appointment count=%d", counted.Items[0].AppointmentCount)
	}
	if _, err := service.CustomersPage(ctx, uuid.New(), f.workspaceID, ListOptions{}); err == nil {
		t.Fatal("outsider read customers")
	}
	if _, err := service.Overview(ctx, uuid.New(), f.workspaceID); err == nil {
		t.Fatal("outsider read overview")
	}
	if _, err := service.AppointmentsPage(ctx, f.userID, f.workspaceID, ListOptions{Cursor: "invalid"}); err == nil {
		t.Fatal("accepted invalid cursor")
	}
}

func countedPageForSchema(t *testing.T, s *Service, ctx context.Context, f bookingFixture) Page[Customer] {
	t.Helper()
	page, err := s.CustomersPage(ctx, f.userID, f.workspaceID, ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func assertCustomerHistoryHTTPPagination(t *testing.T, service *Service, fixture bookingFixture, customerID uuid.UUID) {
	t.Helper()
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "test"))
	RegisterOwnerAPI(service, api)
	load := func(cursor string) CustomerDetail {
		query := url.Values{"limit": {"1"}, "cursor": {cursor}}
		path := "/v1/workspaces/" + fixture.workspaceID.String() + "/customers/" + customerID.String() + "?" + query.Encode()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request = request.WithContext(auth.WithPrincipal(request.Context(), &auth.Principal{UserID: fixture.userID, EmailVerified: true}))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("customer history status=%d: %s", response.Code, response.Body.String())
		}
		var detail CustomerDetail
		if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil {
			t.Fatal(err)
		}
		return detail
	}
	first := load("")
	if len(first.Appointments) != 1 || first.NextCursor == "" || first.AppointmentCount != 1005 {
		t.Fatal("customer history did not honor its limit")
	}
	second := load(first.NextCursor)
	if len(second.Appointments) != 1 || second.Appointments[0].ID == first.Appointments[0].ID {
		t.Fatal("customer history did not honor its cursor")
	}
}
