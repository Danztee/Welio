# Appointment reminders

Continue the approved booking platform with one transactional reminder per
appointment schedule. Owners explicitly enable 24-hour email reminders, disabled
by default. New bookings record the customer's consent to appointment emails.
Existing records without stored consent are excluded. Bookings made less than
24 hours before the appointment receive their confirmation but no separate
reminder.

A scheduler invokes the existing authenticated email job. It first enqueues due
reminders for future, confirmed, opted-in appointments, then drains the durable
outbox. Unique event keys bind appointment and version. A late scheduler catches
up before the appointment starts, never after it starts. Repeated and concurrent
runs cannot create duplicate logical reminders.

Queue claims recheck policy, consent, current version, and appointment status.
Changes and cancellation skip unsent old reminders; rescheduling permits a new
reminder for the new appointment version. Disabling reminders skips unsent
reminders. Already in-flight sends cannot be recalled. Failed sends retain the
existing explicit retry policy because provider acceptance may be ambiguous.

Add an owner-only Settings control and reminder/skipped labels in Notifications.
Use the existing ZeptoMail delivery adapter. No external scheduler or live
ZeptoMail credentials are provisioned. Add a captured-message integration test, database
integration tests, deployment instructions, and truthful hackathon status:
Kiro Crew is the chosen Builder path, but its actual usage is pending user setup.
