package receptionist

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/danztee/welio/internal/bookings"
	"github.com/danztee/welio/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const chatCookiePrefix = "welio-chat-"

type chatAction struct {
	Action         string `json:"action"`
	ConversationID string `json:"conversationId,omitempty"`
	Key            string `json:"key,omitempty"`
	Text           string `json:"text,omitempty"`
	ProposalID     string `json:"proposalId,omitempty"`
	Consent        bool   `json:"consent,omitempty"`
}

type streamEvent struct {
	Type     string   `json:"type"`
	Text     string   `json:"text,omitempty"`
	Activity Activity `json:"activity,omitempty"`
	Data     any      `json:"data,omitempty"`
	Error    string   `json:"error,omitempty"`
}

func (service *Service) serveChat(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	if !validSlug(slug) {
		writeChatJSON(w, http.StatusNotFound, map[string]any{"error": "This chat is unavailable."})
		return
	}
	if !service.allowedChatOrigin(r.Header.Get("Origin")) {
		writeChatJSON(w, http.StatusForbidden, map[string]any{"error": "This request origin is not allowed."})
		return
	}
	if !service.allowRequest(requestRateKey("chat", slug, requestClientAddress(r)), 120, time.Hour) {
		writeChatFailure(w, ErrRateLimited)
		return
	}
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		writeChatJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "Use application/json."})
		return
	}
	if r.ContentLength > 1<<20 {
		writeChatJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "The request is too large."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The request body could not be read."})
		return
	}
	var action struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(body, &action); err != nil {
		writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The chat request is invalid."})
		return
	}
	ctx := r.Context()
	cookies := chatCookies(r)
	switch action.Action {
	case "list":
		var input struct {
			Action string `json:"action"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The chat request is invalid."})
			return
		}
		conversations, err := service.List(ctx, slug, cookies)
		if err != nil {
			writeChatFailure(w, err)
			return
		}
		writeChatJSON(w, http.StatusOK, conversations)
	case "start":
		var input struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversationId,omitempty"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The chat request is invalid."})
			return
		}
		if !service.allowRequest(requestRateKey("chat-start", slug, requestClientAddress(r)), 10, time.Hour) {
			writeChatFailure(w, ErrRateLimited)
			return
		}
		conversations, err := service.List(ctx, slug, cookies)
		if err != nil {
			writeChatFailure(w, err)
			return
		}
		if len(conversations) > 0 {
			selected := conversations[0]
			if input.ConversationID != "" {
				for _, conversation := range conversations {
					if conversation.ID == input.ConversationID {
						selected = conversation
						break
					}
				}
			}
			token := chatToken(r, selected.ID)
			state, err := service.State(ctx, slug, token)
			if err != nil {
				writeChatFailure(w, err)
				return
			}
			writeChatJSON(w, http.StatusOK, map[string]any{"conversationId": selected.ID, "state": state, "conversations": conversations})
			return
		}
		service.startHTTPChat(w, r, slug, cookies)
	case "new":
		var input struct {
			Action string `json:"action"`
		}
		if err := decodeBody(body, &input); err != nil {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The chat request is invalid."})
			return
		}
		if !service.allowRequest(requestRateKey("chat-start", slug, requestClientAddress(r)), 10, time.Hour) {
			writeChatFailure(w, ErrRateLimited)
			return
		}
		service.startHTTPChat(w, r, slug, cookies)
	case "open", "state":
		var input struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversationId"`
		}
		if err := decodeBody(body, &input); err != nil || !validUUID(input.ConversationID) {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The chat request is invalid."})
			return
		}
		token := chatToken(r, input.ConversationID)
		state, err := service.State(ctx, slug, token)
		if err != nil {
			writeChatFailure(w, err)
			return
		}
		writeChatJSON(w, http.StatusOK, map[string]any{"conversationId": input.ConversationID, "state": state})
	case "message":
		var input struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversationId"`
			Key            string `json:"key"`
			Text           string `json:"text"`
		}
		if err := decodeBody(body, &input); err != nil || !validUUID(input.ConversationID) || !validUUID(input.Key) || strings.TrimSpace(input.Text) == "" || len(input.Text) > 1600 {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "Enter a message of up to 1,600 characters."})
			return
		}
		if !service.allowRequest(requestRateKey("chat-turn", slug, requestClientAddress(r)), 30, time.Hour) {
			writeChatFailure(w, ErrRateLimited)
			return
		}
		token := chatToken(r, input.ConversationID)
		service.streamChatMessage(w, r, slug, token, input.Key, input.Text)
	case "confirm":
		var input struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversationId"`
			ProposalID     string `json:"proposalId"`
			Consent        bool   `json:"consent"`
		}
		if err := decodeBody(body, &input); err != nil || !validUUID(input.ConversationID) || !validUUID(input.ProposalID) {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The confirmation request is invalid."})
			return
		}
		if !service.allowRequest(requestRateKey("chat-confirm", slug, requestClientAddress(r)), 8, time.Hour) {
			writeChatFailure(w, ErrRateLimited)
			return
		}
		if !input.Consent {
			writeChatFailure(w, ErrProposalDenied)
			return
		}
		state, err := service.ConfirmChat(ctx, slug, chatToken(r, input.ConversationID), input.ProposalID, input.Consent)
		if err != nil {
			writeChatFailure(w, err)
			return
		}
		writeChatJSON(w, http.StatusOK, state)
	case "reject":
		var input struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversationId"`
			ProposalID     string `json:"proposalId"`
		}
		if err := decodeBody(body, &input); err != nil || !validUUID(input.ConversationID) || !validUUID(input.ProposalID) {
			writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "The proposal request is invalid."})
			return
		}
		if !service.allowRequest(requestRateKey("chat-confirm", slug, requestClientAddress(r)), 8, time.Hour) {
			writeChatFailure(w, ErrRateLimited)
			return
		}
		state, err := service.RejectChatProposal(ctx, slug, chatToken(r, input.ConversationID), input.ProposalID)
		if err != nil {
			writeChatFailure(w, err)
			return
		}
		writeChatJSON(w, http.StatusOK, state)
	default:
		writeChatJSON(w, http.StatusBadRequest, map[string]any{"error": "This chat action is not supported."})
	}
}

func (service *Service) startHTTPChat(w http.ResponseWriter, r *http.Request, slug string, cookies []SessionCookie) {
	token, state, _, err := service.Start(r.Context(), slug)
	if err != nil {
		writeChatFailure(w, err)
		return
	}
	allCookies := append(append([]SessionCookie{}, cookies...), SessionCookie{ID: "", Token: token})
	conversations, err := service.List(r.Context(), slug, allCookies)
	if err != nil {
		writeChatFailure(w, err)
		return
	}
	var id string
	for _, conversation := range conversations {
		for _, cookie := range allCookies {
			if cookie.Token == token && cookie.ID == "" {
				id = conversation.ID
			}
		}
	}
	if id == "" && len(conversations) > 0 {
		id = conversations[0].ID
	}
	if id == "" {
		writeChatFailure(w, ErrUnavailable)
		return
	}
	setChatCookie(w, slug, id, token, service.Config.ChatSecure)
	writeChatJSON(w, http.StatusCreated, map[string]any{"conversationId": id, "state": state, "conversations": conversations})
}

func (service *Service) streamChatMessage(w http.ResponseWriter, r *http.Request, slug, token, key, text string) {
	w.Header().Set("Cache-Control", "no-store, no-transform")
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	flusher, canFlush := w.(http.Flusher)
	if canFlush {
		flusher.Flush()
	}
	sink := &httpStreamSink{writer: w, flusher: flusher, canFlush: canFlush}
	state, err := service.Message(r.Context(), slug, token, key, text, sink)
	if err != nil {
		sink.event(streamEvent{Type: "error", Error: chatErrorMessage(err)})
		return
	}
	sink.event(streamEvent{Type: "complete", Data: state})
}

type httpStreamSink struct {
	writer       http.ResponseWriter
	flusher      http.Flusher
	canFlush     bool
	disconnected bool
}

func (sink *httpStreamSink) TextDelta(text string) {
	sink.event(streamEvent{Type: "delta", Text: text})
}
func (sink *httpStreamSink) Activity(activity Activity) {
	sink.event(streamEvent{Type: "activity", Activity: activity})
}
func (sink *httpStreamSink) event(event streamEvent) {
	if sink.disconnected {
		return
	}
	data, err := json.Marshal(event)
	if err != nil {
		sink.disconnected = true
		return
	}
	if _, err := sink.writer.Write(append(data, '\n')); err != nil {
		sink.disconnected = true
		return
	}
	if sink.canFlush {
		sink.flusher.Flush()
	}
}

func chatCookies(request *http.Request) []SessionCookie {
	cookies := make([]SessionCookie, 0)
	for _, cookie := range request.Cookies() {
		if !strings.HasPrefix(cookie.Name, chatCookiePrefix) {
			continue
		}
		id := strings.TrimPrefix(cookie.Name, chatCookiePrefix)
		if validUUID(id) && cookie.Value != "" {
			cookies = append(cookies, SessionCookie{ID: id, Token: cookie.Value})
		}
	}
	return cookies
}

func chatToken(request *http.Request, conversationID string) string {
	if !validUUID(conversationID) {
		return ""
	}
	cookie, err := request.Cookie(chatCookiePrefix + conversationID)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func setChatCookie(w http.ResponseWriter, slug, id, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: chatCookiePrefix + id, Value: token, Path: "/api/chat/" + slug,
		MaxAge: int(ChatSessionLifetime.Seconds()), Expires: time.Now().Add(ChatSessionLifetime),
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func writeChatJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeChatFailure(w http.ResponseWriter, err error) {
	status := http.StatusServiceUnavailable
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, bookings.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrExpired):
		status = http.StatusGone
	case errors.Is(err, ErrInvalid), errors.Is(err, bookings.ErrInvalid):
		status = http.StatusUnprocessableEntity
	case errors.Is(err, ErrBusy), errors.Is(err, ErrStale), errors.Is(err, bookings.ErrConflict):
		status = http.StatusConflict
	case errors.Is(err, ErrRateLimited):
		status = http.StatusTooManyRequests
	case errors.Is(err, ErrProposalDenied), errors.Is(err, bookings.ErrForbidden):
		status = http.StatusForbidden
	case errors.Is(err, ErrUnavailable), errors.Is(err, bookings.ErrUnavailable):
		status = http.StatusServiceUnavailable
	}
	writeChatJSON(w, status, map[string]any{"error": chatErrorMessage(err)})
}

func chatErrorMessage(err error) string {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, bookings.ErrNotFound):
		return "This chat is unavailable. Start a new conversation."
	case errors.Is(err, ErrExpired):
		return "This proposal expired. Ask the receptionist for a fresh one."
	case errors.Is(err, ErrInvalid), errors.Is(err, bookings.ErrInvalid):
		return safePublicError(err, "Check the details and try again.")
	case errors.Is(err, ErrBusy):
		return "A request is still in progress. Please wait and retry."
	case errors.Is(err, ErrStale):
		return "That proposal is no longer current. Review a new proposal."
	case errors.Is(err, ErrRateLimited):
		return "The receptionist has reached today's usage limit. Please use the booking form."
	case errors.Is(err, ErrProposalDenied):
		return "Confirm only after you approve the booking details and agree to booking emails."
	case errors.Is(err, ErrUnavailable), errors.Is(err, bookings.ErrUnavailable):
		return "The receptionist is temporarily unavailable. Please use the booking form."
	default:
		return "The receptionist could not respond. Please retry or use the booking form."
	}
}

func safePublicError(err error, fallback string) string {
	message := strings.TrimSpace(err.Error())
	if message == "" || strings.Contains(strings.ToLower(message), "sql") || strings.Contains(strings.ToLower(message), "postgres") {
		return fallback
	}
	if len(message) > 240 {
		return fallback
	}
	return message
}

func decodeBody(body []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request contains trailing JSON")
	}
	return nil
}

func validUUID(value string) bool { _, err := uuid.Parse(value); return err == nil }

func (service *Service) allowedChatOrigin(origin string) bool {
	if strings.TrimSpace(origin) == "" {
		return true
	}
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return false
	}
	origins := service.Config.ChatOrigins
	if len(origins) == 0 && service.Config.AppOrigin != "" {
		origins = []string{service.Config.AppOrigin}
	}
	for _, allowed := range origins {
		if normalized == normalizeOrigin(allowed) {
			return true
		}
	}
	return false
}

func requestRateKey(kind, slug, remoteAddress string) string {
	host := remoteAddress
	if parsed, _, err := net.SplitHostPort(remoteAddress); err == nil {
		host = parsed
	}
	return kind + ":" + slug + ":" + hashToken(host)
}

func requestClientAddress(request *http.Request) string {
	if address := httpx.RequestMetaFrom(request.Context()).IP; address != "" {
		return address
	}
	return request.RemoteAddr
}
