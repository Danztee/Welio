# Booking and customer flows

The Go API is the system of record for public booking, appointment management,
customers, availability, and notifications. Browser booking calls go to the
configured public Go API origin. Next.js server actions call Go directly from
the server; the web app does not query PostgreSQL. Start with a workspace
created through onboarding, add active staff and services, assign services to
staff, then publish the booking page.

## Owner workflow

- Configure the business profile, time zone, currency, booking location,
  booking rules, services, team schedules, breaks, service assignments, and
  time off.
- Publishing requires completed setup, a business contact email, and an active
  service assigned to active staff. Unpublishing stops new public bookings;
  existing private customer-management links remain valid.
- Owners can search appointments and customers, create or change appointments,
  review customer appointment history, and retry failed booking notifications.
  Workspace membership and role are checked by Go for every operation.
- A repeat booking with the same email resolves to the existing workspace
  customer. Each appointment keeps a snapshot of its customer contact and
  service details.

## Customer workflow

Customers choose a service and date, view current times, optionally select
preferred staff, enter contact details and any required service address, review
the appointment, then confirm. Business-address bookings use the saved address;
customer-address bookings collect the address for each appointment. Welio does
not take payment.

Confirmation email contains a private management link. The token is sent in a
URL fragment and submitted in a bounded POST; only a hash is stored. Customers
can view, reschedule, or cancel a future confirmed appointment within the
business policy. Rescheduling rechecks availability and preserves the original
booking if the new slot is unavailable.

## Availability and integrity

PostgreSQL stores appointment instants in UTC; UI and email display the saved
business time zone. Availability uses active service/staff eligibility,
working days and hours, breaks, time off, lead time, booking horizon, slot
interval, duration, buffers, and existing appointments. Booking operations
recheck availability while holding the workspace lock. Database constraints
protect workspace-scoped references, and booking idempotency prevents retries
from creating duplicate appointments or messages.

Public management tokens are bounded and hashed at rest. Public routes return
only published catalog and available slots, never customer records, private
staff email, internal time-off reasons, or appointment lists. Public writes
require an allowed origin, JSON content type, bounded body, and rate limit.

## API surface

| Go API route                                                     | Purpose                                           |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| `GET /v1/book/{slug}`                                            | Read the public business and active catalog       |
| `GET /v1/book/{slug}/availability`                               | Check public appointment availability             |
| `POST /v1/book/{slug}`                                           | Create a customer-approved booking                |
| `POST /v1/bookings/{id}`                                         | View, reschedule, or cancel using a private token |
| `GET /v1/workspaces/{workspaceID}/appointments`                  | List workspace appointments                       |
| `GET /v1/workspaces/{workspaceID}/customers`                     | List workspace customers                          |
| `GET /v1/workspaces/{workspaceID}/availability`                  | Owner availability and rescheduling slots         |
| `POST /v1/workspaces/{workspaceID}/appointments`                 | Create an owner-entered appointment               |
| `POST /v1/workspaces/{workspaceID}/appointments/{appointmentID}` | Change appointment status or time                 |

The public Go API is configured with `NEXT_PUBLIC_WELIO_API_URL` in the web
app. Owner server actions use `WELIO_API_INTERNAL_URL` and revalidate the
dashboard after successful writes.

## Email and notifications

Confirmation, change, cancellation, and reminder emails are scheduled as River
jobs in the same database transaction as the appointment operation. The worker
rechecks reminder eligibility before sending. River stores attempts and retry
state; the owner notification list exposes status and recipient, never email
content or private management tokens. Failed booking notifications can be
retried by an owner. Delivery is at least once, so an ambiguous provider timeout
can result in a duplicate message.

Configure a verified `EMAIL_FROM` and a server-only
`ZEPTOMAIL_SEND_MAIL_TOKEN`. `sent` means ZeptoMail accepted the message; it
does not guarantee inbox delivery. There is no Next.js email route or external
cron endpoint. Run the Go worker role continuously so River can deliver email
and schedule reminders. See [the API guide](./API.md) for worker configuration.

## Appointment reminders

Reminders are off by default and owners can enable them in Settings. Customers
must consent to booking updates and reminders. The worker queues a reminder
about 24 hours before an eligible confirmed appointment; bookings made less
than 24 hours before their start do not receive one. Reminder times and content
use the business time zone and saved appointment details.

Before sending, the worker checks the appointment version and status, customer
consent, current workspace setting, and scheduled time. Rescheduling or closing
an appointment makes a queued reminder for its earlier version ineligible.
Provider-accepted messages cannot be recalled, and delivery remains at least
once, so an ambiguous provider timeout can result in a duplicate.

## Verification

Run `make verify` from the repository root. To verify the customer flow, use an
isolated workspace with Bedrock access, then check service discovery,
availability, proposal review, explicit confirmation, and the resulting
appointment and email job. A successful Bedrock configuration check alone does
not prove the whole flow or email delivery.
