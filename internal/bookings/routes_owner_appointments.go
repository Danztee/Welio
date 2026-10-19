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

func registerOwnerAppointmentReads(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-appointments-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/appointments", Summary: "List workspace appointments", Tags: tags},
		func(ctx context.Context, in *appointmentListPath) (*struct{ Body Page[Appointment] }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.AppointmentsPage(ctx, principal.UserID, workspaceID, in.options())
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Page[Appointment] }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-appointment-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/appointments/{appointmentId}", Summary: "Read appointment details", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID   string `path:"workspaceId"`
			AppointmentID string `path:"appointmentId"`
		}) (*struct{ Body BookingView }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			appointmentID, err := uuid.Parse(in.AppointmentID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			booking, err := service.Booking(ctx, appointmentID, Actor{UserID: principal.UserID}, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body BookingView }{Body: *booking}, nil
		})
}

func registerOwnerAvailability(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-availability-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/availability", Summary: "Read workspace booking availability", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID   string `path:"workspaceId"`
			ServiceID     string `query:"service_id,omitempty"`
			StaffID       string `query:"staff_id,omitempty"`
			Date          string `query:"date"`
			AppointmentID string `query:"appointment_id,omitempty"`
		}) (*struct{ Body any }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.limit(ctx, "owner-availability:"+workspaceID.String(), 120, time.Minute); err != nil {
				return nil, err
			}
			if in.AppointmentID != "" {
				appointmentID, err := uuid.Parse(in.AppointmentID)
				if err != nil {
					return nil, problem(ErrNotFound)
				}
				slots, err := service.AvailabilityForBooking(ctx, appointmentID, Actor{UserID: principal.UserID}, workspaceID, in.Date)
				if err != nil {
					return nil, problem(err)
				}
				return &struct{ Body any }{Body: slots}, nil
			}
			serviceID, err := uuid.Parse(in.ServiceID)
			if err != nil {
				return nil, problem(ErrInvalid)
			}
			staffID, err := optionalParseUUID(in.StaffID)
			if err != nil {
				return nil, problem(ErrInvalid)
			}
			slots, err := service.Availability(ctx, OwnerScope(principal.UserID, workspaceID), SlotInput{ServiceID: serviceID, StaffID: staffID, Date: in.Date})
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body any }{Body: slots}, nil
		})
}

func registerOwnerAppointmentWrites(service *Service, api huma.API) {
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-appointment-create", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/appointments", Summary: "Create an appointment for a workspace customer", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        BookingInput
		}) (*struct{ Body bookingReceipt }, error) {
			if err := service.requireOrigin(ctx); err != nil {
				return nil, err
			}
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			id, err := service.Create(ctx, CreateInput{Scope: OwnerScope(principal.UserID, workspaceID), Booking: in.Body, Origin: service.PublicURL, Channel: ChannelForm})
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body bookingReceipt }{Body: bookingReceipt{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-appointment-change", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/appointments/{appointmentId}", Summary: "Reschedule, cancel, complete, or mark an appointment no-show", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID   string `path:"workspaceId"`
			AppointmentID string `path:"appointmentId"`
			Body          ChangeInput
		}) (*struct{ Body bookingReceipt }, error) {
			if err := service.requireOrigin(ctx); err != nil {
				return nil, err
			}
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			appointmentID, err := uuid.Parse(in.AppointmentID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			id, err := service.Change(ctx, appointmentID, Actor{UserID: principal.UserID}, workspaceID, in.Body)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body bookingReceipt }{Body: bookingReceipt{ID: id}}, nil
		})
}
