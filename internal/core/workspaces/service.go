// Package workspaces manages business workspaces and their tenant settings.
package workspaces

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/mail"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

const maxLogoBytes = 450 * 1024

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

type Service struct {
	DB     *db.DB
	Jobs   *river.Client[pgx.Tx]
	AppURL string
}

type WorkspaceInput struct {
	Name            string  `json:"name"`
	Logo            *string `json:"logo"`
	Slug            string  `json:"slug"`
	ContactEmail    string  `json:"contact_email"`
	Phone           string  `json:"phone"`
	ServiceArea     string  `json:"service_area"`
	BusinessAddress string  `json:"business_address"`
	BookingLocation string  `json:"booking_location"`
	TimeZone        string  `json:"time_zone"`
	Currency        string  `json:"currency"`
}

type Workspace struct {
	ID               uuid.UUID `json:"id"`
	Name             string    `json:"name"`
	Logo             *string   `json:"logo"`
	Slug             string    `json:"slug"`
	TimeZone         string    `json:"time_zone"`
	Currency         string    `json:"currency"`
	ContactEmail     *string   `json:"contact_email"`
	ServiceArea      *string   `json:"service_area"`
	BusinessAddress  *string   `json:"business_address"`
	BookingLocation  string    `json:"booking_location"`
	IsPublished      bool      `json:"is_published"`
	Phone            string    `json:"phone"`
	Onboarded        bool      `json:"onboarded"`
	LeadHours        int       `json:"lead_hours"`
	HorizonDays      int       `json:"horizon_days"`
	CancelHours      int       `json:"cancel_hours"`
	SlotMinutes      int       `json:"slot_minutes"`
	RemindersEnabled bool      `json:"reminders_enabled"`
}

type WorkspaceSummary struct {
	Workspace struct {
		ID        uuid.UUID `json:"id"`
		Name      string    `json:"name"`
		Onboarded bool      `json:"onboarded"`
	} `json:"workspace"`
	Role string `json:"role"`
}

func (s *Service) List(ctx context.Context, principal *auth.Principal) ([]WorkspaceSummary, error) {
	if principal == nil {
		return nil, httpx.E(401, "unauthenticated", "Sign in to continue.")
	}
	rows, err := s.DB.Pool.Query(ctx, `SELECT w.id, w.name, w.onboarded, m.role
		FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = $1 ORDER BY w.name, w.id`, principal.UserID)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	defer rows.Close()

	items := make([]WorkspaceSummary, 0)
	for rows.Next() {
		var item WorkspaceSummary
		if err := rows.Scan(&item.Workspace.ID, &item.Workspace.Name, &item.Workspace.Onboarded, &item.Role); err != nil {
			return nil, fmt.Errorf("scan workspace membership: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace memberships: %w", err)
	}
	return items, nil
}

func (s *Service) Create(ctx context.Context, principal *auth.Principal, input WorkspaceInput) (uuid.UUID, error) {
	if principal == nil {
		return uuid.Nil, httpx.E(401, "unauthenticated", "Sign in to continue.")
	}
	input, err := normalizeAndValidate(input)
	if err != nil {
		return uuid.Nil, err
	}
	var workspaceID uuid.UUID
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var creatorName, creatorEmail string
		if err := tx.QueryRow(ctx, `SELECT name, email FROM users WHERE id = $1 FOR UPDATE`, principal.UserID).Scan(&creatorName, &creatorEmail); err != nil {
			if db.IsNotFound(err) {
				return httpx.E(404, "account_not_found", "Your account could not be found.")
			}
			return fmt.Errorf("load workspace creator: %w", err)
		}
		var owned int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE user_id = $1 AND role = 'owner'`, principal.UserID).Scan(&owned); err != nil {
			return fmt.Errorf("count owned workspaces: %w", err)
		}
		if owned >= 20 {
			return httpx.E(422, "workspace_limit", "You can create up to 20 workspaces.")
		}
		if err := tx.QueryRow(ctx, `INSERT INTO workspaces (
			name, logo, slug, contact_email, phone, service_area, business_address,
			booking_location, time_zone, currency, onboarded
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING id`,
			input.Name, input.Logo, input.Slug, input.ContactEmail, input.Phone,
			input.ServiceArea, input.BusinessAddress, input.BookingLocation,
			input.TimeZone, input.Currency).Scan(&workspaceID); err != nil {
			if db.IsUniqueViolation(err, "workspaces_slug_unique") {
				return httpx.E(409, "slug_taken", "That booking address is already taken. Choose another.")
			}
			return fmt.Errorf("create workspace: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, principal.UserID); err != nil {
			return fmt.Errorf("add workspace owner membership: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO staff (workspace_id, user_id, name, email, job_title) VALUES ($1, $2, $3, $4, 'Owner')`, workspaceID, principal.UserID, creatorName, creatorEmail); err != nil {
			return fmt.Errorf("add workspace owner as staff: %w", err)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return workspaceID, nil
}

func (s *Service) Get(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID) (*Workspace, error) {
	if err := requireWorkspace(principal, workspaceID, false); err != nil {
		return nil, err
	}
	var workspace Workspace
	var logo, contactEmail, serviceArea, businessAddress pgtype.Text
	err := s.DB.Pool.QueryRow(ctx, `SELECT id, name, logo, slug, time_zone, currency,
		contact_email, service_area, business_address, booking_location, is_published,
		phone, onboarded, lead_hours, horizon_days, cancel_hours, slot_minutes, reminders_enabled
		FROM workspaces WHERE id = $1`, workspaceID).Scan(
		&workspace.ID, &workspace.Name, &logo, &workspace.Slug, &workspace.TimeZone, &workspace.Currency,
		&contactEmail, &serviceArea, &businessAddress, &workspace.BookingLocation, &workspace.IsPublished,
		&workspace.Phone, &workspace.Onboarded, &workspace.LeadHours, &workspace.HorizonDays,
		&workspace.CancelHours, &workspace.SlotMinutes, &workspace.RemindersEnabled)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, httpx.E(404, "workspace_not_found", "Workspace not found.")
		}
		return nil, fmt.Errorf("load workspace: %w", err)
	}
	workspace.Logo, workspace.ContactEmail = textPointer(logo), textPointer(contactEmail)
	workspace.ServiceArea, workspace.BusinessAddress = textPointer(serviceArea), textPointer(businessAddress)
	return &workspace, nil
}

func (s *Service) SaveBusiness(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID, input WorkspaceInput) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	input, err := normalizeAndValidate(input)
	if err != nil {
		return err
	}
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var currentCurrency, currentTimeZone string
		if err := tx.QueryRow(ctx, `SELECT currency, time_zone FROM workspaces WHERE id = $1 FOR UPDATE`, workspaceID).Scan(&currentCurrency, &currentTimeZone); err != nil {
			if db.IsNotFound(err) {
				return httpx.E(404, "workspace_not_found", "Workspace not found.")
			}
			return fmt.Errorf("lock workspace settings: %w", err)
		}
		if currentCurrency != input.Currency || currentTimeZone != input.TimeZone {
			var hasBookings bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM appointments WHERE workspace_id = $1)`, workspaceID).Scan(&hasBookings); err != nil {
				return fmt.Errorf("check workspace appointments: %w", err)
			}
			if hasBookings {
				return httpx.E(409, "booking_policy_locked", "Currency and time zone cannot change after bookings exist.")
			}
		}
		_, err := tx.Exec(ctx, `UPDATE workspaces SET name=$2, logo=$3, slug=$4, contact_email=$5,
			phone=$6, service_area=$7, business_address=$8, booking_location=$9,
			time_zone=$10, currency=$11, onboarded=true WHERE id=$1`,
			workspaceID, input.Name, input.Logo, input.Slug, input.ContactEmail, input.Phone,
			input.ServiceArea, input.BusinessAddress, input.BookingLocation,
			input.TimeZone, input.Currency)
		if err != nil {
			if db.IsUniqueViolation(err, "workspaces_slug_unique") {
				return httpx.E(409, "slug_taken", "That booking address is already taken. Choose another.")
			}
			return fmt.Errorf("update workspace settings: %w", err)
		}
		return nil
	})
	return err
}

// SaveReminderPolicy updates the owner-controlled reminder setting and releases any
// reminder jobs that have not been delivered yet. River workers re-check this setting
// before sending, so disabling reminders also invalidates already queued work.
func (s *Service) SaveReminderPolicy(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID, enabled bool) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	return s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT reminders_enabled FROM workspaces WHERE id=$1 FOR UPDATE`, workspaceID).Scan(&exists); err != nil {
			if db.IsNotFound(err) {
				return httpx.E(404, "workspace_not_found", "Workspace not found.")
			}
			return fmt.Errorf("lock reminder settings: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE workspaces SET reminders_enabled=$2 WHERE id=$1`, workspaceID, enabled); err != nil {
			return fmt.Errorf("update reminder settings: %w", err)
		}
		if !enabled {
			if _, err := tx.Exec(ctx, `UPDATE appointments SET reminder_queued_version=NULL
				WHERE workspace_id=$1 AND status='confirmed' AND reminder_sent_version IS DISTINCT FROM version`, workspaceID); err != nil {
				return fmt.Errorf("release queued appointment reminders: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) FinishSetup(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	result, err := s.DB.Pool.Exec(ctx, `UPDATE workspaces SET onboarded = true WHERE id = $1`, workspaceID)
	if err != nil {
		return fmt.Errorf("finish workspace setup: %w", err)
	}
	if result.RowsAffected() == 0 {
		return httpx.E(404, "workspace_not_found", "Workspace not found.")
	}
	return nil
}

func requireWorkspace(principal *auth.Principal, id uuid.UUID, ownerOnly bool) error {
	if principal == nil {
		return httpx.E(401, "unauthenticated", "Sign in to continue.")
	}
	if principal.WorkspaceID == uuid.Nil || principal.WorkspaceID != id {
		return httpx.E(403, "workspace_forbidden", "You do not have access to this workspace.")
	}
	if principal.Role != "owner" && principal.Role != "staff" {
		return httpx.E(403, "workspace_forbidden", "You do not have access to this workspace.")
	}
	if ownerOnly && principal.Role != "owner" {
		return httpx.E(403, "forbidden", "You do not have permission to change business settings.")
	}
	return nil
}

func normalizeAndValidate(input WorkspaceInput) (WorkspaceInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = strings.TrimSpace(input.Slug)
	input.ContactEmail = strings.TrimSpace(input.ContactEmail)
	input.Phone = strings.TrimSpace(input.Phone)
	input.ServiceArea = strings.TrimSpace(input.ServiceArea)
	input.BusinessAddress = strings.TrimSpace(input.BusinessAddress)
	if len([]rune(input.Name)) < 2 || len([]rune(input.Name)) > 100 {
		return input, httpx.E(422, "invalid_workspace", "Business name must be between 2 and 100 characters.")
	}
	if !slugPattern.MatchString(input.Slug) || len(input.Slug) < 3 || len(input.Slug) > 80 {
		return input, httpx.E(422, "invalid_workspace", "Booking address must use lowercase letters, numbers, and single hyphens.")
	}
	address, emailErr := mail.ParseAddress(input.ContactEmail)
	if emailErr != nil || address.Address != input.ContactEmail || len(input.ContactEmail) > 254 || !strings.Contains(input.ContactEmail, "@") {
		return input, httpx.E(422, "invalid_workspace", "Enter a valid business contact email.")
	}
	if len(input.Phone) > 40 || len(input.ServiceArea) > 200 || len(input.BusinessAddress) > 200 {
		return input, httpx.E(422, "invalid_workspace", "Business contact and location details are too long.")
	}
	switch input.BookingLocation {
	case "customer_address":
		if len([]rune(strings.TrimSpace(input.ServiceArea))) < 2 {
			return input, httpx.E(422, "invalid_workspace", "Add the neighborhoods or cities where you provide services.")
		}
	case "business_address", "both":
		if len([]rune(strings.TrimSpace(input.BusinessAddress))) < 2 {
			return input, httpx.E(422, "invalid_workspace", "Add the address where customers can visit your business.")
		}
	default:
		return input, httpx.E(422, "invalid_workspace", "Choose a valid booking location.")
	}
	if input.TimeZone != "Africa/Lagos" && input.TimeZone != "Europe/London" && input.TimeZone != "America/New_York" && input.TimeZone != "UTC" {
		return input, httpx.E(422, "invalid_workspace", "Choose a supported business time zone.")
	}
	if input.Currency != "NGN" && input.Currency != "USD" && input.Currency != "GBP" {
		return input, httpx.E(422, "invalid_workspace", "Choose a supported business currency.")
	}
	if input.Logo != nil {
		const prefix = "data:image/webp;base64,"
		if !strings.HasPrefix(*input.Logo, prefix) {
			return input, httpx.E(422, "invalid_logo", "Choose a valid WebP logo.")
		}
		image, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(*input.Logo, prefix))
		if err != nil || len(image) > maxLogoBytes || len(image) < 12 || string(image[:4]) != "RIFF" || string(image[8:12]) != "WEBP" {
			return input, httpx.E(422, "invalid_logo", "Choose a valid image smaller than 450 KB.")
		}
	}
	return input, nil
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
