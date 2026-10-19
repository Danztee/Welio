package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/danztee/welio/internal/deps"
)

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
	server := &http.Server{
		Addr:              d.Cfg.HTTPAddr,
		Handler:           HandlerForRole(d),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
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
