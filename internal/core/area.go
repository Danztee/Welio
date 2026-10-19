// Package core composes account, workspace, and platform-mail capabilities into one
// application area, following OpenDesk's core registration boundary.
package core

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/core/workspaces"
	"github.com/danztee/welio/internal/deps"
)

func Register(d *deps.Deps, api huma.API, router chi.Router) {
	auth.Register(d, api, router)
	workspaces.Register(d, api, router)
}

func RegisterWorkers(d *deps.Deps, workers *river.Workers) {
	river.AddWorker(workers, &systemEmailWorker{sender: d.Mailer, database: d.DB})
}

func Periodic(*deps.Deps) []*river.PeriodicJob { return nil }

func Background(context.Context, *deps.Deps) {}
