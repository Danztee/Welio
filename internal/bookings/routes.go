package bookings

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

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

	registerPublicWaitlist(service, api)
}

type bookingManagementOutput struct {
	Body any
}

// RegisterOwnerAPI exposes the appointment and customer data needed by the
// workspace dashboard. The service rechecks owner membership for every request.
func RegisterOwnerAPI(service *Service, api huma.API) {
	RegisterNotificationAPI(service, api)
	registerOwnerCatalog(service, api)
	registerOwnerPolicies(service, api)
	registerOwnerTimeOff(service, api)
	registerOwnerNotificationRetry(service, api)
	registerOwnerOverview(service, api)
	registerOwnerAppointmentReads(service, api)
	registerOwnerCustomers(service, api)
	registerOwnerAvailability(service, api)
	registerOwnerAppointmentWrites(service, api)
	registerOwnerWaitlist(service, api)
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
