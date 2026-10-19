package catalog

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

type idResponse struct {
	ID uuid.UUID `json:"id"`
}

func RegisterAPI(service *Service, api huma.API) {
	tags := []string{"Catalog"}

	huma.Register(api, huma.Operation{OperationID: "catalog-get", Method: http.MethodGet,
		Path: "/v1/catalog", Summary: "Read workspace services, staff, and assignments", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body snapshotOutput }, error) {
			principal, err := auth.RequireWorkspace(ctx, "staff")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			snapshot, err := service.Get(ctx, principal, principal.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body snapshotOutput }{Body: snapshotResponse(snapshot)}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "catalog-service-create", Method: http.MethodPost,
		Path: "/v1/catalog/services", Summary: "Create a service", Tags: tags,
		DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body ServiceInput }) (*struct{ Body idResponse }, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.SaveService(ctx, principal, principal.WorkspaceID, nil, in.Body)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body idResponse }{Body: idResponse{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "catalog-service-update", Method: http.MethodPut,
		Path: "/v1/catalog/services/{serviceID}", Summary: "Update a service", Tags: tags},
		func(ctx context.Context, in *struct {
			ServiceID uuid.UUID `path:"serviceID"`
			Body      ServiceInput
		}) (*struct{ Body idResponse }, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.SaveService(ctx, principal, principal.WorkspaceID, &in.ServiceID, in.Body)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body idResponse }{Body: idResponse{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "catalog-service-assign-staff", Method: http.MethodPut,
		Path: "/v1/catalog/services/{serviceID}/staff", Summary: "Replace the staff assigned to a service", Tags: tags},
		func(ctx context.Context, in *struct {
			ServiceID uuid.UUID `path:"serviceID"`
			Body      struct {
				StaffIDs []uuid.UUID `json:"staff_ids" maxItems:"100"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := service.AssignServiceStaff(ctx, principal, principal.WorkspaceID, in.ServiceID, in.Body.StaffIDs); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "catalog-staff-create", Method: http.MethodPost,
		Path: "/v1/catalog/staff", Summary: "Add a team member and weekly schedule", Tags: tags,
		DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body staffInput }) (*struct{ Body idResponse }, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.SaveStaff(ctx, principal, principal.WorkspaceID, nil, in.Body.serviceInput())
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body idResponse }{Body: idResponse{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "catalog-staff-update", Method: http.MethodPut,
		Path: "/v1/catalog/staff/{staffID}", Summary: "Update a team member and weekly schedule", Tags: tags},
		func(ctx context.Context, in *struct {
			StaffID uuid.UUID `path:"staffID"`
			Body    staffInput
		}) (*struct{ Body idResponse }, error) {
			principal, err := auth.RequireWorkspace(ctx, "owner")
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := service.SaveStaff(ctx, principal, principal.WorkspaceID, &in.StaffID, in.Body.serviceInput())
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body idResponse }{Body: idResponse{ID: id}}, nil
		})
}
