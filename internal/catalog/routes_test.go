package catalog

import (
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func TestRegisterAPIRegistersCatalogOperations(t *testing.T) {
	api := humachi.New(chi.NewRouter(), huma.DefaultConfig("test", "1"))
	RegisterAPI(&Service{}, api)
	for _, path := range []string{
		"/v1/catalog",
		"/v1/catalog/services",
		"/v1/catalog/services/{serviceID}",
		"/v1/catalog/services/{serviceID}/staff",
		"/v1/catalog/staff",
		"/v1/catalog/staff/{staffID}",
	} {
		if api.OpenAPI().Paths[path] == nil {
			t.Errorf("OpenAPI is missing %s", path)
		}
	}
}
