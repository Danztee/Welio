# Appointment waitlist

## Overview

When a customer tries to book a slot that is fully occupied, Welio currently
offers no recourse — the customer must check back manually. Owners lose
potential bookings to no-shows and last-minute cancellations. This spec adds an
appointment waitlist so customers can request a slot that is currently full and
be automatically notified by email when a matching slot opens.

The waitlist builds on the existing booking, availability, and email job
infrastructure in `internal/bookings`. It follows the same workspace-scoped,
transaction-safe, and idempotency patterns as the booking flow.

## Requirements

### REQ-001: Join the waitlist for a full slot

**When** a customer requests a specific service, date, and optional staff member
and no slots are available for that request, **the system shall** allow the
customer to join a waitlist with their email address, **so that** they are
notified if a matching slot opens.

### REQ-002: Waitlist entry scoping and constraints

**The system shall** scope every waitlist entry to a workspace, service, date,
and optional staff member, and **shall** reject entries with an email that is
empty or invalid, a date outside the workspace booking horizon, or a service
that is not in the published catalog, **so that** only actionable entries are
stored.

### REQ-003: Deduplicate waitlist entries

**When** a customer joins the waitlist for a request that matches an existing
active entry (same workspace, service, date, staff, and email), **the system
shall** return the existing entry rather than creating a duplicate, **so that**
duplicate join requests never produce duplicate notifications.

### REQ-004: Notify the first matching entry when a slot opens

**When** a confirmed appointment is cancelled and the freed slot matches one or
more active waitlist entries, **the system shall** enqueue a notification email
to the first matching entry (by creation order), **so that** the earliest
waitlisted customer gets the first chance to book.

### REQ-005: Expire stale waitlist entries

**When** the appointment date for a waitlist entry has passed, **the system
shall** mark that entry as expired and **shall not** notify it, **so that**
customers never receive offers for past appointments.

### REQ-006: Owner visibility

**When** a workspace owner views the waitlist, **the system shall** return the
active entries for their workspace ordered by date and creation time, **so that**
owners can see demand for fully booked slots.

### REQ-007: No payment or automatic booking

**The system shall not** create a booking automatically from a waitlist
notification. The notification email contains a link to the public booking page
with the matching service, date, and staff pre-selected, **so that** the customer
completes the booking through the normal flow with availability rechecked at
booking time.

### REQ-008: Public route only for join and list

**The system shall** expose only two public (unauthenticated) endpoints: one to
join the waitlist and one to list active entries for a published workspace's
catalog. Owner visibility (REQ-006) uses the existing authenticated workspace
endpoint. All writes are workspace-scoped and validated server-side.

## Out of scope

- SMS notifications (email only for this iteration).
- Waitlist capacity limits or throttling per customer.
- Automatic re-offering to the next entry if the first entry does not book
  within a timeout (manual or single-notification for this iteration).
- Waitlist analytics or conversion reporting.
