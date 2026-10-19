package bookings

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ListOptions struct {
	ExcludeCancelled bool
	Limit            int
	Cursor           string
	Search           string
	Status           string
	CustomerID       uuid.UUID
	From             string
	To               string
}

type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
	Total      int    `json:"total"`
}

type listPath struct {
	WorkspaceID string    `path:"workspaceId"`
	Limit       int       `query:"limit" default:"50" minimum:"1" maximum:"200"`
	Cursor      string    `query:"cursor" maxLength:"200"`
	Search      string    `query:"search" maxLength:"200"`
	CustomerID  uuid.UUID `query:"customer_id" required:"false"`
	From        string    `query:"from" maxLength:"10"`
	To          string    `query:"to" maxLength:"10"`
}

func (p *listPath) options() ListOptions {
	return ListOptions{Limit: p.Limit, Cursor: p.Cursor, Search: p.Search, CustomerID: p.CustomerID, From: p.From, To: p.To}
}

func (o ListOptions) bounds() (int, *time.Time, uuid.UUID, error) {
	limit := o.Limit
	if limit == 0 {
		limit = 50
	}
	if o.Status != "" && o.Status != "confirmed" && o.Status != "completed" && o.Status != "cancelled" && o.Status != "no_show" {
		return 0, nil, uuid.Nil, fmt.Errorf("%w: invalid appointment status", ErrInvalid)
	}
	if limit < 1 || limit > 200 || len(o.Search) > 200 || (o.From != "" && !validDate(o.From)) || (o.To != "" && !validDate(o.To)) || (o.From != "" && o.To != "" && o.From > o.To) {
		return 0, nil, uuid.Nil, fmt.Errorf("%w: invalid list filters", ErrInvalid)
	}
	if o.Cursor == "" {
		return limit, nil, uuid.Nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(o.Cursor)
	if err != nil {
		return 0, nil, uuid.Nil, fmt.Errorf("%w: invalid list cursor", ErrInvalid)
	}
	timestamp, id, ok := strings.Cut(string(raw), "|")
	at, timeErr := time.Parse(time.RFC3339Nano, timestamp)
	uid, idErr := uuid.Parse(id)
	if !ok || timeErr != nil || idErr != nil {
		return 0, nil, uuid.Nil, fmt.Errorf("%w: invalid list cursor", ErrInvalid)
	}
	return limit, &at, uid, nil
}

func listCursor(at time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

type appointmentListPath struct {
	WorkspaceID string    `path:"workspaceId"`
	Limit       int       `query:"limit" default:"50" minimum:"1" maximum:"200"`
	Cursor      string    `query:"cursor" maxLength:"200"`
	Search      string    `query:"search" maxLength:"200"`
	CustomerID  uuid.UUID `query:"customer_id" required:"false"`
	From        string    `query:"from" maxLength:"10"`
	To          string    `query:"to" maxLength:"10"`
	Status      string    `query:"status" enum:",confirmed,completed,cancelled,no_show"`
}

func (p *appointmentListPath) options() ListOptions {
	return ListOptions{Limit: p.Limit, Cursor: p.Cursor, Search: p.Search, CustomerID: p.CustomerID, From: p.From, To: p.To, Status: p.Status}
}
