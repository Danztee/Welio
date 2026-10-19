package bookings

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/deps"
)

// For builds the booking service from shared application dependencies.
func For(d *deps.Deps) *Service {
	service := NewService(d.DB, d.Cfg.PublicURL, d.Cfg.TrustedOrigins...)
	if d.Limiter != nil {
		service.Limiter = d.Limiter
	}
	service.Jobs = d.Jobs
	return service
}

// Register installs the public and workspace booking routes.
func Register(d *deps.Deps, api huma.API, _ chi.Router) {
	service := For(d)
	RegisterPublicAPI(service, api)
	RegisterOwnerAPI(service, api)
}

// RegisterWorkers adds booking delivery and reminder workers.
func RegisterWorkers(d *deps.Deps, workers *river.Workers) {
	registerWorkers(workers, func() *Service { return For(d) }, d.Mailer)
}

// Periodic returns this area's scheduled jobs.
func Periodic(*deps.Deps) []*river.PeriodicJob { return PeriodicJobs() }

// Background runs this area's long-lived processes; bookings has none.
func Background(context.Context, *deps.Deps) {}
