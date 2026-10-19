package bookings

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

func registerOwnerCustomers(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-customers-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/customers", Summary: "List workspace customers", Tags: tags},
		func(ctx context.Context, in *listPath) (*struct{ Body Page[Customer] }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.CustomersPage(ctx, principal.UserID, workspaceID, in.options())
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Page[Customer] }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-customer-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/customers/{customerId}", Summary: "Read customer details and appointment history", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			CustomerID  string `path:"customerId"`
			Cursor      string `query:"cursor" maxLength:"200"`
			Limit       int    `query:"limit" default:"50" minimum:"1" maximum:"200"`
		}) (*struct{ Body CustomerDetail }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			customerID, err := uuid.Parse(in.CustomerID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			item, err := service.Customer(ctx, principal.UserID, workspaceID, customerID, ListOptions{Limit: in.Limit, Cursor: in.Cursor})
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body CustomerDetail }{Body: *item}, nil
		})
}
