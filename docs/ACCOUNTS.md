# Accounts and workspaces

Account and workspace behavior lives in the Go API. Browser authentication
calls the configured public API origin; Next.js server components and actions
use the private API origin. The web app does not read the database. A new
account must verify its email before signing in, then create or accept access
to a workspace.

## Local setup

1. Copy `.env.api.example`, `.env.worker.example`, and `.env.web.example` to
   `.env.api`, `.env.worker`, and `.env.web` in the repository root.
2. Set a random `AUTH_SECRET` with at least 32 bytes in `.env.api`. The
   `DATABASE_URL` values match the local development database in
   `docker-compose.dev.yml`.
3. Put `EMAIL_FROM` and `ZEPTOMAIL_SEND_MAIL_TOKEN` in `.env.worker` to deliver
   verification and recovery email. The web env contains only API URLs.
4. Start PostgreSQL and apply migrations with `make dev-db` and `make migrate`.
   In separate terminals, run `make api`, `make worker`, and `make web`.
5. Create an account at [http://127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up),
   verify its email, and create a workspace. Configure a service, staff member,
   working hours, and service assignment before publishing a booking page.

See [the API guide](./API.md) for how the Go process reads
configuration and runs migrations.

## Implemented account flows

- Email/password registration, sign-in, sign-out, password reset, and email
  verification/resend are handled by Go.
- Passwords are hashed by the Go authentication package. Access tokens are
  short-lived; opaque refresh tokens are stored as hashes, rotated, and tied to
  server-side sessions.
- Session cookies are HttpOnly and SameSite Lax, and Secure in production.
  Users can inspect sessions and revoke one or all other sessions.
- Email verification, password recovery, and invitations use the River worker
  and the ZeptoMail adapter. Failed jobs remain available for retry.
- Workspace creation and owner membership are transactional. Owner-only
  changes and workspace-scoped queries derive identity and role from the Go
  principal, not from a client-supplied workspace identifier alone.
- Team members can view their workspace, services, and team. Owner permissions
  are required for business setup, invitations, catalog changes, and booking
  administration.

The Go backend uses a new PostgreSQL schema created from
`migrations`. It does not read or migrate Better Auth accounts or the
former Drizzle schema. A fresh local or hosted database is required.

## Production configuration

Set API-only values on the API service: `PUBLIC_URL`, `API_SERVER_URL`,
`DATABASE_URL`, `AUTH_SECRET`, and exact `TRUSTED_ORIGINS`. Add
`DATABASE_URL_DIRECT` only when the database's pooled URL cannot support
session features. Set `COOKIE_DOMAIN` only when the web app and API use separate
subdomains. The cookie path and production Secure flag have safe defaults.

The worker needs its own database/public URLs and, when sending email, a
verified `EMAIL_FROM` address and `ZEPTOMAIL_SEND_MAIL_TOKEN`. The web service
gets only its app/API URLs. Enable `TRUST_PROXY=true` on the API only behind a
trusted edge proxy that overwrites forwarded client-address headers. Never
trust a caller-supplied forwarded address or put a secret in a `NEXT_PUBLIC_`
variable.

## Workspace pages

The signed-in application lives under `/dashboard`; new accounts without a
workspace use `/onboarding`. Current dashboard sections include overview,
appointments, customers, receptionist, notifications, services, team, members,
and settings. Owners manage workspace setup; membership checks and tenant scope
are enforced by Go on every API request.

Invoices, payments, and reports are not implemented. See
[bookings](./BOOKINGS.md) for public customer flows and
[reminders](./REMINDERS.md) for reminder consent and delivery behavior.

API processes queue verification, password-reset, and invitation emails through
River in the same transaction as the token. Only the worker needs `EMAIL_FROM`
and `ZEPTOMAIL_SEND_MAIL_TOKEN`; sender credentials are not required to queue.
The verification link opens a confirmation screen that submits the one-time
token to the API. Pending users can resend from the inbox screen.
