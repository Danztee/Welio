// Command e2etest runs an isolated API fixture for browser regression tests.
// It refuses databases outside localhost or without the _test suffix.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/danztee/welio/internal/app"
	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/core/workspaces"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	raw := os.Getenv("WELIO_TEST_DATABASE_URL")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || !strings.HasSuffix(u.Path, "_test") || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return fmt.Errorf("WELIO_TEST_DATABASE_URL must identify a local disposable _test database")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := db.Migrate(ctx, raw); err != nil {
		return err
	}
	cfg := config.Config{Env: "test", Role: "api", HTTPAddr: "127.0.0.1:8181", DatabaseURL: raw, DatabaseURLDirect: raw,
		PublicURL: "http://127.0.0.1:3101", APIServerURL: "http://127.0.0.1:8181", TrustedOrigins: []string{"http://127.0.0.1:3101"},
		AuthSecret: []byte("welio-browser-tests-only-secret-12345"), AuthCookiePath: "/v1/auth", SignupEnabled: true, AWSRegion: "eu-north-1"}
	d, cleanup, err := app.Build(ctx, cfg, slog.Default())
	if err != nil {
		return err
	}
	defer cleanup()
	// Reset only this fixture's login quotas so repeated test runs are independent.
	for _, key := range []string{"login:email:browser@example.test", "login:ip:127.0.0.1", "register:ip:fixture"} {
		digest := sha256.Sum256([]byte(key))
		if _, err := d.DB.Pool.Exec(ctx, `DELETE FROM rate_limits WHERE key=$1`, hex.EncodeToString(digest[:])); err != nil {
			return err
		}
	}
	// Only fixture-owned records are replaced; the entire database is never cleared.
	_, err = d.DB.Pool.Exec(ctx, `DELETE FROM workspaces WHERE slug='browser-fixture'; DELETE FROM users WHERE email='browser@example.test'`)
	if err != nil {
		return err
	}
	account, err := auth.For(d).Register(ctx, auth.RegisterInput{FirstName: "Browser", LastName: "Owner", Email: "browser@example.test", Password: "Welio-browser-test-2026!"}, httpx.RequestMeta{IP: "fixture"})
	if err != nil {
		return err
	}
	_, err = d.DB.Pool.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, account.User.ID)
	if err != nil {
		return err
	}
	id, err := (&workspaces.Service{DB: d.DB}).Create(ctx, &auth.Principal{UserID: account.User.ID, EmailVerified: true}, workspaces.WorkspaceInput{Name: "Browser Fixture", Slug: "browser-fixture", ContactEmail: "browser@example.test", Phone: "+2348012345678", ServiceArea: "Ikeja", BookingLocation: "customer_address", TimeZone: "Africa/Lagos", Currency: "NGN"})
	if err != nil {
		return err
	}
	_, err = d.DB.Pool.Exec(ctx, `UPDATE workspaces SET onboarded=true WHERE id=$1`, id)
	if err != nil {
		return err
	}
	_, err = d.DB.Pool.Exec(ctx, `INSERT INTO customers(workspace_id,name,email,created_at) SELECT $1,'Customer ' || lpad(n::text,4,'0'),'customer-' || n || '@example.test','2026-10-19T08:00:00Z'::timestamptz FROM generate_series(1,1005) n`, id)
	if err != nil {
		return err
	}
	return app.Serve(ctx, d)
}
