# Real booking operations

Accounts and saved setup now connect to actual public bookings and owner appointment/customer management. These records use PostgreSQL, not the browser demo store. Create the business during onboarding, add staff/services and assignments in the dashboard, then use Settings → Publish booking page. Your link is `/book/<business-slug>`.

## Owner workflow

- Business profile: choose whether appointments happen at the customer’s address or at the business address. Existing workspaces keep customer-address bookings. In business-address mode, the saved business address appears on the booking page and is used for booking records and notifications; customers are not asked for their address.
- Settings: minimum notice (0–168 hours), horizon (1–365 days), cancellation/reschedule notice (0–168 hours), and 15/30/60-minute slot interval. Publishing requires completed setup, business contact email, and an active service assigned to active staff. Unpublishing stops new public bookings while existing private links continue working.
- Team: weekly days/hours/breaks and full-day time off in the business time zone. Time off that conflicts with a future confirmed appointment is refused until the booking is rescheduled. Reasons are internal and do not appear in public availability.
- Appointments: search/filter, create a booking, view contact/address details, reschedule, cancel, complete, or mark no-show. Only owners have appointment/customer access in this version; staff accounts retain business/catalog/team views. Closed appointments cannot be reopened by these operations. Completion/no-show cannot be recorded before the appointment starts. Owners may override customer cancellation notice.
- Customers: contacts created by bookings and their appointment history. A repeat email links to the existing customer without letting an anonymous caller overwrite their profile. Each booking retains its own contact/address snapshot.
- Notifications: durable queued/sending/sent/failed email status and attempts. Retry failed messages explicitly. A sending record stranded by a crash can be recovered after ten minutes; a provider may already have accepted it, so retry can duplicate that message.

## Customer workflow

Customers select an active service, date, and staff preference, check current availability, enter details and consent to booking updates, review the price/time/appointment location, and confirm. Customer-address businesses collect an address per booking; business-address appointments use the saved business address. No payment is taken.

Confirmation creates a private management link in the email. The link is `/booking/<uuid>#<random-token>`. The token is in the URL fragment, not the server URL/query string; the browser submits it in a bounded JSON POST. Only its SHA-256 hash is stored on the appointment. Plain UUIDs do not reveal booking/contact information, and an unknown token returns the same unavailable result. A link remains valid until 30 days after its appointment start; rescheduling extends this expiry to the new start plus 30 days.

Customers can reschedule or cancel only confirmed future appointments outside the current workspace notice policy. Failed rescheduling preserves the original slot and stored appointment. A customer management link can still work after the owner unpublishes new bookings. The management page has no external analytics and uses no-referrer metadata. Changes to the workspace notice policy apply to existing customer changes; booked prices, currency, time zone, duration, and buffers remain snapshots.

## Availability and integrity

UTC instants are stored in PostgreSQL and displayed in the snapshotted IANA business time zone. Temporal converts wall-clock inputs and rejects impossible or ambiguous DST times. Slots respect active service/staff eligibility, working days/hours, breaks, full-day leave, minimum notice, booking horizon, grid interval, service duration/buffers, and existing confirmed/completed appointment intervals. Cancelled/no-show appointments release their interval.

Workspace configuration and application booking mutations acquire the workspace row lock in a consistent order. Availability checks use appointment start/end times and the saved buffer values, then booking creation checks availability again while holding that lock. This serializes bookings made through the application. Current migrations do not install a database trigger or exclusion constraint for direct SQL writes, so appointment writes must go through the booking repository.

Creation keys are workspace-scoped and bind the normalized request to its actor. Repeated identical requests return the same booking without duplicate customers/emails; changed details require a new key. Mutation ledger keys prevent repeated changes and events, and optimistic versions reject stale proposals. Service quotes are hashed from current price/name/duration/buffers/currency/zone and are checked again before creating a booking. Staff-service rows keep historical foreign keys while their active eligibility can be removed independently.

## APIs and access

| Endpoint                                | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/book/[slug]`                  | Published, sanitized business/services/staff catalog                        |
| `GET /api/book/[slug]/availability`     | `serviceId`, `date`, optional `staffId`; slot data only                     |
| `POST /api/book/[slug]`                 | Validated booking with consent, quote, and UUID idempotency key             |
| `POST /api/bookings/[id]`               | Private token plus `view`, `availability`, `reschedule`, or `cancel`        |
| `GET /api/workspaces/[id]/availability` | Verified owner session, catalog/slots or reschedule availability            |
| Dashboard Server Actions                | Current owner membership required for booking/configuration/retry mutations |
| `POST /api/jobs/email`                  | Authenticated queue processing, described below                             |

Public writes require the exact configured origin and JSON content type. Bodies are bounded to 8 KB, and Zod validates identifiers, dates, contact fields, consent, and operations. Shared persistent rate-limit storage caps public catalog/availability/manage requests and booking creation. Per-client limits require `AUTH_TRUSTED_IP_HEADER` behind a proxy that overwrites the header and prevents direct origin bypass. Without a trusted header, limits safely use a shared local bucket. Public responses have `Cache-Control: no-store`, and public catalog/slots never expose customer records, staff emails, appointment lists, time-off reasons, or private management tokens.

## Transactional email

Confirmation, reschedule, and cancellation email rows are inserted in the same transaction as their booking/change. A unique event key prevents duplicate logical mail. Provider failure cannot roll back an appointment. Messages carry a clear business-time-zone time and original booking price. Email uses the shared ZeptoMail adapter from [ACCOUNTS.md](./ACCOUNTS.md), with a fixed application endpoint and the configured sender `noreply@hollen.app`. A live Send Mail token is still required for inbox delivery.

Next.js `after()` attempts up to three queued messages following a successful operation. For recovery after restarts and continued draining, schedule an HTTPS `POST /api/jobs/email` (which also queues due reminders) with `Authorization: Bearer <EMAIL_JOB_SECRET>`; configure a separate random secret of at least 32 characters privately in runtime configuration. Missing/incorrect secrets return 401. A job claims up to five messages using `FOR UPDATE SKIP LOCKED`, sends outside the claim transaction, and records the outcome. Provider acceptance is marked sent; this is not an inbox-delivery guarantee. Ambiguous in-flight sends are not automatically retried. Routes allow a 60-second runtime; configure an equivalent or greater limit on the hosting platform.

No external scheduler or AWS resource has been provisioned here. The authenticated job endpoint is ready to connect to EventBridge or another deployment scheduler. Reminders, bounce/delivery webhooks, broader retry/backoff operations, and alerting remain future work. Outbox message bodies contain their required private email links and must stay in server-side database storage; no body/token is returned by the owner notification list or logged.

## Release checks

Run `pnpm check` and `pnpm build`. Before deployment, manually verify booking creation, availability conflicts, private customer links, rescheduling, cancellation, and email failure handling. Verify actual inbox delivery separately; provider acceptance does not guarantee delivery.
