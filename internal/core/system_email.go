package core

import (
	"context"
	"errors"
	"fmt"

	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

type systemEmailWorker struct {
	river.WorkerDefaults[jobs.SystemEmailArgs]
	sender   mailer.Sender
	database *db.DB
}

func (worker *systemEmailWorker) Work(ctx context.Context, job *river.Job[jobs.SystemEmailArgs]) error {
	if worker.sender == nil {
		return errors.New("transactional email sender is not configured")
	}
	args := job.Args
	if (args.AuthTokenHash != "" || args.InvitationID != nil) && worker.database == nil {
		return errors.New("email delivery guard database is not configured")
	}
	if args.AuthTokenHash != "" {
		var eligible bool
		if err := worker.database.Pool.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM welio_auth_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at > now()
		)`, args.AuthTokenHash, args.AuthTokenPurpose).Scan(&eligible); err != nil {
			return fmt.Errorf("check queued authentication email token: %w", err)
		}
		if !eligible {
			return nil
		}
	}
	if args.InvitationID != nil {
		var eligible bool
		if err := worker.database.Pool.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM workspace_invitations WHERE id=$1 AND lower(email)=lower($2)
			  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
		)`, *args.InvitationID, args.To).Scan(&eligible); err != nil {
			return fmt.Errorf("check queued invitation email: %w", err)
		}
		if !eligible {
			return nil
		}
	}
	if err := worker.sender.Send(ctx, mailer.Message{To: args.To, Subject: args.Subject, Text: args.Text}); err != nil {
		return fmt.Errorf("send system email: %w", err)
	}
	return nil
}
