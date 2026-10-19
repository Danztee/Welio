// Package httpx provides shared HTTP middleware and error responses.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

type Error struct {
	Status    int                 `json:"status"`
	Title     string              `json:"title"`
	Detail    string              `json:"detail,omitempty"`
	Code      string              `json:"code,omitempty"`
	RequestID string              `json:"request_id,omitempty"`
	Errors    []*huma.ErrorDetail `json:"errors,omitempty"`
}

func (e *Error) Error() string  { return e.Detail }
func (e *Error) GetStatus() int { return e.Status }
func (e *Error) ContentType(contentType string) string {
	if contentType == "application/json" {
		return "application/problem+json"
	}
	return contentType
}

func E(status int, code, detail string) *Error {
	return &Error{Status: status, Title: http.StatusText(status), Code: code, Detail: detail}
}

const internalMessage = "Something went wrong on our side. Quote the request id if you contact support."

func Install(log *slog.Logger) {
	huma.NewError = func(status int, message string, causes ...error) huma.StatusError {
		err := &Error{Status: status, Title: http.StatusText(status), Detail: message}
		if status >= http.StatusInternalServerError {
			for _, cause := range causes {
				log.Error("internal HTTP error", "status", status, "err", cause)
			}
			err.Code, err.Detail = "internal", internalMessage
			return err
		}
		for _, cause := range causes {
			if cause == nil {
				continue
			}
			var detailer huma.ErrorDetailer
			if errors.As(cause, &detailer) {
				err.Errors = append(err.Errors, detailer.ErrorDetail())
				continue
			}
			err.Errors = append(err.Errors, &huma.ErrorDetail{Message: cause.Error()})
		}
		if (status == http.StatusBadRequest || status == http.StatusUnprocessableEntity) && len(err.Errors) > 0 {
			err.Code = "validation_failed"
		}
		if status == http.StatusNotFound {
			err.Code = "not_found"
		}
		return err
	}
	huma.NewErrorWithContext = func(ctx huma.Context, status int, message string, causes ...error) huma.StatusError {
		err := huma.NewError(status, message, causes...).(*Error)
		err.RequestID = ctx.Header("X-Request-Id")
		if err.RequestID == "" {
			err.RequestID = RequestIDFrom(ctx.Context())
		}
		return err
	}
}

func Wrap(err error) error {
	if err == nil {
		return nil
	}
	var problem *Error
	if errors.As(err, &problem) {
		return problem
	}
	var status huma.StatusError
	if errors.As(err, &status) {
		return status
	}
	return huma.Error500InternalServerError(internalMessage, err)
}

func WriteProblem(w http.ResponseWriter, r *http.Request, problem *Error) {
	problem.RequestID = RequestIDFrom(r.Context())
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(problem.Status)
	_ = json.NewEncoder(w).Encode(problem)
}

type requestIDKey struct{}

func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}
