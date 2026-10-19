# Welio Go API

This standalone Go backend uses pgx and explicit SQL migrations for account,
workspace, catalog, booking, receptionist, and MCP data. Start it with a fresh
database. The web app does not connect to PostgreSQL.

## Run locally

Use Go 1.26 and PostgreSQL. Copy each service template to its matching private env file, change `DATABASE_URL` to a new empty database, and replace `AUTH_SECRET` with at least 32 random bytes. The Make targets load only the matching service file; the Go process itself does not load dotenv files.

```sh
cp .env.api.example .env.api
cp .env.worker.example .env.worker
cp .env.web.example .env.web
make dev-db
make migrate
```

The explicit `migrate` command applies the application schema and River's queue schema. It receives only `DATABASE_URL` and optional `DATABASE_URL_DIRECT`. The API does not migrate the database during startup. `.env.api` configures the Go API and `.env.worker` configures the background worker; the worker does not need the API's auth, Bedrock, or MCP secrets. `.env.web` contains only the public API URL and optional web origin overrides. Local Postgres credentials live in `docker-compose.dev.yml` and need no additional env file.

After migrations finish, start `make api`, `make worker`, and `make web` in
separate terminals.

Hosted deployments set environment values on each service: the web service gets
only public web/API URLs, the API gets database, auth, Bedrock, and MCP settings,
and the worker gets database and mail settings. At deploy time, set those values
in each service's runtime environment or secret store rather than uploading the
local env files.

## Transactional email and reminders

Account verification, password reset, team invitation, booking confirmation, cancellation, reschedule, and reminder jobs are inserted into River in the same PostgreSQL transaction as the operation that created them. If the transaction rolls back, the job rolls back too. The River worker reads `ZEPTOMAIL_SEND_MAIL_TOKEN` and a verified `EMAIL_FROM` sender from its environment; provider failures are retried up to eight attempts. Delivery is at least once, so a provider timeout after accepting a message can result in a duplicate on retry.

Appointment reminders are checked every minute and queued for eligible appointments within 24 hours. They require both the business reminder setting and the customer's email consent. Workers re-check the appointment version and current reminder setting before sending, so canceled or changed appointments do not receive stale reminders. Auth email workers verify that a token is still unused and valid, and invitation workers skip invitations that expired, were accepted, or were revoked before delivery. Owners can update the setting with `PATCH /v1/workspaces/{workspaceID}/booking-reminders` and `{ "enabled": true }`.

The receptionist maintenance worker runs every fifteen minutes. It removes expired chat sessions that have no active turn lease and purges expired, unconfirmed MCP booking proposals. Confirmed proposals retain their appointment reference for idempotent confirmation retries.

River records job state and retry history in `river_job`; Welio does not maintain a separate `email_outbox` table.

The public receptionist chat, private owner preview, and Streamable HTTP MCP
handlers are registered in the Go API. The browser calls the configured public
Go API origin directly, following OpenDesk's web API pattern. Next.js server
components and actions use the private internal origin. No business request
reads or writes PostgreSQL from Next.js.

## Receptionist and MCP

`app.Build` creates the Bedrock ConverseStream adapter from `AWS_REGION` and
`BEDROCK_MODEL_ID`, then registers `/api/chat/{slug}` and `/api/mcp/{slug}` in
the central Chi router. The Go AWS SDK supports the standard credential chain
and `AWS_BEARER_TOKEN_BEDROCK` for Bedrock API-key authentication. Use a local
profile or API key for development and an IAM task role for a hosted API; never
put AWS credentials in browser-visible variables.

Set `PUBLIC_URL` to the public web app origin. Go uses it for verification,
invitation, booking, and chat links. Set `API_SERVER_URL` to the Go API origin;
OpenAPI publishes this URL. In local development these are usually
`http://127.0.0.1:3000` and `http://127.0.0.1:8081`, respectively.

Set the web app's `NEXT_PUBLIC_WELIO_API_URL` in `.env.web` to the Go API's
public origin. Set `WELIO_API_INTERNAL_URL` there only if Next.js server code
must reach the API over a different, private origin. Set Go's
`MCP_ALLOWED_HOSTS` to the public API hostname and configure the app's
exact origin in Go's `TRUSTED_ORIGINS`. Use a shared parent cookie domain when
the app and API are on separate subdomains, and keep `AUTH_COOKIE_PATH` at
`/v1/auth`. If you allow remote MCP origins, configure those exact origins in
the Go API's `MCP_ALLOWED_ORIGINS`.

Configure the service-level OAuth client ID and secret only in the API service
using `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, and the exact public MCP URL in
`MCP_OAUTH_RESOURCE_URL`. Point it at the Go API's public MCP endpoint. Go
serves OAuth metadata, token exchange, JWKS, and MCP bearer validation directly.
This cutover supports service-level `client_credentials` discovery and shared
service operations. It does not implement Alexa+'s user-level
authorization-code/PKCE account-linking flow; Alexa+ user-specific booking is
therefore not complete. A standards-compatible MCP client can use the service
credential to exercise the customer-approved booking flow.

## Tests

Unit tests run with `go test ./...`. PostgreSQL integration tests run only when `WELIO_TEST_DATABASE_URL` points to a local disposable database whose name ends in `_test`:

```sh
WELIO_TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/welio_api_test?sslmode=disable' go test ./...
go vet ./...
go build ./...
```

Integration tests apply both Go and River migrations under a PostgreSQL advisory lock. Never point `WELIO_TEST_DATABASE_URL` at production or a database containing application data.
