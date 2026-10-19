# Welio technical decisions

**Historical record:** This file preserves decisions made during earlier
project stages. Several entries describe architecture that has since been
replaced. The current backend is the standalone Go API described in the root
README and [`docs/API.md`](./API.md): it uses Go
authentication, versioned SQL migrations, pgx, and River. Better Auth and the
Drizzle package were removed; their historical entries below are not current
implementation guidance.

## October 18, 2026 — Keep the verification workflow test-free

At the owner's request, remove the MCP integration suite, endpoint smoke script,
test-only database dependencies, package commands, Turbo environment wiring, and
their setup instructions. The maintained verification workflow is lint, type
checking, formatting, and production builds; no automated test suite is kept.

## October 17, 2026 — Application scaffold

The project uses Next.js App Router, React, TypeScript in strict mode, and Tailwind CSS v4. Application code lives under `src/`, with `@/*` mapped to that directory. These implement the owner's request for Next.js, Tailwind, and shadcn/ui.

Implementation defaults selected for this scaffold:

- pnpm with a committed lockfile and a pinned package-manager version.
- Node.js 24 for local development and CI.
- Official shadcn/ui components using the Base UI Nova preset and semantic CSS tokens. Generated component sources stay in `src/components/ui/`.
- ESLint for code checks and Prettier for formatting.
- Zod for server-side environment validation, protected by `server-only`.
- Server Components by default; add client boundaries only for interactive components.
- A single application package. Add database, authentication, jobs, and Bedrock integrations in their roadmap phases, with provider choices recorded here when selected.

The initial home screen is a scaffold placeholder. `/api/health` is a liveness endpoint only; it does not assert database or external-provider readiness. No customer or booking data is mocked as live functionality.

Database, authentication, hosting, email, payment providers, and AWS account/region/model choices remain open. Hackathon eligibility, Alexa+ integration access, and submission deadline remain unverified. The owner requested application scaffolding now, so this work proceeds independently of the remaining Phase 0 checks.

## October 17, 2026 — Database foundation

The owner approved PostgreSQL with Drizzle ORM. Local development uses PostgreSQL 18 in Docker Compose, published only on loopback port 5433 with a persistent named volume. Drizzle uses the `pg` connection pool with bounded connection and query timeouts. A separate local `welio_test` database runs integration checks.

Versioned migrations in `packages/db/drizzle/` are the schema history. Use `db:generate`, inspect the SQL, then `db:migrate`; do not use `drizzle-kit push` for this project. Initial entities are internal users, workspaces, memberships, services, staff, staff-service eligibility, customers, and appointments.

Composite foreign keys prevent records from different workspaces being linked, including appointment customers, staff eligibility, and optional staff account membership. These are integrity controls, not read authorization: login, authenticated workspace scoping, and authorization remain Phase 2 work. No business-data API is exposed yet. Authentication-provider tables will be added when that provider is selected.

Amounts use integer minor units (₦15,000 = 1,500,000 kobo). Appointments snapshot service name, duration, buffers, price, currency, and service address. UTC instants use PostgreSQL `timestamptz`; the business retains its IANA time zone. Timestamp columns are defined only where an auth contract or application workflow needs them; generic creation and update columns are not added to every table.

The initial schema checks valid time ordering, matching duration, nonnegative prices/buffers, and unique non-null workspace idempotency keys. Full availability rules, status transitions, request idempotency semantics, and concurrent overlap protection remain Phase 4 work; storing appointments does not mean the booking engine is ready.

`/api/health` stays process liveness. `/api/ready` checks PostgreSQL connectivity and core migrated tables, returns 503 when unavailable/unconfigured, and never returns connection strings or raw database errors. Development seed data is fictional, unpublished, transactional, repeatable, and restricted to a loopback non-production target. It does not create working login credentials or send messages.

## October 17, 2026 — Dashboard visual direction

The owner requested Supabase's UI as the design reference. Inspected the open organization Projects screen: compact navigation rail and workspace header, generous content spacing, small consistent type, subtle borders, low-contrast surfaces, restrained green primary actions, and search/filter controls. Use these patterns for Welio's later dashboard while keeping bookings, customers, services, and staff as its navigation. The current starter page is temporary; this database step does not build the dashboard or change the backend provider to Supabase.

## October 17, 2026 — Sign-in and sign-up screens

The owner requested account screens first. Added `/sign-in` and `/sign-up` with shared form and page-shell components, using the existing Base UI shadcn primitives. The chosen direction uses white (`#ffffff`), deep neutral text (`#202923`), soft gray-green surfaces (`#eef3ef`), subtle borders (`#e3e8e4`), and a restrained green primary action (`#20734f`). System sans-serif typography keeps the existing font setup, with a compact 28px form heading and 14px supporting copy. Desktop shows a form beside a clearly labeled booking illustration; mobile shows the form alone.

Inputs have labels, autocomplete hints, inline errors with associated descriptions, first-invalid-field focus, and keyboard-accessible password visibility controls. Preview sign-up validation asks for a full name, valid email, and an 8–128 character password; production validation must be enforced again by the selected authentication backend. The preview performs no account, session, credential-storage, or notification operations. Valid submission and recovery requests explain that account access is not connected. Provider selection, verification, recovery, session handling, and workspace authorization remain pending.

Verification: browser checks covered both routes, blank/invalid input, short passwords, valid preview submissions, first-error focus, keyboard password visibility, recovery notice, navigation in both directions, and no horizontal overflow at 320px/390px. Desktop layout was visually inspected at 1440px. Lint, type checking, formatting, and production build passed.

## October 17, 2026 — Supplied theme and closer Supabase auth layout

This supersedes the earlier green auth palette and booking illustration. Applied the owner's supplied light/dark theme tokens globally, including amber primary, radius, shadows, and typography. Bundled Inter (400/500/600), Source Serif 4, and JetBrains Mono locally. Removed the auth-specific palette overrides.

Inspected Supabase's actual `/dashboard/sign-in` and `/dashboard/sign-up` screens in the browser. Matched the narrow left form column, 384px form width, 28px medium headings, compact controls, password-recovery placement, and quiet right text panel. Removed the decorative booking card and extra marketing copy. Existing preview-only behavior remains.

## October 17, 2026 — Dashboard preview

The owner requested a dashboard with dummy data. Added the public `/dashboard` preview using the supplied theme, a compact Supabase-inspired sidebar/workspace header, data tables, and restrained typography. All sections use fictional local fixtures and share in-memory appointment state. New bookings and status changes update the appointment table, customer list, summary counts, and activity; invoice payment totals remain independent. The sample weekly chart has fixture history plus the current demo Saturday count.

Local interactions cover section navigation, appointment/customer search, status filtering, date selection, appointment detail dialogs, booking creation with basic conflict/working-hour checks, status transitions, sample conversations, help, data reset, and theme switching. These previews implement no production authorization or persistence. They do not replace the Phase 2 security work or Phase 4 scheduling engine.

## October 17, 2026 — Workspace switcher placement

Replaced the dashboard's top-left product logo and separate workspace card with a workspace dropdown in the sidebar header. It lists available workspaces, indicates the active one, and opens a Create workspace dialog. Mobile exposes the same selector in the page header. The owner avatar menu is now labeled Account menu. Demo workspace names, appointments, and activity are scoped to each in-memory workspace; new workspaces start with fictional sample data, and everything resets on refresh.

## October 17, 2026 — Complete connected UI prototype

This supersedes the earlier isolated dashboard/auth previews and refresh-reset behavior. The owner requested all end-to-end dummy UI before backend connection. The prototype now uses a versioned, schema-validated browser store shared across account, onboarding, workspace operations, public booking, self-service, receptionist approvals, invoices/checkout, notifications, reports, and settings. New workspaces start empty; the initial cleaning workspace supplies fixtures. Changes persist across navigation, refresh, and same-origin tabs. The account menu resets the complete demo.

Demo session, recovery, verification, invitation, provider connection, payment, and notification states are explicit simulations. No passwords are persisted and no external providers are called. Authenticated server authorization, secure public access links, real AI, concurrent scheduling integrity, email, payment webhooks, and deployment remain backend work. The supplied amber theme and the existing Supabase-inspired layout remain in place.

## October 17, 2026 — Real accounts and workspace foundation

The owner authorized real account creation and supporting flows, with Welio continuing as a product after the hackathon. Selected Better Auth 1.7.10 with its Drizzle adapter for email/password credentials, verified email, database sessions, recovery, and database rate limits. Existing `users` and workspace membership records are reused. No Cognito dependency is required; AWS remains the planned AI/runtime infrastructure, and account emails already have an Amazon SESv2 adapter. The earlier local inbox setup was later removed in favor of ZeptoMail only.

Real data now lives behind authenticated `/dashboard` and server-side membership checks. Business profiles, services, staff schedules, eligibility, setup completion, and staff invitations persist in PostgreSQL. Owner and staff roles have server-enforced permissions. One-time invitations are random, hashed, email-bound, expire after 7 days, and are consumed under a transaction lock. Password reset revokes existing sessions. Auth secret is generated in ignored local configuration; no hardcoded production secret or credential fallback exists.

Moved the complete fictional prototype to `/demo` and kept its public booking/checkout previews separate. No localStorage demo data is promoted to real records. Booking transactions, customer data APIs, Bedrock/MCP, policy/time-off persistence, payment processing, and production deployment remain subsequent phases. Current automated and HTTP verification is recorded in `docs/ACCOUNTS.md`; browser automation was disabled for this pass.

## October 17, 2026 — ZeptoMail for transactional email

The owner selected ZeptoMail instead of Amazon SES. Replaced the SES adapter and removed its AWS SDK dependency. Verification, recovery, and staff invitations now share the ZeptoMail Send Mail API adapter, with server-only credentials, verified sender configuration, regional endpoint support, bounded requests, redirects disabled, and click/open tracking disabled. The local inbox fallback was subsequently removed at the owner’s request. No live email was sent during this change. AWS Bedrock and the hackathon AI direction remain unchanged. This supersedes the SES email choice in the earlier account entry.

## October 17, 2026 — Transactional bookings and private customer management

Implemented the booking workflow authorized by the owner. PostgreSQL is the source of truth for scheduling policies, full-day time off, availability, bookings, customer records, and mail events. Temporal handles business wall-clock conversion and rejects ambiguous/nonexistent times. Workspace row locks coordinate application booking and configuration mutations; availability derives occupied intervals from appointment start/end times and saved buffers. Current migrations do not add a trigger or exclusion constraint for direct SQL writes, so appointment writes go through the booking repository. Active service eligibility can change without breaking historical foreign keys.

Public catalog/availability responses are sanitized. Booking creation uses a quote fingerprint and idempotency key; changes use a replay ledger and optimistic versions. Customer management capabilities are random, hashed on appointments, carried in email link fragments, and checked with expiry; booking IDs alone grant no read access. Owners explicitly publish the booking page and can override customer cancellation notice. Current notice policies apply to existing customer changes, while price/duration/buffers/currency/zone remain appointment snapshots.

Email events are committed with bookings into an outbox and sent after the response through ZeptoMail (the former local transport has since been removed). Provider failure preserves the booking. An authenticated job endpoint supports future scheduled draining; no external scheduler was provisioned. Interrupted/failed sends require explicit retry, acknowledging possible duplicate delivery. Existing fictional booking flows moved under `/demo`; no demo records were imported into real accounts. Tests and remaining integration/deployment work are documented in `docs/BOOKINGS.md`.

## October 17, 2026 — Bedrock customer receptionist and MCP

Implemented the approved customer chat booking slice using Bedrock Converse and the official MCP SDK. The gateway authenticates a hashed, expiring chat capability before opening an in-process MCP connection scoped to one published business. A separate optional Bearer-protected HTTP transport exposes the same public tools. Neither transport gives the model private appointment access or an execution tool.

Proposals are persisted server-side with exact booking arguments, quote, approval ID, expiry, and stable idempotency key. Only the customer's consent and confirmation button execute the existing booking service; new messages invalidate old proposals. Session leases serialize work without keeping transactions open during inference. Recovery reconciles already committed bookings before any action can discard a proposal. Daily call reservations, turn/tool/token/input limits, and sanitized metrics bound public use.

The public booking page retains its normal form and adds a chat tab. The dashboard links owners to that public flow. Added a live Bedrock connection check and expired-chat cleanup command. AWS region/model/credentials, live inference, deployment cleanup jobs, live ZeptoMail delivery, private owner AI tools, and Alexa+ remain unconfigured or unverified. Automated model responses are injected only in tests and never replace Bedrock at runtime. Setup and limitations are recorded in `docs/RECEPTIONIST.md`.

## October 17, 2026 — ZeptoMail only and appointment reminders

The owner explicitly removed the local email service, its container/image, SMTP dependencies, transport selector, and endpoint environment setting. PostgreSQL is the only local container. ZeptoMail's HTTPS endpoint is fixed in application code and the owner selected `noreply@hollen.app` as the sender. The existing Send Mail token variable is kept private; a new live token has not been supplied or verified. Email configuration is validated on sending, so existing sessions and sign-in stay available while credentials are being configured. There is no runtime fake email fallback.

Added owner-authorized, default-off 24-hour reminders, stored booking-email consent, unique appointment/version mail events, claim-time revalidation, cancellation/reschedule suppression, safe off/on recovery for never-attempted events, explicit provider-failure retries, Notifications labels, a foreground email worker, and authenticated scheduled-job support. Old bookings without recorded consent and short-notice bookings are excluded. Already in-flight external sends cannot be recalled. Tests use captured provider requests without sending email; production scheduling and live inbox delivery are pending.

The user is handling Kiro Crew installation. Actual Crew development usage and submission evidence remain pending; this pass does not claim Crew qualification. The Alexa+ primary track remains selected, while Bedrock remains optional and its account access is blocked. Reminder behavior, deployment commands, and verification are documented in `docs/REMINDERS.md`.

## 2026-10-17 — Focused regression suite

At the user's request, reduced the suite from 71 to 21 tests (70%). Deleted tests rather than skipping them or combining them to disguise the count. Retained core authentication and tenant isolation, concurrent/idempotent bookings, private booking access, rescheduling, outbox failures, ZeptoMail contract, explicit AI approval/capability protection, and reminder scheduling/invalidation. Kept one simulated payment lifecycle test. Some dedicated edge-case coverage is intentionally removed; this is not equivalent coverage. Updated current verification docs to match.

## 2026-10-17 — Remove standalone scripts

Removed the scripts folder at the user's request and reduced package commands from 27 to 10. Tests and Drizzle now load their environment directly. CI runs one test command. Removed CLI seeding, HTTP smoke, Bedrock diagnostics, chat cleanup, and email worker entry points. Reminder delivery remains available through the authenticated email job route; deployed scheduling and expired-chat cleanup remain pending. Earlier decision entries describe historical tooling.

## 2026-10-17 — Remove all tests

At the user's request, deleted the remaining test files, unused database fixtures and test-only guards, package test command, test environment variable, and CI test/database service. No database was dropped. Lint, type checks, formatting, and production builds remain. Earlier test results in this decision log are historical; there is no maintained automated test suite. Signup now stores separate first/last names, keeps combined names synchronized on profile edits, and checks password confirmation in the form.

## October 18, 2026 — Bedrock access clarified

The owner confirmed Bedrock account access. The earlier `ThrottlingException`
for GLM 4.7 reported too many tokens per day; it did not mean Bedrock access was
unavailable. Model and quota selection for the Alexa+ simulation remains subject
to verification. AWS hosting is a separate decision.

## October 18, 2026 — Switch receptionist to Bedrock

The owner confirmed production Bedrock access and requested the switch. The
Strands receptionist now uses Bedrock Converse, with an explicitly configured
region and tool-capable model or inference profile. AWS credentials are resolved
server-side via the SDK chain or a Bedrock API key. The existing MCP scope, call
budget, limits and explicit booking confirmation remain in place. The example
initially used the US Nova Lite inference profile; the current configuration has
since been updated to Claude Sonnet 4.6 in `eu-north-1` (see the Go config
defaults and `docs/RECEPTIONIST.md`). The owner has tested live
Bedrock inference successfully. Strands tool calls and conversation quality
still need release verification.
Alexa+ connectivity and hosting remain separate work.

## October 18, 2026 — pnpm and Turborepo workspace (superseded)

Moved the existing Next.js application to `apps/web` and the shadcn Base UI
components, shared `cn` helper, and mobile hook to `packages/ui`. The web app
imports UI through the `@welio/ui` workspace package. Tailwind's app stylesheet
scans the package source so utility classes in shared components are included.
Root scripts run app tasks through Turborepo. Drizzle migrations live with the
`@welio/db` package in `packages/db/drizzle/`; Docker Compose remains at the
repository root. App environment files live in `apps/web/` so Next.js and the
Drizzle configuration use the same settings.

## October 19, 2026 — Root Go application and standalone web app

Restructured the repository around a root Go module, following OpenDesk's
project organization: the named CLI lives in `cmd/welio`, server packages live
in `internal/`, SQL migrations live at the root, and API/MCP contracts live in
`contracts/`. The Next.js app is a standalone package in `web/`, with its own
manifest, lockfile, dependencies, and commands. Removed the Turbo workspace and
shared `@welio/domain` and `@welio/ui` packages; their source now lives inside
the web app because no other application consumes it. This keeps the backend
independently buildable and deployable while preserving a single repository.
