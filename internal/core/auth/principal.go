package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

const WorkspaceHeader = "X-Welio-Workspace"

type Principal struct {
	UserID          uuid.UUID
	SessionID       uuid.UUID
	Email           string
	EmailVerified   bool
	WorkspaceID     uuid.UUID
	Role            string
	accessExpiresAt time.Time
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, principal *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, principal)
}

func FromContext(ctx context.Context) *Principal {
	principal, _ := ctx.Value(principalKey{}).(*Principal)
	return principal
}

type Resolver struct {
	DB     *db.DB
	Tokens *Tokens
	Log    *slog.Logger
}

func (resolver *Resolver) Middleware(next http.Handler) http.Handler {
	log := resolver.Log
	if log == nil {
		log = slog.Default()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := resolver.resolve(r)
		if err != nil {
			log.ErrorContext(r.Context(), "resolve browser session", "request_id", httpx.RequestIDFrom(r.Context()), "error", err)
			httpx.WriteProblem(w, r, httpx.E(http.StatusServiceUnavailable, "auth_unavailable", "We couldn’t check your session. Please try again."))
			return
		}
		if principal != nil {
			w.Header().Set(httpx.AccessTTLHeader, strconv.Itoa(max(0, int(time.Until(principal.accessExpiresAt).Seconds()))))
			r = r.WithContext(WithPrincipal(r.Context(), principal))
		}
		next.ServeHTTP(w, r)
	})
}

func (resolver *Resolver) resolve(r *http.Request) (*Principal, error) {
	var token string
	if scheme, value, ok := strings.Cut(r.Header.Get("Authorization"), " "); ok && strings.EqualFold(scheme, "Bearer") {
		token = strings.TrimSpace(value)
	} else {
		token = httpx.RequestMetaFrom(r.Context()).AccessCookie
	}
	if token == "" {
		return nil, nil
	}
	claims, err := resolver.Tokens.Verify(token, PurposeAccess)
	if err != nil {
		return nil, nil
	}
	userID, userErr := uuid.Parse(claims.Subject)
	sessionID, sessionErr := uuid.Parse(claims.SessionID)
	if userErr != nil || sessionErr != nil {
		return nil, nil
	}
	principal := &Principal{UserID: userID, SessionID: sessionID, accessExpiresAt: claims.ExpiresAt.Time}
	err = resolver.DB.Pool.QueryRow(r.Context(), `SELECT u.email, u.email_verified
		FROM welio_auth_sessions s JOIN users u ON u.id = s.user_id
		WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
		  AND s.expires_at > now() AND s.max_expires_at > now()`, sessionID, userID).
		Scan(&principal.Email, &principal.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read account session: %w", err)
	}
	if workspaceID, err := uuid.Parse(r.Header.Get(WorkspaceHeader)); err == nil {
		err := resolver.DB.Pool.QueryRow(r.Context(), `SELECT m.role
			FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.workspace_id = $1 AND m.user_id = $2`, workspaceID, userID).Scan(&principal.Role)
		if err == nil {
			principal.WorkspaceID = workspaceID
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("read workspace membership: %w", err)
		}
	}
	return principal, nil
}

var (
	ErrUnauthenticated = errors.New("authentication required")
	ErrForbidden       = errors.New("you do not have permission to do that")
	ErrNoWorkspace     = errors.New("select a workspace for this request")
)

func RequireUser(ctx context.Context) (*Principal, error) {
	principal := FromContext(ctx)
	if principal == nil {
		return nil, httpx.E(http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
	}
	return principal, nil
}

func RequireVerifiedUser(ctx context.Context) (*Principal, error) {
	principal, err := RequireUser(ctx)
	if err != nil {
		return nil, err
	}
	if !principal.EmailVerified {
		return nil, httpx.E(http.StatusForbidden, "email_not_verified", "Verify your email address to continue.")
	}
	return principal, nil
}

func RequireWorkspace(ctx context.Context, minimumRole string) (*Principal, error) {
	principal, err := RequireVerifiedUser(ctx)
	if err != nil {
		return nil, err
	}
	if principal.WorkspaceID == uuid.Nil {
		return nil, httpx.E(http.StatusBadRequest, "workspace_required", ErrNoWorkspace.Error())
	}
	if minimumRole == "owner" && principal.Role != "owner" {
		return nil, httpx.E(http.StatusForbidden, "forbidden", ErrForbidden.Error())
	}
	if minimumRole != "owner" && minimumRole != "staff" {
		return nil, errors.New("unknown minimum workspace role")
	}
	if principal.Role != "owner" && principal.Role != "staff" {
		return nil, httpx.E(http.StatusForbidden, "forbidden", ErrForbidden.Error())
	}
	return principal, nil
}
