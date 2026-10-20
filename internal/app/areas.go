package app

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/bookings"
	"github.com/danztee/welio/internal/catalog"
	"github.com/danztee/welio/internal/core"
	"github.com/danztee/welio/internal/deps"
	"github.com/danztee/welio/internal/receptionist"
)

func registerAreas(d *deps.Deps, api huma.API, router chi.Router) {
	core.Register(d, api, router)
	catalog.Register(d, api, router)
	bookings.Register(d, api, router)
	receptionist.Register(d, api, router)
}

func registerAreaWorkers(d *deps.Deps, workers *river.Workers) []*river.PeriodicJob {
	core.RegisterWorkers(d, workers)
	bookings.RegisterWorkers(d, workers)
	receptionist.RegisterWorkers(d, workers)

	periodic := core.Periodic(d)
	periodic = append(periodic, bookings.Periodic(d)...)
	periodic = append(periodic, receptionist.Periodic(d)...)
	return periodic
}
