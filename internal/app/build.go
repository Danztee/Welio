package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
)

func Build(ctx context.Context, cfg config.Config, log *slog.Logger) (*deps.Deps, func(), error) {
	database, err := db.Open(ctx, cfg.DatabaseURL, cfg.DatabaseURLDirect)
	if err != nil {
		return nil, nil, err
	}
	var mailerSender mailer.Sender
	if cfg.ZeptoMailToken != "" || cfg.EmailFrom != "" {
		mailerSender, err = mailer.NewZeptoMailSender(cfg.ZeptoMailToken, cfg.EmailFrom)
		if err != nil {
			database.Close()
			return nil, nil, err
		}
	}
	limiter := httpx.NewPostgresLimiter(database.Pool, log)
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(cfg.AWSRegion))
	if err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("initialize AWS configuration: %w", err)
	}
	d := &deps.Deps{
		Cfg:     cfg,
		Log:     log,
		DB:      database,
		Limiter: limiter,
		Mailer:  mailerSender,
		Bedrock: bedrockruntime.NewFromConfig(awsCfg),
	}
	workers := river.NewWorkers()
	periodicJobs := registerAreaWorkers(d, workers)
	riverConfig := &river.Config{Workers: workers, Logger: log.With("component", "river"), JobTimeout: time.Minute}
	if cfg.Role != "api" {
		riverConfig.Queues = map[string]river.QueueConfig{
			jobs.QueueEmail:       {MaxWorkers: 10},
			jobs.QueueMaintenance: {MaxWorkers: 1},
		}
		riverConfig.PeriodicJobs = periodicJobs
	}
	jobs, err := river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), riverConfig)
	if err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("create River client: %w", err)
	}
	d.Jobs = jobs
	return d, database.Close, nil
}
