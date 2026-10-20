# Appointment waitlist — tasks

## 1. Database migration

- [x] 1.1 Create `migrations/20261020120000_waitlist.up.sql` with the
  `waitlist_entries` table, foreign keys, check constraints, and indexes (match
  index, workspace index, active-unique partial index).
- [x] 1.2 Create `migrations/20261020120000_waitlist.down.sql` that drops
  `waitlist_entries`.
- [x] 1.3 Run `make check-migrations` to validate the migration files.

## 2. Types and service methods (`internal/bookings`)

- [x] 2.1 Define `WaitlistInput`, `WaitlistEntry`, `WaitlistDateSummary`, and
  `cancelledAppointment` structs in a new `waitlist.go` file.
- [x] 2.2 Implement `Service.JoinWaitlist`: validate email, date range (against
  workspace horizon), and service membership in the published catalog; insert
  or return the existing active entry (deduplicate via the partial unique
  index).
- [x] 2.3 Implement `Service.WaitlistForOwner`: list active entries for a
  workspace ordered by `request_date` then `created_at`.
- [x] 2.4 Implement `Service.NotifyWaitlistOnCancellation`: find the first
  matching active entry, set it to `notified`, and enqueue a `BookingEmailArgs`
  job with `EventType: "waitlist"` in the same transaction.
- [x] 2.5 Implement `Service.ExpireWaitlist`: batch-update entries where
  `status = 'active' AND expires_at < now()` to `status = 'expired'`.

## 3. Cancellation hook

- [x] 3.1 In `Service.Change` (`management.go`), when the action is `cancel`
  and the previous status was `confirmed`, call `NotifyWaitlistOnCancellation`
  within the same transaction.
- [x] 3.2 Derive `request_date` from `starts_at` in the workspace time zone and
  pass the cancelled appointment's `service_id`, `staff_id`, and `starts_at`.

## 4. Periodic expiry sweep

- [x] 4.1 Call `ExpireWaitlist` from `reminderSweepWorker.Work` (in
  `email_jobs.go`) alongside `EnqueueDueReminders`.
- [x] 4.2 Both operations run sequentially — a failure in `EnqueueDueReminders`
  returns early; the next periodic run retries both.

## 5. Email worker

- [x] 5.1 The existing `bookingEmailWorker.Work` already sends non-reminder
  event types directly. The `waitlist` event type builds its body at enqueue
  time (in `NotifyWaitlistOnCancellation`) and falls through to the normal
  send path — no worker changes needed.
- [x] 5.2 The send path is identical to confirmation and reminder emails — no
  new worker needed.

## 6. HTTP routes

- [x] 6.1 Add `POST /v1/book/{slug}/waitlist` (public) — validate body, resolve
  published workspace, call `JoinWaitlist`. Reuse the existing public-booking
  guards (allowed origin, rate limit).
- [x] 6.2 Add `GET /v1/book/{slug}/waitlist` (public) — return date, service
  name, and entry count per date only. No customer PII.
- [x] 6.3 Add `GET /v1/workspaces/{workspaceId}/waitlist` (owner) — verify
  workspace membership, call `WaitlistForOwner`, return full entry details.
- [x] 6.4 Register routes in `routes.go` via `registerPublicWaitlist` and
  `registerOwnerWaitlist`.

## 7. API contract

- [x] 7.1 Ran `make contracts` to regenerate `contracts/openapi.json` and
  `web/src/lib/backend/generated`.
- [x] 7.2 Verified `make contracts-check` passes.

## 8. Tests

- [ ] 8.1 Unit tests for `JoinWaitlist` validation (invalid email, out-of-range
  date, unknown service) — `internal/bookings/waitlist_test.go`.
- [x] 8.2 Integration test for deduplication (same request returns existing entry).
- [x] 8.3 Integration test: cancel a confirmed appointment → assert a
  `waitlist` email job is enqueued and the entry is `notified`.
- [ ] 8.4 Integration test: no matching waitlist entry → no notification sent
  on cancellation.
- [ ] 8.5 Integration test: `ExpireWaitlist` marks past-date entries as
  `expired`.
- [ ] 8.6 Integration test: owner route returns active entries and rejects
  non-members.
- [ ] 8.7 Integration test: public routes reject unpublished workspaces,
  invalid bodies, and disallowed origins.
- [x] 8.8 Run `make test` to confirm the full Go suite passes with the
  disposable PostgreSQL database.
- [x] 8.9 Integration test that joining requires no available slots, the oldest
  matching entry is notified, a stale entry is skipped before the sweep, and
  cancellation sends no waitlist email when no bookable slot opens.

## 9. Verification

- [x] 9.1 Ran `make check` (formatting, contracts, vet, Go unit tests, web
  checks, lint, deploy checks) — all pass.
- [x] 9.2 Ran `make test` with race detection and a disposable PostgreSQL DB.
- [x] 9.3 Ran `goimports -w` and confirmed `make format-check` passes.

## 10. Customer booking flow

- [x] 10.1 Show a waitlist join form when the selected public service and date
  have no available times.
- [x] 10.2 Accept and validate service, date, and staff parameters from the
  notification link and automatically load availability.
- [x] 10.3 Keep the public join response free of saved customer details.
- [x] 10.4 Add a web unit test for valid, invalid, and outdated link selections.
