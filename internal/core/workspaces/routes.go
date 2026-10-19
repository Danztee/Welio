package workspaces

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func RegisterAPI(service *Service, api huma.API) {
	tags := []string{"Workspaces"}

	huma.Register(api, huma.Operation{OperationID: "workspaces-list", Method: http.MethodGet,
		Path: "/v1/workspaces", Summary: "List the signed-in user's workspaces", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body []WorkspaceSummary }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			items, err := service.List(ctx, principal)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body []WorkspaceSummary }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspaces-create", Method: http.MethodPost,
		Path: "/v1/workspaces", Summary: "Create a business workspace", Tags: tags,
		DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body WorkspaceInput }) (*struct {
			Body struct {
				ID uuid.UUID `json:"id"`
			}
		}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.Create(ctx, principal, in.Body)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct {
				Body struct {
					ID uuid.UUID `json:"id"`
				}
			}{Body: struct {
				ID uuid.UUID `json:"id"`
			}{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceID}", Summary: "Read business settings", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
		}) (*struct{ Body Workspace }, error) {
			principal, err := auth.RequireWorkspace(ctx, "staff")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspace, err := service.Get(ctx, principal, in.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Workspace }{Body: *workspace}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-update", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceID}", Summary: "Update business settings", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			Body        WorkspaceInput
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.SaveBusiness(ctx, principal, in.WorkspaceID, in.Body); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-reminders-update", Method: http.MethodPatch,
		Path: "/v1/workspaces/{workspaceID}/booking-reminders", Summary: "Enable or disable customer appointment reminders", Tags: tags,
		DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			Body        struct {
				Enabled bool `json:"enabled"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.SaveReminderPolicy(ctx, principal, in.WorkspaceID, in.Body.Enabled); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-finish-setup", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceID}/setup/complete", Summary: "Mark business setup complete", Tags: tags,
		DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.FinishSetup(ctx, principal, in.WorkspaceID); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-team-access-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceID}/team-access", Summary: "List workspace members and invitations", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
		}) (*struct{ Body TeamAccess }, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			access, err := service.ListTeamAccess(ctx, principal, in.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body TeamAccess }{Body: *access}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-invitation-create", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceID}/invitations", Summary: "Invite a staff member by email", Tags: tags,
		DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			Body        struct {
				Email string `json:"email" maxLength:"254"`
			}
		}) (*struct {
			Body struct {
				ID uuid.UUID `json:"id"`
			}
		}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.Invite(ctx, principal, in.WorkspaceID, in.Body.Email)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct {
				Body struct {
					ID uuid.UUID `json:"id"`
				}
			}{Body: struct {
				ID uuid.UUID `json:"id"`
			}{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-member-revoke", Method: http.MethodDelete,
		Path: "/v1/workspaces/{workspaceID}/members/{userID}", Summary: "Revoke a staff member's workspace access", Tags: tags,
		DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			WorkspaceID uuid.UUID `path:"workspaceID"`
			UserID      uuid.UUID `path:"userID"`
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.RevokeMember(ctx, principal, in.WorkspaceID, in.UserID); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-invitation-revoke", Method: http.MethodDelete,
		Path: "/v1/workspaces/{workspaceID}/invitations/{invitationID}", Summary: "Revoke a pending workspace invitation", Tags: tags,
		DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			WorkspaceID  uuid.UUID `path:"workspaceID"`
			InvitationID uuid.UUID `path:"invitationID"`
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.RevokeInvitation(ctx, principal, in.WorkspaceID, in.InvitationID); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-invitation-inspect", Method: http.MethodPost,
		Path: "/v1/invitations/inspect", Summary: "Check an invitation for the signed-in recipient", Tags: tags},
		func(ctx context.Context, in *struct{ Body invitationTokenInput }) (*struct{ Body InvitationDetail }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			detail, err := service.InvitationDetail(ctx, principal, in.Body.Token)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body InvitationDetail }{Body: *detail}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-invitation-accept", Method: http.MethodPost,
		Path: "/v1/invitations/accept", Summary: "Accept a verified workspace invitation", Tags: tags},
		func(ctx context.Context, in *struct{ Body invitationTokenInput }) (*struct {
			Body struct {
				WorkspaceID uuid.UUID `json:"workspace_id"`
			}
		}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := service.AcceptInvitation(ctx, principal, in.Body.Token)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct {
				Body struct {
					WorkspaceID uuid.UUID `json:"workspace_id"`
				}
			}{Body: struct {
				WorkspaceID uuid.UUID `json:"workspace_id"`
			}{WorkspaceID: workspaceID}}, nil
		})
}

type invitationTokenInput struct {
	Token string `json:"token" minLength:"40" maxLength:"100"`
}
