package bookings

import (
	"testing"

	"github.com/google/uuid"
)

func TestRequestFingerprintKeepsPersistedBookingKeyFormat(t *testing.T) {
	input := BookingInput{
		Key:       uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		ServiceID: uuid.MustParse("22222222-2222-4222-8222-222222222222"),
		StaffID:   uuid.MustParse("33333333-3333-4333-8333-333333333333"),
		Date:      "2026-10-20", Time: "09:00", ServiceLocation: "customer_address",
		Quote: "quote-v1", Name: "Jane Doe", Email: "jane@example.com",
		Address: "Ikeja, Lagos", Consent: true,
	}

	got, err := requestFingerprint(input, "customer_address", "Ikeja, Lagos", uuid.Nil)
	if err != nil {
		t.Fatalf("requestFingerprint() error = %v", err)
	}
	const want = "96bc1cec5c0553d6fd11a2adc32c05e526847074807147d5622108391ab6406c"
	if got != want {
		t.Fatalf("requestFingerprint() = %q, want stable fingerprint %q", got, want)
	}
}
