// Package receptionist implements public AI conversations and the external MCP
// surface for one published Welio workspace at a time.
package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("receptionist resource not found")
	ErrBusy           = errors.New("receptionist operation is already in progress")
	ErrExpired        = errors.New("receptionist resource expired")
	ErrStale          = errors.New("receptionist proposal is no longer current")
	ErrInvalid        = errors.New("receptionist input is invalid")
	ErrRateLimited    = errors.New("receptionist rate limit reached")
	ErrUnavailable    = errors.New("receptionist is unavailable")
	ErrProposalDenied = errors.New("explicit customer approval and email consent are required")
)

const (
	ChatSessionLifetime  = 7 * 24 * time.Hour
	ProposalLifetime     = 10 * time.Minute
	LeaseLifetime        = 2 * time.Minute
	MaxConversationTurns = 20
	MaxConversationBytes = 48_000
	MaxToolRounds        = 5
)

type Settings struct {
	Enabled           bool   `json:"enabled"`
	Greeting          string `json:"greeting" maxLength:"240"`
	Instructions      string `json:"instructions" maxLength:"2400"`
	FAQs              []FAQ  `json:"faqs" maxItems:"12"`
	AllowAvailability bool   `json:"allowAvailability"`
	AllowBooking      bool   `json:"allowBooking"`
}

type FAQ struct {
	Question string `json:"question" maxLength:"200"`
	Answer   string `json:"answer" maxLength:"1000"`
}

type PreviewTurn struct {
	Text  string `json:"text" maxLength:"1600"`
	Reply string `json:"reply" maxLength:"4000"`
}

type PreviewInput struct {
	Text  string        `json:"text" maxLength:"1600"`
	Turns []PreviewTurn `json:"turns" maxItems:"5"`
}

type PreviewResult struct {
	Reply    string    `json:"reply"`
	Proposal *Proposal `json:"proposal"`
}

type PublicConfig struct {
	Enabled  bool   `json:"enabled"`
	Greeting string `json:"greeting"`
}

type Business struct {
	ID              string
	Slug            string
	Name            string
	Currency        string
	TimeZone        string
	BookingLocation string
	BusinessAddress string
	ContactEmail    string
	Phone           string
	CancelHours     int
	Published       bool
	Settings        Settings
}

type ChatContent struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	ToolUseID string          `json:"toolUseId,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	IsError   bool            `json:"isError,omitempty"`
}

type ChatMessage struct {
	Role       string        `json:"role"`
	Content    []ChatContent `json:"content"`
	TrackingID string        `json:"trackingId,omitempty"`
	Metadata   any           `json:"metadata,omitempty"`
}

type ChatTurn struct {
	Key   string `json:"key"`
	Text  string `json:"text"`
	Reply string `json:"reply"`
}

type ChatRetry struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

type ProposalInput struct {
	Key             string `json:"key"`
	ServiceID       string `json:"serviceId"`
	StaffID         string `json:"staffId"`
	Date            string `json:"date"`
	Time            string `json:"time"`
	Quote           string `json:"quote"`
	Name            string `json:"name"`
	Email           string `json:"email"`
	Phone           string `json:"phone"`
	Address         string `json:"address,omitempty"`
	ServiceLocation string `json:"serviceLocation,omitempty"`
	Consent         bool   `json:"consent,omitempty"`
}

type Proposal struct {
	ID          string        `json:"id"`
	ExpiresAt   time.Time     `json:"expiresAt"`
	Input       ProposalInput `json:"input"`
	Service     string        `json:"service"`
	Staff       string        `json:"staff"`
	PriceMinor  int64         `json:"priceMinor"`
	Currency    string        `json:"currency"`
	TimeZone    string        `json:"timeZone"`
	CancelHours int           `json:"cancelHours"`
}

type ExternalProposal struct {
	ID          string        `json:"id"`
	ExpiresAt   time.Time     `json:"expiresAt"`
	Input       ProposalInput `json:"input"`
	Service     string        `json:"service"`
	Staff       string        `json:"staff"`
	PriceMinor  int64         `json:"priceMinor"`
	Currency    string        `json:"currency"`
	TimeZone    string        `json:"timeZone"`
	CancelHours int           `json:"cancelHours"`
}

type ChatState struct {
	Turns   []ChatTurn `json:"turns"`
	Pending *Proposal  `json:"pending"`
	Receipt string     `json:"receipt"`
	Retry   *ChatRetry `json:"retry"`
}

type ChatSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Preview   string    `json:"preview"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ChatSession struct {
	ID          string
	WorkspaceID string
	TokenHash   string
	Messages    []ChatMessage
	Turns       []ChatTurn
	ActiveTurn  *ChatRetry
	Pending     *Proposal
	Receipt     string
	Lease       string
	LeaseUntil  time.Time
	ExpiresAt   time.Time
	UpdatedAt   time.Time
}

func (session ChatSession) State() ChatState {
	return ChatState{Turns: session.Turns, Pending: session.Pending, Receipt: session.Receipt, Retry: session.ActiveTurn}
}

type SessionCookie struct {
	ID    string
	Token string
}

type TurnClaim struct {
	Status  string
	Session *ChatSession
	Lease   string
	State   ChatState
}

type ProposalClaim struct {
	Status        string
	Proposal      ExternalProposal
	AppointmentID string
	Lease         string
}

// Repository holds only durable receptionist session and external proposal state.
// Booking writes deliberately remain behind the shared booking service.
type Repository interface {
	Business(context.Context, string) (Business, error)
	CreateSession(context.Context, string, string, time.Time) (string, error)
	ListSessions(context.Context, string, []SessionCookie, time.Time) ([]ChatSession, error)
	LoadSession(context.Context, string, string, time.Time) (*ChatSession, error)
	ClaimTurn(context.Context, string, string, string, string, time.Time) (TurnClaim, error)
	SaveTurn(context.Context, string, string, []ChatMessage, []ChatTurn, *Proposal) (*ChatSession, error)
	ReleaseTurn(context.Context, string, string) error
	ClaimChatConfirmation(context.Context, string, string, string, time.Time) (TurnClaim, error)
	CompleteChatConfirmation(context.Context, string, string, string) (*ChatSession, error)
	RejectChatProposal(context.Context, string, string, string, time.Time) (ChatState, string, error)
	ReserveModelCall(context.Context, string, int, time.Time) (bool, error)
	SaveExternalProposal(context.Context, string, ExternalProposal, string, time.Time) error
	ClaimExternalProposal(context.Context, string, string, string, time.Time) (ProposalClaim, error)
	CompleteExternalProposal(context.Context, string, string, string) (bool, error)
	ReleaseExternalProposal(context.Context, string, string) error
	PurgeExpiredProposals(context.Context, time.Time) error
	PurgeExpiredSessions(context.Context, time.Time) error
}

// OwnerSettingsRepository loads an unlisted workspace for owner-side setup and
// persists receptionist preferences independently of chat session state.
type OwnerSettingsRepository interface {
	BusinessForWorkspace(context.Context, uuid.UUID, uuid.UUID) (Business, error)
	SaveSettings(context.Context, uuid.UUID, uuid.UUID, Settings) error
}

// OwnerPreviewBookingPort reuses canonical booking reads with an authenticated
// workspace scope, including before the public booking page is published.
type OwnerPreviewBookingPort interface {
	CatalogForOwner(context.Context, uuid.UUID, uuid.UUID) (BookingCatalog, error)
	AvailabilityForOwner(context.Context, uuid.UUID, uuid.UUID, SlotInput) ([]AvailableSlot, error)
}

type ownerPreviewScope struct {
	userID      uuid.UUID
	workspaceID uuid.UUID
}

type ToolDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type ModelRequest struct {
	ModelID   string
	MaxTokens int
	System    string
	Messages  []ChatMessage
	Tools     []ToolDefinition
}

type ModelResponse struct {
	Text      string
	ToolCalls []ToolCall
}

type StreamCallbacks struct {
	OnTextDelta func(string)
}

// BedrockRuntime is implemented by AWSBedrockRuntime using the AWS SDK v2
// ConverseStream API. Implementations forward text deltas as soon as they arrive.
type BedrockRuntime interface {
	ConverseStream(context.Context, ModelRequest, StreamCallbacks) (ModelResponse, error)
}

type Model interface {
	ConverseStream(context.Context, ModelRequest, StreamCallbacks) (ModelResponse, error)
}

type BedrockModel struct {
	Runtime   BedrockRuntime
	ModelID   string
	MaxTokens int
}

func (model BedrockModel) ConverseStream(ctx context.Context, request ModelRequest, callbacks StreamCallbacks) (ModelResponse, error) {
	if model.Runtime == nil || model.ModelID == "" {
		return ModelResponse{}, ErrUnavailable
	}
	request.ModelID = model.ModelID
	if model.MaxTokens > 0 {
		request.MaxTokens = model.MaxTokens
	}
	return model.Runtime.ConverseStream(ctx, request, callbacks)
}

type Activity string

const (
	ActivityThinking             Activity = "thinking"
	ActivityCheckingServices     Activity = "checking_services"
	ActivityCheckingAvailability Activity = "checking_availability"
	ActivityPreparingBooking     Activity = "preparing_booking"
	ActivityWriting              Activity = "writing"
)

type StreamSink interface {
	TextDelta(string)
	Activity(Activity)
}

type BookingCatalog struct {
	Name            string           `json:"name"`
	Currency        string           `json:"currency"`
	TimeZone        string           `json:"timeZone"`
	BookingLocation string           `json:"bookingLocation"`
	BusinessAddress string           `json:"businessAddress,omitempty"`
	CancelHours     int              `json:"cancelHours"`
	Services        []BookingService `json:"services"`
	Staff           []BookingStaff   `json:"staff"`
}

type BookingService struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description,omitempty"`
	DurationMinutes int      `json:"durationMinutes"`
	PriceMinor      int64    `json:"priceMinor"`
	Quote           string   `json:"quote"`
	StaffIDs        []string `json:"staffIds"`
}

type BookingStaff struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SlotInput struct {
	ServiceID string `json:"serviceId"`
	StaffID   string `json:"staffId,omitempty"`
	Date      string `json:"date"`
}

type AvailableSlot struct {
	Time     string `json:"time"`
	StaffID  string `json:"staffId"`
	StartsAt string `json:"startsAt"`
}

type BookingInput struct {
	Key             string
	ServiceID       string
	StaffID         string
	Date            string
	Time            string
	ServiceLocation string
	Quote           string
	Name            string
	Email           string
	Phone           string
	Address         string
	Consent         bool
}

type BookingResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// BookingPort is deliberately narrow and should be adapted to internal/bookings.Service.
// This prevents receptionist code from copying availability or appointment rules.
type BookingPort interface {
	Catalog(context.Context, string) (BookingCatalog, error)
	Availability(context.Context, string, SlotInput) ([]AvailableSlot, error)
	Create(context.Context, string, BookingInput, string) (BookingResult, error)
}

type Config struct {
	BedrockModelID         string
	AppOrigin              string
	ChatOrigins            []string
	ChatSecure             bool
	MCPSecrets             map[string]string
	MCPResourceURL         string
	MCPTokenVerifier       MCPAccessTokenVerifier
	MCPOrigins             []string
	MCPHosts               []string
	MCPConfirmationEnabled bool
}

// MCPAccessTokenVerifier validates OAuth bearer tokens issued for the one
// service-level resource configured by this API deployment.
type MCPAccessTokenVerifier interface {
	VerifyMCPAccessToken(context.Context, string, string) error
}

type RequestLimiter interface {
	Allow(string, int, time.Duration) bool
}
