package bookings

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

type Service struct {
	DB             *db.DB
	PublicURL      string
	TrustedOrigins []string
	Limiter        *httpx.Limiter
	Jobs           *river.Client[pgx.Tx]
	EmailQueue     string
	Now            func() time.Time
}

func NewService(database *db.DB, publicURL string, trustedOrigins ...string) *Service {
	return &Service{DB: database, PublicURL: strings.TrimRight(publicURL, "/"), TrustedOrigins: trustedOrigins,
		Limiter: httpx.NewLimiter(), Now: time.Now}
}

type workspace struct {
	ID               uuid.UUID
	Name             string
	Logo             *string
	Slug             string
	TimeZone         string
	Currency         string
	ContactEmail     *string
	ServiceArea      *string
	BusinessAddress  *string
	BookingLocation  string
	Published        bool
	Phone            string
	LeadHours        int
	HorizonDays      int
	CancelHours      int
	SlotMinutes      int
	RemindersEnabled bool
}

type serviceRecord struct {
	ID                  uuid.UUID
	Name                string
	Description         *string
	DurationMinutes     int
	BufferBeforeMinutes int
	BufferAfterMinutes  int
	PriceMinor          int
	Active              bool
}

type staffSchedule struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	BreakStart string `json:"breakStart"`
	BreakEnd   string `json:"breakEnd"`
	Days       []int  `json:"days"`
}

type worker struct {
	ID       uuid.UUID
	Name     string
	Schedule staffSchedule
}

type occupied struct {
	ID                  uuid.UUID
	StaffID             uuid.UUID
	StartsAt            time.Time
	EndsAt              time.Time
	BufferBeforeMinutes int
	BufferAfterMinutes  int
}

func (service *Service) now() time.Time {
	if service.Now != nil {
		return service.Now().UTC()
	}
	return time.Now().UTC()
}

func (service *Service) Catalog(ctx context.Context, slug string) (*Catalog, error) {
	if !validSlug(slug) {
		return nil, fmt.Errorf("%w: invalid business slug", ErrInvalid)
	}
	var result *Catalog
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, PublicScope(slug), false)
		if err != nil {
			return err
		}
		catalog, err := service.catalog(ctx, tx, w)
		if err != nil {
			return err
		}
		result = catalog
		return nil
	})
	return result, err
}

func (service *Service) Availability(ctx context.Context, scope Scope, input SlotInput) ([]Slot, error) {
	if input.ServiceID == uuid.Nil || !validDate(input.Date) {
		return nil, fmt.Errorf("%w: choose a service and valid date", ErrInvalid)
	}
	var slots []Slot
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, scope, false)
		if err != nil {
			return err
		}
		s, err := service.service(ctx, tx, w.ID, input.ServiceID)
		if err != nil {
			return err
		}
		slots, err = service.availability(ctx, tx, w, s, input.Date, input.StaffID, uuid.Nil)
		return err
	})
	return slots, err
}

func (service *Service) Create(ctx context.Context, input CreateInput) (uuid.UUID, error) {
	v := input.Booking
	v.Name = strings.TrimSpace(v.Name)
	v.Email = normalizeEmail(v.Email)
	v.Phone = strings.TrimSpace(v.Phone)
	v.Address = strings.TrimSpace(v.Address)
	if err := validateBooking(v); err != nil {
		return uuid.Nil, err
	}
	if input.Channel == "" {
		input.Channel = ChannelForm
	}
	if input.Channel != ChannelForm && input.Channel != ChannelReceptionist {
		return uuid.Nil, fmt.Errorf("%w: unknown booking channel", ErrInvalid)
	}
	var bookingID uuid.UUID
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		w, err := service.workspace(ctx, tx, input.Scope, true)
		if err != nil {
			return err
		}
		location := w.BookingLocation
		if location == "both" {
			location = v.ServiceLocation
		}
		if location != "customer_address" && location != "business_address" {
			return fmt.Errorf("%w: choose where the appointment will take place", ErrInvalid)
		}
		if w.BookingLocation != "both" && v.ServiceLocation != "" && v.ServiceLocation != w.BookingLocation {
			return fmt.Errorf("%w: appointment location must match this business’s booking settings", ErrInvalid)
		}
		address := v.Address
		if location == "business_address" {
			address = strings.TrimSpace(value(w.BusinessAddress))
			if address == "" {
				return fmt.Errorf("%w: add a business address before accepting bookings", ErrInvalid)
			}
		} else if address == "" {
			return fmt.Errorf("%w: enter the service address", ErrInvalid)
		}

		fingerprint, err := requestFingerprint(v, location, address, input.Scope.UserID)
		if err != nil {
			return err
		}
		var oldID uuid.UUID
		var oldFingerprint *string
		err = tx.QueryRow(ctx, `SELECT id, request_fingerprint FROM appointments
			WHERE workspace_id=$1 AND idempotency_key=$2`, w.ID, v.Key.String()).Scan(&oldID, &oldFingerprint)
		if err == nil {
			if oldFingerprint == nil || *oldFingerprint != fingerprint {
				return fmt.Errorf("%w: this request key was already used for different booking details", ErrConflict)
			}
			bookingID = oldID
			return nil
		}
		if !db.IsNotFound(err) {
			return fmt.Errorf("read booking idempotency record: %w", err)
		}

		if input.Channel == ChannelReceptionist {
			var settings []byte
			if err := tx.QueryRow(ctx, `SELECT receptionist_settings FROM workspaces WHERE id=$1`, w.ID).Scan(&settings); err != nil {
				return fmt.Errorf("read receptionist settings: %w", err)
			}
			var options struct {
				Enabled           bool `json:"enabled"`
				AllowAvailability bool `json:"allowAvailability"`
				AllowBooking      bool `json:"allowBooking"`
			}
			if err := json.Unmarshal(settings, &options); err != nil || !options.Enabled || !options.AllowAvailability || !options.AllowBooking {
				return fmt.Errorf("%w: the receptionist is no longer accepting booking requests", ErrUnavailable)
			}
		}

		s, err := service.service(ctx, tx, w.ID, v.ServiceID)
		if err != nil {
			return err
		}
		quote := quoteFor(s, w)
		if quote != v.Quote {
			return fmt.Errorf("%w: the service or price changed; refresh and review it again", ErrConflict)
		}
		slots, err := service.availability(ctx, tx, w, s, v.Date, v.StaffID, uuid.Nil)
		if err != nil {
			return err
		}
		var start time.Time
		for _, slot := range slots {
			if slot.Time == v.Time && slot.StaffID == v.StaffID {
				start = slot.StartsAt
				break
			}
		}
		if start.IsZero() {
			return fmt.Errorf("%w: that time is no longer available; choose another slot", ErrConflict)
		}

		customerID, err := service.findOrCreateCustomer(ctx, tx, w.ID, v)
		if err != nil {
			return err
		}
		rawToken := make([]byte, 32)
		if _, err := rand.Read(rawToken); err != nil {
			return fmt.Errorf("generate booking management token: %w", err)
		}
		token := base64.RawURLEncoding.EncodeToString(rawToken)
		tokenHash := hash(token)
		expiresAt := start.Add(30 * 24 * time.Hour)
		source := "public"
		if input.Scope.UserID != uuid.Nil {
			source = "owner"
		} else if input.Channel == ChannelReceptionist {
			source = "receptionist"
		}
		if err := tx.QueryRow(ctx, `INSERT INTO appointments (
			workspace_id, customer_id, service_id, staff_id, starts_at, ends_at,
			service_name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
			price_minor, currency, service_address, customer_name, customer_email,
			customer_phone, notification_consent, time_zone, source, idempotency_key,
			request_fingerprint, management_token_hash, management_expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		RETURNING id`, w.ID, customerID, s.ID, v.StaffID, start, start.Add(time.Duration(s.DurationMinutes)*time.Minute),
			s.Name, s.DurationMinutes, s.BufferBeforeMinutes, s.BufferAfterMinutes, s.PriceMinor, w.Currency,
			address, v.Name, v.Email, v.Phone, v.Consent, w.TimeZone, source, v.Key.String(), fingerprint,
			tokenHash, expiresAt).Scan(&bookingID); err != nil {
			if db.IsUniqueViolation(err, "appointments_workspace_idempotency_unique") {
				return fmt.Errorf("%w: this request is already being processed", ErrConflict)
			}
			return fmt.Errorf("create appointment: %w", err)
		}
		if err := service.enqueueConfirmation(ctx, tx, w, bookingID, v, start, s, address, input.Origin, token); err != nil {
			return err
		}
		return nil
	})
	return bookingID, err
}

func (service *Service) workspace(ctx context.Context, tx pgx.Tx, scope Scope, lock bool) (*workspace, error) {
	if scope.Slug != "" {
		if scope.WorkspaceID != uuid.Nil || scope.UserID != uuid.Nil || !validSlug(scope.Slug) {
			return nil, fmt.Errorf("%w: invalid booking scope", ErrInvalid)
		}
	} else if scope.WorkspaceID == uuid.Nil || scope.UserID == uuid.Nil {
		return nil, fmt.Errorf("%w: a workspace and signed-in user are required", ErrInvalid)
	}
	if scope.UserID != uuid.Nil {
		var role string
		if err := tx.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, scope.WorkspaceID, scope.UserID).Scan(&role); err != nil {
			if db.IsNotFound(err) {
				return nil, ErrNotFound
			}
			return nil, fmt.Errorf("check workspace membership: %w", err)
		}
		if role != "owner" {
			return nil, ErrForbidden
		}
	}
	query := `SELECT id,name,logo,slug,time_zone,currency,contact_email,service_area,business_address,
		booking_location,is_published,phone,lead_hours,horizon_days,cancel_hours,slot_minutes,reminders_enabled
		FROM workspaces WHERE `
	if scope.Slug != "" {
		query += `slug=$1 AND is_published=true`
	} else {
		query += `id=$1`
	}
	if lock {
		query += ` FOR UPDATE`
	}
	key := any(scope.Slug)
	if scope.Slug == "" {
		key = scope.WorkspaceID
	}
	w := &workspace{}
	err := tx.QueryRow(ctx, query, key).Scan(&w.ID, &w.Name, &w.Logo, &w.Slug, &w.TimeZone, &w.Currency,
		&w.ContactEmail, &w.ServiceArea, &w.BusinessAddress, &w.BookingLocation, &w.Published, &w.Phone,
		&w.LeadHours, &w.HorizonDays, &w.CancelHours, &w.SlotMinutes, &w.RemindersEnabled)
	if db.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load booking workspace: %w", err)
	}
	return w, nil
}

func (service *Service) service(ctx context.Context, tx pgx.Tx, workspaceID, serviceID uuid.UUID) (*serviceRecord, error) {
	s := &serviceRecord{}
	err := tx.QueryRow(ctx, `SELECT id,name,description,duration_minutes,buffer_before_minutes,
		buffer_after_minutes,price_minor,is_active FROM services WHERE workspace_id=$1 AND id=$2 AND is_active=true`,
		workspaceID, serviceID).Scan(&s.ID, &s.Name, &s.Description, &s.DurationMinutes, &s.BufferBeforeMinutes,
		&s.BufferAfterMinutes, &s.PriceMinor, &s.Active)
	if db.IsNotFound(err) {
		return nil, fmt.Errorf("%w: this service is no longer available", ErrConflict)
	}
	if err != nil {
		return nil, fmt.Errorf("load service: %w", err)
	}
	return s, nil
}

func (service *Service) catalog(ctx context.Context, tx pgx.Tx, w *workspace) (*Catalog, error) {
	zone, err := time.LoadLocation(w.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("load workspace time zone: %w", err)
	}
	today := service.now().In(zone).Format("2006-01-02")
	maxDate, err := addDays(today, w.HorizonDays)
	if err != nil {
		return nil, err
	}
	catalog := &Catalog{ID: w.ID, Name: w.Name, Logo: w.Logo, Slug: w.Slug, ContactEmail: w.ContactEmail,
		Phone: w.Phone, ServiceArea: w.ServiceArea, BusinessAddress: w.BusinessAddress, BookingLocation: w.BookingLocation,
		TimeZone: w.TimeZone, Currency: w.Currency, LeadHours: w.LeadHours, HorizonDays: w.HorizonDays,
		CancelHours: w.CancelHours, SlotMinutes: w.SlotMinutes, Today: today, MaxDate: maxDate,
		Services: []CatalogEntry{}, Staff: []CatalogStaff{}}
	rows, err := tx.Query(ctx, `SELECT id,name FROM staff WHERE workspace_id=$1 AND is_active=true ORDER BY id`, w.ID)
	if err != nil {
		return nil, fmt.Errorf("list public staff: %w", err)
	}
	for rows.Next() {
		var s CatalogStaff
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan public staff: %w", err)
		}
		catalog.Staff = append(catalog.Staff, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate public staff: %w", err)
	}
	rows.Close()

	serviceRows, err := tx.Query(ctx, `SELECT id,name,description,duration_minutes,buffer_before_minutes,
		buffer_after_minutes,price_minor,is_active FROM services
		WHERE workspace_id=$1 AND is_active=true ORDER BY id`, w.ID)
	if err != nil {
		return nil, fmt.Errorf("list public services: %w", err)
	}
	entries := make(map[uuid.UUID]int)
	for serviceRows.Next() {
		var entry CatalogEntry
		var current serviceRecord
		if err := serviceRows.Scan(&entry.ID, &entry.Name, &entry.Description, &entry.DurationMinutes,
			&current.BufferBeforeMinutes, &current.BufferAfterMinutes, &entry.PriceMinor, &current.Active); err != nil {
			serviceRows.Close()
			return nil, fmt.Errorf("scan public service: %w", err)
		}
		current.ID, current.Name, current.Description = entry.ID, entry.Name, entry.Description
		current.DurationMinutes, current.PriceMinor = entry.DurationMinutes, entry.PriceMinor
		entry.StaffIDs = []string{}
		entry.Quote = quoteFor(&current, w)
		entries[entry.ID] = len(catalog.Services)
		catalog.Services = append(catalog.Services, entry)
	}
	if err := serviceRows.Err(); err != nil {
		serviceRows.Close()
		return nil, fmt.Errorf("iterate public services: %w", err)
	}
	serviceRows.Close()
	staffRows, err := tx.Query(ctx, `SELECT ss.service_id,ss.staff_id FROM staff_services ss
		JOIN staff st ON st.id=ss.staff_id AND st.workspace_id=ss.workspace_id
		WHERE ss.workspace_id=$1 AND ss.is_active=true AND st.is_active=true ORDER BY ss.service_id,ss.staff_id`, w.ID)
	if err != nil {
		return nil, fmt.Errorf("list service staff: %w", err)
	}
	for staffRows.Next() {
		var serviceID, staffID uuid.UUID
		if err := staffRows.Scan(&serviceID, &staffID); err != nil {
			staffRows.Close()
			return nil, fmt.Errorf("scan service staff: %w", err)
		}
		if index, found := entries[serviceID]; found {
			catalog.Services[index].StaffIDs = append(catalog.Services[index].StaffIDs, staffID.String())
		}
	}
	if err := staffRows.Err(); err != nil {
		staffRows.Close()
		return nil, fmt.Errorf("iterate service staff: %w", err)
	}
	staffRows.Close()
	available := catalog.Services[:0]
	for _, entry := range catalog.Services {
		if len(entry.StaffIDs) > 0 {
			available = append(available, entry)
		}
	}
	catalog.Services = available
	return catalog, nil
}

func (service *Service) findOrCreateCustomer(ctx context.Context, tx pgx.Tx, workspaceID uuid.UUID, v BookingInput) (uuid.UUID, error) {
	var customerID uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM customers WHERE workspace_id=$1 AND lower(email)=lower($2) ORDER BY created_at LIMIT 1`, workspaceID, v.Email).Scan(&customerID)
	if err == nil {
		return customerID, nil
	}
	if !db.IsNotFound(err) {
		return uuid.Nil, fmt.Errorf("find customer: %w", err)
	}
	err = tx.QueryRow(ctx, `INSERT INTO customers(workspace_id,name,email,phone) VALUES($1,$2,$3,$4) RETURNING id`, workspaceID, v.Name, v.Email, v.Phone).Scan(&customerID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("create customer: %w", err)
	}
	return customerID, nil
}

func (service *Service) enqueueConfirmation(ctx context.Context, tx pgx.Tx, w *workspace, id uuid.UUID, v BookingInput, start time.Time, s *serviceRecord, address, origin, token string) error {
	if origin == "" {
		origin = service.PublicURL
	}
	parsed := strings.TrimRight(origin, "/")
	when := start.In(mustLocation(w.TimeZone)).Format("Monday, 2 January 2006 at 15:04")
	price := fmt.Sprintf("%s %s", w.Currency, formatMinor(s.PriceMinor))
	body := fmt.Sprintf("Appointment confirmed\n\n%s\n%s (%s)\n%s\nAppointment location: %s\n\nChanges and cancellations require %d hours’ notice.\n\nManage your booking privately:\n%s/booking/%s#%s\n\nContact: %s", s.Name, when, w.TimeZone, price, address, w.CancelHours, parsed, id, token, firstNonempty(value(w.ContactEmail), w.Phone))
	return service.enqueueEmail(ctx, tx, BookingEmailArgs{
		EventKey: id.String() + ":confirmed:0", WorkspaceID: w.ID, AppointmentID: id,
		AppointmentVersion: 0, EventType: "confirmed", To: v.Email,
		Subject: "Appointment confirmed · " + w.Name, Text: body,
	})
}

func validateBooking(v BookingInput) error {
	if v.Key == uuid.Nil || v.ServiceID == uuid.Nil || v.StaffID == uuid.Nil || !validDate(v.Date) || !validClock(v.Time) || !v.Consent || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(v.Quote) {
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
