package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/danztee/welio/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PostgresRepository struct {
	DB *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{DB: database}
}

func (repository *PostgresRepository) Business(ctx context.Context, slug string) (Business, error) {
	if repository == nil || repository.DB == nil {
		return Business{}, errors.New("receptionist repository is not configured")
	}
	var business Business
	var rawSettings []byte
	err := repository.DB.Pool.QueryRow(ctx, `SELECT id::text, slug, name, currency, time_zone,
		booking_location, coalesce(business_address, ''), coalesce(contact_email, ''), phone,
		cancel_hours, is_published, receptionist_settings
		FROM workspaces WHERE slug = $1`, slug).Scan(
		&business.ID, &business.Slug, &business.Name, &business.Currency, &business.TimeZone,
		&business.BookingLocation, &business.BusinessAddress, &business.ContactEmail, &business.Phone,
		&business.CancelHours, &business.Published, &rawSettings,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Business{}, ErrNotFound
	}
	if err != nil {
		return Business{}, fmt.Errorf("load receptionist business: %w", err)
	}
	if !business.Published {
		return Business{}, ErrNotFound
	}
	business.Settings = defaultSettings()
	if len(rawSettings) > 0 {
		if err := json.Unmarshal(rawSettings, &business.Settings); err != nil {
			return Business{}, fmt.Errorf("decode receptionist settings: %w", err)
		}
	}
	if business.Settings.Greeting == "" {
		business.Settings.Greeting = defaultSettings().Greeting
	}
	if business.Settings.FAQs == nil {
		business.Settings.FAQs = []FAQ{}
	}
	return business, nil
}

func (repository *PostgresRepository) BusinessForWorkspace(ctx context.Context, workspaceID uuid.UUID) (Business, error) {
	if repository == nil || repository.DB == nil {
		return Business{}, errors.New("receptionist repository is not configured")
	}
	var business Business
	var rawSettings []byte
	err := repository.DB.Pool.QueryRow(ctx, `SELECT id::text, slug, name, currency, time_zone,
		booking_location, coalesce(business_address, ''), coalesce(contact_email, ''), phone,
		cancel_hours, is_published, receptionist_settings
		FROM workspaces WHERE id = $1`, workspaceID).Scan(
		&business.ID, &business.Slug, &business.Name, &business.Currency, &business.TimeZone,
		&business.BookingLocation, &business.BusinessAddress, &business.ContactEmail, &business.Phone,
		&business.CancelHours, &business.Published, &rawSettings,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Business{}, ErrNotFound
	}
	if err != nil {
		return Business{}, fmt.Errorf("load receptionist workspace: %w", err)
	}
	business.Settings = defaultSettings()
	if len(rawSettings) > 0 {
		if err := json.Unmarshal(rawSettings, &business.Settings); err != nil {
			return Business{}, fmt.Errorf("decode receptionist settings: %w", err)
		}
	}
	if business.Settings.Greeting == "" {
		business.Settings.Greeting = defaultSettings().Greeting
	}
	if business.Settings.FAQs == nil {
		business.Settings.FAQs = []FAQ{}
	}
	return business, nil
}

func (repository *PostgresRepository) SaveSettings(ctx context.Context, userID, workspaceID uuid.UUID, settings Settings) error {
	if repository == nil || repository.DB == nil {
		return errors.New("receptionist repository is not configured")
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encode receptionist settings: %w", err)
	}
	tag, err := repository.DB.Pool.Exec(ctx, `UPDATE workspaces w SET receptionist_settings = $3::jsonb
		FROM memberships m WHERE w.id = $1 AND m.workspace_id = w.id AND m.user_id = $2 AND m.role = 'owner'`,
		workspaceID, userID, string(encoded))
	if err != nil {
		return fmt.Errorf("save receptionist settings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repository *PostgresRepository) CreateSession(ctx context.Context, workspaceID, tokenHash string, expiresAt time.Time) (string, error) {
	var id string
	err := repository.DB.Pool.QueryRow(ctx, `INSERT INTO chat_sessions (workspace_id, token_hash, expires_at)
		VALUES ($1, $2, $3) RETURNING id::text`, workspaceID, tokenHash, expiresAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create receptionist chat session: %w", err)
	}
	return id, nil
}

func (repository *PostgresRepository) ListSessions(ctx context.Context, slug string, cookies []SessionCookie, now time.Time) ([]ChatSession, error) {
	if len(cookies) == 0 {
		return []ChatSession{}, nil
	}
	hashes := make([]string, 0, len(cookies))
	idByHash := make(map[string]string, len(cookies))
	for _, cookie := range cookies {
		hash := hashToken(cookie.Token)
		hashes = append(hashes, hash)
		idByHash[hash] = cookie.ID
	}
	rows, err := repository.DB.Pool.Query(ctx, `SELECT c.id::text, c.workspace_id::text, c.token_hash,
		c.messages, c.turns, c.active_turn, c.pending, coalesce(c.receipt::text, ''),
		coalesce(c.lease::text, ''), coalesce(c.lease_until, 'epoch'::timestamptz), c.expires_at, c.updated_at
		FROM chat_sessions c JOIN workspaces w ON w.id = c.workspace_id
		WHERE w.slug = $1 AND w.is_published = true AND c.expires_at > $2
		AND c.token_hash = ANY($3::text[]) ORDER BY c.updated_at DESC`, slug, now, hashes)
	if err != nil {
		return nil, fmt.Errorf("list receptionist chat sessions: %w", err)
	}
	defer rows.Close()
	sessions := make([]ChatSession, 0, len(cookies))
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan receptionist chat session: %w", err)
		}
		requestedID := idByHash[session.TokenHash]
		if requestedID != "" && requestedID != session.ID {
			continue
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate receptionist chat sessions: %w", err)
	}
	return sessions, nil
}

func (repository *PostgresRepository) LoadSession(ctx context.Context, slug, token string, now time.Time) (*ChatSession, error) {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin receptionist session lookup: %w", err)
	}
	defer tx.Rollback(ctx)
	session, err := lockSession(ctx, tx, slug, hashToken(token), now)
	if err != nil || session == nil {
		return session, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit receptionist session lookup: %w", err)
	}
	return session, nil
}

func (repository *PostgresRepository) ClaimTurn(ctx context.Context, slug, token, key, text string, now time.Time) (TurnClaim, error) {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return TurnClaim{}, fmt.Errorf("begin receptionist turn: %w", err)
	}
	defer tx.Rollback(ctx)
	session, err := lockSession(ctx, tx, slug, hashToken(token), now)
	if err != nil {
		return TurnClaim{}, err
	}
	if session == nil {
		return TurnClaim{Status: "unavailable"}, nil
	}
	for _, turn := range session.Turns {
		if turn.Key != key {
			continue
		}
		if turn.Text != text {
			return TurnClaim{Status: "message-key-reused"}, nil
		}
		return TurnClaim{Status: "cached", State: session.State()}, nil
	}
	if session.ActiveTurn != nil && (session.ActiveTurn.Key != key || session.ActiveTurn.Text != text) {
		return TurnClaim{Status: "retry-previous"}, nil
	}
	if session.Lease != "" && session.LeaseUntil.After(now) {
		return TurnClaim{Status: "busy"}, nil
	}
	if session.Receipt != "" {
		return TurnClaim{Status: "cached", State: session.State()}, nil
	}
	messageBytes, err := json.Marshal(session.Messages)
	if err != nil {
		return TurnClaim{}, fmt.Errorf("encode receptionist conversation: %w", err)
	}
	if len(session.Turns) >= MaxConversationTurns || len(messageBytes) > MaxConversationBytes {
		return TurnClaim{Status: "full"}, nil
	}
	lease := uuid.NewString()
	_, err = tx.Exec(ctx, `UPDATE chat_sessions SET lease = $2, lease_until = $3,
		active_turn = $4::jsonb, pending = NULL, updated_at = now()
		WHERE id = $1`, session.ID, lease, now.Add(LeaseLifetime), marshalJSON(ChatRetry{Key: key, Text: text}))
	if err != nil {
		return TurnClaim{}, fmt.Errorf("claim receptionist turn: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return TurnClaim{}, fmt.Errorf("commit receptionist turn claim: %w", err)
	}
	session.Lease = lease
	session.LeaseUntil = now.Add(LeaseLifetime)
	session.ActiveTurn = &ChatRetry{Key: key, Text: text}
	session.Pending = nil
	return TurnClaim{Status: "claimed", Session: session, Lease: lease}, nil
}

func (repository *PostgresRepository) SaveTurn(ctx context.Context, sessionID, lease string, messages []ChatMessage, turns []ChatTurn, pending *Proposal) (*ChatSession, error) {
	var session ChatSession
	var messagesJSON, turnsJSON, pendingJSON []byte
	var err error
	if messagesJSON, err = json.Marshal(messages); err != nil {
		return nil, fmt.Errorf("encode receptionist messages: %w", err)
	}
	if turnsJSON, err = json.Marshal(turns); err != nil {
		return nil, fmt.Errorf("encode receptionist turns: %w", err)
	}
	if pending != nil {
		if pendingJSON, err = json.Marshal(pending); err != nil {
			return nil, fmt.Errorf("encode receptionist proposal: %w", err)
		}
	}
	row := repository.DB.Pool.QueryRow(ctx, `UPDATE chat_sessions SET messages = $3::jsonb, turns = $4::jsonb,
		active_turn = NULL, pending = $5::jsonb, lease = NULL, lease_until = NULL, updated_at = now()
		WHERE id = $1 AND lease = $2 RETURNING id::text, workspace_id::text, token_hash, messages, turns,
		active_turn, pending, coalesce(receipt::text, ''), coalesce(lease::text, ''),
		coalesce(lease_until, 'epoch'::timestamptz), expires_at, updated_at`,
		sessionID, lease, messagesJSON, turnsJSON, nullableJSON(pendingJSON))
	if err := scanSessionRow(row, &session); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("save receptionist turn: %w", err)
	}
	return &session, nil
}

func (repository *PostgresRepository) ReleaseTurn(ctx context.Context, sessionID, lease string) error {
	_, err := repository.DB.Pool.Exec(ctx, `UPDATE chat_sessions SET lease = NULL, lease_until = NULL
		WHERE id = $1 AND lease = $2`, sessionID, lease)
	if err != nil {
		return fmt.Errorf("release receptionist turn: %w", err)
	}
	return nil
}

func (repository *PostgresRepository) ClaimChatConfirmation(ctx context.Context, slug, token, proposalID string, now time.Time) (TurnClaim, error) {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return TurnClaim{}, fmt.Errorf("begin chat proposal confirmation: %w", err)
	}
	defer tx.Rollback(ctx)
	session, err := lockSession(ctx, tx, slug, hashToken(token), now)
	if err != nil {
		return TurnClaim{}, err
	}
	if session == nil {
		return TurnClaim{Status: "unavailable"}, nil
	}
	if session.Receipt != "" {
		return TurnClaim{Status: "confirmed", State: session.State()}, nil
	}
	if session.Lease != "" && session.LeaseUntil.After(now) {
		return TurnClaim{Status: "busy"}, nil
	}
	if session.Pending == nil || session.Pending.ID != proposalID {
		return TurnClaim{Status: "stale"}, nil
	}
	if !session.Pending.ExpiresAt.After(now) {
		return TurnClaim{Status: "expired"}, nil
	}
	lease := uuid.NewString()
	_, err = tx.Exec(ctx, `UPDATE chat_sessions SET lease = $2, lease_until = $3, updated_at = now() WHERE id = $1`, session.ID, lease, now.Add(LeaseLifetime))
	if err != nil {
		return TurnClaim{}, fmt.Errorf("claim chat proposal confirmation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return TurnClaim{}, fmt.Errorf("commit chat proposal confirmation claim: %w", err)
	}
	session.Lease, session.LeaseUntil = lease, now.Add(LeaseLifetime)
	return TurnClaim{Status: "claimed", Session: session, Lease: lease}, nil
}

func (repository *PostgresRepository) CompleteChatConfirmation(ctx context.Context, sessionID, lease, appointmentID string) (*ChatSession, error) {
	var session ChatSession
	row := repository.DB.Pool.QueryRow(ctx, `UPDATE chat_sessions SET receipt = $3, pending = NULL,
		lease = NULL, lease_until = NULL, updated_at = now() WHERE id = $1 AND lease = $2
		RETURNING id::text, workspace_id::text, token_hash, messages, turns, active_turn, pending,
		coalesce(receipt::text, ''), coalesce(lease::text, ''), coalesce(lease_until, 'epoch'::timestamptz), expires_at, updated_at`,
		sessionID, lease, appointmentID)
	if err := scanSessionRow(row, &session); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("save chat confirmation result: %w", err)
	}
	return &session, nil
}

func (repository *PostgresRepository) RejectChatProposal(ctx context.Context, slug, token, proposalID string, now time.Time) (ChatState, string, error) {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ChatState{}, "", fmt.Errorf("begin chat proposal rejection: %w", err)
	}
	defer tx.Rollback(ctx)
	session, err := lockSession(ctx, tx, slug, hashToken(token), now)
	if err != nil {
		return ChatState{}, "", err
	}
	if session == nil {
		return ChatState{}, "unavailable", nil
	}
	if session.Lease != "" && session.LeaseUntil.After(now) {
		return ChatState{}, "busy", nil
	}
	if session.Pending == nil || session.Pending.ID != proposalID || session.Receipt != "" {
		return ChatState{}, "stale", nil
	}
	_, err = tx.Exec(ctx, `UPDATE chat_sessions SET pending = NULL, updated_at = now() WHERE id = $1`, session.ID)
	if err != nil {
		return ChatState{}, "", fmt.Errorf("reject chat proposal: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatState{}, "", fmt.Errorf("commit chat proposal rejection: %w", err)
	}
	session.Pending = nil
	return session.State(), "saved", nil
}

func (repository *PostgresRepository) ReserveModelCall(ctx context.Context, workspaceID string, maximum int, now time.Time) (bool, error) {
	key := "receptionist:daily:" + workspaceID + ":" + now.UTC().Format("2006-01-02")
	var count int
	err := repository.DB.Pool.QueryRow(ctx, `INSERT INTO request_counters (key, count, last_request)
		VALUES ($1, 1, $2) ON CONFLICT (key) DO UPDATE
		SET count = request_counters.count + 1, last_request = EXCLUDED.last_request
		WHERE request_counters.count < $3 RETURNING count`, key, now.UnixMilli(), maximum).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reserve receptionist model call: %w", err)
	}
	return true, nil
}

func (repository *PostgresRepository) SaveExternalProposal(ctx context.Context, workspaceID string, proposal ExternalProposal, tokenHash string, expiresAt time.Time) error {
	encoded, err := json.Marshal(proposal)
	if err != nil {
		return fmt.Errorf("encode external booking proposal: %w", err)
	}
	_, err = repository.DB.Pool.Exec(ctx, `INSERT INTO mcp_booking_proposals
		(id, workspace_id, idempotency_key, approval_token_hash, proposal, expires_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, proposal.ID, workspaceID, proposal.Input.Key, tokenHash, encoded, expiresAt)
	if err != nil {
		return fmt.Errorf("save external booking proposal: %w", err)
	}
	return nil
}

func (repository *PostgresRepository) ClaimExternalProposal(ctx context.Context, slug, proposalID, tokenHash string, now time.Time) (ProposalClaim, error) {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProposalClaim{}, fmt.Errorf("begin external proposal confirmation: %w", err)
	}
	defer tx.Rollback(ctx)
	var workspaceID, idempotencyKey, appointmentID, leaseID string
	var expiresAt, leaseUntil time.Time
	var rawProposal []byte
	err = tx.QueryRow(ctx, `SELECT p.workspace_id::text, p.idempotency_key,
		coalesce(p.confirmed_appointment_id::text, ''), coalesce(p.confirmation_lease::text, ''),
		coalesce(p.confirmation_lease_until, 'epoch'::timestamptz), p.expires_at, p.proposal
		FROM mcp_booking_proposals p JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.id = $1 AND p.approval_token_hash = $2 AND w.slug = $3 AND w.is_published = true
		FOR UPDATE OF p`, proposalID, tokenHash, slug).Scan(&workspaceID, &idempotencyKey, &appointmentID, &leaseID, &leaseUntil, &expiresAt, &rawProposal)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProposalClaim{Status: "invalid"}, nil
	}
	if err != nil {
		return ProposalClaim{}, fmt.Errorf("load external booking proposal: %w", err)
	}
	if appointmentID != "" {
		return ProposalClaim{Status: "confirmed", AppointmentID: appointmentID}, nil
	}
	if leaseID != "" && leaseUntil.After(now) {
		return ProposalClaim{Status: "busy"}, nil
	}
	var committedID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM appointments WHERE workspace_id = $1 AND idempotency_key = $2`, workspaceID, idempotencyKey).Scan(&committedID)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE mcp_booking_proposals SET confirmed_appointment_id = $2, proposal = NULL,
			confirmation_lease = NULL, confirmation_lease_until = NULL WHERE id = $1`, proposalID, committedID)
		if err != nil {
			return ProposalClaim{}, fmt.Errorf("reconcile external proposal confirmation: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return ProposalClaim{}, fmt.Errorf("commit external proposal reconciliation: %w", err)
		}
		return ProposalClaim{Status: "confirmed", AppointmentID: committedID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ProposalClaim{}, fmt.Errorf("check external proposal booking result: %w", err)
	}
	if !expiresAt.After(now) {
		return ProposalClaim{Status: "expired"}, nil
	}
	if len(rawProposal) == 0 || string(rawProposal) == "null" {
		return ProposalClaim{Status: "invalid"}, nil
	}
	var proposal ExternalProposal
	if err := json.Unmarshal(rawProposal, &proposal); err != nil {
		return ProposalClaim{}, fmt.Errorf("decode external booking proposal: %w", err)
	}
	lease := uuid.NewString()
	_, err = tx.Exec(ctx, `UPDATE mcp_booking_proposals SET confirmation_lease = $2,
		confirmation_lease_until = $3 WHERE id = $1`, proposalID, lease, now.Add(LeaseLifetime))
	if err != nil {
		return ProposalClaim{}, fmt.Errorf("claim external booking proposal: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ProposalClaim{}, fmt.Errorf("commit external proposal claim: %w", err)
	}
	return ProposalClaim{Status: "claimed", Proposal: proposal, Lease: lease}, nil
}

func (repository *PostgresRepository) CompleteExternalProposal(ctx context.Context, proposalID, lease, appointmentID string) (bool, error) {
	tag, err := repository.DB.Pool.Exec(ctx, `UPDATE mcp_booking_proposals SET confirmed_appointment_id = $3,
		proposal = NULL, confirmation_lease = NULL, confirmation_lease_until = NULL
		WHERE id = $1 AND confirmation_lease = $2`, proposalID, lease, appointmentID)
	if err != nil {
		return false, fmt.Errorf("complete external booking proposal: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (repository *PostgresRepository) ReleaseExternalProposal(ctx context.Context, proposalID, lease string) error {
	_, err := repository.DB.Pool.Exec(ctx, `UPDATE mcp_booking_proposals SET confirmation_lease = NULL,
		confirmation_lease_until = NULL WHERE id = $1 AND confirmation_lease = $2`, proposalID, lease)
	if err != nil {
		return fmt.Errorf("release external booking proposal: %w", err)
	}
	return nil
}

func (repository *PostgresRepository) PurgeExpiredProposals(ctx context.Context, now time.Time) error {
	tx, err := repository.DB.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin expired proposal cleanup: %w", err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE mcp_booking_proposals AS proposal
		SET confirmed_appointment_id = appointment.id, proposal = NULL,
			confirmation_lease = NULL, confirmation_lease_until = NULL
		FROM appointments AS appointment
		WHERE proposal.confirmed_appointment_id IS NULL AND proposal.proposal IS NOT NULL
		  AND proposal.expires_at <= $1
		  AND (proposal.confirmation_lease_until IS NULL OR proposal.confirmation_lease_until <= $1)
		  AND appointment.workspace_id = proposal.workspace_id
		  AND appointment.idempotency_key = proposal.idempotency_key`, now)
	if err != nil {
		return fmt.Errorf("reconcile expired booking proposals: %w", err)
	}
	_, err = tx.Exec(ctx, `DELETE FROM mcp_booking_proposals WHERE expires_at <= $1
		AND confirmed_appointment_id IS NULL
		AND (confirmation_lease_until IS NULL OR confirmation_lease_until <= $1)`, now)
	if err != nil {
		return fmt.Errorf("delete expired booking proposals: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit expired proposal cleanup: %w", err)
	}
	return nil
}

func (repository *PostgresRepository) PurgeExpiredSessions(ctx context.Context, now time.Time) error {
	if repository == nil || repository.DB == nil {
		return errors.New("receptionist repository is not configured")
	}
	if _, err := repository.DB.Pool.Exec(ctx, `DELETE FROM chat_sessions
		WHERE expires_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)`, now); err != nil {
		return fmt.Errorf("delete expired receptionist chat sessions: %w", err)
	}
	return nil
}

func lockSession(ctx context.Context, tx pgx.Tx, slug, tokenHash string, now time.Time) (*ChatSession, error) {
	var session ChatSession
	row := tx.QueryRow(ctx, `SELECT c.id::text, c.workspace_id::text, c.token_hash, c.messages, c.turns,
		c.active_turn, c.pending, coalesce(c.receipt::text, ''), coalesce(c.lease::text, ''),
		coalesce(c.lease_until, 'epoch'::timestamptz), c.expires_at, c.updated_at
		FROM chat_sessions c JOIN workspaces w ON w.id = c.workspace_id
		WHERE c.token_hash = $1 AND w.slug = $2 AND w.is_published = true AND c.expires_at > $3
		FOR UPDATE OF c`, tokenHash, slug, now)
	if err := scanSessionRow(row, &session); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load receptionist chat session: %w", err)
	}
	if session.Receipt == "" && session.Pending != nil {
		var appointmentID string
		err := tx.QueryRow(ctx, `SELECT id::text FROM appointments WHERE workspace_id = $1 AND idempotency_key = $2`, session.WorkspaceID, session.Pending.Input.Key).Scan(&appointmentID)
		if err == nil {
			if _, err := tx.Exec(ctx, `UPDATE chat_sessions SET receipt = $2, pending = NULL, lease = NULL, lease_until = NULL WHERE id = $1`, session.ID, appointmentID); err != nil {
				return nil, fmt.Errorf("reconcile receptionist booking receipt: %w", err)
			}
			session.Receipt, session.Pending, session.Lease = appointmentID, nil, ""
			session.LeaseUntil = time.Time{}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("check receptionist booking receipt: %w", err)
		}
	}
	return &session, nil
}

type rowScanner interface{ Scan(...any) error }

func scanSession(rows pgx.Rows) (ChatSession, error) {
	var session ChatSession
	err := scanSessionFields(rows, &session)
	return session, err
}

func scanSessionRow(row rowScanner, session *ChatSession) error {
	return scanSessionFields(row, session)
}

func scanSessionFields(row rowScanner, session *ChatSession) error {
	var messagesJSON, turnsJSON, activeJSON, pendingJSON []byte
	err := row.Scan(&session.ID, &session.WorkspaceID, &session.TokenHash, &messagesJSON, &turnsJSON,
		&activeJSON, &pendingJSON, &session.Receipt, &session.Lease, &session.LeaseUntil,
		&session.ExpiresAt, &session.UpdatedAt)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(messagesJSON, &session.Messages); err != nil {
		return fmt.Errorf("decode messages: %w", err)
	}
	if err := json.Unmarshal(turnsJSON, &session.Turns); err != nil {
		return fmt.Errorf("decode turns: %w", err)
	}
	if len(activeJSON) > 0 && string(activeJSON) != "null" {
		var active ChatRetry
		if err := json.Unmarshal(activeJSON, &active); err != nil {
			return fmt.Errorf("decode active turn: %w", err)
		}
		session.ActiveTurn = &active
	}
	if len(pendingJSON) > 0 && string(pendingJSON) != "null" {
		var pending Proposal
		if err := json.Unmarshal(pendingJSON, &pending); err != nil {
			return fmt.Errorf("decode pending proposal: %w", err)
		}
		session.Pending = &pending
	}
	if session.Messages == nil {
		session.Messages = []ChatMessage{}
	}
	if session.Turns == nil {
		session.Turns = []ChatTurn{}
	}
	return nil
}

func marshalJSON(value any) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func nullableJSON(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func defaultSettings() Settings {
	return Settings{
		Enabled:           true,
		Greeting:          "Hello! How can I help you find a service or book an appointment?",
		AllowAvailability: true,
		AllowBooking:      true,
		FAQs:              []FAQ{},
	}
}
