// Package app wires the API and worker dependencies and controls process lifecycle.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"

	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/httpx"
	"github.com/danztee/welio/internal/jobs"
	"github.com/danztee/welio/internal/mailer"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

func NewLogger(cfg config.Config) *slog.Logger {
	if cfg.Env == "production" {
		return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

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
	limiter := httpx.NewLimiter()
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(cfg.AWSRegion))
	if err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("initialize AWS configuration: %w", err)
	}
	d := &deps.Deps{
		Cfg: cfg, Log: log, DB: database, Limiter: limiter, Mailer: mailerSender,
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

func Serve(ctx context.Context, d *deps.Deps) error {
	workerStarted := false
	if d.Cfg.Role != "api" {
		if err := d.Jobs.Start(ctx); err != nil {
			return fmt.Errorf("start River workers: %w", err)
		}
		workerStarted = true
		for _, feature := range areas {
			go feature.background(ctx, d)
		}
		d.Log.Info("background workers started", "role", d.Cfg.Role)
	}
	server := &http.Server{Addr: d.Cfg.HTTPAddr, Handler: HandlerForRole(d), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 90 * time.Second}
	serverErr := make(chan error, 1)
	go func() {
		d.Log.Info("Welio API listening", "addr", d.Cfg.HTTPAddr, "role", d.Cfg.Role)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()
	select {
	case err := <-serverErr:
		if workerStarted {
			stopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if stopErr := d.Jobs.Stop(stopCtx); stopErr != nil {
				return fmt.Errorf("stop River workers after server error: %w", stopErr)
			}
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown HTTP server: %w", err)
		}
		if workerStarted {
			if err := d.Jobs.Stop(shutdownCtx); err != nil {
				return fmt.Errorf("stop River workers: %w", err)
			}
		}
		return <-serverErr
	}
}
