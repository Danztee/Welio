// Package dbtest provides the PostgreSQL integration-test setup used across Welio.
package dbtest

import (
	"context"
	"net/url"
	"os"
	"path"
	"strings"
	"testing"
	"time"

	"github.com/danztee/welio/internal/db"
)

// OpenTestDB only uses an explicitly supplied local database whose name ends in _test.
// It never falls back to DATABASE_URL, so regular application data is never touched.
func OpenTestDB(t *testing.T) *db.DB {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("WELIO_TEST_DATABASE_URL"))
	if raw == "" {
		t.Skip("set WELIO_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		t.Fatal("WELIO_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	if !strings.HasSuffix(path.Base(u.Path), "_test") {
		t.Fatal("WELIO_TEST_DATABASE_URL database name must end with _test")
	}
	if host := u.Hostname(); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatal("WELIO_TEST_DATABASE_URL must point to a local PostgreSQL instance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := db.Open(ctx, raw, raw)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(database.Close)
	if err := db.Migrate(ctx, raw); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return database
}
