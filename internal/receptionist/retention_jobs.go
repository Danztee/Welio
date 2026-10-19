package receptionist

import (
	"context"
	"fmt"
	"time"

	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/jobs"
)

type retentionSweepArgs = jobs.ReceptionistRetentionSweepArgs

type retentionSweepWorker struct {
	river.WorkerDefaults[retentionSweepArgs]
	service *Service
}

func (worker *retentionSweepWorker) Work(ctx context.Context, _ *river.Job[retentionSweepArgs]) error {
	now := worker.service.now()
	if err := worker.service.Repository.PurgeExpiredProposals(ctx, now); err != nil {
		return fmt.Errorf("purge expired booking proposals: %w", err)
	}
	if err := worker.service.Repository.PurgeExpiredSessions(ctx, now); err != nil {
		return fmt.Errorf("purge expired chat sessions: %w", err)
	}
	return nil
}

// RegisterWorkersForService installs retention cleanup for a test or standalone service.
func RegisterWorkersForService(workers *river.Workers, service *Service) {
	river.AddWorker(workers, &retentionSweepWorker{service: service})
}

// PeriodicJobs schedules retention cleanup so expired records are removed even
// when the business has no new receptionist traffic.
func PeriodicJobs() []*river.PeriodicJob {
	return []*river.PeriodicJob{
		river.NewPeriodicJob(river.PeriodicInterval(15*time.Minute), func() (river.JobArgs, *river.InsertOpts) {
			opts := retentionSweepArgs{}.InsertOpts()
			return retentionSweepArgs{}, &opts
		}, &river.PeriodicJobOpts{RunOnStart: true}),
	}
}
