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

1. Install the standalone web app dependencies and create one private env file
   for each process:

   ```sh
   cd web
   pnpm install
   cd ..
   cp .env.api.example .env.api
   cp .env.worker.example .env.worker
   cp .env.web.example .env.web
   ```

2. Set a unique `AUTH_SECRET` of at least 32 bytes in `.env.api`. For Bedrock,
   use the AWS SDK credential chain or put `AWS_BEARER_TOKEN_BEDROCK` in
   `.env.api`. Set `ZEPTOMAIL_SEND_MAIL_TOKEN` and `EMAIL_FROM` in
   `.env.worker` only when enabling email. Keep credentials out of `.env.web`;
   use an IAM role when hosted.

3. Start the local PostgreSQL dependency and apply migrations:

   ```sh
   make dev-db
   make migrate
   ```

4. Start the Go API in a terminal:

   ```sh
   make api
   ```

   Run `make worker` in another terminal to deliver email and process scheduled
   jobs. The API and worker load separate env files.

5. Start the web app in another terminal:

   ```sh
   make web
   ```

   Open [http://127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up). The web
   target reads only `.env.web`; API and worker credentials stay out of the
   Next.js process. Stop each foreground process with Ctrl+C; run
   `make dev-db-down` to stop PostgreSQL while keeping its volume. See [the API
   guide](./docs/API.md) for service-specific configuration and database tests.

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

## Verification

```sh
make check
make build
```

`make check` validates migration filename pairs, Go formatting, Go tests and vet,
then runs the web type check and lint. `make build` builds the Go executable and
the Next.js production app. GitHub Actions runs the same checks and provides an
isolated PostgreSQL service for the database integration tests.

PostgreSQL integration tests are skipped unless
`WELIO_TEST_DATABASE_URL` points to a local disposable database whose name ends
in `_test`. Do not point tests at production or a database containing useful
data. An external MCP client requires a reachable HTTPS endpoint and its
server-side OAuth or bearer configuration.

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
