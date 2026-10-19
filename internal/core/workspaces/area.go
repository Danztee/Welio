package workspaces

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"

	"github.com/danztee/welio/internal/deps"
)

// For builds the workspace service from shared application dependencies.
func For(d *deps.Deps) *Service {
	return &Service{DB: d.DB, Jobs: d.Jobs, AppURL: d.Cfg.PublicURL}
}

// Register installs workspace routes.
func Register(d *deps.Deps, api huma.API, _ chi.Router) {
	RegisterAPI(For(d), api)
}
