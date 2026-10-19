// Package app wires the API and worker dependencies and controls process lifecycle.
package app

import (
	"log/slog"
	"os"

	"github.com/danztee/welio/internal/config"
)

func NewLogger(cfg config.Config) *slog.Logger {
	if cfg.Env == "production" {
		return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
}
