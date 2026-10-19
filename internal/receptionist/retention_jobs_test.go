package receptionist

import (
	"context"
	"testing"
	"time"
)

func TestRetentionSweepPurgesExpiredProposalsAndSessions(t *testing.T) {
	repository := newFakeRepository()
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	service := &Service{Repository: repository, Now: func() time.Time { return now }}
	worker := &retentionSweepWorker{service: service}

	if err := worker.Work(context.Background(), nil); err != nil {
		t.Fatalf("run retention sweep: %v", err)
	}
	if repository.purgedProposals != 1 || repository.purgedSessions != 1 {
		t.Fatalf("purge calls = proposals:%d sessions:%d, want one each", repository.purgedProposals, repository.purgedSessions)
	}
	if !repository.purgeTime.Equal(now) {
		t.Fatalf("purge used %s, want %s", repository.purgeTime, now)
	}
}
