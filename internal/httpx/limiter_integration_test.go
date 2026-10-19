package httpx

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/danztee/welio/internal/dbtest"
)

func TestPostgresLimitsAreAtomicAndSharedAcrossInstances(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := NewPostgresLimiter(database.Pool, log)
	b := NewPostgresLimiter(database.Pool, log)
	key := "shared-limit-test:" + uuid.NewString()
	var allowed atomic.Int32
	var workers sync.WaitGroup
	for i := 0; i < 40; i++ {
		workers.Go(func() {
			if a.Allow(key, 7, time.Minute) {
				allowed.Add(1)
			}
			if b.Allow(key, 7, time.Minute) {
				allowed.Add(1)
			}
		})
	}
	workers.Wait()
	if allowed.Load() != 7 {
		t.Fatalf("allowed %d across two replicas, want 7", allowed.Load())
	}
	restarted := NewPostgresLimiter(database.Pool, log)
	if restarted.Allow(key, 7, time.Minute) {
		t.Fatal("new replica reset quota")
	}
	// Force expiry without waiting; a fresh window must accept exactly its limit.
	if _, err := database.Pool.Exec(context.Background(), `UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1`, limitKey(key)); err != nil {
		t.Fatal(err)
	}
	if !b.Allow(key, 1, time.Minute) || a.Allow(key, 1, time.Minute) {
		t.Fatal("quota did not reset on expiry")
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key=$1`, limitKey(key))
	})
}
