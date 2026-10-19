// Package deps holds explicit dependencies shared by Welio backend areas.
package deps

import (
	"log/slog"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/mailer"
)

type Deps struct {
	Cfg     config.Config
	Log     *slog.Logger
	DB      *db.DB
	Limiter *httpx.Limiter
	Mailer  mailer.Sender
	Bedrock *bedrockruntime.Client
	Jobs    *river.Client[pgx.Tx]
}
