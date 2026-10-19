package bookings

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CatalogForOwner returns the active booking catalog for an owner preview. It
// shares the same quote and staff-assignment data as the public catalog while
// allowing setup and preview before publication.
func (service *Service) CatalogForOwner(ctx context.Context, userID, workspaceID uuid.UUID) (*Catalog, error) {
	if userID == uuid.Nil || workspaceID == uuid.Nil {
		return nil, fmt.Errorf("%w: a workspace and signed-in owner are required", ErrInvalid)
	}
	var result *Catalog
	err := service.DB.Tx(ctx, func(tx pgx.Tx) error {
		workspace, err := service.workspace(ctx, tx, OwnerScope(userID, workspaceID), false)
		if err != nil {
			return err
		}
		result, err = service.catalog(ctx, tx, workspace)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
