package bookings

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func TestRegisterAPIsAndPublicValidation(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test Welio API", "test"))
	service := &Service{}
	RegisterPublicAPI(service, api)
	RegisterOwnerAPI(service, api)

	request := httptest.NewRequest(http.MethodGet, "/v1/book/!bad", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("GET invalid public slug status = %d, want 400: %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/workspaces/00000000-0000-4000-8000-000000000000/appointments", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET owner appointments without a session status = %d, want 401: %s", response.Code, response.Body.String())
	}

	body := []byte(`{"key":"11111111-1111-4111-8111-111111111111","service_id":"22222222-2222-4222-8222-222222222222","staff_id":"33333333-3333-4333-8333-333333333333","date":"2026-10-20","time":"09:00","quote":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"Jane Doe","email":"jane@example.com","phone":"","address":"12 Main Street","consent":true}`)
	request = httptest.NewRequest(http.MethodPost, "/v1/book/test-business", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("POST public booking without a trusted origin status = %d, want 403: %s", response.Code, response.Body.String())
	}
}
