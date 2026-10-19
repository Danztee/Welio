package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/deps"
)

func TestReceptionistHTTPRejectsNonmembersAndRevokedMembership(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	fixture := seedMCPFixture(t, ctx, database)
	outsider := uuid.New()
	_, err := database.Pool.Exec(ctx, `INSERT INTO users(id,name,email,email_verified,password_hash) VALUES($1,'Outsider',$2,true,'unused')`, outsider, outsider.String()+"@example.test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM workspaces WHERE id=$1`, fixture.workspaceID)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1 OR id=$2`, fixture.userID, outsider)
	})
	secret := []byte(strings.Repeat("s", 32))
	router := Router(&deps.Deps{DB: database, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Cfg: config.Config{AuthSecret: secret, PublicURL: "https://welio.example"}})
	tokens := auth.NewTokens(secret)
	call := func(user uuid.UUID) int {
		session := uuid.New()
		_, err := database.Pool.Exec(ctx, `INSERT INTO welio_auth_sessions(id,user_id,refresh_hash,expires_at,max_expires_at) VALUES($1,$2,$3,now()+interval '1 day',now()+interval '30 days')`, session, user, uuid.NewString())
		if err != nil {
			t.Fatal(err)
		}
		token, _, err := tokens.Sign(auth.Claims{Purpose: auth.PurposeAccess, SessionID: session.String()}, user.String(), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodGet, "/v1/workspaces/"+fixture.workspaceID.String()+"/receptionist", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set(auth.WorkspaceHeader, fixture.workspaceID.String())
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response.Code
	}
	if got := call(fixture.userID); got != 200 {
		t.Fatalf("owner response=%d", got)
	}
	if got := call(outsider); got == 200 {
		t.Fatal("HTTP nonmember read settings")
	}
	_, err = database.Pool.Exec(ctx, `DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2`, fixture.workspaceID, fixture.userID)
	if err != nil {
		t.Fatal(err)
	}
	if got := call(fixture.userID); got == 200 {
		t.Fatal("revoked HTTP membership retained access")
	}
}
