# Welio Go Backend

**Status:** Implemented with updates. The current implementation uses River's
durable job tables for transactional email and maintenance work; it does not
use a separate Welio email-outbox table. See the root README and
`docs/API.md` for the current runtime details.

## Intent

Move Welio's product backend from Next.js to a standalone Go modular monolith, following OpenDesk's architecture and implementation patterns. Next.js remains the web UI. Go owns authentication, workspaces, services and staff, bookings, the AI receptionist, MCP, email, and background work.

The Go backend is a fresh implementation. Existing Welio tables and Better Auth records are reference material for product behavior only. Do not adopt, import, baseline, or preserve a Drizzle schema or Better Auth credentials. New local and production environments use versioned SQL migrations and authentication implemented in Go. No data migration or production cutover is part of this code work.

## OpenDesk implementation patterns

Adapt these OpenDesk areas to Welio's requirements:

- `cmd/opendesk/main.go`: small CLI, config validation, graceful shutdown, and serve/migrate/health commands.
- `internal/app/app.go`, `internal/deps/deps.go`: manual dependency wiring, feature registration, process roles, and explicit lifecycle.
- Feature `Register` packages: feature-owned routes and workers, sharing Go application services.
- `internal/db/` and `migrations/`: pgx repositories, embedded SQL migrations, and an explicit migration command.
- `contracts/api.md`: versioned API contract and generated OpenAPI.
- `internal/core/auth/` and `internal/core/workspaces/`: account and workspace capabilities grouped under the core area.
- `internal/receptionist/`: business-scoped MCP tools and booking approval, alongside receptionist chat and owner preview. This is intentionally feature-owned; it does not expose OpenDesk's general helpdesk API surface.
- `internal/mailer/` and `internal/jobs/`: transactional email delivery and durable River job arguments/queue names, respectively.

Use a modular monolith. Do not create a deployable microservice for every feature. Manual dependency injection is the default.

## Product and API boundaries

The Go API owns versioned `/v1` endpoints for authentication, workspaces, services, staff/schedules, customers, appointments, public booking, receptionist conversations, and operations. The external MCP endpoint remains `/api/mcp/{slug}`. It binds to a published workspace by slug and never accepts an arbitrary workspace ID as a tool argument.

The browser calls the Go API through a typed API client configured with a public API origin, following OpenDesk's web pattern. Next.js server components and actions call Go through a private internal origin. Public booking, receptionist chat, dashboard, and MCP adapters all call shared Go services. In particular, booking creation and MCP confirmation share availability, quote, tenant, idempotency, and transaction rules.

## Authentication

Implement authentication in Go using OpenDesk's security patterns. New users register with email and password; verification, reset, sessions, profile updates, and session revocation are handled by the Go API. Use Argon2id for new passwords and reject weak or breached passwords. Use short-lived access JWTs and rotating opaque refresh tokens; persist only refresh-token hashes. Enforce trusted origins for cookie-authenticated writes and keep cookies HttpOnly, Secure in production, and SameSite Lax.

Do not read Better Auth tables, accept Better Auth sessions or password hashes, or ship scrypt compatibility. No existing user/session migration is planned. OAuth for external MCP clients is implemented in Go and uses server-side client credentials; never expose client secrets to browsers. Keep OAuth audience, scope, token expiry, key rotation, and discovery behavior explicit and tested.

## Data and migrations

PostgreSQL remains the system of record. Create the complete schema from empty using embedded SQL migrations. The current Welio schema can inform product fields and business invariants, but migration files must be authored and maintained with the Go backend; no Drizzle migration adoption or runtime dependency belongs in the backend.

Use pgx and parameterized SQL. Every tenant query uses a workspace ID derived from the principal or a published slug. Composite foreign keys and workspace-scoped unique keys should prevent cross-tenant references. Booking creation and changes remain transactional and idempotent, with transactional email jobs inserted into River. MCP proposals store a hash of the approval token, expire, are idempotent, and require explicit customer confirmation before the shared booking service is invoked.

Never run implementation migrations against production data. Tests use a disposable local PostgreSQL database ending in `_test`. Existing local databases may need a separate clean database for the new backend; do not drop or reset them implicitly.

## Runtime and integrations

- Keep Bedrock calls server-side using the AWS SDK for Go. Use the configured AWS region/model and bounded streaming/tool-call loops.
- Use the official Go MCP SDK for Streamable HTTP and comply with MCP specification 2025-11-25 or later.
- Keep ZeptoMail delivery behind an interface and enqueue transactional mail in River in the same transaction as the product change.
- Follow OpenDesk's API/worker role split. Keep each worker with the area that owns its behavior, while durable River argument types and queue names live in `internal/jobs`.
- Keep secrets in environment/secret-manager configuration and redact them and customer content from logs.

## Security and correctness invariants

- Tenant identity comes from an authenticated principal or a public business slug.
- Public APIs never reveal private customer records or credentials.
- Service, price, staff assignment, and availability are reloaded at booking time.
- Concurrent overlapping requests cannot create duplicate bookings.
- MCP booking preparation does not create an appointment. Confirmation requires the unexpired proposal token and explicit customer approval, then rechecks availability and idempotency.
- Errors are stable problem responses and do not expose SQL, credentials, or provider internals.

## Implementation sequence

1. Build the Go CLI, configuration, health checks, middleware, pgx connection, and a clean initial SQL schema.
2. Implement Go authentication and replace the web auth client and server session reads.
3. Port workspace setup/settings, service catalog, staff assignments/schedules, customer management, and appointment operations.
4. Port public booking and customer-facing receptionist behavior; preserve streaming and durable conversation state.
5. Port Bedrock orchestration and MCP tools/Streamable HTTP/OAuth; exercise a full externally callable customer-to-booking flow.
6. Move email and recurring work to Go and remove Next backend routes/server actions and direct database access as each contract is ready.
7. Verify clean install, tenant isolation, API/UI flows, Bedrock, MCP, build, and local demo setup. Deployment is separate and is not authorized by this plan.

Each feature package owns route registration and application behavior. Avoid unrelated UI redesign. Keep the web app runnable as routes move, but do not add database or auth compatibility layers.

## Validation

Required Go checks: `gofmt`, `go vet ./...`, `go test ./...`, and `go build ./...`. Use disposable-PostgreSQL integration coverage for auth, tenant isolation, booking races/idempotency, River job atomicity, and MCP proposal expiration/approval/replay. Verify MCP initialization, tool discovery, prepare, explicit confirmation, and repeat confirmation through a real Streamable HTTP client. Run web typecheck, tests, and production build when frontend adapters change.

## Decisions

- One Go modular monolith and one Next.js UI.
- Go owns the backend, auth, and fresh schema from the outset.
- No Better Auth compatibility, old credentials/session adoption, Drizzle adoption, or schema baseline support.
- PostgreSQL remains the system of record for the Go implementation; no data transfer is part of this work.
- One booking service serves HTTP, receptionist, and MCP paths.
- Alexa+ readiness means an externally callable MCP server and a demonstrated agent flow; do not claim native Alexa+ connection until one exists.
- Do not deploy, push, commit, or modify production data as part of this work.
