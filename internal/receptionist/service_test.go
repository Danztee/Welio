package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestMessageStreamsAndPersistsConversationState(t *testing.T) {
	t.Parallel()
	repository := newFakeRepository()
	model := &fakeModel{response: ModelResponse{Text: "We offer standard cleaning."}}
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, model, Config{AppOrigin: "https://welio.example"})
	service.Now = func() time.Time { return time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC) }
	token := "private-chat-token"
	conversationID, err := repository.CreateSession(context.Background(), repository.business.ID, hashToken(token), service.now().Add(ChatSessionLifetime))
	if err != nil {
		t.Fatal(err)
	}
	sink := &recordingSink{}
	key := "e37eaa6f-50a4-4bb8-8dfc-6f0f28d63703"
	state, err := service.Message(context.Background(), repository.business.Slug, token, key, "What services do you offer?", sink)
	if err != nil {
		t.Fatalf("message: %v", err)
	}
	if len(state.Turns) != 1 || state.Turns[0].Reply != "We offer standard cleaning." {
		t.Fatalf("unexpected state: %#v", state)
	}
	if strings.Join(sink.deltas, "") != "We offer standard cleaning." {
		t.Fatalf("streamed text = %q", strings.Join(sink.deltas, ""))
	}
	if len(sink.activities) == 0 || sink.activities[0] != ActivityThinking {
		t.Fatalf("activity stream = %#v", sink.activities)
	}
	saved := repository.sessions[conversationID]
	if saved == nil || len(saved.Messages) != 2 || saved.Lease != "" {
		t.Fatalf("conversation was not saved/released: %#v", saved)
	}
	if repository.reserveCalls != 1 {
		t.Fatalf("model reservations = %d, want 1", repository.reserveCalls)
	}
}

func TestAllowedChatOriginUsesTrustedWebOrigins(t *testing.T) {
	service := NewService(nil, nil, nil, Config{
		AppOrigin:   "https://api.welio.example",
		ChatOrigins: []string{"https://app.welio.example", "https://preview.welio.example"},
	})
	for _, test := range []struct {
		origin string
		want   bool
	}{
		{origin: "", want: true},
		{origin: "https://app.welio.example", want: true},
		{origin: "https://preview.welio.example", want: true},
		{origin: "https://api.welio.example", want: false},
		{origin: "https://other.example", want: false},
		{origin: "https://app.welio.example/path", want: false},
	} {
		if got := service.allowedChatOrigin(test.origin); got != test.want {
			t.Errorf("allowedChatOrigin(%q) = %t, want %t", test.origin, got, test.want)
		}
	}
}

func TestMessageRejectsReusedKeysAndReleasesFailedLeases(t *testing.T) {
	t.Parallel()
	repository := newFakeRepository()
	model := &fakeModel{err: errors.New("bedrock adapter failure")}
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, model, Config{})
	token := "private-chat-token"
	_, err := repository.CreateSession(context.Background(), repository.business.ID, hashToken(token), time.Now().Add(ChatSessionLifetime))
	if err != nil {
		t.Fatal(err)
	}
	key := "e37eaa6f-50a4-4bb8-8dfc-6f0f28d63703"
	if _, err := service.Message(context.Background(), repository.business.Slug, token, key, "First text", nil); err == nil {
		t.Fatal("expected model failure")
	}
	if repository.releasedTurns != 1 {
		t.Fatalf("released leases = %d, want 1", repository.releasedTurns)
	}
	if _, err := service.Message(context.Background(), repository.business.Slug, token, key, "Different text", nil); err == nil || !errors.Is(err, ErrInvalid) {
		t.Fatalf("reused key error = %v", err)
	}
}

func TestChatBookingRequiresConsentAndPersistsReceipt(t *testing.T) {
	t.Parallel()
	repository := newFakeRepository()
	bookingService := &fakeBookings{catalog: sampleBookingCatalog()}
	service := NewService(repository, bookingService, &fakeModel{}, Config{})
	token := "private-chat-token"
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	service.Now = func() time.Time { return now }
	sessionID, err := repository.CreateSession(context.Background(), repository.business.ID, hashToken(token), now.Add(ChatSessionLifetime))
	if err != nil {
		t.Fatal(err)
	}
	repository.sessions[sessionID].Pending = &Proposal{
		ID: "a9f36682-32fb-45d6-b0c4-d5193d38ce38", ExpiresAt: now.Add(ProposalLifetime),
		Input: sampleProposalInput(),
	}
	if _, err := service.ConfirmChat(context.Background(), repository.business.Slug, token, repository.sessions[sessionID].Pending.ID, false); !errors.Is(err, ErrProposalDenied) {
		t.Fatalf("confirmation without email consent error = %v", err)
	}
	if bookingService.createCalls != 0 {
		t.Fatal("confirmation without consent created an appointment")
	}
	proposalID := repository.sessions[sessionID].Pending.ID
	first, err := service.ConfirmChat(context.Background(), repository.business.Slug, token, proposalID, true)
	if err != nil {
		t.Fatalf("confirm chat booking: %v", err)
	}
	second, err := service.ConfirmChat(context.Background(), repository.business.Slug, token, proposalID, true)
	if err != nil {
		t.Fatalf("repeat chat confirmation: %v", err)
	}
	if first.Receipt == "" || first.Receipt != second.Receipt || first.Pending != nil || bookingService.createCalls != 1 {
		t.Fatalf("chat confirmation was not durable and idempotent: first=%#v second=%#v calls=%d", first, second, bookingService.createCalls)
	}
}

func TestChatHTTPStreamsNDJSONAndKeepsSessionCookiePrivate(t *testing.T) {
	t.Parallel()
	repository := newFakeRepository()
	model := &fakeModel{response: ModelResponse{Text: "Hello from Welio."}}
	service := NewService(repository, &fakeBookings{catalog: sampleBookingCatalog()}, model, Config{AppOrigin: "https://welio.example", ChatSecure: true})
	router := chi.NewRouter()
	RegisterRoutes(router, service)
	token := "chat-cookie-token"
	conversationID, err := repository.CreateSession(context.Background(), repository.business.ID, hashToken(token), time.Now().Add(ChatSessionLifetime))
	if err != nil {
		t.Fatal(err)
	}
	key := "e37eaa6f-50a4-4bb8-8dfc-6f0f28d63703"
	body := `{"action":"message","conversationId":"` + conversationID + `","key":"` + key + `","text":"Hi"}`
	request := httptest.NewRequest(http.MethodPost, "https://welio.example/api/chat/sample-business", strings.NewReader(body))
	request.Header.Set("Origin", "https://welio.example")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: chatCookiePrefix + conversationID, Value: token})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("Content-Type"), "application/x-ndjson") {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	lines := strings.Split(strings.TrimSpace(response.Body.String()), "\n")
	var events []map[string]json.RawMessage
	for _, line := range lines {
		var event map[string]json.RawMessage
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("invalid ndjson event %q: %v", line, err)
		}
		events = append(events, event)
	}
	if len(events) < 3 {
		t.Fatalf("expected activity, delta, and completion events; got %s", response.Body.String())
	}
	var lastType string
	if err := json.Unmarshal(events[len(events)-1]["type"], &lastType); err != nil || lastType != "complete" {
		t.Fatalf("last stream event = %q (%v)", lastType, err)
	}
}

type recordingSink struct {
	deltas     []string
	activities []Activity
}

func (sink *recordingSink) TextDelta(value string)  { sink.deltas = append(sink.deltas, value) }
func (sink *recordingSink) Activity(value Activity) { sink.activities = append(sink.activities, value) }
