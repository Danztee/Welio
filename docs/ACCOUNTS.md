# Accounts and saved workspaces

`/sign-up` and `/sign-in` now use real Better Auth email/password credentials in PostgreSQL. Verification is required before sign-in. `/dashboard` reads the current database session and only the workspaces the current user belongs to. The browser-only demo has been retired.

## Local setup

1. Copy `apps/web/.env.example` to `apps/web/.env.local` if it does not exist. Preserve existing configuration.
2. Set `BETTER_AUTH_SECRET` to a unique random value of at least 32 characters. Generate one with `openssl rand -base64 48`; keep it in `apps/web/.env.local`, never in source control.
3. Set `BETTER_AUTH_URL=http://127.0.0.1:3000`. Use this exact origin in your browser; `localhost` has different cookies/origin. `APP_URL` is the metadata origin and should match your deployment.
4. Run `pnpm install --frozen-lockfile`, `pnpm db:up`, `pnpm db:migrate`, and configure the ZeptoMail Send Mail token.
5. Run `pnpm --filter @welio/web dev -- --hostname 127.0.0.1` and open [Create account](http://127.0.0.1:3000/sign-up).
6. Open the verification email in your real inbox and follow its link. ZeptoMail is the only email provider; the verified sender is `noreply@hollen.app`.
7. Create a workspace with business details. In the dashboard, add a team member, working hours, a service, and its staff assignment. Refresh or sign out and back in to confirm persistence.

Only PostgreSQL runs locally in Docker. Accounts use Better Auth with database-backed sessions; email goes through ZeptoMail.

## Implemented

- Email/password signup and signin, server-side name/password validation, field errors, request failures, and pending states.
- Verification on signup and resend, one-hour verification links, automatic session after verification.
- Password reset email, 30-minute reset link, single-use token, password confirmation, and revocation of previous sessions.
- Database sessions, HttpOnly/SameSite cookies, secure production cookies, seven-day expiry, signout, and signing out other sessions.
- Database-backed authentication rate limits and Better Auth origin/CSRF validation. Cookie caching is off, so session revocation is checked against the database.
- Transactional workspace/owner membership creation, workspace selection, unique slug, owner-only profile/catalog/staff updates, and saved setup status.
- Services use integer minor currency units; staff store working hours/days/breaks; staff-service assignment is workspace-scoped. Staff resource records do not automatically create account access.
- Owners can email staff invitations, view their status, revoke invitations or staff membership. Recipients must sign in with the verified invited address. Tokens are random, hashed at rest, expire after seven days, and are atomically single-use. Reinviting replaces earlier outstanding invitations for that email.
- Staff can view their workspace, service catalog, and team, while server mutations and membership administration require owner membership.
- The dashboard handles loading failures without exposing database or configuration details. The readiness endpoint checks the auth/workspace schema too.

## ZeptoMail deployment

Set `EMAIL_FROM=Welio <noreply@hollen.app>` and `ZEPTOMAIL_SEND_MAIL_TOKEN` to your agent’s Send Mail token. The API endpoint is fixed in `apps/web/src/lib/email/zeptomail.ts`; there is no transport or API URL environment variable. Do not use an OAuth access token or expose the Send Mail token through `NEXT_PUBLIC_` variables.

Set `BETTER_AUTH_URL` and `APP_URL` to your public HTTPS origin, configure a production PostgreSQL URL and unique `BETTER_AUTH_SECRET`, and apply the committed migrations. Add the required sending-domain DNS records and complete sender verification in ZeptoMail. Account verification, password reset, and staff invitations all use this shared adapter. The adapter sends plain text, disables click/open tracking, rejects redirects, uses a 10-second timeout, and never includes provider response bodies, email content, or credentials in errors. It does not automatically retry uncertain sends, which could duplicate email.

The sender is configured as `noreply@hollen.app`; a live Send Mail token is still required before verification, reset, invitations, or booking emails can be delivered. Add it privately to `apps/web/.env.local` and restart the app. Provider configuration is validated when sending, so existing sessions and sign-in remain usable while email is unavailable. Builds do not require email secrets. No live delivery is claimed until an actual controlled inbox test passes.

Behind a trusted edge proxy, set `AUTH_TRUSTED_IP_HEADER` to the client-IP header that the proxy overwrites, and ensure the application origin cannot bypass that proxy. Do not trust a header that clients can supply. Without it, authentication safely falls back to a shared per-endpoint bucket; this is appropriate locally but must be configured for multi-user deployment. The app does not trust forwarded hosts to build auth URLs. Incoming development logs suppress auth/reset/verification/invitation URLs to avoid token logging; apply equivalent query redaction in hosting/proxy logs.

Authentication mail uses Next.js `after()` so the request does not wait for provider delivery and does not reveal email existence through provider latency. Delivery failure emits only the `auth_email_delivery_failed` event, with no recipient/token. Users can resend links after delivery is restored. Invitation sending is awaited, and a delivery failure revokes that invitation. Provider retries, bounce tracking, and an email outbox are future operational work.

## Release checks

Run `pnpm check` and `pnpm build`. Before deployment, manually verify signup, email verification, recovery, workspace creation, member isolation, role restrictions, invitations, and persistence using controlled accounts and inboxes.

## Related workflows

Public booking and customer management are covered in [BOOKINGS.md](./BOOKINGS.md). Appointment reminders are covered in [REMINDERS.md](./REMINDERS.md). The receptionist uses Amazon Bedrock; the owner has tested live inference. Payments, delivery webhooks, deployed scheduling, and production hosting remain future work.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [Next.js integration](https://better-auth.com/docs/integrations/next), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [ZeptoMail sending API](https://www.zoho.com/zeptomail/help/api/email-sending.html), [official ZeptoMail examples](https://github.com/zoho/zoho-cpaas-node).

## Account names and password confirmation

Signup collects first name and last name separately (1–50 characters each after trimming). Better Auth validates both server-side and stores them as `users.first_name` and `users.last_name`. The combined `name` remains available for display and authentication compatibility. Account profile edits update the same two fields and recompute the combined name. Migration `0006` adds nullable columns for existing accounts without guessing how their names split; new signups require both fields.

Signup requires matching password and confirmation values before submitting. Confirmation is a form check, is not sent to the auth API, and is never stored. Existing password hashing and server-side password limits are unchanged.

## Workspace onboarding

After authentication, accounts with no workspace are redirected to `/onboarding`. The standalone flow creates the business and opens the dashboard. Team members, working hours, services, and staff assignments are added there before the booking page can be published. Owners of workspaces left incomplete by the previous flow can finish business setup at `/onboarding?workspace=<id>`. Existing staff memberships can enter their workspace without owner setup permissions. Create workspace from the switcher links to `/onboarding?new=true`; it no longer opens a dashboard creation dialog. The business address uses a multiline textarea; the booking URL slug is suggested from the business name and remains editable.

Signed-in workspaces contain their own saved records and start empty. Onboarding does not insert fictional bookings, customers, or invoices.

## Dashboard routes

Each live section has a dedicated Next.js page: `/dashboard` (overview), `/dashboard/appointments`, `/dashboard/customers`, `/dashboard/receptionist`, `/dashboard/notifications`, `/dashboard/services`, `/dashboard/team`, `/dashboard/members`, and `/dashboard/settings`. The optional `workspace` query parameter selects the active workspace; it does not select the section. All pages share the authenticated workspace loader and onboarding checks. Sidebar entries are links, and mutation actions revalidate the dashboard subtree. Direct links preserve their destination through sign-in.

The demo routes have been removed. Invoices and reports are not yet implemented in the signed-in application.
