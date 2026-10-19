package httpx

import (
	"io"
	"log/slog"
	"testing"

	"github.com/danielgtaylor/huma/v2"
)

func TestNewErrorRetainsValidationDetails(t *testing.T) {
	Install(slog.New(slog.NewTextHandler(io.Discard, nil)))

	problem, ok := huma.NewError(422, "The request is invalid.", &huma.ErrorDetail{
		Location: "body.email",
		Message:  "must be a valid email address",
		Value:    "invalid",
	}).(*Error)
	if !ok {
		t.Fatal("huma.NewError did not return the API problem type")
	}
	if problem.Code != "validation_failed" {
		t.Fatalf("problem code = %q, want validation_failed", problem.Code)
	}
	if len(problem.Errors) != 1 || problem.Errors[0].Location != "body.email" {
		t.Fatalf("validation details = %#v, want the original field detail", problem.Errors)
	}
}

func TestNewErrorHidesInternalCauses(t *testing.T) {
	Install(slog.New(slog.NewTextHandler(io.Discard, nil)))

	problem, ok := huma.NewError(500, "database failure", &huma.ErrorDetail{
		Message: "sensitive failure details",
	}).(*Error)
	if !ok {
		t.Fatal("huma.NewError did not return the API problem type")
	}
	if problem.Detail != internalMessage || problem.Code != "internal" || len(problem.Errors) != 0 {
		t.Fatalf("internal problem leaked its cause: %#v", problem)
	}
}
