# Welio Go API

This standalone Go backend uses pgx and explicit SQL migrations for account,
workspace, catalog, booking, receptionist, and MCP data. Start it with a fresh
database. The web app does not connect to PostgreSQL.

## Run locally

Run `make setup` and `make dev` from the root, as described in the
[README](../README.md#run-locally). To run the services individually:

```sh
make dev-db
make migrate
# Each in its own terminal:
make api
make worker
make web
```

The explicit `migrate` command applies the application schema and River's queue
schema. It receives only `DATABASE_URL` and optional `DATABASE_URL_DIRECT`. The
API does not migrate the database during startup. `.env.api` configures the Go
API and `.env.worker` configures the background worker; the worker does not need
the API's auth, Bedrock, or MCP secrets. `.env.web` contains only the public API
URL and optional web origin overrides. Local Postgres credentials live in
`docker-compose.dev.yml` and need no additional env file.

## Accounts and workspaces

Registration, sign-in, verification, password recovery, session renewal, and
session revocation are handled by the Go API. New accounts verify their email
before signing in, then create a workspace through onboarding or accept an
invitation. Access tokens are short-lived; opaque refresh tokens are hashed and
rotated. Session cookies are HttpOnly and SameSite Lax, and Secure in
production.

Go derives workspace identity and roles from the authenticated principal and
checks membership on each request. Owners manage business setup, invitations,
catalog, and bookings; team members have limited access.

Hosted deployments set environment values on each service: the web service gets
only public web/API URLs, the API gets database, auth, Bedrock, and MCP
settings, and the worker gets database and mail settings. The
[AWS deployment](../deploy/aws/README.md) supplies each container with only its
own settings from a private production env file.

## Transactional email and reminders

Account verification, password reset, team invitation, booking confirmation,
cancellation, reschedule, and reminder jobs are inserted into River in the same
PostgreSQL transaction as the operation that created them. If the transaction
rolls back, the job rolls back too. The River worker reads
`ZEPTOMAIL_SEND_MAIL_TOKEN` and a verified `EMAIL_FROM` sender from its
environment; provider failures are retried up to eight attempts. Delivery is at
least once, so a provider timeout after accepting a message can result in a
duplicate on retry.

Appointment reminders are checked every minute and queued for eligible
appointments within 24 hours. They require both the business reminder setting
and the customer's email consent. Workers re-check the appointment version and
current reminder setting before sending, so canceled or changed appointments do
not receive stale reminders. Auth email workers verify that a token is still
unused and valid, and invitation workers skip invitations that expired, were
accepted, or were revoked before delivery. Owners can update the setting with
`PATCH /v1/workspaces/{workspaceID}/booking-reminders` and
`{ "enabled": true }`.

The receptionist maintenance worker runs every fifteen minutes. It removes
expired chat sessions that have no active turn lease and purges expired,
unconfirmed MCP booking proposals. Confirmed proposals retain their appointment
reference for idempotent confirmation retries.

River records job state and retry history in `river_job`.

The public receptionist chat, private owner preview, and Streamable HTTP MCP
handlers are registered in the Go API. Browser requests use the configured
public API origin; Next.js server components and actions use the private
internal origin. Business data is read and written by the Go API.

## Receptionist and MCP

`app.Build` creates the Bedrock ConverseStream adapter from `AWS_REGION` and
`BEDROCK_MODEL_ID`, then registers `/api/chat/{slug}` and `/api/mcp/{slug}` in
the central Chi router. The Go AWS SDK supports the standard credential chain
and `AWS_BEARER_TOKEN_BEDROCK` for Bedrock API-key authentication. Use a local
profile or API key for development and an IAM role for a hosted API; never put
AWS credentials in browser-visible variables.

Set `PUBLIC_URL` to the public web app origin. Go uses it for verification,
invitation, booking, and chat links. Set `API_SERVER_URL` to the Go API origin;
OpenAPI publishes this URL. In local development these are usually
`http://127.0.0.1:3000` and `http://127.0.0.1:8081`, respectively.

Set the web app's `NEXT_PUBLIC_WELIO_API_URL` in `.env.web` to the Go API's
public origin. Set `WELIO_API_INTERNAL_URL` there only if Next.js server code
must reach the API over a different, private origin. Set Go's
`MCP_ALLOWED_HOSTS` to the public API hostname and configure the app's exact
origin in Go's `TRUSTED_ORIGINS`. Use a shared parent cookie domain when the app
and API are on separate subdomains, and keep `AUTH_COOKIE_PATH` at `/v1/auth`.
If you allow remote MCP origins, configure those exact origins in the Go API's
`MCP_ALLOWED_ORIGINS`.

Configure service-level OAuth credentials only in the API environment using
`MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, and the exact public MCP URL
in `MCP_OAUTH_RESOURCE_URL`. Point it at the Go API's public MCP endpoint. Go
serves OAuth metadata, token exchange, JWKS, and MCP bearer validation. See the
[receptionist guide](./RECEPTIONIST.md) for the MCP authorization model.

## Session renewal and shared limits

Keep the refresh cookie restricted to `/v1/auth`. When server-rendered account
checks find an expired access cookie, the web app redirects to `/session/renew`.
That browser page calls the Go API directly, so the browser can send its scoped
refresh cookie and apply the API's replacement cookies. It then returns to an
allowlisted local destination. Web Locks serialize renewal across tabs, with a
shared in-tab promise and bounded `refresh_race` recovery as fallbacks. API
outages offer retry instead of treating the session as revoked.

Runtime rate limits use the `rate_limits` PostgreSQL table. Counters are atomic
across API replicas and survive restarts; storage failures fail closed. Keys are
hashed, and a River maintenance job removes expired quota/auth state in bounded
batches. The AI daily budget remains in its existing atomic database counter.
Apply migrations before starting new API/worker binaries.

## Container image

`make image` builds the nonroot Go image. Run the same image as
`welio serve --role api` or `welio serve --role worker`, using separate process
environments. Run `welio migrate` as a release step before either role. TLS,
public URLs, trusted origins, and a shared parent cookie domain still need
deployment-specific configuration.

See [the contract guide](../contracts/README.md) for HTTP conventions and code
generation, and [verification](../README.md#verification) for the test commands.
