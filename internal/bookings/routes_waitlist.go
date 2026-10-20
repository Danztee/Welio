package bookings

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

type waitlistJoinResponse struct {
	Joined bool `json:"joined"`
}

// registerPublicWaitlist installs the public waitlist join and list endpoints.
func registerPublicWaitlist(service *Service, api huma.API) {
	tags := []string{"Public booking"}
	public := []map[string][]string{}

	huma.Register(api, huma.Operation{OperationID: "public-waitlist-join", Method: http.MethodPost,
		Path: "/v1/book/{slug}/waitlist", Summary: "Join the waitlist for a full booking slot", Tags: tags, Security: public},
		func(ctx context.Context, in *struct {
			Slug string `path:"slug"`
			Body WaitlistInput
		}) (*struct{ Body waitlistJoinResponse }, error) {
			if err := service.requireOrigin(ctx); err != nil {
				return nil, err
			}
			if err := service.limit(ctx, "waitlist:"+in.Slug, 8, time.Hour); err != nil {
				return nil, err
			}
			_, _, err := service.JoinWaitlist(ctx, PublicScope(in.Slug), in.Body)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body waitlistJoinResponse }{Body: waitlistJoinResponse{Joined: true}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-waitlist-list", Method: http.MethodGet,
		Path: "/v1/book/{slug}/waitlist", Summary: "See waitlist demand for a business", Tags: tags, Security: public},
		func(ctx context.Context, in *struct {
			Slug string `path:"slug"`
		}) (*struct{ Body []WaitlistDateSummary }, error) {
			if err := service.limit(ctx, "waitlist-list:"+in.Slug, 120, time.Minute); err != nil {
				return nil, err
			}
			summary, err := service.PublicWaitlistSummary(ctx, in.Slug)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []WaitlistDateSummary }{Body: summary}, nil
		})
}

// registerOwnerWaitlist installs the owner-facing waitlist list endpoint.
func registerOwnerWaitlist(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-waitlist-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/waitlist", Summary: "List workspace waitlist entries", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body []WaitlistEntry }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			entries, err := service.WaitlistForOwner(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []WaitlistEntry }{Body: entries}, nil
		})
}
