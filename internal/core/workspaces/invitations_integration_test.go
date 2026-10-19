package workspaces

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

func TestInvitationLifecycleAndAuthorization(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	ownerID := createTestUser(t, database, "Invitation Owner", "invite-owner")
	workspaceID, owner := createOwnerWorkspace(t, database, ownerID, "invites")
	recipientID := createTestUser(t, database, "Invited Staff", "invite-recipient")
	wrongRecipientID := createTestUser(t, database, "Wrong Account", "invite-wrong")
	defer func() {
		deleteWorkspaceAndUser(t, database, workspaceID, ownerID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, recipientID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, wrongRecipientID)
	}()
	var recipientEmail string
	if err := database.Pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, recipientID).Scan(&recipientEmail); err != nil {
		t.Fatal(err)
	}
	sender := &recordingInvitationSender{}
	service := newInvitationService(t, database, sender)

	staffPrincipal := &auth.Principal{UserID: recipientID, WorkspaceID: workspaceID, Role: "staff", EmailVerified: true}
	if _, err := service.Invite(ctx, staffPrincipal, workspaceID, "another@example.test"); errorCode(err) != "forbidden" {
		t.Fatalf("staff Invite() error = %v", err)
	}

	invitationID, err := service.Invite(ctx, owner, workspaceID, recipientEmail)
	if err != nil {
		t.Fatalf("Invite() = %v", err)
	}
	token := invitationTokenFromMessage(t, latestQueuedInvitationEmail(t, database, recipientEmail))
	var storedHash string
	if err := database.Pool.QueryRow(ctx, `SELECT token_hash FROM workspace_invitations WHERE id=$1`, invitationID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash != digestInvitationToken(token) || strings.Contains(storedHash, token) {
		t.Fatalf("stored token hash does not match the emailed token")
	}

	wrongPrincipal := &auth.Principal{UserID: wrongRecipientID, EmailVerified: true}
	if _, err := service.InvitationDetail(ctx, wrongPrincipal, token); errorCode(err) != "invalid_invitation" {
		t.Fatalf("wrong recipient invitation detail error = %v", err)
	}
	unverifiedPrincipal := &auth.Principal{UserID: recipientID, EmailVerified: false}
	if _, err := service.InvitationDetail(ctx, unverifiedPrincipal, token); errorCode(err) != "email_not_verified" {
		t.Fatalf("unverified recipient invitation detail error = %v", err)
	}
	if _, err := service.AcceptInvitation(ctx, unverifiedPrincipal, token); errorCode(err) != "email_not_verified" {
		t.Fatalf("unverified recipient accept error = %v", err)
	}

	recipient := &auth.Principal{UserID: recipientID, EmailVerified: true}
	detail, err := service.InvitationDetail(ctx, recipient, token)
	if err != nil || detail.ID != invitationID || detail.WorkspaceID != workspaceID || detail.WorkspaceName != "A Clean Business" {
		t.Fatalf("InvitationDetail() = %+v, %v", detail, err)
	}
	acceptedWorkspace, err := service.AcceptInvitation(ctx, recipient, token)
	if err != nil || acceptedWorkspace != workspaceID {
		t.Fatalf("AcceptInvitation() = %s, %v", acceptedWorkspace, err)
	}
	var role string
	if err := database.Pool.QueryRow(ctx, `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`, workspaceID, recipientID).Scan(&role); err != nil || role != "staff" {
		t.Fatalf("accepted membership role = %q, %v", role, err)
	}
	if _, err := service.AcceptInvitation(ctx, recipient, token); errorCode(err) != "invalid_invitation" {
		t.Fatalf("repeated AcceptInvitation() error = %v", err)
	}
	if _, err := service.Invite(ctx, owner, workspaceID, recipientEmail); errorCode(err) != "already_member" {
		t.Fatalf("Invite() for existing member error = %v", err)
	}

	access, err := service.ListTeamAccess(ctx, owner, workspaceID)
	if err != nil {
		t.Fatalf("ListTeamAccess() = %v", err)
	}
	if len(access.Members) != 2 || len(access.Invitations) != 1 || access.Invitations[0].ID != invitationID || access.Invitations[0].AcceptedAt == nil {
		t.Fatalf("team access after accept = %+v", access)
	}
	if err := service.RevokeMember(ctx, owner, workspaceID, ownerID); errorCode(err) != "cannot_revoke_self" {
		t.Fatalf("owner self-revoke error = %v", err)
	}
	if err := service.RevokeMember(ctx, owner, workspaceID, recipientID); err != nil {
		t.Fatalf("RevokeMember() = %v", err)
	}
	if err := service.RevokeMember(ctx, owner, workspaceID, recipientID); errorCode(err) != "workspace_member_not_found" {
		t.Fatalf("revoke absent staff error = %v", err)
	}

	outsiderID := createTestUser(t, database, "Another Owner", "invite-outsider")
	defer func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, outsiderID) }()
	outsiderWorkspaceID, outsider := createOwnerWorkspace(t, database, outsiderID, "outsider")
	defer func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, outsiderWorkspaceID)
	}()
	if _, err := service.ListTeamAccess(ctx, outsider, workspaceID); errorCode(err) != "workspace_forbidden" {
		t.Fatalf("cross-workspace invitation listing error = %v", err)
	}
}

func TestPendingInvitationReplacementRevocationAndDeliveryFailure(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	ownerID := createTestUser(t, database, "Invite Lifecycle Owner", "invite-flow-owner")
	workspaceID, owner := createOwnerWorkspace(t, database, ownerID, "invite-flow")
	defer deleteWorkspaceAndUser(t, database, workspaceID, ownerID)
	sender := &recordingInvitationSender{}
	service := newInvitationService(t, database, sender)
	const emailAddress = "pending@example.test"

	firstID, err := service.Invite(ctx, owner, workspaceID, emailAddress)
	if err != nil {
		t.Fatal(err)
	}
	firstToken := invitationTokenFromMessage(t, latestQueuedInvitationEmail(t, database, emailAddress))
	secondID, err := service.Invite(ctx, owner, workspaceID, emailAddress)
	if err != nil {
		t.Fatal(err)
	}
	secondToken := invitationTokenFromMessage(t, latestQueuedInvitationEmail(t, database, emailAddress))
	if firstID == secondID || firstToken == secondToken {
		t.Fatal("replacement invitation should use a new id and token")
	}
	var firstRevoked bool
	if err := database.Pool.QueryRow(ctx, `SELECT revoked_at IS NOT NULL FROM workspace_invitations WHERE id=$1`, firstID).Scan(&firstRevoked); err != nil || !firstRevoked {
		t.Fatalf("previous invitation revoked = %v, %v", firstRevoked, err)
	}
	if err := service.RevokeInvitation(ctx, owner, workspaceID, secondID); err != nil {
		t.Fatalf("RevokeInvitation() = %v", err)
	}
	var pending bool
	if err := database.Pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM workspace_invitations WHERE id=$1`, secondID).Scan(&pending); err != nil || pending {
		t.Fatalf("revoked invitation still pending = %v, %v", pending, err)
	}
	if err := service.RevokeInvitation(ctx, owner, workspaceID, secondID); errorCode(err) != "workspace_invitation_not_found" {
		t.Fatalf("repeat RevokeInvitation() error = %v", err)
	}
	pendingUserID := createTestUserWithEmail(t, database, "pending@example.test")
	defer func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, pendingUserID)
	}()
	pendingPrincipal := &auth.Principal{UserID: pendingUserID, EmailVerified: true}
	if _, err := service.InvitationDetail(ctx, pendingPrincipal, firstToken); errorCode(err) != "invalid_invitation" {
		t.Fatalf("replaced invitation detail error = %v", err)
	}
	if _, err := service.InvitationDetail(ctx, pendingPrincipal, secondToken); errorCode(err) != "invalid_invitation" {
		t.Fatalf("revoked invitation detail error = %v", err)
	}

	expiredID, err := service.Invite(ctx, owner, workspaceID, "expired@example.test")
	if err != nil {
		t.Fatal(err)
	}
	expiredToken := invitationTokenFromMessage(t, latestQueuedInvitationEmail(t, database, "expired@example.test"))
	if _, err := database.Pool.Exec(ctx, `UPDATE workspace_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1`, expiredID); err != nil {
		t.Fatal(err)
	}
	expiredUserID := createTestUserWithEmail(t, database, "expired@example.test")
	defer func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, expiredUserID)
	}()
	expiredPrincipal := &auth.Principal{UserID: expiredUserID, EmailVerified: true}
	if _, err := service.InvitationDetail(ctx, expiredPrincipal, expiredToken); errorCode(err) != "invalid_invitation" {
		t.Fatalf("expired invitation detail error = %v", err)
	}

	failedSender := &recordingInvitationSender{err: errors.New("mail provider unavailable")}
	failedService := newInvitationService(t, database, failedSender)
	failedInvitationID, err := failedService.Invite(ctx, owner, workspaceID, "delivery-retry@example.test")
	if err != nil {
		t.Fatalf("Invite() with provider unavailable = %v; durable queue should accept the invitation", err)
	}
	var invitationActive bool
	if err := database.Pool.QueryRow(ctx, `SELECT revoked_at IS NULL FROM workspace_invitations WHERE id=$1`, failedInvitationID).Scan(&invitationActive); err != nil || !invitationActive {
		t.Fatalf("queued invitation active = %v, %v", invitationActive, err)
	}
	var jobState string
	if err := database.Pool.QueryRow(ctx, `SELECT state FROM river_job WHERE kind='mail.system' AND args->>'to'='delivery-retry@example.test'`).Scan(&jobState); err != nil || jobState != "available" {
		t.Fatalf("queued invitation email state = %q, %v", jobState, err)
	}
	if len(failedSender.messages) != 0 {
		t.Fatal("Invite() called the provider instead of queuing email delivery")
	}

	canceledContext, cancel := context.WithCancel(ctx)
	cancel()
	canceledService := newInvitationService(t, database, &recordingInvitationSender{})
	if _, err := canceledService.Invite(canceledContext, owner, workspaceID, "canceled-delivery@example.test"); err == nil {
		t.Fatal("Invite() with a canceled transaction succeeded")
	}
	var canceledInvitations int
	if err := database.Pool.QueryRow(ctx, `SELECT count(*) FROM workspace_invitations WHERE email='canceled-delivery@example.test'`).Scan(&canceledInvitations); err != nil || canceledInvitations != 0 {
		t.Fatalf("invitation count after canceled transaction = %d, %v", canceledInvitations, err)
	}

	if _, err := service.Invite(ctx, owner, workspaceID, "not an email"); errorCode(err) != "invalid_email" {
		t.Fatalf("invalid email Invite() error = %v", err)
	}
	withoutQueue := &Service{DB: database, AppURL: "https://welio.example"}
	if _, err := withoutQueue.Invite(ctx, owner, workspaceID, "no-mailer@example.test"); errorCode(err) != "invite_delivery_unavailable" {
		t.Fatalf("Invite() without queue error = %v", err)
	}
}

func TestInvitationRateLimit(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	ownerID := createTestUser(t, database, "Rate Limit Owner", "invite-limit-owner")
	workspaceID, owner := createOwnerWorkspace(t, database, ownerID, "invite-limit")
	defer deleteWorkspaceAndUser(t, database, workspaceID, ownerID)
	service := newInvitationService(t, database, &recordingInvitationSender{})
	for index := range 10 {
		address := fmt.Sprintf("limit-%d@example.test", index)
		if _, err := service.Invite(ctx, owner, workspaceID, address); err != nil {
			t.Fatalf("Invite() #%d = %v", index+1, err)
		}
	}
	if _, err := service.Invite(ctx, owner, workspaceID, "limit-last@example.test"); errorCode(err) != "invitation_limit" {
		t.Fatalf("11th Invite() error = %v", err)
	}
}

type recordingInvitationSender struct {
	messages []mailer.Message
	err      error
	cancel   context.CancelFunc
}

func newInvitationService(t *testing.T, database *db.DB, _ mailer.Sender) *Service {
	t.Helper()
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(nil), &river.Config{})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	return &Service{DB: database, Jobs: jobs, AppURL: "https://welio.example"}
}

func latestQueuedInvitationEmail(t *testing.T, database *db.DB, to string) mailer.Message {
	t.Helper()
	var raw []byte
	err := database.Pool.QueryRow(context.Background(), `SELECT args FROM river_job
		WHERE kind='mail.system' AND args->>'to'=$1 ORDER BY id DESC LIMIT 1`, to).Scan(&raw)
	if err != nil {
		t.Fatalf("load queued invitation email: %v", err)
	}
	var args jobs.SystemEmailArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		t.Fatalf("decode queued invitation email: %v", err)
	}
	return mailer.Message{To: args.To, Subject: args.Subject, Text: args.Text}
}

func (s *recordingInvitationSender) Send(ctx context.Context, message mailer.Message) error {
	s.messages = append(s.messages, message)
	if s.cancel != nil {
		s.cancel()
		return ctx.Err()
	}
	return s.err
}

func invitationTokenFromMessage(t *testing.T, message mailer.Message) string {
	t.Helper()
	for _, field := range strings.Fields(message.Text) {
		parsed, err := url.Parse(field)
		if err == nil && parsed.Path == "/accept-invite" {
			if token := parsed.Query().Get("token"); token != "" {
				return token
			}
		}
	}
	t.Fatal("invitation email did not contain an invitation link")
	return ""
}

func createOwnerWorkspace(t *testing.T, database *db.DB, ownerID uuid.UUID, prefix string) (uuid.UUID, *auth.Principal) {
	t.Helper()
	principal := &auth.Principal{UserID: ownerID, EmailVerified: true}
	workspaceID, err := (&Service{DB: database}).Create(context.Background(), principal, validWorkspaceInput(prefix+"-"+uuid.NewString()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	principal.WorkspaceID, principal.Role = workspaceID, "owner"
	return workspaceID, principal
}

func createTestUserWithEmail(t *testing.T, database *db.DB, emailAddress string) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := database.Pool.QueryRow(context.Background(), `INSERT INTO users (name,first_name,last_name,email,email_verified,password_hash)
		VALUES ('Pending Invite','Pending','Invite',$1,true,'test-password-hash') RETURNING id`, emailAddress).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	return userID
}

func deleteWorkspaceAndUser(t *testing.T, database *db.DB, workspaceID, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	if _, err := database.Pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, workspaceID); err != nil {
		t.Errorf("delete test workspace: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID); err != nil {
		t.Errorf("delete test user: %v", err)
	}
}
