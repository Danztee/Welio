package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/bookings"
	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

// RegisterOwnerAPI registers the workspace owner settings and private preview
// endpoints. Preview calls the same model and booking tools as public chat, but
// uses owner-scoped reads and never writes a chat session or an appointment.
func RegisterOwnerAPI(service *Service, api huma.API) {
	registerOwnerSettings(service, api)
	registerOwnerPreview(service, api)
	registerPublicConfig(service, api)
}

func registerOwnerSettings(service *Service, api huma.API) {
	tags := []string{"Receptionist"}
	huma.Register(api, huma.Operation{OperationID: "workspace-receptionist-settings-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceID}/receptionist", Summary: "Read receptionist settings", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
		}) (*struct{ Body settingsDTO }, error) {
			settings, err := service.OwnerSettings(ctx, in.WorkspaceID)
			if err != nil {
				return nil, receptionistAPIError(err)
			}
			return &struct{ Body settingsDTO }{Body: settingsResponse(settings)}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-receptionist-settings-update", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceID}/receptionist", Summary: "Update receptionist settings", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			Body        settingsDTO
		}) (*struct{ Body settingsDTO }, error) {
			if err := requireTrustedWriteOrigin(ctx, service.Config); err != nil {
				return nil, httpx.Wrap(err)
			}
			settings, err := service.SaveOwnerSettings(ctx, in.WorkspaceID, in.Body.settings())
			if err != nil {
				return nil, receptionistAPIError(err)
			}
			return &struct{ Body settingsDTO }{Body: settingsResponse(settings)}, nil
		})
}

func registerOwnerPreview(service *Service, api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "workspace-receptionist-preview", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceID}/receptionist/preview", Summary: "Privately test the receptionist", Tags: []string{"Receptionist"}},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			Body        PreviewInput
		}) (*huma.StreamResponse, error) {
			if err := requireTrustedWriteOrigin(ctx, service.Config); err != nil {
				return nil, httpx.Wrap(err)
			}
			principal, _, err := service.ownerBusiness(ctx, in.WorkspaceID)
			if err != nil {
				return nil, receptionistAPIError(err)
			}
			if !service.allowRequest("receptionist-preview:"+principal.UserID.String(), 20, time.Hour) {
				return nil, receptionistAPIError(ErrRateLimited)
			}
			if err := validatePreviewInput(in.Body); err != nil {
				return nil, receptionistAPIError(err)
			}
			return &huma.StreamResponse{Body: func(streamCtx huma.Context) {
				streamCtx.SetHeader("Content-Type", "application/x-ndjson; charset=utf-8")
				streamCtx.SetHeader("Cache-Control", "no-store, no-transform")
				streamCtx.SetHeader("Referrer-Policy", "no-referrer")
				streamCtx.SetHeader("X-Accel-Buffering", "no")
				streamCtx.SetHeader("X-Content-Type-Options", "nosniff")
				streamCtx.SetStatus(http.StatusOK)
				sink := newHumaStreamSink(streamCtx)
				result, err := service.Preview(streamCtx.Context(), in.WorkspaceID, in.Body, sink)
				if err != nil {
					sink.event(streamEvent{Type: "error", Error: chatErrorMessage(err)})
					return
				}
				sink.event(streamEvent{Type: "complete", Data: result})
			}}, nil
		})
}

func registerPublicConfig(service *Service, api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "public-receptionist-config", Method: http.MethodGet,
		Path: "/v1/book/{slug}/receptionist", Summary: "Read public receptionist status and greeting", Tags: []string{"Public booking"},
		Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Slug string `path:"slug"`
		}) (*struct{ Body PublicConfig }, error) {
			if !service.allowRequest("public-receptionist-config:"+in.Slug, 120, time.Minute) {
				return nil, receptionistAPIError(ErrRateLimited)
			}
			if service.Repository == nil || !validSlug(in.Slug) {
				return nil, receptionistAPIError(ErrNotFound)
			}
			business, err := service.Repository.Business(ctx, in.Slug)
			if err != nil {
				return nil, receptionistAPIError(err)
			}
			greeting := business.Settings.Greeting
			if greeting == "" {
				greeting = defaultSettings().Greeting
			}
			return &struct{ Body PublicConfig }{Body: PublicConfig{
				Enabled:  business.Settings.Enabled,
				Greeting: greeting,
			}}, nil
		})
}

func receptionistAPIError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, bookings.ErrNotFound):
		return httpx.E(http.StatusNotFound, "not_found", "The requested receptionist resource was not found.")
	case errors.Is(err, ErrInvalid), errors.Is(err, bookings.ErrInvalid):
		return httpx.E(http.StatusUnprocessableEntity, "invalid_input", safePublicError(err, "Check the receptionist settings and try again."))
	case errors.Is(err, ErrRateLimited):
		return httpx.E(http.StatusTooManyRequests, "rate_limited", "Too many requests. Please try again later.")
	case errors.Is(err, ErrUnavailable), errors.Is(err, bookings.ErrUnavailable):
		return httpx.E(http.StatusServiceUnavailable, "unavailable", "The receptionist is temporarily unavailable.")
	case errors.Is(err, bookings.ErrForbidden):
		return httpx.E(http.StatusForbidden, "forbidden", "You do not have permission to do that.")
	case errors.Is(err, bookings.ErrConflict):
		return httpx.E(http.StatusConflict, "conflict", safePublicError(err, "The requested booking option is no longer available."))
	default:
		return httpx.Wrap(err)
	}
}

func (service *Service) OwnerSettings(ctx context.Context, workspaceID uuid.UUID) (Settings, error) {
	_, business, err := service.ownerBusiness(ctx, workspaceID)
	if err != nil {
		return Settings{}, err
	}
	return business.Settings, nil
}

func (service *Service) SaveOwnerSettings(ctx context.Context, workspaceID uuid.UUID, settings Settings) (Settings, error) {
	principal, _, err := service.ownerBusiness(ctx, workspaceID)
	if err != nil {
		return Settings{}, err
	}
	repository, ok := service.Repository.(OwnerSettingsRepository)
	if !ok {
		return Settings{}, ErrUnavailable
	}
	settings, err = normalizeSettings(settings)
	if err != nil {
		return Settings{}, err
	}
	if err := repository.SaveSettings(ctx, principal.UserID, workspaceID, settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (service *Service) Preview(ctx context.Context, workspaceID uuid.UUID, input PreviewInput, sink StreamSink) (PreviewResult, error) {
	principal, business, err := service.ownerBusiness(ctx, workspaceID)
	if err != nil {
		return PreviewResult{}, err
	}
	input.Text = strings.TrimSpace(input.Text)
	if err := validatePreviewInput(input); err != nil {
		return PreviewResult{}, err
	}
	if service.Bookings == nil || service.Model == nil || service.DailyCallLimit <= 0 {
		return PreviewResult{}, ErrUnavailable
	}
	messages := make([]ChatMessage, 0, len(input.Turns)*2+1)
	for _, turn := range input.Turns {
		messages = append(messages,
			ChatMessage{Role: "user", Content: []ChatContent{{Type: "text", Text: turn.Text}}},
			ChatMessage{Role: "assistant", Content: []ChatContent{{Type: "text", Text: turn.Reply}}},
		)
	}
	messages = append(messages, ChatMessage{Role: "user", Content: []ChatContent{{Type: "text", Text: input.Text}}})
	result, err := service.runConversation(ctx, business, business.Slug, messages, false,
		&ownerPreviewScope{userID: principal.UserID, workspaceID: workspaceID}, sink)
	if err != nil {
		return PreviewResult{}, err
	}
	if result.pending != nil {
		return PreviewResult{
			Reply:    "Preview booking prepared. In the live chat, the customer would review this card and explicitly confirm it.",
			Proposal: result.pending,
		}, nil
	}
	return PreviewResult{Reply: result.reply}, nil
}

func (service *Service) ownerBusiness(ctx context.Context, workspaceID uuid.UUID) (*auth.Principal, Business, error) {
	principal, err := auth.RequireWorkspace(ctx, "owner")
	if err != nil {
		return nil, Business{}, err
	}
	if principal.WorkspaceID != workspaceID {
		return nil, Business{}, httpx.E(http.StatusForbidden, "workspace_forbidden", "You do not have access to this workspace.")
	}
	repository, ok := service.Repository.(OwnerSettingsRepository)
	if !ok {
		return nil, Business{}, ErrUnavailable
	}
	business, err := repository.BusinessForWorkspace(ctx, principal.UserID, workspaceID)
	return principal, business, err
}

func requireTrustedWriteOrigin(ctx context.Context, config Config) error {
	origin := strings.TrimRight(httpx.RequestMetaFrom(ctx).Origin, "/")
	if origin == "" || origin == "null" {
		return httpx.E(http.StatusForbidden, "origin_not_allowed", "This request origin is not allowed.")
	}
	origins := config.ChatOrigins
	if len(origins) == 0 && config.AppOrigin != "" {
		origins = []string{config.AppOrigin}
	}
	for _, candidate := range origins {
		if strings.TrimRight(candidate, "/") == origin {
			return nil
		}
	}
	return httpx.E(http.StatusForbidden, "origin_not_allowed", "This request origin is not allowed.")
}

func normalizeSettings(settings Settings) (Settings, error) {
	settings.Greeting = strings.TrimSpace(settings.Greeting)
	settings.Instructions = strings.TrimSpace(settings.Instructions)
	if settings.Greeting == "" || utf8.RuneCountInString(settings.Greeting) > 240 || utf8.RuneCountInString(settings.Instructions) > 2400 {
		return Settings{}, fmt.Errorf("%w: greeting is required and settings must fit their length limits", ErrInvalid)
	}
	if len(settings.FAQs) > 12 {
		return Settings{}, fmt.Errorf("%w: add no more than 12 frequently asked questions", ErrInvalid)
	}
	if settings.AllowBooking && !settings.AllowAvailability {
		return Settings{}, fmt.Errorf("%w: enable availability checks before allowing booking requests", ErrInvalid)
	}
	if settings.FAQs == nil {
		settings.FAQs = []FAQ{}
	}
	for index := range settings.FAQs {
		faq := &settings.FAQs[index]
		faq.Question = strings.TrimSpace(faq.Question)
		faq.Answer = strings.TrimSpace(faq.Answer)
		if faq.Question == "" || faq.Answer == "" || utf8.RuneCountInString(faq.Question) > 200 || utf8.RuneCountInString(faq.Answer) > 1000 {
			return Settings{}, fmt.Errorf("%w: each question and answer must be complete and fit its length limit", ErrInvalid)
		}
	}
	return settings, nil
}

func validatePreviewInput(input PreviewInput) error {
	if strings.TrimSpace(input.Text) == "" || utf8.RuneCountInString(input.Text) > 1600 || len(input.Turns) > 5 {
		return fmt.Errorf("%w: enter a message of up to 1,600 characters", ErrInvalid)
	}
	for _, turn := range input.Turns {
		if strings.TrimSpace(turn.Text) == "" || utf8.RuneCountInString(turn.Text) > 1600 || utf8.RuneCountInString(turn.Reply) > 4000 {
			return fmt.Errorf("%w: preview conversation is invalid", ErrInvalid)
		}
	}
	return nil
}

type humaStreamSink struct {
	writer   io.Writer
	flusher  interface{ Flush() }
	disabled bool
}

func newHumaStreamSink(ctx huma.Context) *humaStreamSink {
	writer := ctx.BodyWriter()
	sink := &humaStreamSink{writer: writer}
	if flusher, ok := writer.(interface{ Flush() }); ok {
		sink.flusher = flusher
	}
	return sink
}

func (sink *humaStreamSink) TextDelta(text string) {
	sink.event(streamEvent{Type: "delta", Text: text})
}

func (sink *humaStreamSink) Activity(activity Activity) {
	sink.event(streamEvent{Type: "activity", Activity: activity})
}

func (sink *humaStreamSink) event(event streamEvent) {
	if sink.disabled {
		return
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		sink.disabled = true
		return
	}
	if _, err := sink.writer.Write(append(encoded, '\n')); err != nil {
		sink.disabled = true
		return
	}
	if sink.flusher != nil {
		sink.flusher.Flush()
	}
}
