package bookings

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// These policies do not perform I/O. Booking transactions call them before writes.
func validateBooking(v BookingInput) error {
	if v.Key == uuid.Nil || v.ServiceID == uuid.Nil || v.StaffID == uuid.Nil || !validDate(v.Date) || !validClock(v.Time) || !v.Consent || !quotePattern.MatchString(v.Quote) {
		return fmt.Errorf("%w: check booking details", ErrInvalid)
	}
	v.Name = strings.TrimSpace(v.Name)
	if len([]rune(v.Name)) < 2 || len([]rune(v.Name)) > 100 {
		return fmt.Errorf("%w: enter a name between 2 and 100 characters", ErrInvalid)
	}
	v.Email = strings.ToLower(strings.TrimSpace(v.Email))
	address, err := mail.ParseAddress(v.Email)
	if err != nil || address.Address != v.Email || len(v.Email) > 254 {
		return fmt.Errorf("%w: enter a valid email address", ErrInvalid)
	}
	if len([]rune(strings.TrimSpace(v.Phone))) > 40 {
		return fmt.Errorf("%w: phone number is too long", ErrInvalid)
	}
	if v.Address != "" && (len([]rune(strings.TrimSpace(v.Address))) < 3 || len([]rune(v.Address)) > 500) {
		return fmt.Errorf("%w: enter a valid service address", ErrInvalid)
	}
	if v.ServiceLocation != "" && v.ServiceLocation != "customer_address" && v.ServiceLocation != "business_address" {
		return fmt.Errorf("%w: choose a valid appointment location", ErrInvalid)
	}
	return nil
}

var quotePattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func validSlug(v string) bool { return len(v) >= 3 && len(v) <= 80 && slugPattern.MatchString(v) }
func validDate(v string) bool {
	if !datePattern.MatchString(v) {
		return false
	}
	_, err := time.Parse("2006-01-02", v)
	return err == nil
}
func validClock(v string) bool { return clockPattern.MatchString(v) }
func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func firstNonempty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

type quotePayload struct {
	ID              uuid.UUID `json:"id"`
	Name            string    `json:"name"`
	Price           int       `json:"price"`
	Duration        int       `json:"duration"`
	Before          int       `json:"before"`
	After           int       `json:"after"`
	Active          bool      `json:"active"`
	Currency        string    `json:"currency"`
	Zone            string    `json:"zone"`
	BookingLocation string    `json:"bookingLocation"`
	ServiceArea     *string   `json:"serviceArea"`
	BusinessAddress *string   `json:"businessAddress"`
}

func quoteFor(s *serviceRecord, w *workspace) string {
	body, _ := json.Marshal(quotePayload{ID: s.ID, Name: s.Name, Price: s.PriceMinor, Duration: s.DurationMinutes, Before: s.BufferBeforeMinutes,
		After: s.BufferAfterMinutes, Active: s.Active, Currency: w.Currency, Zone: w.TimeZone, BookingLocation: w.BookingLocation,
		ServiceArea: w.ServiceArea, BusinessAddress: w.BusinessAddress})
	return hash(string(body))
}

type bookingFingerprintInput struct {
	Key             uuid.UUID `json:"key"`
	ServiceID       uuid.UUID `json:"serviceId"`
	StaffID         uuid.UUID `json:"staffId"`
	Date            string    `json:"date"`
	Time            string    `json:"time"`
	ServiceLocation string    `json:"serviceLocation,omitempty"`
	Quote           string    `json:"quote"`
	Name            string    `json:"name"`
	Email           string    `json:"email"`
	Phone           string    `json:"phone"`
	Address         string    `json:"address,omitempty"`
	Consent         bool      `json:"consent"`
}

func requestFingerprint(v BookingInput, location, address string, userID uuid.UUID) (string, error) {
	actor := "public"
	if userID != uuid.Nil {
		actor = userID.String()
	}
	// Keep the private idempotency fingerprint independent of the public REST
	// field names. Existing keys must hash the same booking details after an API
	// contract casing change.
	booking := bookingFingerprintInput{
		Key: v.Key, ServiceID: v.ServiceID, StaffID: v.StaffID, Date: v.Date, Time: v.Time,
		ServiceLocation: v.ServiceLocation, Quote: v.Quote, Name: v.Name, Email: v.Email,
		Phone: v.Phone, Address: v.Address, Consent: v.Consent,
	}
	canonical := struct {
		Version  int                     `json:"schema"`
		Booking  bookingFingerprintInput `json:"booking"`
		Location string                  `json:"serviceLocation"`
		Address  string                  `json:"address"`
		Actor    string                  `json:"actor"`
	}{1, booking, location, address, actor}
	b, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("fingerprint booking: %w", err)
	}
	return hash(string(b)), nil
}

func addDays(date string, days int) (string, error) {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return "", fmt.Errorf("parse booking date: %w", err)
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02"), nil
}
func mustLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}
func formatMinor(amount int) string { return fmt.Sprintf("%d.%02d", amount/100, amount%100) }

func jsonUnmarshalSchedule(raw []byte, target *staffSchedule) error {
	if err := json.Unmarshal(raw, target); err != nil {
		return err
	}
	if !validClock(target.Start) || !validClock(target.End) {
		return errors.New("schedule is malformed")
	}
	if (target.BreakStart == "") != (target.BreakEnd == "") || (target.BreakStart != "" && (!validClock(target.BreakStart) || !validClock(target.BreakEnd))) {
		return errors.New("schedule break is malformed")
	}
	for _, day := range target.Days {
		if day < 0 || day > 6 {
			return errors.New("schedule weekdays are malformed")
		}
	}
	return nil
}
