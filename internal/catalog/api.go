package catalog

import (
	"github.com/google/uuid"
)

// scheduleInput and scheduleOutput define the REST representation. The stored
// schedule shape stays private to the repository because it is JSON persisted
// in PostgreSQL.
type scheduleInput struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	BreakStart string `json:"break_start"`
	BreakEnd   string `json:"break_end"`
	Days       []int  `json:"days"`
}

type staffInput struct {
	Name     string        `json:"name"`
	Email    string        `json:"email"`
	JobTitle string        `json:"job_title"`
	IsActive bool          `json:"is_active"`
	Schedule scheduleInput `json:"schedule"`
}

func (input staffInput) serviceInput() StaffInput {
	return StaffInput{
		Name: input.Name, Email: input.Email, JobTitle: input.JobTitle, IsActive: input.IsActive,
		Schedule: Schedule{
			Start: input.Schedule.Start, End: input.Schedule.End,
			BreakStart: input.Schedule.BreakStart, BreakEnd: input.Schedule.BreakEnd,
			Days: input.Schedule.Days,
		},
	}
}

type staffOutput struct {
	ID          uuid.UUID     `json:"id"`
	WorkspaceID uuid.UUID     `json:"workspace_id"`
	UserID      *uuid.UUID    `json:"user_id" nullable:"true"`
	Name        string        `json:"name"`
	Email       string        `json:"email"`
	JobTitle    string        `json:"job_title"`
	Schedule    scheduleInput `json:"schedule"`
	IsActive    bool          `json:"is_active"`
	Role        *string       `json:"role"`
}

type snapshotOutput struct {
	Services    []ServiceItem `json:"services"`
	Staff       []staffOutput `json:"staff"`
	Assignments []Assignment  `json:"assignments"`
}

func snapshotResponse(snapshot *Snapshot) snapshotOutput {
	result := snapshotOutput{
		Services: snapshot.Services, Assignments: snapshot.Assignments,
		Staff: make([]staffOutput, 0, len(snapshot.Staff)),
	}
	for _, member := range snapshot.Staff {
		result.Staff = append(result.Staff, staffOutput{
			ID: member.ID, WorkspaceID: member.WorkspaceID, UserID: member.UserID,
			Name: member.Name, Email: member.Email, JobTitle: member.JobTitle,
			Schedule: scheduleInput{
				Start: member.Schedule.Start, End: member.Schedule.End,
				BreakStart: member.Schedule.BreakStart, BreakEnd: member.Schedule.BreakEnd,
				Days: member.Schedule.Days,
			},
			IsActive: member.IsActive, Role: member.Role,
		})
	}
	return result
}
