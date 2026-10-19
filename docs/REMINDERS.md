# Appointment reminders

Owners can turn appointment reminders on or off in Settings. The default is
off. A reminder is scheduled for an eligible confirmed appointment about 24
hours before its start. Customers must have consented to booking update and
reminder email when they booked.

## Eligibility and timing

Only future confirmed appointments qualify. A booking made less than 24 hours
before its start gets its normal confirmation email but no additional reminder.
Reminder content uses the appointment's saved business time zone and booking
details. An unpublished booking page does not affect existing appointments.

The worker checks the current appointment version, status, customer consent,
workspace setting, and scheduled time before delivery. Rescheduling or closing
an appointment makes a queued reminder for the earlier version ineligible. A
message already accepted by ZeptoMail cannot be recalled. Provider acceptance
does not guarantee exactly-once inbox delivery.

## Queue and delivery

The API inserts transactional email jobs into River in the same PostgreSQL
transaction as booking changes. River retries failed jobs and stores their
delivery state and attempt history in its own tables; there is no separate
Welio email-outbox table. The worker periodically scans for reminders and
processes email jobs. Run a worker-capable Go process continuously for reminders
and transactional email to run.

Configure the Go API environment with a verified sender and private token:

```dotenv
EMAIL_FROM=Welio <noreply@example.com>
ZEPTOMAIL_SEND_MAIL_TOKEN=your-private-send-mail-token
```

Do not expose email credentials to the web app or browser. Owners can see
notification status and retry eligible failed booking email from the dashboard.
The status `sent` means the provider accepted the email; check a controlled
inbox before claiming delivery.

## Verification

The Go integration tests cover reminder scheduling, stale appointment
suppression, and email delivery through a test sender. Run them against a local
disposable PostgreSQL database whose name ends in `_test`; see
[the API guide](./API.md). No production scheduler or email
delivery is claimed until the deployed worker and a controlled inbox have been
verified.
