package receptionist

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type fakeRepository struct {
	Repository
	business          Business
	sessions          map[string]*ChatSession
	proposals         map[string]fakeProposal
	reserveAllowed    bool
	reserveCalls      int
	releasedTurns     int
	releasedProposals int
	purgedProposals   int
	purgedSessions    int
	purgeTime         time.Time
}

type fakeProposal struct {
	tokenHash     string
	proposal      ExternalProposal
	expiresAt     time.Time
	lease         string
	appointmentID string
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		business: Business{ID: uuid.NewString(), Slug: "sample-business", Name: "Sample Business", Currency: "NGN", TimeZone: "Africa/Lagos", BookingLocation: "customer_address", Published: true, Settings: defaultSettings()},
		sessions: map[string]*ChatSession{}, proposals: map[string]fakeProposal{}, reserveAllowed: true,
	}
}

func (repository *fakeRepository) Business(_ context.Context, slug string) (Business, error) {
	if slug != repository.business.Slug {
		return Business{}, ErrNotFound
	}
	return repository.business, nil
}

func (repository *fakeRepository) BusinessForWorkspace(_ context.Context, _ uuid.UUID, workspaceID uuid.UUID) (Business, error) {
	if workspaceID.String() != repository.business.ID {
		return Business{}, ErrNotFound
	}
	return repository.business, nil
}

func (repository *fakeRepository) SaveSettings(_ context.Context, _ uuid.UUID, workspaceID uuid.UUID, settings Settings) error {
	if workspaceID.String() != repository.business.ID {
		return ErrNotFound
	}
	repository.business.Settings = settings
	return nil
}

func (repository *fakeRepository) CreateSession(_ context.Context, workspaceID, tokenHash string, expiry time.Time) (string, error) {
	id := uuid.NewString()
	repository.sessions[id] = &ChatSession{ID: id, WorkspaceID: workspaceID, TokenHash: tokenHash, ExpiresAt: expiry, Messages: []ChatMessage{}, Turns: []ChatTurn{}}
	return id, nil
}

func (repository *fakeRepository) ListSessions(_ context.Context, slug string, cookies []SessionCookie, now time.Time) ([]ChatSession, error) {
	result := make([]ChatSession, 0)
	for _, cookie := range cookies {
		for _, session := range repository.sessions {
			if session.TokenHash == hashToken(cookie.Token) && (cookie.ID == "" || cookie.ID == session.ID) && session.ExpiresAt.After(now) && slug == repository.business.Slug {
				result = append(result, cloneSession(*session))
			}
		}
	}
	return result, nil
}

func (repository *fakeRepository) LoadSession(_ context.Context, slug, token string, now time.Time) (*ChatSession, error) {
	for _, session := range repository.sessions {
		if session.TokenHash == hashToken(token) && session.ExpiresAt.After(now) && slug == repository.business.Slug {
			copy := cloneSession(*session)
			return &copy, nil
		}
	}
	return nil, nil
}

func (repository *fakeRepository) ClaimTurn(_ context.Context, slug, token, key, text string, now time.Time) (TurnClaim, error) {
	session, err := repository.LoadSession(context.Background(), slug, token, now)
	if err != nil || session == nil {
		return TurnClaim{Status: "unavailable"}, err
	}
	for _, turn := range session.Turns {
		if turn.Key == key {
			if turn.Text != text {
				return TurnClaim{Status: "message-key-reused"}, nil
			}
			return TurnClaim{Status: "cached", State: session.State()}, nil
		}
	}
	if session.ActiveTurn != nil && (session.ActiveTurn.Key != key || session.ActiveTurn.Text != text) {
		return TurnClaim{Status: "retry-previous"}, nil
	}
	if session.Lease != "" && session.LeaseUntil.After(now) {
		return TurnClaim{Status: "busy"}, nil
	}
	lease := uuid.NewString()
	session.Lease, session.LeaseUntil, session.ActiveTurn = lease, now.Add(LeaseLifetime), &ChatRetry{Key: key, Text: text}
	repository.sessions[session.ID] = session
	return TurnClaim{Status: "claimed", Session: session, Lease: lease}, nil
}

func (repository *fakeRepository) SaveTurn(_ context.Context, sessionID, lease string, messages []ChatMessage, turns []ChatTurn, pending *Proposal) (*ChatSession, error) {
	session := repository.sessions[sessionID]
	if session == nil || session.Lease != lease {
		return nil, nil
	}
	session.Messages, session.Turns, session.Pending = messages, turns, pending
	session.Lease, session.LeaseUntil, session.ActiveTurn = "", time.Time{}, nil
	session.UpdatedAt = time.Now()
	copy := cloneSession(*session)
	return &copy, nil
}

func (repository *fakeRepository) ReleaseTurn(_ context.Context, sessionID, lease string) error {
	if session := repository.sessions[sessionID]; session != nil && session.Lease == lease {
		session.Lease, session.LeaseUntil = "", time.Time{}
		repository.releasedTurns++
	}
	return nil
}

func (repository *fakeRepository) ClaimChatConfirmation(_ context.Context, slug, token, proposalID string, now time.Time) (TurnClaim, error) {
	session, err := repository.LoadSession(context.Background(), slug, token, now)
	if err != nil || session == nil {
		return TurnClaim{Status: "unavailable"}, err
	}
	if session.Receipt != "" {
		return TurnClaim{Status: "confirmed", State: session.State()}, nil
	}
	if session.Pending == nil || session.Pending.ID != proposalID {
		return TurnClaim{Status: "stale"}, nil
	}
	if !session.Pending.ExpiresAt.After(now) {
		return TurnClaim{Status: "expired"}, nil
	}
	lease := uuid.NewString()
	session.Lease, session.LeaseUntil = lease, now.Add(LeaseLifetime)
	repository.sessions[session.ID] = session
	return TurnClaim{Status: "claimed", Session: session, Lease: lease}, nil
}

func (repository *fakeRepository) CompleteChatConfirmation(_ context.Context, sessionID, lease, appointmentID string) (*ChatSession, error) {
	session := repository.sessions[sessionID]
	if session == nil || session.Lease != lease {
		return nil, nil
	}
	session.Receipt, session.Pending, session.Lease, session.LeaseUntil = appointmentID, nil, "", time.Time{}
	copy := cloneSession(*session)
	return &copy, nil
}

func (repository *fakeRepository) RejectChatProposal(_ context.Context, slug, token, proposalID string, now time.Time) (ChatState, string, error) {
	session, err := repository.LoadSession(context.Background(), slug, token, now)
	if err != nil || session == nil {
		return ChatState{}, "unavailable", err
	}
	if session.Pending == nil || session.Pending.ID != proposalID {
		return ChatState{}, "stale", nil
	}
	session.Pending = nil
	repository.sessions[session.ID] = session
	return session.State(), "saved", nil
}

func (repository *fakeRepository) ReserveModelCall(context.Context, string, int, time.Time) (bool, error) {
	repository.reserveCalls++
	return repository.reserveAllowed, nil
}

func (repository *fakeRepository) SaveExternalProposal(_ context.Context, _ string, proposal ExternalProposal, tokenHash string, expiry time.Time) error {
	repository.proposals[proposal.ID] = fakeProposal{tokenHash: tokenHash, proposal: proposal, expiresAt: expiry}
	return nil
}

func (repository *fakeRepository) ClaimExternalProposal(_ context.Context, slug, proposalID, tokenHash string, now time.Time) (ProposalClaim, error) {
	proposal, found := repository.proposals[proposalID]
	if !found || slug != repository.business.Slug || proposal.tokenHash != tokenHash {
		return ProposalClaim{Status: "invalid"}, nil
	}
	if proposal.appointmentID != "" {
		return ProposalClaim{Status: "confirmed", AppointmentID: proposal.appointmentID}, nil
	}
	if !proposal.expiresAt.After(now) {
		return ProposalClaim{Status: "expired"}, nil
	}
	if proposal.lease != "" {
		return ProposalClaim{Status: "busy"}, nil
	}
	proposal.lease = uuid.NewString()
	repository.proposals[proposalID] = proposal
	return ProposalClaim{Status: "claimed", Proposal: proposal.proposal, Lease: proposal.lease}, nil
}

func (repository *fakeRepository) CompleteExternalProposal(_ context.Context, proposalID, lease, appointmentID string) (bool, error) {
	proposal, found := repository.proposals[proposalID]
	if !found || proposal.lease != lease {
		return false, nil
	}
	proposal.appointmentID, proposal.lease = appointmentID, ""
	repository.proposals[proposalID] = proposal
	return true, nil
}

func (repository *fakeRepository) ReleaseExternalProposal(_ context.Context, proposalID, lease string) error {
	proposal, found := repository.proposals[proposalID]
	if found && proposal.lease == lease {
		proposal.lease = ""
		repository.proposals[proposalID] = proposal
		repository.releasedProposals++
	}
	return nil
}

func (repository *fakeRepository) PurgeExpiredProposals(_ context.Context, now time.Time) error {
	repository.purgedProposals++
	repository.purgeTime = now
	return nil
}
func (repository *fakeRepository) PurgeExpiredSessions(_ context.Context, now time.Time) error {
	repository.purgedSessions++
	repository.purgeTime = now
	return nil
}

type fakeBookings struct {
	catalog     BookingCatalog
	slots       []AvailableSlot
	createErr   error
	createCalls int
	created     BookingInput
}

func (bookings *fakeBookings) Catalog(context.Context, string) (BookingCatalog, error) {
	return bookings.catalog, nil
}
func (bookings *fakeBookings) Availability(context.Context, string, SlotInput) ([]AvailableSlot, error) {
	return bookings.slots, nil
}
func (bookings *fakeBookings) Create(_ context.Context, _ string, input BookingInput, _ string) (BookingResult, error) {
	bookings.createCalls++
	bookings.created = input
	if bookings.createErr != nil {
		return BookingResult{}, bookings.createErr
	}
	return BookingResult{ID: "bb555d60-c95f-4576-9931-58fe8ea5bf77", Status: "confirmed"}, nil
}

type fakeModel struct {
	response ModelResponse
	err      error
	calls    int
}

func (model *fakeModel) ConverseStream(_ context.Context, _ ModelRequest, callbacks StreamCallbacks) (ModelResponse, error) {
	model.calls++
	if model.err != nil {
		return ModelResponse{}, model.err
	}
	if model.response.Text != "" && callbacks.OnTextDelta != nil {
		callbacks.OnTextDelta(model.response.Text)
	}
	return model.response, nil
}

func sampleBookingCatalog() BookingCatalog {
	serviceID, staffID := "131ef2e8-91a1-4f6d-8fe2-5c3dc2a5c2da", "3991113f-7e0b-42af-8532-cf4d2b199acb"
	return BookingCatalog{Name: "Sample Business", Currency: "NGN", TimeZone: "Africa/Lagos", BookingLocation: "customer_address", CancelHours: 24,
		Services: []BookingService{{ID: serviceID, Name: "Standard cleaning", Description: "Home cleaning", DurationMinutes: 60, PriceMinor: 3000000, Quote: stringsOf('a', 64), StaffIDs: []string{staffID}}},
		Staff:    []BookingStaff{{ID: staffID, Name: "Ada"}}}
}

func sampleProposalInput() ProposalInput {
	catalog := sampleBookingCatalog()
	return ProposalInput{Key: uuid.NewString(), ServiceID: catalog.Services[0].ID, StaffID: catalog.Staff[0].ID,
		Date: "2026-10-20", Time: "13:00", Quote: catalog.Services[0].Quote, Name: "John Doe", Email: "john@example.com",
		Phone: "08012345678", Address: "Ikeja, Lagos", Consent: false}
}

func cloneSession(session ChatSession) ChatSession {
	encoded, _ := json.Marshal(session)
	var result ChatSession
	_ = json.Unmarshal(encoded, &result)
	return result
}

func stringsOf(char byte, length int) string {
	result := make([]byte, length)
	for i := range result {
		result[i] = char
	}
	return string(result)
}
