# Appointment waitlist — design

## Context

Welio's booking flow lives in `internal/bookings`. The `Service.Availability`
method computes open slots from staff schedules, time off, and existing
appointments. `Service.Create` inserts an appointment and its confirmation email
job in one transaction. The `bookingEmailWorker` delivers queued emails through
ZeptoMail. Cancellation happens via `Service.Manage`, which sets the appointment
status to `cancelled` within a workspace-locked transaction.

The waitlist adds a new table, a small set of service methods, two public
routes, one owner route, and a notification job that reuses the existing email
worker. The design follows the area-owned, workspace-scoped, transaction-safe
patterns already in the codebase.

The public booking form offers a waitlist join when its availability request
returns no slots. The server checks availability again before accepting the
entry. Notification links preselect service, date, and optional staff on the
booking page; the page reloads availability before a customer can book.

## Data model

### New table: `waitlist_entries`

```sql
CREATE TABLE waitlist_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    service_id   uuid NOT NULL,
    staff_id     uuid,          -- NULL means "any staff"
    request_date date NOT NULL,
    customer_email text NOT NULL,
    customer_name  text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','notified','expired','cancelled')),
    notified_at  timestamptz,
    expires_at   timestamptz NOT NULL,  -- request_date end-of-day in workspace TZ
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT waitlist_entries_workspace_id_unique UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, service_id)
        REFERENCES services(workspace_id, id)
);

CREATE INDEX waitlist_entries_match_idx
    ON waitlist_entries (workspace_id, service_id, request_date, status, created_at);
CREATE INDEX waitlist_entries_workspace_idx
    ON waitlist_entries (workspace_id, status, request_date);
```

- `staff_id` is nullable: `NULL` matches any staff member.
- `expires_at` is computed from the request date in the workspace time zone so
  the sweep worker can expire entries with a simple timestamp comparison.
- A partial unique index prevents duplicates among active entries:

```sql
CREATE UNIQUE INDEX waitlist_entries_active_unique
    ON waitlist_entries (workspace_id, service_id, request_date,
                         COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'),
                         lower(customer_email))
    WHERE status = 'active';
```

### Migration files

| File | Purpose |
| ---- | ------- |
| `migrations/<ts>_waitlist.up.sql` | Create `waitlist_entries` and indexes |
| `migrations/<ts>_waitlist.down.sql` | Drop `waitlist_entries` |

## Service layer (`internal/bookings`)

### New methods on `Service`

```go
// JoinWaitlist adds or returns an existing active entry for the same request.
func (s *Service) JoinWaitlist(ctx context.Context, input WaitlistInput) (WaitlistEntry, error)

// WaitlistForOwner lists active entries for a workspace, ordered by date then creation.
func (s *Service) WaitlistForOwner(ctx context.Context, workspaceID uuid.UUID) ([]WaitlistEntry, error)

// NotifyWaitlistOnCancellation finds and notifies the first matching active
// entry after a confirmed appointment is cancelled. Called from Manage.
func (s *Service) NotifyWaitlistOnCancellation(ctx context.Context, tx pgx.Tx, w *workspace, appt cancelledAppointment) (bool, error)

// ExpireWaitlist marks entries whose request_date has passed as expired.
// Called by the periodic sweep worker alongside EnqueueDueReminders.
func (s *Service) ExpireWaitlist(ctx context.Context) (int, error)
```

### Cancellation hook

`Service.Manage` already locks the workspace and updates the appointment status
inside a transaction. When the action is `cancel` and the appointment was
`confirmed`, call `NotifyWaitlistOnCancellation` in the same transaction:

1. Query the first `active` entry matching the cancelled appointment's
   `service_id`, `request_date` (derived from `starts_at` in the workspace time
   zone), and `staff_id` (or `staff_id IS NULL` for any-staff entries).
2. If found, insert a `BookingEmailArgs` job with `EventType: "waitlist"` into
   the same transaction via `enqueueEmail`.
3. Set the entry `status = 'notified'` and `notified_at = now()`.
4. If no match, do nothing — the freed slot is simply available for new
   bookings.

### Expiry sweep

`ExpireWaitlist` runs inside the existing periodic job loop (alongside
`EnqueueDueReminders`). It updates entries where `status = 'active' AND
expires_at < now()` to `status = 'expired'`. A single `UPDATE ... WHERE` query
with a batch limit keeps it cheap.

## Notification email

The waitlist notification reuses `BookingEmailArgs` with a new `EventType`
value `"waitlist"`. The email body includes:

- Business name, service name, requested date (in the business time zone).
- Optional preferred staff name.
- A link to the public booking page: `{publicURL}/book/{slug}?service={id}&date={date}&staff={staffId}`.

The link pre-selects the matching service, date, and staff, but the customer
completes the booking through the normal flow. Availability is rechecked at
booking time — the freed slot may already be taken by another customer.

## HTTP routes

### Public routes (unauthenticated, published workspace only)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/v1/book/{slug}/waitlist` | Join the waitlist |
| `GET`  | `/v1/book/{slug}/waitlist` | List active entries (date, service summary only — no PII) |

The `POST` body: `{ service_id, request_date, staff_id?, customer_email, customer_name? }`.

Public routes follow the same guards as the existing booking endpoints:
published workspace check, allowed origin, JSON content type, bounded body,
and rate limit. The `GET` returns only date, service name, and entry count
per date — never customer email or names.

### Owner route (authenticated, workspace membership required)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/v1/workspaces/{workspaceId}/waitlist` | List active entries with full details |

Authorization mirrors the existing owner appointment routes: the handler
verifies workspace membership and role before calling `WaitlistForOwner`.

## Worker integration

- **`bookingEmailWorker`**: already handles multiple `EventType` values. Add
  `"waitlist"` handling — the body and subject differ but the send path is
  identical.
- **Periodic sweep**: extend `PeriodicJobs` or call `ExpireWaitlist` from the
  existing `reminderSweepWorker.Work` alongside `EnqueueDueReminders`. Both are
  cheap bounded queries; combining them avoids a second periodic job.

## Idempotency

- Join: the partial unique index on active entries prevents duplicates. A
  duplicate `POST` returns the existing entry with `200` instead of `201`.
- Notification: the `notified` status and the transaction-scoped update ensure a
  cancelled appointment notifies at most one entry. If the email job is retried,
  the entry is already `notified` and the worker skips it.
- Cancellation: if the appointment is re-cancelled or the transaction rolls
  back, no notification is sent.

## Security

- Public routes never expose customer email or names.
- The join endpoint validates the email format, date range (within the
  workspace booking horizon), and that the service is in the published catalog.
- Owner routes require workspace membership; the Go API authorizes every
  request.
- Rate limiting on the public join endpoint prevents flooding (reuse the
  existing public-booking rate limiter).

## Testing

- **Unit tests** (`_test.go`): `JoinWaitlist` deduplication, date/service
  validation, and expiry logic. Run under `make check` (no database needed for
  validation logic; use integration tests for persistence).
- **Integration tests** (`_integration_test.go`): cancellation → notification
  flow, expiry sweep, owner listing, public route guards. Run under
  `make test` with the disposable PostgreSQL database.
- **Contract**: regenerate `contracts/openapi.json` and web client types with
  `make contracts` after adding routes.

## Risks and trade-offs

- **Single notification**: only the first matching entry is notified. If they
  do not book, the slot goes to the next public booking. A follow-up iteration
  could add a timeout-based re-offer, but that is out of scope.
- **Slot matching granularity**: entries match on service + date + optional
  staff, not on exact time. A cancelled 10:00 slot notifies a customer who
  requested "any time that day." This is intentional — the booking page shows
  all available times for the date.
- **No automatic booking**: the customer must complete the booking manually,
  which means the freed slot could be taken by someone else first. This is the
  correct trade-off: automatic booking would bypass availability rechecks and
  consent.
