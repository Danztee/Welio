package catalog

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/deps"
)

// For builds the catalog service from shared application dependencies.
func For(d *deps.Deps) *Service { return &Service{DB: d.DB} }

// Register installs catalog routes.
func Register(d *deps.Deps, api huma.API, _ chi.Router) { RegisterAPI(For(d), api) }

// RegisterWorkers adds this area's background workers; the catalog has none.
func RegisterWorkers(*deps.Deps, *river.Workers) {}

// Periodic returns this area's scheduled jobs; the catalog has none.
func Periodic(*deps.Deps) []*river.PeriodicJob { return nil }

// Background runs this area's long-lived processes; the catalog has none.
func Background(context.Context, *deps.Deps) {}
