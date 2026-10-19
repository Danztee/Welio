# Welio

Welio helps service businesses manage appointments, customers, staff schedules,
and services. Its AI receptionist answers business questions and helps customers
prepare and confirm bookings. The receptionist runs on Amazon Bedrock and exposes
the same tenant-scoped booking operations through a Streamable HTTP MCP server.

## Architecture

The repository uses a root Go module and a standalone Next.js application in
`web/`. The Go API owns authentication, PostgreSQL, tenant authorization,
booking rules, MCP, Bedrock calls, transactional mail delivery, and background jobs. Browser
requests use `NEXT_PUBLIC_WELIO_API_URL`; Next.js server components and actions
use the private `WELIO_API_INTERNAL_URL`. The web app does not connect to
PostgreSQL.

The Go layout follows the OpenDesk area boundary: `internal/core` groups
accounts and workspaces, `internal/jobs` owns durable River arguments and queue
names, and `internal/mailer` owns the ZeptoMail adapter. Welio does not have
OpenDesk's mailbox product, so it has no mailbox feature under `internal/email`.
OpenDesk's `core/mcpserver` serves a workspace-wide helpdesk API; Welio's
`/api/mcp/{slug}` exposes one business's receptionist tools, so that MCP server
stays with `internal/receptionist` and uses the same booking service as chat and
the web API.

```text
Browser ──> web/ (Next.js UI)
Browser ──────────> Go API ──> PostgreSQL
                          ├──> Amazon Bedrock
                          └──> River workers ──> ZeptoMail
MCP client ──────────────> Go API (Streamable HTTP)
```

The Go process can run as `all`, `api`, or `worker`. During development, Docker
Compose provides PostgreSQL while the API and worker run as separate local
processes with separate env files. `make migrate` applies SQL and River
migrations to that database.

## Run locally

Requirements: Docker Compose, Node.js 24, pnpm 11.9.0, Go 1.26, and AWS Bedrock
access for live receptionist responses.

```sh
make setup
make dev
```

`make setup` checks local prerequisites, installs dependencies, creates missing
private env files, and generates a local auth secret. Existing env files are
preserved. `make dev` starts PostgreSQL, waits for readiness, applies migrations,
and launches the API, worker, and Next.js as separate processes in one terminal.
Go changes rebuild and restart the Go processes; Next.js provides its own hot
reload. After adding SQL migrations, run `make migrate` or restart `make dev`. Ctrl+C stops the launcher and its child processes. PostgreSQL retains its
volume; use `make dev-db-down` to stop it.

Open [http://127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up).
Run `make doctor` to diagnose prerequisites, env configuration, and local ports.
The individual `make api`, `make worker`, `make web`, and `make migrate` targets
remain available.

Set Bedrock credentials in `.env.api` for live receptionist responses, using the
AWS SDK credential chain or `AWS_BEARER_TOKEN_BEDROCK`. Set
`ZEPTOMAIL_SEND_MAIL_TOKEN` and `EMAIL_FROM` in `.env.worker` to enable email.
Keep credentials out of `.env.web`; the launcher gives Next.js only its web
configuration. See [the API guide](./docs/API.md) for service configuration.

## AI receptionist and MCP

The web receptionist and external MCP server use the same Go booking and
availability services. The MCP server supports initialization and tool
discovery, service discovery, availability checks, booking preparation, and
booking confirmation after explicit customer approval. Proposal expiry,
workspace scope, availability checks, and idempotency are enforced by the API.

The optional external MCP OAuth integration currently supports a server-level
`client_credentials` grant. It is a usable MCP integration point, but it does
not implement Alexa+'s user-level authorization-code/PKCE account-linking flow
or represent a native Alexa+ connection. Configure OAuth credentials and
`MCP_OAUTH_RESOURCE_URL` only in the Go API environment. Point it at the Go
API's public MCP URL, such as
`https://api.example.com/api/mcp/your-business`. The endpoint must use HTTPS
outside local development. Follow [the receptionist and MCP guide](./docs/RECEPTIONIST.md)
to configure and run an external Streamable HTTP MCP client.
For the Alexa+ hackathon rehearsal and video outline, see
[the hackathon demo guide](./docs/HACKATHON-DEMO.md).

## Verification

```sh
make check      # fast checks without starting Docker
make test       # Go race tests with an automatic disposable PostgreSQL database
make test-e2e   # browser tests with an automatic disposable PostgreSQL database
make verify     # full checks, builds, browser regressions, and container smoke test
```

The test launcher owns its temporary database container and removes it when the
command exits. It does not read the application database URL. Integration tests
apply application and River migrations automatically. `make check` runs Go unit
tests without database integration tests; use `make verify` for full validation.

`make build` builds Go and Next.js production outputs. `make image-test` checks
the API and worker image in an isolated container network. GitHub Actions also
runs database, browser, contract, formatting, lint, and build checks.

## Repository layout

```text
cmd/welio/       Go API, migration, health-check, and version commands
contracts/       HTTP and MCP contracts
internal/        Core/auth/workspaces, catalog, bookings, receptionist, jobs, mailer, and app wiring
migrations/      Versioned PostgreSQL schema and queue migrations
web/             Standalone Next.js application and its package manifest
docs/            Setup guides and product documentation
Dockerfile       Go API and worker image
docker-compose.dev.yml  Local PostgreSQL development dependency
```

Go commands run from the repository root; frontend commands run from `web/`.
See the focused guides for [accounts](./docs/ACCOUNTS.md),
[bookings](./docs/BOOKINGS.md), and [reminders](./docs/REMINDERS.md).

## Code conventions

Run `make fmt` to format handwritten Go and frontend/configuration files, and
`make format-check` to check their formatting. Both tools are pinned; CI runs
the same checks. API artifacts remain owned by `make contracts`.

See [the architecture guide](./docs/ARCHITECTURE.md) for module boundaries,
workspace data flow, and the patterns adapted from the local OpenDesk reference.
