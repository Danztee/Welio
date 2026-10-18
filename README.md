# Welio

**Manage bookings and customers, with an AI receptionist to help.**

Welio helps service businesses keep appointments, schedules, services, and customer details organized. Its AI receptionist answers customer questions and helps them book. The app includes verified accounts, workspace isolation, public booking, customer management, and transactional booking email. The Strands and Amazon Bedrock receptionist is implemented, and the owner has tested live Bedrock inference successfully. Payment processing remains planned. See [ROADMAP.md](./ROADMAP.md) for delivery status.

## Run locally

Requirements: a running Docker engine with Docker Compose, Node.js 24, and pnpm 11.9.0 (see `packageManager` in `package.json`). If pnpm is unavailable, install it with `npm install --global pnpm@11.9.0`.

```sh
nvm use
pnpm install --frozen-lockfile
cp -n apps/web/.env.example apps/web/.env.local
pnpm db:up
pnpm db:migrate
# Set BETTER_AUTH_SECRET in apps/web/.env.local to a unique random value (32+ characters).
# Use 127.0.0.1 consistently with the configured BETTER_AUTH_URL.
pnpm dev
```

Open [127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up). All email uses ZeptoMail with the verified sender `noreply@hollen.app`. Set `ZEPTOMAIL_SEND_MAIL_TOKEN` privately in `apps/web/.env.local` before testing verification or recovery; there is no local email service. See [docs/ACCOUNTS.md](./docs/ACCOUNTS.md) for complete setup and ZeptoMail configuration. The local database uses development-only credentials from `apps/web/.env.example`; no hosted service account is required. Keep Docker Desktop or OrbStack running. `db:up` waits for PostgreSQL health; `docker compose stop db` stops it without deleting data.

## AI receptionist

Owners configure greetings, instructions, FAQs, and allowed actions in **Receptionist**. **Test & publish** previews saved settings against real availability without creating appointments or emails, shows setup readiness, and provides publishing and booking-link controls.

The public booking page includes customer chat backed by the Strands SDK and Amazon Bedrock, with scoped Model Context Protocol (MCP) tools. Live Bedrock inference has been tested successfully. Customers review and confirm each proposed appointment before the existing booking operations create it. See [docs/RECEPTIONIST.md](./docs/RECEPTIONIST.md) for server configuration, usage limits, data retention, and remaining release checks.

The optional external MCP endpoint uses Streamable HTTP and exposes tenant-scoped receptionist tools to trusted MCP clients. It is a foundation for the Alexa+ track; it does not itself connect Welio to Alexa+. Real booking completion is an explicit server-side opt-in and requires customer approval and email consent. The external-client flow has not yet been verified end to end. See [docs/RECEPTIONIST.md](./docs/RECEPTIONIST.md) for setup, usage limits, and data retention.

Appointment reminders are available in **Settings** and are off by default. See [docs/REMINDERS.md](./docs/REMINDERS.md) for consent, scheduling, and delivery setup.

## Code style

Prettier owns formatting, including Tailwind class ordering in JSX and `cn`,
`clsx`, and `cva` calls. It reads the Tailwind v4 theme from
`apps/web/src/app/globals.css`. ESLint checks Next.js, React, and TypeScript rules;
formatting rules that conflict with Prettier are disabled. Shared ESLint spacing
rules add blank lines between imports, declarations, control-flow blocks, and
returns. Lint warnings fail the check so they cannot quietly accumulate.

Install the recommended workspace extensions in VS Code for formatting and
ESLint fixes on save. Other editors can use `.editorconfig` and the same
Prettier configuration. Run `pnpm format` to format files and apply spacing
rules, then `pnpm check` before pushing. CI already runs `pnpm check` on pushes
and pull requests. Generated build files, the lockfile, and Drizzle metadata
are excluded from formatting.

## Commands

| Command            | Purpose                            |
| ------------------ | ---------------------------------- |
| `pnpm dev`         | Start development.                 |
| `pnpm build`       | Build for production.              |
| `pnpm start`       | Serve the production build.        |
| `pnpm lint`        | Check code rules.                  |
| `pnpm format`      | Format files.                      |
| `pnpm check`       | Check lint, types, and formatting. |
| `pnpm db:up`       | Start local PostgreSQL.            |
| `pnpm db:generate` | Generate a migration.              |
| `pnpm db:migrate`  | Apply migrations.                  |

## Structure

```text
apps/web/
  src/
    app/               App Router pages, layouts, global styles, and HTTP routes
      api/health/      Application liveness endpoint
      api/ready/       Database/schema readiness endpoint
    components/        Auth, dashboard, platform, and product UI
    features/          Server queries and explicit feature view models
    lib/               Next.js auth, email, AI, HTTP, and server integrations
packages/ui/
  src/components/      Shared shadcn/ui source components
  src/hooks/           Shared UI hooks
  src/lib/utils.ts     Shared class-name helper
packages/domain/
  src/bookings/        Booking contracts, enums, time helpers, and pure rules
  src/workspaces/      Workspace contracts, enums, and domain errors
  src/receptionist/    Receptionist contracts, settings, and proposal rules
packages/db/
  drizzle/             Reviewed SQL migrations and schema snapshots
  src/schema/          Drizzle schema, grouped by database responsibility
  src/connection.ts    PostgreSQL connection factory and Database type
  src/bookings/        Booking, policy, reminder, and email-outbox queries
  src/workspaces/      Workspace, team, invitation, and access queries
  src/receptionist/    Chat-session, proposal, and settings persistence
  drizzle.config.ts    Drizzle Kit configuration and database tasks
docker-compose.yaml    Persistent local PostgreSQL 17 and Valkey 8 services
turbo.json             Workspace task graph
docs/DECISIONS.md      Stack choices and open decisions
ROADMAP.md             Phases, acceptance checks, and release scope
.github/workflows/     CI checks and production build
```

Use `@/` imports for app source, `@welio/ui/...` for shared components, `@welio/domain/...` for framework-independent contracts and rules, and `@welio/db/...` for database access. Keep credentials and server integrations on the server; `apps/web/src/lib/env.ts`, the database accessor, and database repositories are guarded by `server-only`. App server code gets a connection through `getDatabase` from `@welio/db`.

Put input contracts and pure policy in `packages/domain`; put SQL, schema constraints, and atomic persistence operations in `packages/db`. Keep Next.js routes, server actions, provider calls, transport mapping, and feature composition in `apps/web`. `apps/web/src/features/workspaces` owns the dashboard query boundary and its explicit UI view types. Keep shadcn/ui primitives in `packages/ui`; compose them into product flows in the web app.

## Configuration

`APP_URL` is the absolute HTTP(S) application origin, used for metadata. It defaults to `http://127.0.0.1:3000` for development, matching `BETTER_AUTH_URL`; use that exact host when opening the local app because public write endpoints validate the request origin. Set both values to the actual application origin when deploying and rebuild. Invalid values fail with field names, without printing configuration values.

Commit `apps/web/.env.example` with placeholders; keep `apps/web/.env.local` and real credentials out of Git. The local Compose database is bound to `127.0.0.1:5461`; it uses the development-only credentials shown in the example and does not reuse a PostgreSQL instance on port 5432. Hosted PostgreSQL needs its own credentials and verified TLS configuration from the provider; certificate verification is not disabled by the client. All email uses ZeptoMail’s Send Mail API. Only the Send Mail token and verified sender are configured server-side; the HTTPS endpoint is fixed in application code. The AI receptionist uses an AWS region, Bedrock model and server-side AWS credentials. Valkey is included in local Compose but is not currently used by application code.

The application uses a light amber shadcn theme with white panels and a pale gray sidebar and locally bundled Inter, Source Serif 4, and JetBrains Mono fonts, so builds do not fetch fonts from Google. UI primitives use the official shadcn Base UI Nova preset and Lucide icons. To add a component, use the official registry explicitly:

```sh
pnpm --dir apps/web dlx shadcn@latest add @shadcn/input
```

## Verify and build

```sh
pnpm check
pnpm build
pnpm start
curl -i http://localhost:3000/api/health
```

`DATABASE_URL` is required only when accessing the database. Database configuration loads `apps/web/.env.local`/`apps/web/.env` using Next.js environment precedence; existing process variables take priority. The database connection is lazy, so `pnpm build` and liveness work without PostgreSQL. Invalid database URLs fail without printing their values. The local Compose file maps PostgreSQL to `127.0.0.1:5461` with the development-only `user/password` credentials used by `.env.example`; Valkey is included in Compose but the application does not currently use it.

The health endpoint returns `status: "ok"`, `service: "welio"`, and a generated request ID also available in `X-Request-Id`. It is not cached and reports process liveness only; `/api/ready` separately verifies the database and core migrated tables. It returns 200 with `status: "ready"` when usable, or 503 with `status: "not_ready"` when unconfigured, unreachable, or unmigrated. Both endpoints send `Cache-Control: no-store` and a generated `X-Request-Id`; raw database errors are not returned.

GitHub Actions runs a frozen-lockfile install, code checks, and a production build on pushes and pull requests. It has not been run remotely until this repository is pushed to GitHub. Hosting and external services have not been configured.

## Database workflow

Change the relevant module under `packages/db/src/schema/`, run `pnpm db:generate`, review the generated SQL in `packages/db/drizzle/`, then run `pnpm db:migrate`. Turbo routes both tasks to `@welio/db`; its Drizzle config loads the schema barrel and local environment values from `apps/web/.env.local` or `apps/web/.env`. Commit schema, SQL, snapshots, and the lockfile together. Do not use schema push or automatically run migrations during web requests/builds. Reapplying migrations is a no-op when no changes are pending.

Workspace foreign keys and server-side membership checks protect real business data. Real availability and booking operations now enforce working hours, time off, policies, idempotency, and database-level overlap exclusion. See [docs/BOOKINGS.md](./docs/BOOKINGS.md) for setup, public/customer routes, the email outbox, and verification.

## Application UI

The signed-in application lives at `/dashboard`; new accounts create a workspace through `/onboarding`. Each workspace starts with its own PostgreSQL records.

Payment processing and reports remain future work. See [docs/UI-COMPONENTS.md](./docs/UI-COMPONENTS.md) for shared component guidance.

See [ROADMAP.md](./ROADMAP.md) for remaining release work and [docs/DECISIONS.md](./docs/DECISIONS.md) for dated technical decisions.
