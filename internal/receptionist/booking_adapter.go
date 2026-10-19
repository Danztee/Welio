package receptionist

import (
	"context"
	"fmt"
	"time"

	"github.com/danztee/welio/internal/bookings"
	"github.com/google/uuid"
)

// SharedBookingService adapts the canonical booking module to the receptionist
// port. Booking constraints and appointment writes remain owned by bookings.
type SharedBookingService struct {
	Service *bookings.Service
}

func (adapter SharedBookingService) Catalog(ctx context.Context, slug string) (BookingCatalog, error) {
	if adapter.Service == nil {
		return BookingCatalog{}, ErrUnavailable
	}
	catalog, err := adapter.Service.Catalog(ctx, slug)
	if err != nil {
		return BookingCatalog{}, err
	}
	return bookingCatalog(catalog), nil
}

func (adapter SharedBookingService) CatalogForOwner(ctx context.Context, userID, workspaceID uuid.UUID) (BookingCatalog, error) {
	if adapter.Service == nil {
		return BookingCatalog{}, ErrUnavailable
	}
	catalog, err := adapter.Service.CatalogForOwner(ctx, userID, workspaceID)
	if err != nil {
		return BookingCatalog{}, err
	}
	return bookingCatalog(catalog), nil
}

func bookingCatalog(catalog *bookings.Catalog) BookingCatalog {
	result := BookingCatalog{
		Name: catalog.Name, Currency: catalog.Currency,
		TimeZone: catalog.TimeZone, BookingLocation: catalog.BookingLocation,
		CancelHours: catalog.CancelHours, Services: make([]BookingService, 0, len(catalog.Services)),
		Staff: make([]BookingStaff, 0, len(catalog.Staff)),
	}
	if catalog.BusinessAddress != nil {
		result.BusinessAddress = *catalog.BusinessAddress
	}
	for _, service := range catalog.Services {
		description := ""
		if service.Description != nil {
			description = *service.Description
		}
		result.Services = append(result.Services, BookingService{
			ID: service.ID.String(), Name: service.Name, Description: description,
			DurationMinutes: service.DurationMinutes, PriceMinor: int64(service.PriceMinor),
			Quote: service.Quote, StaffIDs: service.StaffIDs,
		})
	}
	for _, member := range catalog.Staff {
		result.Staff = append(result.Staff, BookingStaff{ID: member.ID.String(), Name: member.Name})
	}
	return result
}

func (adapter SharedBookingService) Availability(ctx context.Context, slug string, input SlotInput) ([]AvailableSlot, error) {
	if adapter.Service == nil {
		return nil, ErrUnavailable
	}
	serviceID, err := uuid.Parse(input.ServiceID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid service ID", ErrInvalid)
	}
	staffID := uuid.Nil
	if input.StaffID != "" {
		staffID, err = uuid.Parse(input.StaffID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid staff ID", ErrInvalid)
		}
	}
	slots, err := adapter.Service.Availability(ctx, bookings.PublicScope(slug), bookings.SlotInput{
		ServiceID: serviceID, StaffID: staffID, Date: input.Date,
	})
	if err != nil {
		return nil, err
	}
	result := make([]AvailableSlot, 0, len(slots))
	for _, slot := range slots {
		result = append(result, AvailableSlot{Time: slot.Time, StaffID: slot.StaffID.String(), StartsAt: slot.StartsAt.Format(time.RFC3339Nano)})
	}
	return result, nil
}

func (adapter SharedBookingService) AvailabilityForOwner(ctx context.Context, userID, workspaceID uuid.UUID, input SlotInput) ([]AvailableSlot, error) {
	if adapter.Service == nil {
		return nil, ErrUnavailable
	}
	serviceID, err := uuid.Parse(input.ServiceID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid service ID", ErrInvalid)
	}
	staffID := uuid.Nil
	if input.StaffID != "" {
		staffID, err = uuid.Parse(input.StaffID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid staff ID", ErrInvalid)
		}
	}
	slots, err := adapter.Service.Availability(ctx, bookings.OwnerScope(userID, workspaceID), bookings.SlotInput{
		ServiceID: serviceID, StaffID: staffID, Date: input.Date,
	})
	if err != nil {
		return nil, err
	}
	result := make([]AvailableSlot, 0, len(slots))
	for _, slot := range slots {
		result = append(result, AvailableSlot{Time: slot.Time, StaffID: slot.StaffID.String(), StartsAt: slot.StartsAt.Format(time.RFC3339Nano)})
	}
	return result, nil
}

func (adapter SharedBookingService) Create(ctx context.Context, slug string, input BookingInput, origin string) (BookingResult, error) {
	if adapter.Service == nil {
		return BookingResult{}, ErrUnavailable
	}
	key, err := uuid.Parse(input.Key)
	if err != nil {
		return BookingResult{}, fmt.Errorf("%w: invalid idempotency key", ErrInvalid)
	}
	serviceID, err := uuid.Parse(input.ServiceID)
	if err != nil {
		return BookingResult{}, fmt.Errorf("%w: invalid service ID", ErrInvalid)
	}
	staffID, err := uuid.Parse(input.StaffID)
	if err != nil {
		return BookingResult{}, fmt.Errorf("%w: invalid staff ID", ErrInvalid)
	}
	id, err := adapter.Service.Create(ctx, bookings.CreateInput{
		Scope: bookings.PublicScope(slug),
		Booking: bookings.BookingInput{
			Key: key, ServiceID: serviceID, StaffID: staffID, Date: input.Date, Time: input.Time,
			ServiceLocation: input.ServiceLocation, Quote: input.Quote, Name: input.Name,
			Email: input.Email, Phone: input.Phone, Address: input.Address, Consent: input.Consent,
		},
		Origin:  origin,
		Channel: bookings.ChannelReceptionist,
	})
	if err != nil {
		return BookingResult{}, err
	}
	return BookingResult{ID: id.String(), Status: "confirmed"}, nil
}
