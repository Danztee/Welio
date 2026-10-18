# Welio implementation roadmap

**Your AI Front Desk, Always On.**

Created: October 17, 2026. Status: Phase 1 scaffold and local database foundation implemented; deployment and environment work remain.

## 1. Product and finish line

Welio helps small service businesses run their front desk through a dashboard, a public booking page, and a conversational AI receptionist. Business owners configure their services, prices, staff, and working hours. Customers ask questions and book appointments. The AI performs authorized operations through the same business rules as the dashboard.

The first complete customer journey is for a small cleaning business. The data model should support other appointment businesses, but specialized salon, barber, and field-service workflows are outside the first release.

Example owner request:

> “Book Sarah for Tuesday at 10 AM, charge ₦15,000, and send her the appointment details.”

Welio must resolve which Sarah and which date, check availability, show the proposed booking and amount, and obtain any required authorization. Setting an appointment price, creating an invoice, and collecting money are separate operations. A customer must authorize payment through the payment provider; an AI instruction alone must never debit them.

### Release boundaries

| Release                 | Required outcome                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hackathon demonstration | A deployed owner can onboard, publish services and availability, accept a customer booking, manage customers, and use AI tools to book or change an appointment and deliver an authorized confirmation email. |
| Private beta            | Real businesses can use the core workflow with secure workspace isolation, reliable notifications, backups, monitoring, and a support process.                                                                |
| Full initial product    | Beta capabilities plus staff accounts, reminders, invoices, payment links and reconciliation, operational reporting, and a validated production release.                                                      |
| Expansion               | Additional channels such as telephone voice, SMS, WhatsApp, and native Alexa+ experiences after access, feasibility, costs, and permissions are verified.                                                     |

“Always On” is the product ambition. Publish actual service availability and support expectations only after measuring the deployed system.

## 2. Planning assumptions and decisions

These are proposed defaults for implementation, not choices already approved by the owner:

- Build a responsive web application first; no native mobile application in the initial release.
- Start with one location per workspace, one staff member per appointment, fixed-duration services, and no recurring appointments or group bookings.
- For the cleaning demonstration, assume service at the customer's address within an owner-defined service area. Collect the address per booking; route optimization and travel-time scheduling are deferred, so owners must configure adequate buffers.
- Start the demonstration with cleaning businesses and NGN pricing. Store a workspace currency and an IANA time zone; use `Africa/Lagos` as the demonstration default, not a global hard-coded setting.
- Support owners and public customers first. Add staff accounts and permissions before broader beta access.
- Use TypeScript, React, a server-side application/API, PostgreSQL, and a managed authentication solution. Choose exact frameworks and versions during setup after checking compatibility.
- Use Strands SDK with Amazon Bedrock for model tool calling. Put business operations behind an authenticated MCP interface backed by application services.
- Use a durable job queue and transactional outbox for email and reminders. Redis is optional infrastructure if needed by the chosen queue; it is not the source of booking truth.
- Prefer a modular application with one deployment boundary initially. Separate workers where execution or scaling requires it; avoid starting with independent microservices.
- Choose hosting, email, authentication, and payment providers after checking regional support, costs, account access, and integration requirements.

The earlier discussion mentions an October 23, 2026 hackathon deadline and an Alexa+ primary track. Treat both as **unverified planning inputs** until the official rules, submission time zone, track requirements, and integration access have been checked. A web simulation must be labeled as a simulation and must not be represented as a working Alexa+ integration.

## 3. Proposed architecture

```text
Owner dashboard / Public booking page / Web AI chat
                         |
              Authentication + application API
                         |
          Booking / customer / billing services
             |                       |
         PostgreSQL          Outbox + durable workers
                                     |
                            Email / payment provider

Web AI chat -> AI gateway -> Strands SDK -> Amazon Bedrock
                    |
             Authenticated MCP tools
                    |
        The same application services and policies
```

The server determines workspace identity and permissions from the authenticated context. A model-supplied workspace ID is never authority. Public booking and chat receive a limited business-scoped context and cannot read customer lists, invoices, or other private records.

### Core records

| Area           | Records and important fields                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Identity       | User, workspace, membership, role, session                                                                 |
| Business setup | Business profile, booking slug, time zone, currency, notification policy                                   |
| Catalog        | Service, duration, buffer, price in integer minor units, active status                                     |
| Scheduling     | Staff, service eligibility, working hours, breaks, time off, appointment, private service-address snapshot |
| Customers      | Customer, contact information, consent, appointment history                                                |
| AI             | Conversation, tool request, approval, execution result                                                     |
| Delivery       | Outbox event, notification, attempt count, delivery state                                                  |
| Billing        | Invoice, line item, payment reference, webhook event, refund record                                        |
| Accountability | Audit event, actor, workspace, action, timestamp, request identifier                                       |

Store appointment instants in UTC and display them in the workspace or explicitly selected customer time zone. Snapshot duration and price on appointments and invoices so later catalog edits do not rewrite history. Keep personal data out of logs wherever possible.

## 4. Implementation order

Check off an item only when it works and its completion evidence is available. Finish the phase gate before beginning dependent work. Each phase should produce a small, reviewable change.

### Phase 0 — Confirm the delivery constraints

- [ ] Verify official hackathon eligibility, deadline and time zone, required artifacts, permitted services, and track judging criteria.
- [ ] Verify Alexa+ integration access and requirements. Decide whether the submission can satisfy the intended track; use a permitted alternative if access is unavailable.
- [ ] Confirm Bedrock model access, tool capabilities, quotas, and a modest development spend limit.
- [ ] Confirm initial business type and booking rules: duration, staff assignment, lead time, booking horizon, buffers, cancellation cutoff, and business time zone.
- [ ] Record provider and stack choices in `docs/DECISIONS.md`, including proposed defaults accepted or changed.
- [ ] Define the demonstration business, its services, synthetic customers, and the exact demonstration script.

**Done when:** Required accounts and access work, track feasibility is understood, and the first release has an agreed scope. Do not leave Alexa+ access discovery until submission day.

### Phase 1 — Set up the application foundation

- [x] Initialize source control and the application using the chosen compatible framework versions.
- [x] Add a README, local setup instructions, environment-variable template, formatting, linting, type checking, and a CI build configuration. Remote CI execution remains pending repository publication.
- [x] Set up PostgreSQL, schema migrations, a local development database, and synthetic seed data. Added a separate integration-test database and server-only database readiness endpoint.
- [ ] Create separate development and production environments; use a staging environment for release verification.
- [ ] Add server-side configuration validation, secret storage, health checks, structured errors, and request identifiers.
- [ ] Deploy a minimal page and verify database connectivity from the deployed application.

**Done when:** A fresh checkout can run from documented instructions, CI passes, and the deployed application can use its database without exposing credentials.

### Phase 2 — Add accounts and workspace isolation

- [x] Build responsive sign-in and sign-up screens with accessible validation and password controls. The screens now use real email/password authentication.
- [x] Implement sign-up, sign-in, sign-out, verification, and account recovery with Better Auth, PostgreSQL, and ZeptoMail delivery (live credentials pending).
- [x] Create a workspace for a new owner and associate membership with that workspace transactionally.
- [ ] Add server-side authorization to every private query and mutation, including MCP entry points. Implemented for account/workspace setup and membership operations; Implemented for booking/customer management too; MCP entry points remain pending.
- [x] Define owner/staff permissions: owners manage setup and invitations, staff can view their workspace, services, and team. Acceptance, revocation, and membership checks are implemented.
- [ ] Add safe session handling and rate limits for authentication and public endpoints. Implemented database-backed sessions, auth/public-booking rate limits, origin checks, and bounded requests. Future public AI endpoints still need controls.
- [x] Test current workspace queries, mutations, and URLs against guessed identifiers and another owner; staff cannot perform owner mutations. Future tools require their own negative tests.

**Done when:** Two owners can use independent workspaces and verified attempts to cross workspace boundaries fail.

### Phase 3 — Build business onboarding

- [x] Save business name, contact details, service area, time zone, currency, and a unique booking slug.
- [x] Let owners save services with descriptions, durations, prices, and booking buffers.
- [x] Let owners save staff resources and service assignments, independently of staff sign-in invitations.
- [x] Configure weekly working hours, breaks, time off, lead time, booking horizon, and cancellation rules.
- [x] Add a setup checklist and booking-page preview; prevent publishing incomplete configurations.
- [ ] Validate public business content separately from private internal notes.

**Done when:** An owner can configure a real service and publish enough information to calculate bookable slots.

### Phase 4 — Build the scheduling engine first

- [x] Implement availability from service duration, buffers, staff eligibility, working hours, breaks, time off, and existing appointments.
- [ ] Define appointment states and permitted transitions: confirmed, completed, cancelled, and no-show. Document who can perform each transition.
- [ ] Implement create, reschedule, and cancel operations with server-side validation and audit events.
- [x] Enforce non-overlapping occupied intervals per staff member at the database/transaction boundary. A UI availability check alone is insufficient.
- [x] Add idempotency keys to mutations so retries do not create duplicate appointments or events.
- [ ] Keep the original appointment if rescheduling fails; commit the move and its event atomically.
- [ ] Test concurrent requests for the same slot, adjacent slots with buffers, time-zone conversion, daylight-saving boundaries, time off, cancellations, and repeated requests.

**Done when:** Concurrent requests cannot double-book a staff resource, every entry point follows the same rules, and failed rescheduling preserves the original booking.

### Phase 5 — Deliver public booking and owner management

- [ ] Build the public flow: choose service, choose available time, enter contact details, review, and confirm.
- [ ] For on-site services, collect and snapshot the service address, validate the supported service area, and restrict address access to authorized owners/staff and the verified booking customer.
- [ ] Revalidate availability when confirming and offer alternatives if the slot has just been taken.
- [ ] Create or match customers using deliberate contact-matching rules; avoid merging people solely by name.
- [ ] Add the owner calendar, appointment list, appointment detail, and manual booking/rescheduling/cancellation.
- [ ] Add customer search, customer detail, and appointment history.
- [ ] Provide secure, expiring customer management links with limited scope; never expose appointments through predictable identifiers.
- [ ] Handle loading, empty, validation, success, and failure states; support keyboard navigation and mobile layouts.

**Done when:** A customer can book through the deployed page and the owner can find and manage that booking without using AI.

### Phase 6 — Make confirmations reliable

- [ ] Integrate an email provider and configure its required sender verification.
- [ ] Store the appointment mutation and notification event in the same database transaction.
- [ ] Build a worker with durable retries, deduplication, delivery tracking, and a visible failed-job path.
- [ ] Create confirmation, reschedule, and cancellation templates with correct business, service, amount, time zone, and management link.
- [ ] Add an explicit owner policy allowing standard transactional messages for bookings; collect the customer's required consent/contact preference. AI-generated or exceptional messages require a reviewed approval.
- [ ] Display booking success and email delivery status separately. A failed email must not erase a successful booking.
- [ ] Test delivery to a controlled inbox, provider failure, worker restart, and repeated processing of the same event.

**Done when:** Authorized confirmations reach the controlled inbox, delivery failure is visible and retryable, and duplicate job processing does not create duplicate logical notifications.

### Phase 7 — Connect Strands, Bedrock and MCP tools

- [x] Add saved receptionist greeting, instructions, FAQs, customer chat status, and enforced availability/booking permissions.
- [x] Add an owner-only preview without booking/email execution, readiness checks, and booking-page publishing/link controls.

- [ ] Verify the chosen Bedrock model supports the required tool flow through Strands; configure AWS credentials, timeouts, and usage limits.
- [ ] Implement server-side MCP authentication and distinct public-customer and owner tool permissions.
- [ ] Require a valid appointment-scoped management token or equivalent verified ownership before public chat reads, reschedules, or cancels an existing appointment. A name, email address, or booking ID alone does not prove ownership; keep management tokens outside model prompts and logs.
- [ ] Start with read tools: `list_services`, `get_business_hours`, `check_availability`, and owner-only `find_customer` and `get_appointments`.
- [ ] Add mutation tools: `create_appointment`, `reschedule_appointment`, and `cancel_appointment`, reusing the tested application services.
- [ ] Define validated tool input/output schemas and stable error codes. Return alternatives for unavailable slots.
- [ ] Require clarification for ambiguous customer identity, service, price, or relative dates before mutation.
- [ ] Present a specific action summary for approval. Bind approval to the authenticated actor, workspace, exact arguments, expiry, and one-time execution; revalidate availability at execution.
- [ ] Treat messages and retrieved business content as untrusted input. Enforce authorization, amounts, and tool scope in application code.
- [ ] Record tool attempts, approvals, execution results, latency, and cost without retaining unnecessary personal data.
- [ ] Add readable failure handling for model outages, invalid arguments, expired approvals, and tool timeouts. Never claim success without a committed backend result.
- [ ] Test realistic conversations, duplicate calls, prompt injection, public attempts to access owner tools or someone else's appointment, and booking conflicts between preview and approval.

**Done when:** An owner can ask to book a customer, approve the concrete action, and see the actual persisted appointment and authorized email status. Public chat can answer catalog questions and book without exposing private data.

### Phase 8 — Complete the hackathon release

- [ ] Demonstrate onboarding, public booking, owner calendar, customer history, and one complete AI-assisted booking flow.
- [ ] Demonstrate a conflict or unavailable slot and the recovery path.
- [ ] Complete the real Alexa+ integration if feasible and required for the chosen track; otherwise select a track and demonstration format explicitly permitted by the rules.
- [ ] Run the critical end-to-end flow against the deployed environment, including a real controlled email delivery.
- [ ] Review workspace isolation, permissions, secrets, public data exposure, mobile usability, and AI usage limits.
- [ ] Prepare a concise README, architecture diagram, demo video, screenshots, setup instructions, AWS service explanation, and honest limitations.
- [ ] Verify submission links, required fields, judging access, and official deadline/time zone before submitting.

**Done when:** The deployed flow works from a fresh session, the submission meets verified rules, and every demonstrated capability is clearly identified as implemented or simulated.

### Phase 9 — Add reminders and operational reliability

- [x] Add owner-controlled 24-hour email reminders and reschedule/cancellation-aware job invalidation. Deployed scheduling and live inbox verification remain pending.
- [x] Check the latest appointment state before sending a reminder; suppress stale messages.
- [ ] Add error monitoring and alerts for failed jobs, elevated request failures, queue age, and model spend.
- [ ] Configure database backups and retention; perform and document a restore rehearsal.
- [ ] Document deployment, rollback, migrations, incident response, and secret rotation.
- [ ] Add customer-data export/deletion and retention controls, privacy information, and separate transactional/marketing preferences as applicable.
- [ ] Measure booking success, email delivery, AI task completion, latency, and operating cost per workspace.

**Done when:** The service can recover from worker and provider failures, a backup restore is proven, and operators can detect and investigate incidents.

### Phase 10 — Make staff collaboration usable

- [ ] Add staff invitations, account acceptance, removal, and scoped permissions.
- [ ] Let staff view their assigned appointments and manage availability within owner-defined permissions.
- [ ] Add owner controls for assignment and service eligibility, plus an audit trail for changes.
- [ ] Test revoked membership, staff access restrictions, and schedule changes that affect existing bookings.

**Done when:** Multiple staff members can work in one business without gaining unintended owner privileges or causing schedule conflicts.

### Phase 11 — Add invoices and payment links

- [ ] Select a payment provider with verified support for the initial business region, currency, onboarding, and settlement requirements.
- [ ] Define invoice numbering, line items, due dates, draft/issued/void states, and unpaid/partial/paid/refunded payment status. Confirm applicable tax and invoice requirements before launch.
- [ ] Create invoices from appointment price snapshots; make amount overrides explicit and permission-controlled.
- [ ] Generate hosted checkout links and never store raw card details.
- [ ] Verify webhook signatures and deduplicate provider events. Reconcile confirmed payments against invoices, including out-of-order events.
- [ ] Keep invoice issuance, delivery, payment collection, and refunds as separate authorized actions.
- [ ] Handle failed, expired, duplicate, partial, and refunded payments; provide a reconciliation view for owners.
- [ ] Add owner-only AI tools for invoice drafts and approved invoice delivery. Keep refunds under explicit owner approval.
- [ ] Test provider sandbox flows before a controlled live payment and settlement check.

**Done when:** An owner can issue an accurate invoice, send an authorized payment link, and see payment status derived from verified provider events rather than a browser redirect or AI statement.

### Phase 12 — Add useful reporting and launch a private beta

- [ ] Show upcoming appointments, completed jobs, cancellations, unpaid invoices, and collected revenue using clearly defined metrics.
- [ ] Separate appointment value, invoiced amounts, and received payments in reports.
- [ ] Add activity history, setup guidance, help content, and an owner-visible route to support.
- [ ] Recruit a small pilot group and run onboarding with each business using its actual services and availability.
- [ ] Observe booking and AI workflows, resolve blocking issues, and validate that the product saves owners time.
- [ ] Confirm privacy and service terms, account deletion, provider production readiness, support ownership, and realistic operating costs.
- [ ] Run accessibility, responsive-layout, concurrency, authorization, and failure-recovery checks against the release candidate.

**Done when:** Pilot businesses can independently onboard, receive bookings, manage customers and staff, receive reminders, issue invoices, and reconcile payments, with monitoring and a support process in place.

### Phase 13 — Expand channels after the core is stable

- [ ] Prioritize telephone voice, SMS, WhatsApp, or native Alexa+ based on pilot demand and verified platform access.
- [ ] For telephone voice, add number provisioning, speech input/output, call interruption, human handoff, latency monitoring, and clear failure behavior.
- [ ] Define recording/transcription consent and retention before enabling either feature.
- [ ] Reuse the same authorized scheduling tools, customer identity checks, and audit trail for every channel.
- [ ] Consider calendar synchronization, recurring appointments, multiple locations, deposits, travel time, and richer staff workflows as separate scoped releases.
- [ ] Add Welio subscription billing and plan limits only after separating them from the invoices businesses send their customers.

**Done when:** Each additional channel meets its own functional, permission, reliability, and cost checks before being offered to customers.

## 5. Conditional hackathon schedule

If October 23 is confirmed as the deadline, use the following compressed solo-builder target. This is a prioritization guide, not a delivery guarantee. Authentication, data isolation, and scheduling integrity are release requirements even under time pressure.

| Date, 2026 | Target                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| October 17 | Verify rules and account access; choose stack; deploy foundation.                           |
| October 18 | Owner accounts, workspace isolation, onboarding, services, and staff resources.             |
| October 19 | Availability engine, conflict protection, public booking, and basic owner appointment view. |
| October 20 | Customer records, transactional outbox, and delivered confirmation email.                   |
| October 21 | Strands/Bedrock, MCP tools, scoped permissions, and action approvals.                       |
| October 22 | End-to-end checks, track integration, deployment polish, demo recording, and documentation. |
| October 23 | Submission validation and buffer before the verified cutoff.                                |

If behind, reduce the number of screens, configurable settings, and supported scenarios. Keep invoices/payments, staff logins, advanced reporting, and telephone voice after the hackathon. Do not demonstrate unsupported actions as complete. Track-specific integration work begins with access verification on October 17, not October 22.

## 6. Verification and release evidence

Use targeted tests for rules that can lose bookings, disclose data, send incorrect messages, or misstate payments. Use manual walkthroughs for straightforward presentation details.

| Gate          | Evidence to retain                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Scheduling    | Automated concurrency and rescheduling checks; time-zone and buffer cases.                                           |
| Authorization | Negative tests across two workspaces, public tools, staff roles, and revoked access.                                 |
| AI actions    | Conversation cases with persisted results, argument-bound approvals, duplicate execution, and injected instructions. |
| Notifications | Controlled inbox delivery, retried failures, deduplication, and stale-reminder suppression.                          |
| Payments      | Signed-event verification, replay/out-of-order cases, reconciliation, and controlled settlement.                     |
| Deployment    | Passing build, fresh-session walkthrough, backup restoration, and documented rollback.                               |
| Usability     | Keyboard and mobile walkthroughs; pilot observation of a complete booking flow.                                      |

## 7. Completion checklist for the full initial product

- [ ] A new business can create an account and finish setup without developer help.
- [ ] Its customers can book and securely manage appointments on mobile or desktop.
- [ ] Concurrent requests cannot double-book a staff resource.
- [ ] Owners and staff have the correct access; workspace data remains isolated.
- [ ] The AI can read allowed business information and execute approved actions with truthful results.
- [ ] Confirmations and reminders are authorized, tracked, retryable, and recoverable.
- [ ] Customers, appointments, invoices, and verified payments are visible in the dashboard.
- [ ] A business can issue an invoice, receive payment, and reconcile it correctly.
- [ ] Monitoring, spend limits, backups, restoration, and support procedures are operational.
- [ ] Pilot businesses have successfully completed the core workflows on the deployed product.

## 8. How to maintain this roadmap

At the start of each phase, turn its checklist into implementation tasks with dependencies and acceptance checks. At its end, record the delivery date, evidence, known limitations, and remaining work. Update assumptions when official platform rules, pilot feedback, or technical findings change the plan.

**Database foundation evidence (October 17, 2026):** PostgreSQL 18 runs in Docker Compose; the initial eight-table migration and synthetic seed have been applied repeatedly. Integration checks cover tenant foreign keys, seed repeatability, snapshots, prices/durations, idempotency keys, transaction rollback, and local-target guards. The development application reports database readiness separately from liveness. Deployment and production secret management remain pending.

**UI milestone:** The browser-only end-to-end demo is implemented. Its route inventory, flows, demo boundaries, and checks are recorded in [docs/UI-CHECKLIST.md](./docs/UI-CHECKLIST.md). This completes the prototype interface milestone; the production/backend checkboxes above remain independent.

**Booking milestone:** Real policy/time-off setup, availability, public/owner bookings, private customer changes, customer lists, and transactional mail events are implemented and verified; see `docs/BOOKINGS.md`.

**Receptionist milestone:** Strands Agent with Bedrock Converse, scoped MCP catalog/availability/proposal tools, persisted chat sessions, expiring explicit approvals, idempotent booking execution, public chat UI, usage limits, and owner configuration/preview controls are implemented; see `docs/RECEPTIONIST.md`. Live Bedrock inference and conversation quality remain unverified until AWS credentials and model access are configured. Phase 7 also retains owner tools, private management tools, and broader observability work; it is not complete.

**Builder direction:** Strands SDK supplies the runtime agent loop with Bedrock as the model provider. The official rules explicitly list Strands SDK for the AWS Builder mini challenge. Kiro Crew remains an additional development-tool path, with actual contribution evidence pending. Alexa+ remains the intended primary track through the MCP/simulation path; a working demo and submission evidence are still required. The owner has Bedrock access; the earlier GLM 4.7 error was a daily token throttle. Live inference and a model with usable quota for the Alexa simulation remain to be verified.

**Next action:** Configure the ZeptoMail token for `noreply@hollen.app` and run a controlled live inbox check. All automated test files and their package/CI commands were removed at the user’s request. Continue verification with code checks, builds, and manual walkthroughs. Record actual Kiro Crew contributions once user setup is complete. Configure deployed email/expired-chat cleanup jobs. Complete remaining Phase 0 access and Alexa+ track checks before claiming hackathon readiness. Technical choices and the Supabase design reference are recorded in `docs/DECISIONS.md`.
