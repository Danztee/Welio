package receptionist

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/danztee/welio/internal/bookings"
	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/deps"
)

// For builds the receptionist from shared application dependencies.
func For(d *deps.Deps) *Service {
	var model Model
	var repository Repository
	if d.Bedrock != nil {
		model = BedrockModel{Runtime: NewAWSBedrockRuntimeFromClient(d.Bedrock), ModelID: d.Cfg.BedrockModelID, MaxTokens: 1024}
	}
	if d.DB != nil {
		repository = NewPostgresRepository(d.DB)
	}
	service := NewService(
		repository,
		SharedBookingService{Service: bookings.For(d)},
		model,
		Config{
			BedrockModelID:         d.Cfg.BedrockModelID,
			AppOrigin:              d.Cfg.PublicURL,
			ChatOrigins:            d.Cfg.TrustedOrigins,
			ChatSecure:             d.Cfg.CookieSecure,
			MCPSecrets:             d.Cfg.MCPSecrets,
			MCPResourceURL:         d.Cfg.MCPOAuthResourceURL,
			MCPTokenVerifier:       auth.OAuthFor(d),
			MCPOrigins:             d.Cfg.MCPOrigins,
			MCPHosts:               d.Cfg.MCPHosts,
			MCPConfirmationEnabled: d.Cfg.MCPConfirmationEnabled,
		},
	)
	service.DailyCallLimit = d.Cfg.AIDailyCallLimit
	if d.Limiter != nil {
		service.Limiter = d.Limiter
	}
	return service
}

// Register installs public receptionist chat/MCP and owner preview routes.
func Register(d *deps.Deps, api huma.API, router chi.Router) {
	service := For(d)
	RegisterRoutes(router, service)
	RegisterOwnerAPI(service, api)
}

// RegisterWorkers adds receptionist retention cleanup.
func RegisterWorkers(d *deps.Deps, workers *river.Workers) {
	RegisterWorkersForService(workers, For(d))
}

// Periodic returns this area's scheduled jobs.
func Periodic(*deps.Deps) []*river.PeriodicJob { return PeriodicJobs() }
