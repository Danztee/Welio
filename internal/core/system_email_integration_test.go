package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/dbtest"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

type recordingSystemMailer struct {
	mu       sync.Mutex
	messages []mailer.Message
}

func (sender *recordingSystemMailer) Send(_ context.Context, message mailer.Message) error {
	sender.mu.Lock()
	defer sender.mu.Unlock()
	sender.messages = append(sender.messages, message)
	return nil
}

func (sender *recordingSystemMailer) count() int {
	sender.mu.Lock()
	defer sender.mu.Unlock()
	return len(sender.messages)
}

func TestSystemEmailWorkerSkipsStaleGuardedMail(t *testing.T) {
	database := dbtest.OpenTestDB(t)
	ctx := context.Background()
	queue := "core_mail_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	sender := &recordingSystemMailer{}
	workers := river.NewWorkers()
	RegisterWorkers(&deps.Deps{Mailer: sender, DB: database}, workers)
	client, err := river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), &river.Config{
		Workers:           workers,
		Queues:            map[string]river.QueueConfig{queue: {MaxWorkers: 1}},
		FetchPollInterval: 20 * time.Millisecond,
		FetchCooldown:     20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("create River client: %v", err)
	}
	if err := client.Start(ctx); err != nil {
		t.Fatalf("start River worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.Stop(stopCtx); err != nil {
			t.Errorf("stop River worker: %v", err)
		}
	})

	args := jobs.SystemEmailArgs{To: "system@example.test", Subject: "Queued", Text: "Delivered by River"}
	if err := database.Tx(ctx, func(tx pgx.Tx) error {
		_, err := client.InsertTx(ctx, tx, args, &river.InsertOpts{Queue: queue, MaxAttempts: 8})
		return err
	}); err != nil {
		t.Fatalf("enqueue system email: %v", err)
	}
	waitForCoreEmailCount(t, sender, 1)

	staleInvitationID := uuid.New()
	for _, args := range []jobs.SystemEmailArgs{
		{To: "stale-invitation@example.test", Subject: "Stale invitation", Text: "Do not send", InvitationID: &staleInvitationID},
		{To: "stale-auth@example.test", Subject: "Stale auth", Text: "Do not send", AuthTokenHash: strings.Repeat("a", 64), AuthTokenPurpose: "verify_email"},
	} {
		if err := database.Tx(ctx, func(tx pgx.Tx) error {
			_, err := client.InsertTx(ctx, tx, args, &river.InsertOpts{Queue: queue, MaxAttempts: 8})
			return err
		}); err != nil {
			t.Fatalf("enqueue guarded system email: %v", err)
		}
		waitForSystemEmailState(t, ctx, database.Pool, args.To, "completed")
	}
	if got := sender.count(); got != 1 {
		t.Fatalf("delivered %d emails; stale guarded messages should be skipped", got)
	}
}

func waitForCoreEmailCount(t *testing.T, sender *recordingSystemMailer, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if sender.count() >= count {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("River delivered %d system emails; want at least %d", sender.count(), count)
}

func waitForSystemEmailState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, to, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var state string
		err := pool.QueryRow(ctx, `SELECT state FROM river_job WHERE kind=$1 AND args->>'to'=$2`, jobs.KindSystemEmail, to).Scan(&state)
		if err == nil && state == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("River system email for %q did not reach %q", to, want)
}

var _ mailer.Sender = (*recordingSystemMailer)(nil)
