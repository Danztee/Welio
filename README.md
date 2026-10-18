# Welio

**Your AI Front Desk, Always On.**

An AI receptionist and business management application for small service businesses. The application scaffold and PostgreSQL/Drizzle database foundation are implemented. Real email/password accounts, verified sessions, workspace isolation, invitations, and saved business/services/staff setup are implemented in the signed-in application. Real public booking, availability, customer management, and transactional booking email are implemented. The Strands/Bedrock customer chat and Receptionist configuration/preview controls are implemented; live Bedrock access remains to be verified. Payment processing remains planned. See [ROADMAP.md](./ROADMAP.md) for the delivery sequence.

## Run locally

Requirements: a running Docker engine with Docker Compose, Node.js 24, and pnpm 11.9.0 (see `packageManager` in `package.json`). If pnpm is unavailable, install it with `npm install --global pnpm@11.9.0`.

```sh
nvm use
pnpm install --frozen-lockfile
cp -n .env.example .env.local
pnpm db:up
pnpm db:migrate
# Set BETTER_AUTH_SECRET in .env.local to a unique random value (32+ characters).
# Use 127.0.0.1 consistently with the configured BETTER_AUTH_URL.
pnpm dev
```

Open [127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up). All email uses ZeptoMail with the verified sender `noreply@hollen.app`. Set `ZEPTOMAIL_SEND_MAIL_TOKEN` privately in `.env.local` before testing verification or recovery; there is no local email service. See [docs/ACCOUNTS.md](./docs/ACCOUNTS.md) for complete setup and ZeptoMail configuration. The local database uses development-only credentials from `.env.example`; no hosted service account is required. Keep Docker Desktop or OrbStack running. `db:up` waits for PostgreSQL health; `docker compose stop db` stops it without deleting data.

## AI receptionist

Owners configure greetings, instructions, FAQs, and allowed actions in **Receptionist**. **Test & publish** previews saved settings against real availability without creating appointments or emails, shows setup readiness, and provides publishing and booking-link controls.

The public booking page includes customer chat backed by Strands SDK and Amazon Bedrock and scoped
MCP tools. Explicit review and confirmation create an appointment using the
existing booking operations. The runtime Strands integration is documented for the AWS Builder mini challenge; Kiro Crew development evidence remains pending. Configure an AWS region, model and credentials before enabling live chat; see
[docs/RECEPTIONIST.md](./docs/RECEPTIONIST.md) for credentials and model setup,
usage limits, retention, and verification. Live model access still needs verification.

Appointment reminders are available in **Settings** and are off by default. See [docs/REMINDERS.md](./docs/REMINDERS.md) for consent, scheduling, delivery, and tests.

## Code style

Prettier owns formatting, including Tailwind class ordering in JSX and `cn`,
`clsx`, and `cva` calls. It reads the Tailwind v4 theme from
`src/app/globals.css`. ESLint checks Next.js, React, and TypeScript rules;
formatting rules that conflict with Prettier are disabled. Lint warnings fail
the check so they cannot quietly accumulate.

Install the recommended workspace extensions in VS Code for formatting and
ESLint fixes on save. Other editors can use `.editorconfig` and the same
Prettier configuration. Run `pnpm format` to format files, then `pnpm check` before pushing. CI already runs `pnpm check` on pushes
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
src/
  app/                 App Router pages, layouts, global styles, and HTTP routes
    api/health/        Application liveness endpoint
    api/ready/         Database/schema readiness endpoint
  components/ui/       Generated shadcn/ui source components
  db/                  Schema, connection factory, server-only access, seed fixtures
  lib/                 Shared utilities and validated server environment
drizzle/               Reviewed SQL migrations and schema snapshots
compose.yaml           Persistent local PostgreSQL 18 instance
docs/DECISIONS.md      Stack choices and open decisions
ROADMAP.md             Phases, acceptance checks, and release scope
.github/workflows/     CI checks and production build
```

Use `@/` imports for source files. Keep credentials and server integrations on the server; `src/lib/env.ts` is guarded by `server-only`. Application database code must import `getDatabase` from `@/db`, which is also guarded by `server-only`. The connection factory is shared only with trusted CLI scripts.

## Configuration

`APP_URL` is the absolute HTTP(S) application origin, used for metadata. It defaults to `http://localhost:3000` for development. Set it to the actual application origin when deploying and rebuild. Invalid values fail with field names, without printing configuration values.

Commit `.env.example` with placeholders; keep `.env.local` and real credentials out of Git. The local database is bound only to `127.0.0.1:5433`; it does not reuse any PostgreSQL instance on port 5432. Hosted PostgreSQL needs its own credentials and verified TLS configuration from the provider; certificate verification is not disabled by the client. All email uses ZeptoMail’s Send Mail API. Only the Send Mail token and verified sender are configured server-side; the HTTPS endpoint is fixed in application code. The AI receptionist uses an AWS region, Bedrock model and server-side AWS credentials. PostgreSQL is the only local container service.

The application uses a light amber shadcn theme with white panels and a pale gray sidebar and locally bundled Inter, Source Serif 4, and JetBrains Mono fonts, so builds do not fetch fonts from Google. UI primitives use the official shadcn Base UI Nova preset and Lucide icons. To add a component, use the official registry explicitly:

```sh
pnpm dlx shadcn@latest add @shadcn/input
```

## Verify and build

```sh
pnpm check
pnpm build
pnpm start
curl -i http://localhost:3000/api/health
```

`DATABASE_URL` is required only when accessing the database. Database configuration loads `.env.local`/`.env` using Next.js environment precedence; existing process variables take priority. The database connection is lazy, so `pnpm build` and liveness work without PostgreSQL. Invalid database URLs fail without printing their values.

The health endpoint returns `status: "ok"`, `service: "welio"`, and a generated request ID also available in `X-Request-Id`. It is not cached and reports process liveness only; `/api/ready` separately verifies the database and core migrated tables. It returns 200 with `status: "ready"` when usable, or 503 with `status: "not_ready"` when unconfigured, unreachable, or unmigrated. Both endpoints send `Cache-Control: no-store` and a generated `X-Request-Id`; raw database errors are not returned.

GitHub Actions runs a frozen-lockfile install, code checks, and a production build on pushes and pull requests. It has not been run remotely until this repository is pushed to GitHub. Hosting and external services have not been configured.

## Database workflow

Change `src/db/schema.ts`, run `pnpm db:generate`, review the generated SQL in `drizzle/`, then run `pnpm db:migrate`. Commit schema, SQL, snapshots, and the lockfile together. Do not use schema push or automatically run migrations during web requests/builds. Reapplying migrations is a no-op when no changes are pending.

Automated test files and test tooling were removed at the user’s request. Verification uses code checks, production builds, and manual application walkthroughs.

Workspace foreign keys and server-side membership checks protect real business data. Real availability and booking operations now enforce working hours, time off, policies, idempotency, and database-level overlap exclusion. See [docs/BOOKINGS.md](./docs/BOOKINGS.md) for setup, public/customer routes, the email outbox, and verification.

## Application UI

The signed-in application lives at `/dashboard`, with dedicated routes for appointments, customers, receptionist, notifications, services, team, members, and settings. New accounts create their workspace through `/onboarding`. Workspaces show their own PostgreSQL records and start empty.

The retired browser-only demo and its fictional invoice/checkout flows have been removed. Payment processing and reports remain future work. The UI uses a light theme, yellow primary actions, outlined secondary actions, and shared dialog, menu, tab, and table components.

## Next work

Configure live ZeptoMail delivery and deployed email/expired-chat cleanup jobs. Verify reminders in a controlled inbox. Strands/Bedrock/MCP customer booking is implemented but live model access still needs verification; record actual Kiro Crew contributions after setup. Owner AI tools, Alexa+ connectivity, payment processing, and deployment verification remain subsequent work. Record decisions in [docs/DECISIONS.md](./docs/DECISIONS.md).
