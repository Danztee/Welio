package core

import (
	"context"
	"fmt"
	"time"

	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/jobs"
)

type retentionWorker struct {
	river.WorkerDefaults[jobs.CoreRetentionArgs]
	database *db.DB
}

func (w *retentionWorker) Work(ctx context.Context, _ *river.Job[jobs.CoreRetentionArgs]) error {
	// Bounded batches keep maintenance from holding locks on a busy API table.
	for _, query := range []string{
		`DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < now() LIMIT 10000)`,
		`DELETE FROM request_counters WHERE key IN (SELECT key FROM request_counters WHERE last_request < extract(epoch from now() - interval '7 days') * 1000 LIMIT 10000)`,
		`DELETE FROM welio_auth_tokens WHERE token_hash IN (SELECT token_hash FROM welio_auth_tokens WHERE expires_at < now() - interval '7 days' LIMIT 10000)`,
		`DELETE FROM welio_auth_sessions WHERE id IN (SELECT id FROM welio_auth_sessions WHERE max_expires_at < now() - interval '30 days' LIMIT 10000)`,
	} {
		if _, err := w.database.Pool.Exec(ctx, query); err != nil {
			return fmt.Errorf("purge expired platform state: %w", err)
		}
	}
	return nil
}

func retentionJobs() []*river.PeriodicJob {
	return []*river.PeriodicJob{river.NewPeriodicJob(river.PeriodicInterval(15*time.Minute), func() (river.JobArgs, *river.InsertOpts) {
		opts := jobs.CoreRetentionArgs{}.InsertOpts()
		return jobs.CoreRetentionArgs{}, &opts
	}, &river.PeriodicJobOpts{RunOnStart: true})}
}
