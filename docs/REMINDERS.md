# Appointment reminders

Owners enable **Settings → Appointment reminders**. The setting is off by
default and authorizes one standard email reminder per appointment schedule,
24 hours before its start. Notification rows identify reminders separately from
booking updates and show queued, sending, sent, failed, or skipped status.
`sent` means accepted by ZeptoMail, not confirmed inbox delivery.

## Consent and timing

New bookings store the customer's agreement to confirmation, change, and
reminder emails in `appointments.notification_consent`. Records from before
this migration default to false and are excluded; consent is never invented
for imported or older records. The same consent gate applies to public, owner,
and explicitly confirmed AI bookings.

Only future confirmed appointments qualify. The appointment must have been
created at least 24 hours before its start. Short-notice bookings receive the
normal confirmation without an additional reminder. Times in emails use the
appointment's saved business time zone and price. If a worker is late, a due
reminder can be sent before the appointment starts, but never after it starts.
An unpublished booking page does not cancel existing appointments or their
authorized reminders.

## Queue and changes

`enqueueDueReminders` creates durable outbox rows with unique keys containing
the appointment ID and version. It scans bounded batches and uses the same
workspace-first locking order as booking and configuration mutations. Repeated
or concurrent scans cannot duplicate a logical reminder.

Delivery claims recheck current workspace policy, customer consent, recipient,
appointment status, version, and time before handing the message to ZeptoMail.
Rescheduling or closing a booking atomically skips its queued/failed reminders.
A reschedule can receive a new reminder for its new version and time.

Disabling reminders skips queued/failed reminders. Re-enabling restores eligible
skipped reminders only when they have never been attempted. Previously attempted
messages are not automatically re-sent because the provider may have accepted
them. Normal provider failures remain visible and support explicit owner retry;
the retry is revalidated before sending. Never-attempted skipped reminders for
stale versions, closed appointments, or missing consent remain suppressed.

Already claimed, in-flight messages cannot be recalled if a cancellation or
policy change occurs during the external send. This limitation is disclosed in
the settings confirmation. Provider acceptance and database status recording
cannot guarantee exactly-once physical inbox delivery.

Reminders include business contact information and reference the original
confirmation email for private management. They do not create a replacement
management capability or expose a token/hash in the reminder body.

## Email setup

ZeptoMail is the only email provider. Configure:

```dotenv
EMAIL_FROM=Welio <noreply@hollen.app>
ZEPTOMAIL_SEND_MAIL_TOKEN=your-private-send-mail-token
```

The endpoint is fixed in `apps/web/src/lib/email/zeptomail.ts`. There is no local SMTP
service, transport selector, or endpoint environment setting. Missing credentials
leave durable booking emails queued until the provider is configured. Existing
sign-in and sessions remain usable; verification/recovery still require a
working sender and token. Live inbox delivery has not been verified yet.

## Schedule delivery

The standalone worker scripts have been removed.

For deployment, use a managed worker or schedule authenticated
`POST /api/jobs/email` every minute. Protect it with a separate random
`EMAIL_JOB_SECRET` of at least 32 characters. The route validates email
configuration, scans up to 20 due appointments, and processes up to five outbox
items per request. It returns `remindersQueued`, `sent`, `failed`, and `skipped`
counts. Scale invocation frequency/workers for larger queues. Each scan has a
three-second admission budget between transactions; an individual database
operation still uses the connection's existing statement timeout.

No deployed scheduler has been provisioned. A saved reminder policy alone does
not run background work. The deployment must schedule the protected job route.

## Verification

Live release check: use a controlled customer inbox with explicit permission,
enable reminders, run the worker for an eligible booking, verify a single
provider-accepted notification and the actual inbox, then test cancellation and
rescheduling. Do not change a real customer's booking time for a test.
