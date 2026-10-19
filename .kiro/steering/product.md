---
inclusion: always
---

# Welio product context

Welio is a booking platform for service businesses. It manages appointments,
customers, staff schedules, and services, backed by an AI receptionist that
answers business questions and helps customers prepare and confirm bookings.

## Architecture at a glance

- **Go API** (`cmd/welio`, `internal/`) — authentication, PostgreSQL, tenant
  authorization, booking rules, MCP, Amazon Bedrock calls, transactional mail,
  and background jobs. Runs as `all`, `api`, or `worker` process roles.
- **Next.js web app** (`web/`) — renders the UI and calls the Go API. Does NOT
  connect to PostgreSQL. Browser uses `NEXT_PUBLIC_WELIO_API_URL`; server code
  uses `WELIO_API_INTERNAL_URL`.
- **PostgreSQL** — system of record. Appointment instants stored in UTC; UI and
  email display the saved business time zone.
- **River workers** — durable background jobs (email delivery, scheduled
  maintenance) defined in `internal/jobs`.
- **Amazon Bedrock** — powers the AI receptionist.
- **ZeptoMail** — transactional email delivery via `internal/mailer`.

## Backend areas

| Package                 | Responsibility                                                |
| ----------------------- | ------------------------------------------------------------- |
| `internal/app`          | Application composition, route registration, lifecycle       |
| `internal/deps`         | Shared configuration and infrastructure clients              |
| `internal/core`         | Accounts, workspaces, membership, platform maintenance       |
| `internal/catalog`      | Business profile, services, staff, assignments, schedules    |
| `internal/bookings`     | Booking policies, availability, appointments, customers     |
| `internal/receptionist` | AI conversations and MCP tools backed by booking services     |
| `internal/jobs`         | Durable River job definitions and queue operations            |
| `internal/mailer`       | Transactional email delivery through ZeptoMail                |

Each area owns its business rules and persistence. HTTP handlers validate
requests, establish the authenticated or public business context, and call area
services. A model or browser never chooses the authoritative workspace for a
protected operation.

## Key invariants

- Booking changes and their notification jobs are inserted in the same database
  transaction.
- Booking operations recheck availability while holding the workspace lock.
- Database constraints protect workspace-scoped references; booking idempotency
  prevents retries from creating duplicate appointments or messages.
- Public management tokens are bounded and hashed at rest.
- Public routes return only published catalog and available slots — never
  customer records, private staff email, internal time-off reasons, or
  appointment lists.
- Backend credentials stay out of the web app environment.

See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) and
[docs/BOOKINGS.md](../../docs/BOOKINGS.md) for the full guides.
