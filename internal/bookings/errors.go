package bookings

import (
	"errors"
	"net/http"
	"strings"

	"github.com/danztee/welio/internal/httpx"
)

var (
	ErrInvalid     = errors.New("invalid booking request")
	ErrConflict    = errors.New("booking conflict")
	ErrNotFound    = errors.New("Booking unavailable.")
	ErrForbidden   = errors.New("You do not have permission to manage this booking.")
	ErrUnavailable = errors.New("The booking service is temporarily unavailable.")
)

func problem(err error) error {
	switch {
	case errors.Is(err, ErrInvalid):
		return httpx.E(http.StatusBadRequest, "invalid_booking", detail(err, ErrInvalid, "Check booking details."))
	case errors.Is(err, ErrConflict):
		return httpx.E(http.StatusConflict, "booking_conflict", detail(err, ErrConflict, "That time is no longer available."))
	case errors.Is(err, ErrNotFound):
		return httpx.E(http.StatusNotFound, "booking_not_found", detail(err, ErrNotFound, ErrNotFound.Error()))
	case errors.Is(err, ErrForbidden):
		return httpx.E(http.StatusForbidden, "booking_forbidden", detail(err, ErrForbidden, ErrForbidden.Error()))
	case errors.Is(err, ErrUnavailable):
		return httpx.E(http.StatusServiceUnavailable, "booking_unavailable", detail(err, ErrUnavailable, ErrUnavailable.Error()))
	default:
		return httpx.Wrap(err)
	}
}

func detail(err, sentinel error, fallback string) string {
	message := strings.TrimSpace(strings.TrimPrefix(err.Error(), sentinel.Error()))
	message = strings.TrimSpace(strings.TrimPrefix(message, ":"))
	if message == "" {
		return fallback
	}
	return message
}
