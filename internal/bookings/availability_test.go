package bookings

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLocalInstantRejectsSkippedAndRepeatedClockTimes(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []struct {
		date  string
		clock string
	}{
		{date: "2026-03-08", clock: "02:30"},
		{date: "2026-11-01", clock: "01:30"},
	} {
		if _, err := localInstant(input.date, input.clock, location); err == nil {
			t.Errorf("localInstant(%q, %q) accepted a skipped or ambiguous local time", input.date, input.clock)
		}
	}
}

func TestLocalInstantResolvesLagosTime(t *testing.T) {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		t.Fatal(err)
	}
	got, err := localInstant("2026-10-20", "09:30", location)
	if err != nil {
		t.Fatal(err)
	}
	if got.UTC().Format(time.RFC3339) != "2026-10-20T08:30:00Z" {
		t.Fatalf("localInstant() = %s, want 2026-10-20T08:30:00Z", got.UTC().Format(time.RFC3339))
	}
}

func TestBookingInputValidation(t *testing.T) {
	base := BookingInput{Key: uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		ServiceID: uuid.MustParse("22222222-2222-4222-8222-222222222222"), StaffID: uuid.MustParse("33333333-3333-4333-8333-333333333333"),
		Date: "2026-10-20", Time: "09:00", Quote: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Name: "Jane Doe", Email: "jane@example.com", Phone: "", Address: "12 Main Street", Consent: true}
	if err := validateBooking(base); err != nil {
		t.Fatalf("valid booking rejected: %v", err)
	}
	base.Consent = false
	if err := validateBooking(base); err == nil {
		t.Fatal("booking without customer notification consent was accepted")
	}
}

func TestQuoteMatchesPublicBookingContract(t *testing.T) {
	s := &serviceRecord{ID: uuid.MustParse("22222222-2222-4222-8222-222222222222"), Name: "Standard cleaning",
		DurationMinutes: 60, PriceMinor: 1500000, Active: true}
	address := "20 Business Road"
	w := &workspace{Currency: "NGN", TimeZone: "Africa/Lagos", BookingLocation: "both", BusinessAddress: &address}
	if got, want := quoteFor(s, w), "96f62182e31ed9b3d5e5bf5c1595bac75605ff50d6599d90bf677b23a6ae5133"; got != want {
		t.Fatalf("quoteFor() = %s, want %s", got, want)
	}
}
