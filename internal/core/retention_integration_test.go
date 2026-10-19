package core

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/dbtest"
)

func TestRetentionPreservesActiveQuotaAndAuthenticationRecords(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	user := uuid.New()
	_, err := database.Pool.Exec(ctx, `INSERT INTO users(id,name,email,password_hash) VALUES($1,'Retention',$2,'unused')`, user, user.String()+"@example.test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, user) })
	active, expired := uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key=$1 OR key=$2`, active, expired)
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM request_counters WHERE key=$1 OR key=$2`, active, expired)
	})
	for _, item := range []struct {
		key  string
		days int
	}{{active, 1}, {expired, -60}} {
		when := time.Now().AddDate(0, 0, item.days)
		if _, err := database.Pool.Exec(ctx, `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,$2)`, item.key, when); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Pool.Exec(ctx, `INSERT INTO request_counters(key,count,last_request) VALUES($1,1,$2)`, item.key, when.UnixMilli()); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Pool.Exec(ctx, `INSERT INTO welio_auth_tokens(user_id,email,purpose,token_hash,expires_at) VALUES($1,'retention@example.test','verify_email',$2,$3)`, user, item.key, when); err != nil {
			t.Fatal(err)
		}
		if _, err := database.Pool.Exec(ctx, `INSERT INTO welio_auth_sessions(user_id,refresh_hash,expires_at,max_expires_at) VALUES($1,$2,$3,$3)`, user, item.key, when); err != nil {
			t.Fatal(err)
		}
	}
	if err := (&retentionWorker{database: database}).Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`SELECT EXISTS(SELECT 1 FROM rate_limits WHERE key=$1)`,
		`SELECT EXISTS(SELECT 1 FROM request_counters WHERE key=$1)`,
		`SELECT EXISTS(SELECT 1 FROM welio_auth_tokens WHERE token_hash=$1)`,
		`SELECT EXISTS(SELECT 1 FROM welio_auth_sessions WHERE refresh_hash=$1)`,
	} {
		for _, item := range []struct {
			key  string
			want bool
		}{{active, true}, {expired, false}} {
			var exists bool
			if err := database.Pool.QueryRow(ctx, query, item.key).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if exists != item.want {
				t.Fatalf("retention preserved=%v, want=%v for %s", exists, item.want, query)
			}
		}
	}
}
