package receptionist

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/httpx"
)

type Service struct {
	Repository     Repository
	Bookings       BookingPort
	Model          Model
	Config         Config
	Now            func() time.Time
	DailyCallLimit int
	Limiter        RequestLimiter
}

func NewService(repository Repository, bookings BookingPort, model Model, config Config) *Service {
	return &Service{Repository: repository, Bookings: bookings, Model: model, Config: config, Now: time.Now, DailyCallLimit: 200, Limiter: httpx.NewLimiter()}
}

func (service *Service) allowRequest(key string, maximum int, window time.Duration) bool {
	return service.Limiter.Allow(key, maximum, window)
}

func (service *Service) now() time.Time {
	return service.Now().UTC()
}

func (service *Service) Start(ctx context.Context, slug string) (string, ChatState, []ChatSummary, error) {
	business, err := service.publicBusiness(ctx, slug)
	if err != nil {
		return "", ChatState{}, nil, err
	}
	if service.Model == nil || service.Bookings == nil {
		return "", ChatState{}, nil, ErrUnavailable
	}
	token, err := randomToken(32)
	if err != nil {
		return "", ChatState{}, nil, fmt.Errorf("create chat token: %w", err)
	}
	id, err := service.Repository.CreateSession(ctx, business.ID, hashToken(token), service.now().Add(ChatSessionLifetime))
	if err != nil {
		return "", ChatState{}, nil, err
	}
	return token, ChatState{Turns: []ChatTurn{}}, []ChatSummary{{ID: id, Title: business.Name, Preview: "Start a conversation", UpdatedAt: service.now()}}, nil
}

func (service *Service) List(ctx context.Context, slug string, cookies []SessionCookie) ([]ChatSummary, error) {
	business, err := service.publicBusiness(ctx, slug)
	if err != nil {
		return nil, err
	}
	sessions, err := service.Repository.ListSessions(ctx, slug, cookies, service.now())
	if err != nil {
		return nil, err
	}
	result := make([]ChatSummary, 0, len(sessions))
	for _, session := range sessions {
		firstMessage := ""
		if len(session.Turns) > 0 {
			firstMessage = session.Turns[0].Text
		} else if session.ActiveTurn != nil {
			firstMessage = session.ActiveTurn.Text
		}
		title := firstMessage
		if title == "" {
			title = business.Name
		}
		if len(title) > 64 {
			title = strings.TrimSpace(title[:61]) + "…"
		}
		preview := "Start a conversation"
		if len(session.Turns) > 0 {
			preview = session.Turns[len(session.Turns)-1].Reply
		} else if firstMessage != "" {
			preview = "Waiting for a reply…"
		}
		if len(preview) > 120 {
			preview = strings.TrimSpace(preview[:117]) + "…"
		}
		result = append(result, ChatSummary{ID: session.ID, Title: title, Preview: preview, UpdatedAt: session.UpdatedAt})
	}
	return result, nil
}

func (service *Service) State(ctx context.Context, slug, token string) (ChatState, error) {
	if _, err := service.publicBusiness(ctx, slug); err != nil {
		return ChatState{}, err
	}
	session, err := service.Repository.LoadSession(ctx, slug, token, service.now())
	if err != nil {
		return ChatState{}, err
	}
	if session == nil {
		return ChatState{}, ErrNotFound
	}
	return session.State(), nil
}

func (service *Service) Message(ctx context.Context, slug, token, key, text string, sink StreamSink) (ChatState, error) {
	if err := validateChatTurn(key, text); err != nil {
		return ChatState{}, err
	}
	business, err := service.publicBusiness(ctx, slug)
	if err != nil {
		return ChatState{}, err
	}
	if service.Bookings == nil || service.Model == nil {
		return ChatState{}, ErrUnavailable
	}
	if service.DailyCallLimit <= 0 {
		return ChatState{}, ErrUnavailable
	}
	claim, err := service.Repository.ClaimTurn(ctx, slug, token, key, text, service.now())
	if err != nil {
		return ChatState{}, err
	}
	switch claim.Status {
	case "unavailable":
		return ChatState{}, ErrNotFound
	case "message-key-reused":
		return ChatState{}, fmt.Errorf("%w: this message key was used for different text", ErrInvalid)
	case "retry-previous":
		return ChatState{}, fmt.Errorf("%w: retry the previous message before sending another one", ErrInvalid)
	case "busy":
		return ChatState{}, ErrBusy
	case "full":
		return ChatState{}, fmt.Errorf("%w: this conversation is full; start a new chat or use the booking form", ErrInvalid)
	case "cached":
		return claim.State, nil
	case "claimed":
	default:
		return ChatState{}, ErrUnavailable
	}
	session := claim.Session
	if session == nil {
		return ChatState{}, ErrUnavailable
	}
	leaseReleased := false
	defer func() {
		if !leaseReleased {
			_ = service.Repository.ReleaseTurn(context.WithoutCancel(ctx), session.ID, claim.Lease)
		}
	}()

	messages := append([]ChatMessage{}, session.Messages...)
	messages = append(messages, ChatMessage{Role: "user", Content: []ChatContent{{Type: "text", Text: text}}})
	result, err := service.runConversation(ctx, business, slug, messages, false, nil, sink)
	if err != nil {
		return ChatState{}, err
	}
	turns := append(append([]ChatTurn{}, session.Turns...), ChatTurn{Key: key, Text: text, Reply: result.reply})
	saved, err := service.Repository.SaveTurn(ctx, session.ID, claim.Lease, result.messages, turns, result.pending)
	if err != nil {
		return ChatState{}, err
	}
	if saved == nil {
		return ChatState{}, fmt.Errorf("%w: this request expired; reload the conversation", ErrNotFound)
	}
	leaseReleased = true
	err = nil
	return saved.State(), nil
}

func (service *Service) ConfirmChat(ctx context.Context, slug, token, proposalID string, emailConsent bool) (ChatState, error) {
	if !emailConsent {
		return ChatState{}, ErrProposalDenied
	}
	if _, err := service.publicBusiness(ctx, slug); err != nil {
		return ChatState{}, err
	}
	if service.Bookings == nil {
		return ChatState{}, ErrUnavailable
	}
	claim, err := service.Repository.ClaimChatConfirmation(ctx, slug, token, proposalID, service.now())
	if err != nil {
		return ChatState{}, err
	}
	switch claim.Status {
	case "unavailable":
		return ChatState{}, ErrNotFound
	case "busy":
		return ChatState{}, ErrBusy
	case "stale":
		return ChatState{}, ErrStale
	case "expired":
		return ChatState{}, ErrExpired
	case "confirmed":
		return claim.State, nil
	case "claimed":
	default:
		return ChatState{}, ErrUnavailable
	}
	session := claim.Session
	if session == nil || session.Pending == nil {
		return ChatState{}, ErrStale
	}
	input := session.Pending.Input
	booking, err := service.Bookings.Create(ctx, slug, BookingInput{
		Key: input.Key, ServiceID: input.ServiceID, StaffID: input.StaffID, Date: input.Date,
		Time: input.Time, ServiceLocation: input.ServiceLocation, Quote: input.Quote,
		Name: input.Name, Email: input.Email, Phone: input.Phone, Address: input.Address, Consent: true,
	}, service.Config.AppOrigin)
	if err != nil {
		_ = service.Repository.ReleaseTurn(context.WithoutCancel(ctx), session.ID, claim.Lease)
		return ChatState{}, err
	}
	saved, err := service.Repository.CompleteChatConfirmation(ctx, session.ID, claim.Lease, booking.ID)
	if err != nil {
		return ChatState{}, err
	}
	if saved == nil {
		return ChatState{}, fmt.Errorf("%w: retry confirmation to retrieve the booking result", ErrUnavailable)
	}
	return saved.State(), nil
}

func (service *Service) RejectChatProposal(ctx context.Context, slug, token, proposalID string) (ChatState, error) {
	state, status, err := service.Repository.RejectChatProposal(ctx, slug, token, proposalID, service.now())
	if err != nil {
		return ChatState{}, err
	}
	switch status {
	case "unavailable":
		return ChatState{}, ErrNotFound
	case "busy":
		return ChatState{}, ErrBusy
	case "stale":
		return ChatState{}, ErrStale
	}
	return state, nil
}

func (service *Service) ConfirmMCP(ctx context.Context, slug string, input MCPConfirmInput) (BookingResult, error) {
	if !input.CustomerApproved || !input.EmailConsent {
		return BookingResult{}, ErrProposalDenied
	}
	if _, err := service.publicBusiness(ctx, slug); err != nil {
		return BookingResult{}, err
	}
	claim, err := service.Repository.ClaimExternalProposal(ctx, slug, input.ProposalID, hashToken(input.ConfirmationToken), service.now())
	if err != nil {
		return BookingResult{}, err
	}
	switch claim.Status {
	case "invalid":
		return BookingResult{}, ErrNotFound
	case "expired":
		return BookingResult{}, ErrExpired
	case "busy":
		return BookingResult{}, ErrBusy
	case "confirmed":
		return BookingResult{ID: claim.AppointmentID, Status: "confirmed"}, nil
	case "claimed":
	default:
		return BookingResult{}, ErrUnavailable
	}
	proposal := claim.Proposal
	bookingInput := proposal.Input
	result, err := service.Bookings.Create(ctx, slug, BookingInput{
		Key: bookingInput.Key, ServiceID: bookingInput.ServiceID, StaffID: bookingInput.StaffID,
		Date: bookingInput.Date, Time: bookingInput.Time, ServiceLocation: bookingInput.ServiceLocation,
		Quote: bookingInput.Quote, Name: bookingInput.Name, Email: bookingInput.Email,
		Phone: bookingInput.Phone, Address: bookingInput.Address, Consent: true,
	}, service.Config.AppOrigin)
	if err != nil {
		_ = service.Repository.ReleaseExternalProposal(context.WithoutCancel(ctx), input.ProposalID, claim.Lease)
		return BookingResult{}, err
	}
	completed, err := service.Repository.CompleteExternalProposal(ctx, input.ProposalID, claim.Lease, result.ID)
	if err != nil {
		return BookingResult{}, err
	}
	if !completed {
		return BookingResult{}, fmt.Errorf("%w: retry confirmation to retrieve the booking result", ErrUnavailable)
	}
	return result, nil
}

func (service *Service) publicBusiness(ctx context.Context, slug string) (Business, error) {
	if service.Repository == nil || !validSlug(slug) {
		return Business{}, ErrNotFound
	}
	business, err := service.Repository.Business(ctx, slug)
	if err != nil {
		return Business{}, err
	}
	if !business.Published || !business.Settings.Enabled {
		return Business{}, ErrUnavailable
	}
	return business, nil
}

func validateChatTurn(key, text string) error {
	if _, err := uuid.Parse(key); err != nil || strings.TrimSpace(text) == "" || len(text) > 1600 {
		return ErrInvalid
	}
	return nil
}

func validSlug(value string) bool {
	if len(value) < 3 || len(value) > 80 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	previousDash := false
	for _, char := range value {
		if char == '-' {
			if previousDash {
				return false
			}
			previousDash = true
			continue
		}
		if char < 'a' || char > 'z' {
			if char < '0' || char > '9' {
				return false
			}
		}
		previousDash = false
	}
	return true
}

func validateProposalInput(input ProposalInput) error {
	if _, err := uuid.Parse(input.ServiceID); err != nil {
		return fmt.Errorf("%w: choose a valid service", ErrInvalid)
	}
	if _, err := uuid.Parse(input.StaffID); err != nil {
		return fmt.Errorf("%w: choose a valid team member", ErrInvalid)
	}
	if _, err := time.Parse("2006-01-02", input.Date); err != nil {
		return fmt.Errorf("%w: use a calendar date in YYYY-MM-DD format", ErrInvalid)
	}
	if _, err := time.Parse("15:04", input.Time); err != nil {
		return fmt.Errorf("%w: use a time in 24-hour HH:MM format", ErrInvalid)
	}
	if len(input.Name) < 2 || len(input.Name) > 100 || len(input.Phone) > 40 || len(input.Address) > 500 {
		return ErrInvalid
	}
	address, err := mail.ParseAddress(input.Email)
	if err != nil || !strings.EqualFold(address.Address, input.Email) || len(input.Email) > 254 {
		return fmt.Errorf("%w: enter a valid email address", ErrInvalid)
	}
	if len(input.Quote) != 64 || strings.ToLower(input.Quote) != input.Quote {
		return fmt.Errorf("%w: service quote is not valid", ErrInvalid)
	}
	if _, err := hex.DecodeString(input.Quote); err != nil {
		return fmt.Errorf("%w: service quote is not valid", ErrInvalid)
	}
	return nil
}

func randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func hashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}
