package bookings

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/core/auth"
	"github.com/danztee/welio/internal/httpx"
)

type bookingReceipt struct {
	ID uuid.UUID `json:"id"`
}

// RegisterPublicAPI installs the public catalog, availability, booking, and
// customer self-service endpoints. It is safe to register alongside owner and
// receptionist APIs on the same Huma API.
func RegisterPublicAPI(service *Service, api huma.API) {
	tags := []string{"Public booking"}
	public := []map[string][]string{}

	huma.Register(api, huma.Operation{OperationID: "public-booking-catalog", Method: http.MethodGet,
		Path: "/v1/book/{slug}", Summary: "Read a published business booking page", Tags: tags, Security: public},
		func(ctx context.Context, in *struct {
			Slug string `path:"slug"`
		}) (*struct{ Body Catalog }, error) {
			if err := service.limit(ctx, "catalog:"+in.Slug, 120, time.Minute); err != nil {
				return nil, err
			}
			catalog, err := service.Catalog(ctx, in.Slug)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Catalog }{Body: *catalog}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-booking-availability", Method: http.MethodGet,
		Path: "/v1/book/{slug}/availability", Summary: "Check public appointment availability", Tags: tags, Security: public},
		func(ctx context.Context, in *struct {
			Slug      string `path:"slug"`
			ServiceID string `query:"service_id"`
			StaffID   string `query:"staff_id,omitempty"`
			Date      string `query:"date"`
		}) (*struct{ Body []Slot }, error) {
			if err := service.limit(ctx, "availability:"+in.Slug, 120, time.Minute); err != nil {
				return nil, err
			}
			serviceID, err := uuid.Parse(in.ServiceID)
			if err != nil {
				return nil, problem(ErrInvalid)
			}
			staffID, err := optionalParseUUID(in.StaffID)
			if err != nil {
				return nil, problem(ErrInvalid)
			}
			slots, err := service.Availability(ctx, PublicScope(in.Slug), SlotInput{ServiceID: serviceID, StaffID: staffID, Date: in.Date})
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []Slot }{Body: slots}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-booking-create", Method: http.MethodPost,
		Path: "/v1/book/{slug}", Summary: "Create a customer-approved booking", Tags: tags, DefaultStatus: http.StatusCreated, Security: public},
		func(ctx context.Context, in *struct {
			Slug string `path:"slug"`
			Body BookingInput
		}) (*struct{ Body bookingReceipt }, error) {
			if err := service.requireOrigin(ctx); err != nil {
				return nil, err
			}
			if err := service.limit(ctx, "create:"+in.Slug, 8, time.Hour); err != nil {
				return nil, err
			}
			id, err := service.Create(ctx, CreateInput{Scope: PublicScope(in.Slug), Booking: in.Body, Origin: service.PublicURL, Channel: ChannelForm})
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body bookingReceipt }{Body: bookingReceipt{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-booking-management", Method: http.MethodPost,
		Path: "/v1/bookings/{id}", Summary: "View or manage a booking with its private management token", Tags: tags, Security: public},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body struct {
				Token   string    `json:"token"`
				Action  string    `json:"action"`
				Version int       `json:"version,omitempty"`
				Key     uuid.UUID `json:"key,omitempty"`
				Date    string    `json:"date,omitempty"`
				Time    string    `json:"time,omitempty"`
				StaffID uuid.UUID `json:"staff_id,omitempty"`
			}
		}) (*bookingManagementOutput, error) {
			if err := service.requireOrigin(ctx); err != nil {
				return nil, err
			}
			if err := service.limit(ctx, "manage", 60, time.Minute); err != nil {
				return nil, err
			}
			id, err := uuid.Parse(in.ID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			actor := Actor{Token: in.Body.Token}
			switch in.Body.Action {
			case "view":
				booking, err := service.Booking(ctx, id, actor, uuid.Nil)
				if err != nil {
					return nil, problem(err)
				}
				return &bookingManagementOutput{Body: booking}, nil
			case "availability":
				slots, err := service.AvailabilityForBooking(ctx, id, actor, uuid.Nil, in.Body.Date)
				if err != nil {
					return nil, problem(err)
				}
				return &bookingManagementOutput{Body: slots}, nil
			case "reschedule", "cancel":
				if in.Body.Key == uuid.Nil {
					return nil, problem(ErrInvalid)
				}
				changed, err := service.Change(ctx, id, actor, uuid.Nil, ChangeInput{Key: in.Body.Key, Version: in.Body.Version, Action: in.Body.Action, Date: in.Body.Date, Time: in.Body.Time, StaffID: in.Body.StaffID})
				if err != nil {
					return nil, problem(err)
				}
				return &bookingManagementOutput{Body: bookingReceipt{ID: changed}}, nil
			default:
				return nil, problem(ErrInvalid)
			}
		})
}

type bookingManagementOutput struct {
	Body any
}

// RegisterOwnerAPI exposes the appointment and customer data needed by the
// workspace dashboard. The service rechecks owner membership for every request.
func RegisterOwnerAPI(service *Service, api huma.API) {
	RegisterNotificationAPI(service, api)
	tags := []string{"Appointments and customers"}

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-catalog", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/booking-catalog", Summary: "Read the active catalog for booking setup", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body Catalog }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			catalog, err := service.CatalogForOwner(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body Catalog }{Body: *catalog}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-policy-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/booking-policy", Summary: "Read workspace booking policy", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body BookingPolicy }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			policy, err := service.GetPolicy(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body BookingPolicy }{Body: *policy}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-policy-save", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/booking-policy", Summary: "Update workspace booking policy", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        BookingPolicy
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.SavePolicy(ctx, principal.UserID, workspaceID, in.Body); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-reminder-policy-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/reminder-policy", Summary: "Read workspace reminder policy", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body ReminderPolicy }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			policy, err := service.GetReminderPolicy(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body ReminderPolicy }{Body: *policy}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-reminder-policy-save", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/reminder-policy", Summary: "Update workspace reminder policy", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        struct {
				Enabled *bool `json:"enabled"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if in.Body.Enabled == nil {
				return nil, problem(fmt.Errorf("%w: reminder setting is required", ErrInvalid))
			}
			if err := service.SaveReminderPolicy(ctx, principal.UserID, workspaceID, *in.Body.Enabled); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-booking-publish", Method: http.MethodPut,
		Path: "/v1/workspaces/{workspaceId}/booking-page", Summary: "Publish or unpublish a booking page", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        struct {
				Published *bool `json:"published"`
			}
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if in.Body.Published == nil {
				return nil, problem(fmt.Errorf("%w: publication status is required", ErrInvalid))
			}
			if err := service.SetPublished(ctx, principal.UserID, workspaceID, *in.Body.Published); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/time-off", Summary: "List workspace team time off", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body []TimeOff }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.ListTimeOff(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []TimeOff }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-create", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/time-off", Summary: "Schedule team time off", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			Body        TimeOffInput
		}) (*struct{ Body bookingReceipt }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			id, err := service.CreateTimeOff(ctx, principal.UserID, workspaceID, in.Body)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body bookingReceipt }{Body: bookingReceipt{ID: id}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-time-off-delete", Method: http.MethodDelete,
		Path: "/v1/workspaces/{workspaceId}/time-off/{timeOffId}", Summary: "Remove scheduled team time off", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			TimeOffID   string `path:"timeOffId"`
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			timeOffID, err := uuid.Parse(in.TimeOffID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.DeleteTimeOff(ctx, principal.UserID, workspaceID, timeOffID); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-notification-retry", Method: http.MethodPost,
		Path: "/v1/workspaces/{workspaceId}/notifications/{notificationId}/retry", Summary: "Retry a failed booking notification", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID    string `path:"workspaceId"`
			NotificationID int64  `path:"notificationId"`
		}) (*struct{}, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			if err := service.RetryNotification(ctx, principal.UserID, workspaceID, in.NotificationID); err != nil {
				return nil, problem(err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-appointments-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/appointments", Summary: "List workspace appointments", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body []Appointment }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.ListAppointments(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []Appointment }{Body: items}, nil
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

	huma.Register(api, huma.Operation{OperationID: "workspace-customers-list", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/customers", Summary: "List workspace customers", Tags: tags},
		func(ctx context.Context, in *workspacePath) (*struct{ Body []Customer }, error) {
			principal, err := auth.RequireVerifiedUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			workspaceID, err := uuid.Parse(in.WorkspaceID)
			if err != nil {
				return nil, problem(ErrNotFound)
			}
			items, err := service.ListCustomers(ctx, principal.UserID, workspaceID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body []Customer }{Body: items}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "workspace-customer-get", Method: http.MethodGet,
		Path: "/v1/workspaces/{workspaceId}/customers/{customerId}", Summary: "Read customer details and appointment history", Tags: tags},
		func(ctx context.Context, in *struct {
			WorkspaceID string `path:"workspaceId"`
			CustomerID  string `path:"customerId"`
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
			item, err := service.Customer(ctx, principal.UserID, workspaceID, customerID)
			if err != nil {
				return nil, problem(err)
			}
			return &struct{ Body CustomerDetail }{Body: *item}, nil
		})

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

type workspacePath struct {
	WorkspaceID string `path:"workspaceId"`
}

func optionalParseUUID(value string) (uuid.UUID, error) {
	if value == "" {
		return uuid.Nil, nil
	}
	return uuid.Parse(value)
}

func (service *Service) limit(ctx context.Context, scope string, max int, window time.Duration) error {
	if service.Limiter == nil {
		return nil
	}
	meta := httpx.RequestMetaFrom(ctx)
	key := "booking:" + scope + ":" + meta.IP
	if !service.Limiter.Allow(key, max, window) {
		return httpx.E(http.StatusTooManyRequests, "rate_limited", "Too many requests. Please try again later.")
	}
	return nil
}

func (service *Service) requireOrigin(ctx context.Context) error {
	origin := strings.TrimRight(httpx.RequestMetaFrom(ctx).Origin, "/")
	if origin == "" || origin == "null" {
		return httpx.E(http.StatusForbidden, "origin_not_allowed", "This request origin is not allowed.")
	}
	allowed := service.TrustedOrigins
	if len(allowed) == 0 {
		parsed, err := url.Parse(service.PublicURL)
		if err == nil && parsed.Scheme != "" && parsed.Host != "" {
			allowed = []string{parsed.Scheme + "://" + parsed.Host}
		}
	}
	for _, candidate := range allowed {
		if strings.TrimRight(candidate, "/") == origin {
			return nil
		}
	}
	return httpx.E(http.StatusForbidden, "origin_not_allowed", "This request origin is not allowed.")
}
