package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func TestOwnerSettingsRequireWorkspaceOwnerAndPersistSettings(t *testing.T) {
	repository := newFakeRepository()
	workspaceID, err := uuid.Parse(repository.business.ID)
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, &fakeModel{}, Config{
		AppOrigin: "https://app.welio.example",
	})
	router := ownerTestRouter(service, &auth.Principal{UserID: userID, WorkspaceID: workspaceID, Role: "owner", EmailVerified: true})

	get := httptest.NewRequest(http.MethodGet, "/v1/workspaces/"+workspaceID.String()+"/receptionist", nil)
	got := httptest.NewRecorder()
	router.ServeHTTP(got, get)
	if got.Code != http.StatusOK {
		t.Fatalf("GET settings status=%d body=%s", got.Code, got.Body.String())
	}
	var settings settingsDTO
	if err := json.Unmarshal(got.Body.Bytes(), &settings); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if settings.Greeting != defaultSettings().Greeting || !settings.AllowBooking {
		t.Fatalf("GET greeting=%q, want default greeting", settings.Greeting)
	}

	input := `{"enabled":true,"greeting":"Welcome to Sample Business.","instructions":"Be warm and concise.","faqs":[{"question":"Where do you serve?","answer":"Ikeja and nearby areas."}],"allow_availability":true,"allow_booking":true}`
	put := httptest.NewRequest(http.MethodPut, "/v1/workspaces/"+workspaceID.String()+"/receptionist", strings.NewReader(input))
	put.Header.Set("Content-Type", "application/json")
	put.Header.Set("Origin", "https://app.welio.example")
	updated := httptest.NewRecorder()
	router.ServeHTTP(updated, put)
	if updated.Code != http.StatusOK {
		t.Fatalf("PUT settings status=%d body=%s", updated.Code, updated.Body.String())
	}
	if repository.business.Settings.Greeting != "Welcome to Sample Business." || len(repository.business.Settings.FAQs) != 1 {
		t.Fatalf("settings were not persisted by repository: %+v", repository.business.Settings)
	}

	staffRouter := ownerTestRouter(service, &auth.Principal{UserID: userID, WorkspaceID: workspaceID, Role: "staff", EmailVerified: true})
	denied := httptest.NewRecorder()
	staffRouter.ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/v1/workspaces/"+workspaceID.String()+"/receptionist", nil))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("staff GET settings status=%d, want 403 body=%s", denied.Code, denied.Body.String())
	}

	wrongWorkspace := httptest.NewRecorder()
	staffRouter = ownerTestRouter(service, &auth.Principal{UserID: userID, WorkspaceID: uuid.New(), Role: "owner", EmailVerified: true})
	staffRouter.ServeHTTP(wrongWorkspace, httptest.NewRequest(http.MethodGet, "/v1/workspaces/"+workspaceID.String()+"/receptionist", nil))
	if wrongWorkspace.Code != http.StatusForbidden {
		t.Fatalf("cross-workspace GET settings status=%d, want 403 body=%s", wrongWorkspace.Code, wrongWorkspace.Body.String())
	}
}

func TestOwnerPreviewStreamsProposalWithoutPersistingOrBooking(t *testing.T) {
	repository := newFakeRepository()
	workspaceID, err := uuid.Parse(repository.business.ID)
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	bookings := &previewBookings{catalog: sampleBookingCatalog(), slots: []AvailableSlot{{Time: "13:00", StaffID: sampleBookingCatalog().Staff[0].ID}}}
	model := &scriptedModel{responses: []ModelResponse{
		{ToolCalls: []ToolCall{{ID: "prepare-1", Name: "prepare_booking", Input: mustJSON(t, map[string]any{
			"serviceId": sampleBookingCatalog().Services[0].ID,
			"staffId":   sampleBookingCatalog().Staff[0].ID,
			"date":      "2026-10-20",
			"time":      "13:00",
			"name":      "John Doe",
			"email":     "john@example.com",
			"address":   "Ikeja, Lagos",
		})}}},
		{Text: "I found a suitable appointment."},
	}}
	service := NewService(repository, bookings, model, Config{AppOrigin: "https://app.welio.example"})
	service.Now = func() time.Time { return time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC) }
	router := ownerTestRouter(service, &auth.Principal{UserID: userID, WorkspaceID: workspaceID, Role: "owner", EmailVerified: true})
	request := httptest.NewRequest(http.MethodPost, "/v1/workspaces/"+workspaceID.String()+"/receptionist/preview", strings.NewReader(`{"text":"Can you book me for cleaning?","turns":[]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://app.welio.example")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("Content-Type"), "application/x-ndjson") {
		t.Fatalf("preview content type=%q, want NDJSON", response.Header().Get("Content-Type"))
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read preview stream: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	var complete streamEvent
	hasDelta, hasActivity := false, false
	for _, line := range lines {
		var event streamEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("decode preview event %q: %v", line, err)
		}
		if event.Type == "complete" {
			complete = event
		} else if event.Type == "delta" && event.Text != "" {
			hasDelta = true
		} else if event.Type == "activity" && event.Activity != "" {
			hasActivity = true
		}
	}
	if !hasDelta || !hasActivity {
		t.Fatalf("preview did not stream text and activity events: %s", body)
	}
	if complete.Type != "complete" {
		t.Fatalf("preview stream did not complete: %s", body)
	}
	var result PreviewResult
	encoded, err := json.Marshal(complete.Data)
	if err != nil || json.Unmarshal(encoded, &result) != nil {
		t.Fatalf("decode preview result %s: %v", encoded, err)
	}
	if result.Proposal == nil || result.Proposal.ID == "" || !strings.Contains(result.Reply, "explicitly confirm") {
		t.Fatalf("unexpected preview result: %+v", result)
	}
	if len(repository.sessions) != 0 || len(repository.proposals) != 0 || bookings.createCalls != 0 {
		t.Fatalf("preview persisted state or booked: sessions=%d proposals=%d createCalls=%d", len(repository.sessions), len(repository.proposals), bookings.createCalls)
	}
	if bookings.ownerCatalogCalls < 1 || bookings.ownerAvailabilityCalls < 1 {
		t.Fatalf("preview did not use owner booking reads: catalog=%d availability=%d", bookings.ownerCatalogCalls, bookings.ownerAvailabilityCalls)
	}
}

func TestPublicReceptionistConfigDoesNotExposePrivateInstructions(t *testing.T) {
	repository := newFakeRepository()
	repository.business.Settings.Instructions = "Only for the model, never public."
	repository.business.Settings.FAQs = []FAQ{{Question: "Internal question", Answer: "Internal answer"}}
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, &fakeModel{}, Config{})
	router := ownerTestRouter(service, nil)
	request := httptest.NewRequest(http.MethodGet, "/v1/book/"+repository.business.Slug+"/receptionist", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("public config status=%d body=%s", response.Code, response.Body.String())
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "instructions") || strings.Contains(string(body), "Internal answer") || strings.Contains(string(body), "Internal question") {
		t.Fatalf("public response exposed private settings: %s", body)
	}
	var config PublicConfig
	if err := json.Unmarshal(body, &config); err != nil {
		t.Fatalf("decode public config: %v", err)
	}
	if !config.Enabled || config.Greeting != defaultSettings().Greeting {
		t.Fatalf("unexpected public config: %+v", config)
	}
}

type previewBookings struct {
	catalog                BookingCatalog
	slots                  []AvailableSlot
	ownerCatalogCalls      int
	ownerAvailabilityCalls int
	createCalls            int
}

func (bookings *previewBookings) Catalog(context.Context, string) (BookingCatalog, error) {
	return bookings.catalog, nil
}
func (bookings *previewBookings) Availability(context.Context, string, SlotInput) ([]AvailableSlot, error) {
	return bookings.slots, nil
}
func (bookings *previewBookings) CatalogForOwner(context.Context, uuid.UUID, uuid.UUID) (BookingCatalog, error) {
	bookings.ownerCatalogCalls++
	return bookings.catalog, nil
}
func (bookings *previewBookings) AvailabilityForOwner(context.Context, uuid.UUID, uuid.UUID, SlotInput) ([]AvailableSlot, error) {
	bookings.ownerAvailabilityCalls++
	return bookings.slots, nil
}
func (bookings *previewBookings) Create(context.Context, string, BookingInput, string) (BookingResult, error) {
	bookings.createCalls++
	return BookingResult{}, nil
}

type scriptedModel struct {
	responses []ModelResponse
	calls     int
}

func (model *scriptedModel) ConverseStream(_ context.Context, _ ModelRequest, callbacks StreamCallbacks) (ModelResponse, error) {
	if model.calls >= len(model.responses) {
		return ModelResponse{}, errors.New("scripted response exhausted")
	}
	response := model.responses[model.calls]
	model.calls++
	if response.Text != "" && callbacks.OnTextDelta != nil {
		callbacks.OnTextDelta(response.Text)
	}
	return response, nil
}

func ownerTestRouter(service *Service, principal *auth.Principal) http.Handler {
	router := chi.NewRouter()
	router.Use(httpx.RequestMetaMiddleware)
	if principal != nil {
		router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r.WithContext(auth.WithPrincipal(r.Context(), principal)))
			})
		})
	}
	openAPI := huma.DefaultConfig("Receptionist tests", "1")
	api := humachi.New(router, openAPI)
	RegisterOwnerAPI(service, api)
	return router
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
