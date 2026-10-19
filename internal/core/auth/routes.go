package auth

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/danztee/welio/internal/httpx"
)

type authOutput struct {
	SetCookie    []string `header:"Set-Cookie"`
	CacheControl string   `header:"Cache-Control"`
	Body         AuthResult
}

type AuthConfig struct {
	PasswordLogin bool `json:"password_login"`
	SignupEnabled bool `json:"signup_enabled"`
}

func RegisterAPI(service *Service, api huma.API) {
	tags := []string{"Authentication"}

	huma.Register(api, huma.Operation{OperationID: "auth-config", Method: http.MethodGet, Path: "/v1/auth/config",
		Summary: "Read account sign-in options", Tags: tags, Security: []map[string][]string{}},
		func(context.Context, *struct{}) (*struct{ Body AuthConfig }, error) {
			return &struct{ Body AuthConfig }{Body: AuthConfig{PasswordLogin: true, SignupEnabled: service.Cfg.SignupEnabled}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "auth-register", Method: http.MethodPost, Path: "/v1/auth/register",
		Summary: "Create a Welio account", Tags: tags, DefaultStatus: http.StatusCreated, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				FirstName string `json:"first_name" maxLength:"50"`
				LastName  string `json:"last_name" maxLength:"50"`
				Email     string `json:"email" maxLength:"254"`
				Password  string `json:"password" minLength:"1" maxLength:"128"`
			}
		}) (*authOutput, error) {
			result, err := service.Register(ctx, RegisterInput{FirstName: in.Body.FirstName, LastName: in.Body.LastName,
				Email: in.Body.Email, Password: in.Body.Password}, httpx.RequestMetaFrom(ctx))
			return output(result), httpx.Wrap(err)
		})

	huma.Register(api, huma.Operation{OperationID: "auth-login", Method: http.MethodPost, Path: "/v1/auth/login",
		Summary: "Sign in with email and password", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Email    string `json:"email" maxLength:"254"`
				Password string `json:"password" maxLength:"128"`
			}
		}) (*authOutput, error) {
			result, err := service.Login(ctx, LoginInput{Email: in.Body.Email, Password: in.Body.Password}, httpx.RequestMetaFrom(ctx))
			return output(result), httpx.Wrap(err)
		})

	huma.Register(api, huma.Operation{OperationID: "auth-refresh", Method: http.MethodPost, Path: "/v1/auth/refresh",
		Summary: "Rotate the current browser session", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, _ *struct{}) (*authOutput, error) {
			meta := httpx.RequestMetaFrom(ctx)
			result, err := service.Refresh(ctx, meta.RefreshCookie, meta)
			return output(result), httpx.Wrap(err)
		})

	huma.Register(api, huma.Operation{OperationID: "auth-logout", Method: http.MethodPost, Path: "/v1/auth/logout",
		Summary: "Sign out of the current session", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, _ *struct{}) (*struct {
			SetCookie []string `header:"Set-Cookie"`
		}, error) {
			cookies, err := service.Logout(ctx, FromContext(ctx), httpx.RequestMetaFrom(ctx).RefreshCookie)
			return &struct {
				SetCookie []string `header:"Set-Cookie"`
			}{SetCookie: cookies}, httpx.Wrap(err)
		})

	huma.Register(api, huma.Operation{OperationID: "auth-verify-email", Method: http.MethodPost, Path: "/v1/auth/verify-email",
		Summary: "Verify an email address", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Token string `json:"token" maxLength:"200"`
			}
		}) (*struct{}, error) {
			return &struct{}{}, httpx.Wrap(service.VerifyEmail(ctx, in.Body.Token))
		})

	huma.Register(api, huma.Operation{OperationID: "auth-resend-verification", Method: http.MethodPost, Path: "/v1/auth/verify-email/resend",
		Summary: "Resend an email verification link", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Email string `json:"email" maxLength:"254"`
			}
		}) (*struct{}, error) {
			return &struct{}{}, httpx.Wrap(service.ResendVerification(ctx, in.Body.Email, httpx.RequestMetaFrom(ctx)))
		})

	huma.Register(api, huma.Operation{OperationID: "auth-password-reset-request", Method: http.MethodPost, Path: "/v1/auth/password/reset/request",
		Summary: "Request a password reset link", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Email string `json:"email" maxLength:"254"`
			}
		}) (*struct{}, error) {
			return &struct{}{}, httpx.Wrap(service.RequestPasswordReset(ctx, in.Body.Email, httpx.RequestMetaFrom(ctx)))
		})

	huma.Register(api, huma.Operation{OperationID: "auth-password-reset", Method: http.MethodPost, Path: "/v1/auth/password/reset",
		Summary: "Set a new password from a reset link", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Token    string `json:"token" maxLength:"200"`
				Password string `json:"password" minLength:"1" maxLength:"128"`
			}
		}) (*struct{}, error) {
			return &struct{}{}, httpx.Wrap(service.ResetPassword(ctx, in.Body.Token, in.Body.Password))
		})

	huma.Register(api, huma.Operation{OperationID: "me-get", Method: http.MethodGet, Path: "/v1/me",
		Summary: "Read the signed-in account", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body User }, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			user, err := service.GetMe(ctx, principal)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body User }{Body: *user}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-session-get", Method: http.MethodGet, Path: "/v1/me/session",
		Summary: "Read the current browser session", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body Session }, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			session, err := service.GetCurrentSession(ctx, principal)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Session }{Body: *session}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-update", Method: http.MethodPatch, Path: "/v1/me",
		Summary: "Update the signed-in account name", Tags: tags},
		func(ctx context.Context, in *struct {
			Body struct {
				FirstName string `json:"first_name" maxLength:"50"`
				LastName  string `json:"last_name" maxLength:"50"`
			}
		}) (*struct{ Body User }, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			user, err := service.UpdateMe(ctx, principal, in.Body.FirstName, in.Body.LastName)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body User }{Body: *user}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-sessions-list", Method: http.MethodGet, Path: "/v1/me/sessions",
		Summary: "List active account sessions", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body []Session }, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			sessions, err := service.ListSessions(ctx, principal)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body []Session }{Body: sessions}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-session-revoke", Method: http.MethodDelete, Path: "/v1/me/sessions/{id}",
		Summary: "Revoke an account session", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			sessionID, err := uuid.Parse(in.ID)
			if err != nil {
				return nil, httpx.E(404, "not_found", "Session not found.")
			}
			return &struct{}{}, httpx.Wrap(service.RevokeSession(ctx, principal, sessionID))
		})

	huma.Register(api, huma.Operation{OperationID: "me-sessions-revoke-others", Method: http.MethodPost, Path: "/v1/me/sessions/revoke-others",
		Summary: "Sign out other account sessions", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, _ *struct{}) (*struct{}, error) {
			principal, err := RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{}{}, httpx.Wrap(service.RevokeOtherSessions(ctx, principal))
		})
}

func output(result *AuthResult) *authOutput {
	if result == nil {
		return &authOutput{CacheControl: "no-store"}
	}
	return &authOutput{SetCookie: result.SetCookie, CacheControl: "no-store", Body: *result}
}
