package workspaces

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/jobs"
)

const invitationTTL = 7 * 24 * time.Hour

var invitationTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{40,100}$`)

type TeamMemberAccess struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
	Email  string    `json:"email"`
	Role   string    `json:"role"`
}

type Invitation struct {
	ID         uuid.UUID  `json:"id"`
	Email      string     `json:"email"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	AcceptedAt *time.Time `json:"accepted_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
}

type TeamAccess struct {
	Members     []TeamMemberAccess `json:"members"`
	Invitations []Invitation       `json:"invitations"`
}

func (s *Service) Invite(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID, rawEmail string) (uuid.UUID, error) {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return uuid.Nil, err
	}
	if s.Jobs == nil {
		return uuid.Nil, httpx.E(503, "invite_delivery_unavailable", "Invitation email is not configured.")
	}
	appURL, err := invitationAppURL(s.AppURL)
	if err != nil {
		return uuid.Nil, httpx.E(503, "invite_delivery_unavailable", "Invitation email is not configured.")
	}
	address, err := mail.ParseAddress(strings.TrimSpace(rawEmail))
	if err != nil || address.Address == "" || address.Address != strings.TrimSpace(rawEmail) || len(address.Address) > 254 {
		return uuid.Nil, httpx.E(422, "invalid_email", "Enter a valid email address.")
	}
	emailAddress := strings.ToLower(address.Address)
	token, err := newInvitationToken()
	if err != nil {
		return uuid.Nil, fmt.Errorf("create workspace invitation token: %w", err)
	}
	var invitationID uuid.UUID
	var workspaceName string
	err = s.DB.Tx(ctx, func(tx pgx.Tx) error {
		// Serializing invitations on the workspace row keeps the hourly limit and
		// replacement of a pending invite correct when two requests race.
		if err := tx.QueryRow(ctx, `SELECT name FROM workspaces WHERE id=$1 FOR UPDATE`, workspaceID).Scan(&workspaceName); err != nil {
			if db.IsNotFound(err) {
				return httpx.E(404, "workspace_not_found", "Workspace not found.")
			}
			return fmt.Errorf("lock workspace for invitation: %w", err)
		}
		var isMember bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
			WHERE m.workspace_id=$1 AND lower(u.email)=$2
		)`, workspaceID, emailAddress).Scan(&isMember); err != nil {
			return fmt.Errorf("check invitation recipient membership: %w", err)
		}
		if isMember {
			return httpx.E(409, "already_member", "This person is already a member.")
		}
		var recentCount int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM workspace_invitations
			WHERE workspace_id=$1 AND created_at > now() - interval '1 hour'`, workspaceID).Scan(&recentCount); err != nil {
			return fmt.Errorf("count recent workspace invitations: %w", err)
		}
		if recentCount >= 10 {
			return httpx.E(429, "invitation_limit", "Invitation limit reached. Try again later.")
		}
		if _, err := tx.Exec(ctx, `UPDATE workspace_invitations SET revoked_at=now()
			WHERE workspace_id=$1 AND lower(email)=$2 AND accepted_at IS NULL AND revoked_at IS NULL`, workspaceID, emailAddress); err != nil {
			return fmt.Errorf("revoke prior pending workspace invitations: %w", err)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO workspace_invitations
			(workspace_id,email,role,token_hash,invited_by,expires_at)
			VALUES ($1,$2,'staff',$3,$4,$5) RETURNING id`, workspaceID, emailAddress,
			digestInvitationToken(token), principal.UserID, time.Now().UTC().Add(invitationTTL)).Scan(&invitationID); err != nil {
			return fmt.Errorf("save workspace invitation: %w", err)
		}
		link := appURL + "/accept-invite?token=" + url.QueryEscape(token)
		args := jobs.SystemEmailArgs{
			To: emailAddress, Subject: "Join " + workspaceName + " on Welio",
			Text: "You’ve been invited to join " + workspaceName + " as a staff member. Sign in or create an account with this email, then accept the invitation:\n\n" + link + "\n\nThis invitation expires in 7 days.",
		}
		args.InvitationID = &invitationID
		return jobs.EnqueueSystemEmailTx(ctx, tx, s.Jobs, args)
	})
	if err != nil {
		return uuid.Nil, err
	}
	return invitationID, nil
}

func (s *Service) InvitationDetail(ctx context.Context, principal *auth.Principal, token string) (*InvitationDetail, error) {
	if err := requireVerifiedInvitee(principal); err != nil {
		return nil, err
	}
	if !invitationTokenPattern.MatchString(token) {
		return nil, httpx.E(422, "invalid_invitation_token", "Open the invitation link from your email.")
	}
	var emailAddress string
	var emailVerified bool
	if err := s.DB.Pool.QueryRow(ctx, `SELECT email,email_verified FROM users WHERE id=$1`, principal.UserID).Scan(&emailAddress, &emailVerified); err != nil {
		if db.IsNotFound(err) {
			return nil, httpx.E(403, "invite_account_required", "Verify and sign in with the invited account.")
		}
		return nil, fmt.Errorf("load invitation recipient: %w", err)
	}
	if !emailVerified {
		return nil, httpx.E(403, "email_not_verified", "Verify your email address before accepting an invitation.")
	}
	var detail InvitationDetail
	var acceptedAt, revokedAt pgtype.Timestamptz
	err := s.DB.Pool.QueryRow(ctx, `SELECT i.id,i.workspace_id,w.name,i.email,i.expires_at,i.accepted_at,i.revoked_at
		FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id
		WHERE i.token_hash=$1`, digestInvitationToken(token)).Scan(
		&detail.ID, &detail.WorkspaceID, &detail.WorkspaceName, &detail.Email, &detail.ExpiresAt, &acceptedAt, &revokedAt)
	if db.IsNotFound(err) {
		return nil, invalidInvitation()
	}
	if err != nil {
		return nil, fmt.Errorf("load workspace invitation: %w", err)
	}
	detail.AcceptedAt, detail.RevokedAt = nullableTime(acceptedAt), nullableTime(revokedAt)
	if !strings.EqualFold(detail.Email, emailAddress) || detail.RevokedAt != nil || detail.AcceptedAt != nil || !detail.ExpiresAt.After(time.Now().UTC()) {
		return nil, invalidInvitation()
	}
	return &detail, nil
}

type InvitationDetail struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	WorkspaceName string     `json:"workspace_name"`
	Email         string     `json:"email"`
	ExpiresAt     time.Time  `json:"expires_at"`
	AcceptedAt    *time.Time `json:"accepted_at"`
	RevokedAt     *time.Time `json:"revoked_at"`
}

func (s *Service) AcceptInvitation(ctx context.Context, principal *auth.Principal, token string) (uuid.UUID, error) {
	if err := requireVerifiedInvitee(principal); err != nil {
		return uuid.Nil, err
	}
	if !invitationTokenPattern.MatchString(token) {
		return uuid.Nil, httpx.E(422, "invalid_invitation_token", "Open the invitation link from your email.")
	}
	var workspaceID uuid.UUID
	err := s.DB.Tx(ctx, func(tx pgx.Tx) error {
		var emailAddress string
		var emailVerified bool
		if err := tx.QueryRow(ctx, `SELECT email,email_verified FROM users WHERE id=$1`, principal.UserID).Scan(&emailAddress, &emailVerified); err != nil {
			if db.IsNotFound(err) {
				return httpx.E(403, "invite_account_required", "Verify and sign in with the invited account.")
			}
			return fmt.Errorf("load invitation recipient: %w", err)
		}
		if !emailVerified {
			return httpx.E(403, "email_not_verified", "Verify your email address before accepting an invitation.")
		}
		var invitationID uuid.UUID
		var inviteEmail string
		var expiresAt time.Time
		var acceptedAt, revokedAt pgtype.Timestamptz
		err := tx.QueryRow(ctx, `SELECT id,workspace_id,email,expires_at,accepted_at,revoked_at
			FROM workspace_invitations WHERE token_hash=$1 FOR UPDATE`, digestInvitationToken(token)).Scan(
			&invitationID, &workspaceID, &inviteEmail, &expiresAt, &acceptedAt, &revokedAt)
		if db.IsNotFound(err) {
			return invalidInvitation()
		}
		if err != nil {
			return fmt.Errorf("lock workspace invitation: %w", err)
		}
		if !strings.EqualFold(inviteEmail, emailAddress) || acceptedAt.Valid || revokedAt.Valid || !expiresAt.After(time.Now().UTC()) {
			return invalidInvitation()
		}
		if _, err := tx.Exec(ctx, `INSERT INTO memberships (workspace_id,user_id,role)
			VALUES ($1,$2,'staff') ON CONFLICT (workspace_id,user_id) DO NOTHING`, workspaceID, principal.UserID); err != nil {
			return fmt.Errorf("add invited workspace membership: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE workspace_invitations SET accepted_at=now()
			WHERE id=$1`, invitationID); err != nil {
			return fmt.Errorf("mark workspace invitation accepted: %w", err)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return workspaceID, nil
}

func (s *Service) ListTeamAccess(ctx context.Context, principal *auth.Principal, workspaceID uuid.UUID) (*TeamAccess, error) {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return nil, err
	}
	access := &TeamAccess{Members: []TeamMemberAccess{}, Invitations: []Invitation{}}
	rows, err := s.DB.Pool.Query(ctx, `SELECT u.id,u.name,u.email,m.role FROM memberships m
		JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.role,u.name,u.id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace members: %w", err)
	}
	for rows.Next() {
		var member TeamMemberAccess
		if err := rows.Scan(&member.UserID, &member.Name, &member.Email, &member.Role); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan workspace member: %w", err)
		}
		access.Members = append(access.Members, member)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate workspace members: %w", err)
	}
	rows.Close()

	rows, err = s.DB.Pool.Query(ctx, `SELECT id,email,created_at,expires_at,accepted_at,revoked_at
		FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC,id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace invitations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var invite Invitation
		var acceptedAt, revokedAt pgtype.Timestamptz
		if err := rows.Scan(&invite.ID, &invite.Email, &invite.CreatedAt, &invite.ExpiresAt, &acceptedAt, &revokedAt); err != nil {
			return nil, fmt.Errorf("scan workspace invitation: %w", err)
		}
		invite.AcceptedAt, invite.RevokedAt = nullableTime(acceptedAt), nullableTime(revokedAt)
		access.Invitations = append(access.Invitations, invite)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace invitations: %w", err)
	}
	return access, nil
}

func (s *Service) RevokeMember(ctx context.Context, principal *auth.Principal, workspaceID, targetUserID uuid.UUID) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	if principal.UserID == targetUserID {
		return httpx.E(422, "cannot_revoke_self", "You cannot revoke your own access.")
	}
	tag, err := s.DB.Pool.Exec(ctx, `DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role='staff'`, workspaceID, targetUserID)
	if err != nil {
		return fmt.Errorf("revoke workspace member access: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.E(404, "workspace_member_not_found", "Team member not found.")
	}
	return nil
}

func (s *Service) RevokeInvitation(ctx context.Context, principal *auth.Principal, workspaceID, invitationID uuid.UUID) error {
	if err := requireWorkspace(principal, workspaceID, true); err != nil {
		return err
	}
	tag, err := s.DB.Pool.Exec(ctx, `UPDATE workspace_invitations SET revoked_at=now()
		WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL`, workspaceID, invitationID)
	if err != nil {
		return fmt.Errorf("revoke workspace invitation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.E(404, "workspace_invitation_not_found", "Invitation not found.")
	}
	return nil
}

func requireVerifiedInvitee(principal *auth.Principal) error {
	if principal == nil {
		return httpx.E(401, "unauthenticated", "Sign in to continue.")
	}
	if !principal.EmailVerified {
		return httpx.E(403, "email_not_verified", "Verify your email address before accepting an invitation.")
	}
	return nil
}

func invalidInvitation() error {
	return httpx.E(422, "invalid_invitation", "This invitation is invalid, expired, already accepted, or addressed to another account.")
}

func newInvitationToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate invitation token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func digestInvitationToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func invitationAppURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("app URL must be an absolute http or https URL")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func nullableTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}
