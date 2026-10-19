// Package bookings owns public booking, appointment management, and customer
// reads. Its service methods are shared by the HTTP API and the receptionist
// confirmation flow so availability and booking rules have one implementation.
package bookings

import (
	"time"

	"github.com/google/uuid"
)

const (
	ChannelForm         = "form"
	ChannelReceptionist = "receptionist"
)

// Scope is either a published public page (Slug) or a signed-in workspace.
// Owner access is always checked from the workspace membership table.
type Scope struct {
	Slug        string
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
}

func PublicScope(slug string) Scope { return Scope{Slug: slug} }

func OwnerScope(userID, workspaceID uuid.UUID) Scope {
	return Scope{UserID: userID, WorkspaceID: workspaceID}
}

type SlotInput struct {
	ServiceID uuid.UUID `json:"service_id"`
	StaffID   uuid.UUID `json:"staff_id,omitempty"`
	Date      string    `json:"date"`
}

type BookingInput struct {
	Key             uuid.UUID `json:"key"`
	ServiceID       uuid.UUID `json:"service_id"`
	StaffID         uuid.UUID `json:"staff_id"`
	Date            string    `json:"date"`
	Time            string    `json:"time"`
	ServiceLocation string    `json:"service_location,omitempty"`
	Quote           string    `json:"quote"`
	Name            string    `json:"name"`
	Email           string    `json:"email"`
	Phone           string    `json:"phone"`
	Address         string    `json:"address,omitempty"`
	Consent         bool      `json:"consent"`
}

type CreateInput struct {
	Scope   Scope
	Booking BookingInput
	Origin  string
	Channel string
}

type ChangeInput struct {
	Key     uuid.UUID `json:"key"`
	Version int       `json:"version"`
	Action  string    `json:"action"`
	Date    string    `json:"date,omitempty"`
	Time    string    `json:"time,omitempty"`
	StaffID uuid.UUID `json:"staff_id,omitempty"`
}

// BookingPolicy contains the workspace-level rules used to calculate
// availability and how far ahead a customer may book.
type BookingPolicy struct {
	LeadHours   int `json:"lead_hours"`
	HorizonDays int `json:"horizon_days"`
	CancelHours int `json:"cancel_hours"`
	SlotMinutes int `json:"slot_minutes"`
}

type ReminderPolicy struct {
	Enabled bool `json:"enabled"`
}

type TimeOffInput struct {
	StaffID uuid.UUID `json:"staff_id"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Reason  string    `json:"reason"`
}

type TimeOff struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	StaffID     uuid.UUID `json:"staff_id"`
	StaffName   string    `json:"staff_name"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	Reason      string    `json:"reason"`
}

type Actor struct {
	UserID uuid.UUID
	Token  string
}

type Catalog struct {
	ID              uuid.UUID      `json:"id"`
	Name            string         `json:"name"`
	Logo            *string        `json:"logo"`
	Slug            string         `json:"slug"`
	ContactEmail    *string        `json:"contact_email"`
	Phone           string         `json:"phone"`
	ServiceArea     *string        `json:"service_area"`
	BusinessAddress *string        `json:"business_address"`
	BookingLocation string         `json:"booking_location"`
	TimeZone        string         `json:"time_zone"`
	Currency        string         `json:"currency"`
	LeadHours       int            `json:"lead_hours"`
	HorizonDays     int            `json:"horizon_days"`
	CancelHours     int            `json:"cancel_hours"`
	SlotMinutes     int            `json:"slot_minutes"`
	Today           string         `json:"today"`
	MaxDate         string         `json:"max_date"`
	Services        []CatalogEntry `json:"services"`
	Staff           []CatalogStaff `json:"staff"`
}

type CatalogEntry struct {
	ID              uuid.UUID `json:"id"`
	Name            string    `json:"name"`
	Description     *string   `json:"description"`
	DurationMinutes int       `json:"duration_minutes"`
	PriceMinor      int       `json:"price_minor"`
	Quote           string    `json:"quote"`
	StaffIDs        []string  `json:"staff_ids"`
}

type CatalogStaff struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type Slot struct {
	Time     string    `json:"time"`
	StaffID  uuid.UUID `json:"staff_id"`
	StartsAt time.Time `json:"starts_at"`
}

type BookingView struct {
	WorkspaceID   uuid.UUID `json:"workspace_id"`
	ID            uuid.UUID `json:"id"`
	Version       int       `json:"version"`
	Status        string    `json:"status"`
	ServiceID     uuid.UUID `json:"service_id"`
	StaffID       uuid.UUID `json:"staff_id"`
	ServiceName   string    `json:"service_name"`
	StaffName     string    `json:"staff_name"`
	StartsAt      time.Time `json:"starts_at"`
	EndsAt        time.Time `json:"ends_at"`
	TimeZone      string    `json:"time_zone"`
	PriceMinor    int       `json:"price_minor"`
	Currency      string    `json:"currency"`
	Duration      int       `json:"duration_minutes"`
	Name          string    `json:"name"`
	Email         string    `json:"email"`
	Phone         string    `json:"phone"`
	Address       string    `json:"address"`
	Business      string    `json:"business"`
	ContactEmail  *string   `json:"contact_email"`
	BusinessPhone string    `json:"business_phone"`
	CanChange     bool      `json:"can_change"`
	CancelHours   int       `json:"cancel_hours"`
	Slug          string    `json:"slug"`
}

type Appointment struct {
	ID                  uuid.UUID `json:"id"`
	WorkspaceID         uuid.UUID `json:"workspace_id"`
	CustomerID          uuid.UUID `json:"customer_id"`
	ServiceID           uuid.UUID `json:"service_id"`
	StaffID             uuid.UUID `json:"staff_id"`
	Status              string    `json:"status"`
	StartsAt            time.Time `json:"starts_at"`
	EndsAt              time.Time `json:"ends_at"`
	ServiceName         string    `json:"service_name"`
	DurationMinutes     int       `json:"duration_minutes"`
	BufferBeforeMinutes int       `json:"buffer_before_minutes"`
	BufferAfterMinutes  int       `json:"buffer_after_minutes"`
	PriceMinor          int       `json:"price_minor"`
	Currency            string    `json:"currency"`
	ServiceAddress      *string   `json:"service_address"`
	CustomerName        string    `json:"customer_name"`
	CustomerEmail       string    `json:"customer_email"`
	CustomerPhone       string    `json:"customer_phone"`
	NotificationConsent bool      `json:"notification_consent"`
	TimeZone            string    `json:"time_zone"`
	Source              string    `json:"source"`
	Version             int       `json:"version"`
	IdempotencyKey      *string   `json:"-"`
	CreatedAt           time.Time `json:"created_at"`
	StaffName           string    `json:"staff_name"`
}

type Customer struct {
	AppointmentCount int       `json:"appointment_count"`
	ID               uuid.UUID `json:"id"`
	WorkspaceID      uuid.UUID `json:"workspace_id"`
	Name             string    `json:"name"`
	Email            *string   `json:"email"`
	Phone            *string   `json:"phone"`
	CreatedAt        time.Time `json:"created_at"`
}

type CustomerDetail struct {
	NextCursor string `json:"next_cursor"`
	Customer
	Appointments []Appointment `json:"appointments"`
}
