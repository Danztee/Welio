// Package catalog manages workspace services, staff, assignments, and schedules.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/mail"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

var clockPattern = regexp.MustCompile(`^(?:[01][0-9]|2[0-3]):[0-5][0-9]$`)

type Service struct{ DB *db.DB }

type ServiceItem struct {
	ID                  uuid.UUID `json:"id"`
	WorkspaceID         uuid.UUID `json:"workspace_id"`
	Name                string    `json:"name"`
	Description         *string   `json:"description"`
	DurationMinutes     int       `json:"duration_minutes"`
	BufferBeforeMinutes int       `json:"buffer_before_minutes"`
	BufferAfterMinutes  int       `json:"buffer_after_minutes"`
	PriceMinor          int64     `json:"price_minor"`
	IsActive            bool      `json:"is_active"`
}

type Schedule struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	BreakStart string `json:"breakStart"`
	BreakEnd   string `json:"breakEnd"`
	Days       []int  `json:"days"`
}

type StaffMember struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	UserID      *uuid.UUID `json:"user_id"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	JobTitle    string     `json:"job_title"`
	Schedule    Schedule   `json:"schedule"`
	IsActive    bool       `json:"is_active"`
	Role        *string    `json:"role"`
}

type Assignment struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	StaffID     uuid.UUID `json:"staff_id"`
	ServiceID   uuid.UUID `json:"service_id"`
	IsActive    bool      `json:"is_active"`
}

type Snapshot struct {
	Services    []ServiceItem `json:"services"`
	Staff       []StaffMember `json:"staff"`
	Assignments []Assignment  `json:"assignments"`
}

type ServiceInput struct {
	Name                string       `json:"name"`
	Description         string       `json:"description"`
	DurationMinutes     int          `json:"duration_minutes"`
	BufferBeforeMinutes int          `json:"buffer_before_minutes"`
	BufferAfterMinutes  int          `json:"buffer_after_minutes"`
	Price               float64      `json:"price"`
	IsActive            bool         `json:"is_active"`
	StaffIDs            *[]uuid.UUID `json:"staff_ids,omitempty"`
}

type StaffInput struct {
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	JobTitle string   `json:"job_title"`
	IsActive bool     `json:"is_active"`
	Schedule Schedule `json:"schedule"`
}

func (s *Service) Get(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID) (*Snapshot, error) {
	if err := requireWorkspace(principal, workspaceID, false); err != nil {
		return nil, err
	}
	snapshot := &Snapshot{Services: []ServiceItem{}, Staff: []StaffMember{}, Assignments: []Assignment{}}
	rows, err := s.DB.Pool.Query(ctx, `SELECT id, workspace_id, name, description, duration_minutes,
		buffer_before_minutes, buffer_after_minutes, price_minor, is_active
		FROM services WHERE workspace_id = $1 ORDER BY name, id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace services: %w", err)
	}
	for rows.Next() {
		var item ServiceItem
		var description pgtype.Text
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &description,
			&item.DurationMinutes, &item.BufferBeforeMinutes, &item.BufferAfterMinutes,
			&item.PriceMinor, &item.IsActive); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan workspace service: %w", err)
		}
		item.Description = textPointer(description)
		snapshot.Services = append(snapshot.Services, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate workspace services: %w", err)
	}
	rows.Close()

	rows, err = s.DB.Pool.Query(ctx, `SELECT st.id, st.workspace_id, st.user_id,
		coalesce(u.name, st.name), coalesce(u.email, st.email), st.job_title,
		st.schedule, st.is_active, m.role
		FROM staff st LEFT JOIN users u ON u.id = st.user_id
		LEFT JOIN memberships m ON m.workspace_id = st.workspace_id AND m.user_id = st.user_id
		WHERE st.workspace_id = $1 ORDER BY st.name, st.id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace staff: %w", err)
	}
	for rows.Next() {
		var item StaffMember
		var userID pgtype.UUID
		var scheduleJSON []byte
		var role pgtype.Text
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &userID, &item.Name, &item.Email,
			&item.JobTitle, &scheduleJSON, &item.IsActive, &role); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan workspace staff: %w", err)
		}
		if userID.Valid {
			id, err := uuid.FromBytes(userID.Bytes[:])
			if err != nil {
				rows.Close()
				return nil, fmt.Errorf("decode linked staff account: %w", err)
			}
			item.UserID = &id
		}
		if role.Valid {
			item.Role = &role.String
		}
		if err := json.Unmarshal(scheduleJSON, &item.Schedule); err != nil {
			rows.Close()
			return nil, fmt.Errorf("decode staff schedule: %w", err)
		}
		snapshot.Staff = append(snapshot.Staff, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate workspace staff: %w", err)
	}
	rows.Close()

	rows, err = s.DB.Pool.Query(ctx, `SELECT workspace_id, staff_id, service_id, is_active
		FROM staff_services WHERE workspace_id = $1 AND is_active = true
		ORDER BY staff_id, service_id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list staff service assignments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item Assignment
		if err := rows.Scan(&item.WorkspaceID, &item.StaffID, &item.ServiceID, &item.IsActive); err != nil {
			return nil, fmt.Errorf("scan staff service assignment: %w", err)
		}
		snapshot.Assignments = append(snapshot.Assignments, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate staff service assignments: %w", err)
	}
	return snapshot, nil
}

func (s *Service) SaveService(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID, serviceID *uuid.UUID, input ServiceInput) (uuid.UUID, error) {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return uuid.Nil, err
	}
	if err := validateService(input); err != nil {
		return uuid.Nil, err
	}
	staffIDs := uniqueIDs(input.StaffIDs)
	priceMinor := int64(math.Round(input.Price * 100))
	var id uuid.UUID
	err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		if err := ensureActiveStaff(ctx, tx, workspaceID, staffIDs); err != nil {
			return err
		}
		if serviceID == nil {
			if err := tx.QueryRow(ctx, `INSERT INTO services (workspace_id, name, description, duration_minutes,
				buffer_before_minutes, buffer_after_minutes, price_minor, is_active)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, workspaceID,
				strings.TrimSpace(input.Name), input.Description, input.DurationMinutes,
				input.BufferBeforeMinutes, input.BufferAfterMinutes, priceMinor, input.IsActive).Scan(&id); err != nil {
				return fmt.Errorf("create service: %w", err)
			}
		} else {
			id = *serviceID
			tag, err := tx.Exec(ctx, `UPDATE services SET name=$3, description=$4, duration_minutes=$5,
				buffer_before_minutes=$6, buffer_after_minutes=$7, price_minor=$8, is_active=$9
				WHERE workspace_id=$1 AND id=$2`, workspaceID, id,
				strings.TrimSpace(input.Name), input.Description, input.DurationMinutes,
				input.BufferBeforeMinutes, input.BufferAfterMinutes, priceMinor, input.IsActive)
			if err != nil {
				return fmt.Errorf("update service: %w", err)
			}
			if tag.RowsAffected() == 0 {
				return httpx.E(404, "service_not_found", "Service not found.")
			}
		}
		if serviceID == nil || input.StaffIDs != nil {
			if err := replaceAssignments(ctx, tx, workspaceID, id, staffIDs); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func (s *Service) AssignServiceStaff(ctx context.Context, principal *auth.Principal, workspaceID, serviceID uuid.UUID, staffIDs []uuid.UUID) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	staffIDs = uniqueIDs(&staffIDs)
	return s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM services WHERE workspace_id=$1 AND id=$2)`, workspaceID, serviceID).Scan(&exists); err != nil {
			return fmt.Errorf("check assigned service: %w", err)
		}
		if !exists {
			return httpx.E(404, "service_not_found", "Service not found.")
		}
		if err := ensureActiveStaff(ctx, tx, workspaceID, staffIDs); err != nil {
			return err
		}
		return replaceAssignments(ctx, tx, workspaceID, serviceID, staffIDs)
	})
}

func (s *Service) SaveStaff(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID, staffID *uuid.UUID, input StaffInput) (uuid.UUID, error) {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return uuid.Nil, err
	}
	if err := validateStaff(&input); err != nil {
		return uuid.Nil, err
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	schedule, err := json.Marshal(input.Schedule)
	if err != nil {
		return uuid.Nil, fmt.Errorf("encode staff schedule: %w", err)
	}
	var id uuid.UUID
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var duplicate bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM staff WHERE workspace_id=$1
			AND lower(email)=lower($2) AND ($3::uuid IS NULL OR id<>$3))`, workspaceID, input.Email, staffID).Scan(&duplicate); err != nil {
			return fmt.Errorf("check duplicate staff email: %w", err)
		}
		if duplicate {
			return httpx.E(409, "staff_email_taken", "A team member with this email already exists.")
		}
		if staffID == nil {
			if err := tx.QueryRow(ctx, `INSERT INTO staff (workspace_id, name, email, job_title, schedule, is_active)
				VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, workspaceID, input.Name,
				input.Email, input.JobTitle, schedule, input.IsActive).Scan(&id); err != nil {
				return fmt.Errorf("create staff member: %w", err)
			}
		} else {
			id = *staffID
			tag, err := tx.Exec(ctx, `UPDATE staff SET name=$3, email=$4, job_title=$5, schedule=$6, is_active=$7
				WHERE workspace_id=$1 AND id=$2`, workspaceID, id, input.Name, input.Email,
				input.JobTitle, schedule, input.IsActive)
			if err != nil {
				return fmt.Errorf("update staff member: %w", err)
			}
			if tag.RowsAffected() == 0 {
				return httpx.E(404, "staff_not_found", "Staff member not found.")
			}
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func validateService(input ServiceInput) error {
	nameLength := len([]rune(strings.TrimSpace(input.Name)))
	if nameLength < 2 || nameLength > 100 {
		return httpx.E(422, "invalid_service", "Service name must be between 2 and 100 characters.")
	}
	if len([]rune(input.Description)) > 2000 {
		return httpx.E(422, "invalid_service", "Service description must be 2,000 characters or fewer.")
	}
	if input.DurationMinutes < 15 || input.DurationMinutes > 480 {
		return httpx.E(422, "invalid_service", "Service duration must be between 15 and 480 minutes.")
	}
	if input.BufferBeforeMinutes < 0 || input.BufferBeforeMinutes > 180 || input.BufferAfterMinutes < 0 || input.BufferAfterMinutes > 180 {
		return httpx.E(422, "invalid_service", "Service buffers must be between 0 and 180 minutes.")
	}
	priceMinor := input.Price * 100
	if math.IsNaN(input.Price) || math.IsInf(input.Price, 0) || input.Price < 0 || input.Price > 10_000_000 || math.Abs(priceMinor-math.Round(priceMinor)) > 0.000001 {
		return httpx.E(422, "invalid_service", "Enter a price with no more than two decimal places.")
	}
	if input.StaffIDs != nil && len(*input.StaffIDs) > 100 {
		return httpx.E(422, "invalid_service", "A service can be assigned to at most 100 team members.")
	}
	if input.StaffIDs != nil {
		for _, id := range *input.StaffIDs {
			if id == uuid.Nil {
				return httpx.E(422, "invalid_service", "Choose active team members in this workspace.")
			}
		}
	}
	return nil
}

func validateStaff(input *StaffInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.JobTitle = strings.TrimSpace(input.JobTitle)
	if len([]rune(input.Name)) < 2 || len([]rune(input.Name)) > 100 || len([]rune(input.JobTitle)) > 100 {
		return httpx.E(422, "invalid_staff", "Enter a team member name and a job title of 100 characters or fewer.")
	}
	input.Email = strings.TrimSpace(input.Email)
	if len(input.Email) > 254 {
		return httpx.E(422, "invalid_staff", "Enter a valid team member email.")
	}
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || !strings.Contains(input.Email, "@") {
		return httpx.E(422, "invalid_staff", "Enter a valid team member email.")
	}
	schedule := &input.Schedule
	if !clockPattern.MatchString(schedule.Start) || !clockPattern.MatchString(schedule.End) || schedule.Start >= schedule.End {
		return httpx.E(422, "invalid_schedule", "Working hours must have a valid start time before the end time.")
	}
	if (schedule.BreakStart == "") != (schedule.BreakEnd == "") {
		return httpx.E(422, "invalid_schedule", "Set both break times or leave both empty.")
	}
	if schedule.BreakStart != "" && (!clockPattern.MatchString(schedule.BreakStart) || !clockPattern.MatchString(schedule.BreakEnd) || schedule.BreakStart >= schedule.BreakEnd || schedule.BreakStart < schedule.Start || schedule.BreakEnd > schedule.End) {
		return httpx.E(422, "invalid_schedule", "Working hours and break times must be in order, with the break inside working hours.")
	}
	if len(schedule.Days) < 1 || len(schedule.Days) > 7 {
		return httpx.E(422, "invalid_schedule", "Choose at least one working day.")
	}
	days := make(map[int]struct{}, len(schedule.Days))
	for _, day := range schedule.Days {
		if day < 0 || day > 6 {
			return httpx.E(422, "invalid_schedule", "Choose valid working days.")
		}
		days[day] = struct{}{}
	}
	schedule.Days = schedule.Days[:0]
	for day := 0; day < 7; day++ {
		if _, ok := days[day]; ok {
			schedule.Days = append(schedule.Days, day)
		}
	}
	return nil
}

func ensureActiveStaff(ctx context.Context, tx pgx.Tx, workspaceID uuid.UUID, staffIDs []uuid.UUID) error {
	if len(staffIDs) == 0 {
		return nil
	}
	for _, id := range staffIDs {
		if id == uuid.Nil {
			return httpx.E(422, "invalid_staff_assignment", "Choose active team members in this workspace.")
		}
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM staff WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND is_active=true`, workspaceID, staffIDs).Scan(&count); err != nil {
		return fmt.Errorf("validate service staff assignments: %w", err)
	}
	if count != len(staffIDs) {
		return httpx.E(422, "invalid_staff_assignment", "Choose active team members in this workspace.")
	}
	return nil
}

func replaceAssignments(ctx context.Context, tx pgx.Tx, workspaceID, serviceID uuid.UUID, staffIDs []uuid.UUID) error {
	if _, err := tx.Exec(ctx, `UPDATE staff_services SET is_active=false WHERE workspace_id=$1 AND service_id=$2`, workspaceID, serviceID); err != nil {
		return fmt.Errorf("deactivate old service assignments: %w", err)
	}
	for _, staffID := range staffIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO staff_services (workspace_id, staff_id, service_id, is_active)
			VALUES ($1,$2,$3,true) ON CONFLICT (workspace_id, staff_id, service_id)
			DO UPDATE SET is_active=true`, workspaceID, staffID, serviceID); err != nil {
			return fmt.Errorf("save service assignment: %w", err)
		}
	}
	return nil
}

func uniqueIDs(ids *[]uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	result := make([]uuid.UUID, 0, len(*ids))
	seen := make(map[uuid.UUID]struct{}, len(*ids))
	for _, id := range *ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func requireWorkspace(principal *auth.Principal, id uuid.UUID, ownerOnly bool) error {
	if principal == nil {
		return httpx.E(401, "unauthenticated", "Sign in to continue.")
	}
	if principal.WorkspaceID != id || id == uuid.Nil || (principal.Role != "owner" && principal.Role != "staff") {
		return httpx.E(403, "workspace_forbidden", "You do not have access to this workspace.")
	}
	if ownerOnly && principal.Role != "owner" {
		return httpx.E(403, "forbidden", "You do not have permission to change services or team settings.")
	}
	return nil
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
