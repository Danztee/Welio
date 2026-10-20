// Package core owns accounts, workspaces, and platform maintenance jobs.
package core

import (
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
	river.AddWorker(workers, &retentionWorker{database: d.DB})
	river.AddWorker(workers, &systemEmailWorker{sender: d.Mailer, database: d.DB})
}

func Periodic(*deps.Deps) []*river.PeriodicJob { return retentionJobs() }
