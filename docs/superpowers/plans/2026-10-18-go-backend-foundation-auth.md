# Welio Go Backend Implementation Plan

**Status:** Implemented. The Go API now serves authentication, workspace and
catalog management, booking, receptionist/MCP, email, and background work. The
Next.js browser client uses the public API origin; server components and actions
use the private API origin. It starts from an empty
PostgreSQL database using Go SQL migrations; Better Auth and Drizzle runtime
code have been removed. Current details and verification commands are in the
root README and `docs/API.md`.

**Spec:** `docs/superpowers/specs/2026-10-18-go-backend-extraction-design.md`

## Delivered areas

- Go CLI, validated configuration, PostgreSQL pools, embedded SQL migrations,
  health routes, structured HTTP errors, and explicit process roles.
- Go authentication for registration, sign-in, verification, recovery, token
  refresh, sign-out, profile changes, and session revocation.
- Workspace setup, memberships, invitations, services, staff, schedules, and
  service assignments.
- Public and owner booking, availability, customer management, appointments,
  notifications, and River-backed transactional email and reminders.
- Bedrock ConverseStream receptionist, durable chat, private preview, external
  Streamable HTTP MCP, and customer-approved idempotent MCP booking confirmation.
- Next.js UI and server actions; no application database access or Better
  Auth/Drizzle runtime remains in the web app.
- OpenDesk-style feature registration for routes, workers, and periodic jobs.

## Verification still depends on environment

Run the root web checks and Go checks from the README. PostgreSQL integration
tests require a disposable local `_test` database. Bedrock inference, email
delivery, and externally reachable MCP OAuth require their real credentials and
endpoints; source code and unit tests do not prove those hosted integrations.

## Working constraints

- Keep tenant scoping and role checks in Go services.
- Test with `WELIO_TEST_DATABASE_URL` only when it points to a local database ending in `_test`.
- Use the current Welio code as behavior/schema reference, not as a migration or auth compatibility layer.
- Read the installed Next.js guide before editing Next-specific behavior.
- Do not deploy, push, commit, or run migrations against production data.
