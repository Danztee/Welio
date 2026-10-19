package jobs

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

// EnqueueSystemEmailTx atomically schedules a system email with the operation that
// created its verification token or invitation.
func EnqueueSystemEmailTx(ctx context.Context, tx pgx.Tx, client *river.Client[pgx.Tx], args SystemEmailArgs) error {
	if client == nil {
		return errors.New("email job client is not configured")
	}
	if _, err := client.InsertTx(ctx, tx, args, nil); err != nil {
		return fmt.Errorf("enqueue system email: %w", err)
	}
	return nil
}
