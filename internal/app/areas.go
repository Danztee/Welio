package app

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/bookings"
	"github.com/danztee/welio/internal/catalog"
	"github.com/danztee/welio/internal/core"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/receptionist"
)

// area keeps each feature's HTTP routes and background jobs together in the
// process composition, following the registration boundary used by OpenDesk.
type area struct {
	register        func(*deps.Deps, huma.API, chi.Router)
	registerWorkers func(*deps.Deps, *river.Workers)
	periodic        func(*deps.Deps) []*river.PeriodicJob
	background      func(context.Context, *deps.Deps)
}

var areas = []area{
	{
		register:        core.Register,
		registerWorkers: core.RegisterWorkers,
		periodic:        core.Periodic,
		background:      core.Background,
	},
	{
		register:        catalog.Register,
		registerWorkers: catalog.RegisterWorkers,
		periodic:        catalog.Periodic,
		background:      catalog.Background,
	},
	{
		register:        bookings.Register,
		registerWorkers: bookings.RegisterWorkers,
		periodic:        bookings.Periodic,
		background:      bookings.Background,
	},
	{
		register:        receptionist.Register,
		registerWorkers: receptionist.RegisterWorkers,
		periodic:        receptionist.Periodic,
		background:      receptionist.Background,
	},
}

func registerAreas(d *deps.Deps, api huma.API, router chi.Router) {
	for _, feature := range areas {
		feature.register(d, api, router)
	}
}

func registerAreaWorkers(d *deps.Deps, workers *river.Workers) []*river.PeriodicJob {
	var periodic []*river.PeriodicJob
	for _, feature := range areas {
		feature.registerWorkers(d, workers)
		periodic = append(periodic, feature.periodic(d)...)
	}
	return periodic
}
