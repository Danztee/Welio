# Accounts and saved workspace foundation

Implement the account and workspace phase authorized by the owner. Preserve the supplied theme and existing account pages. Use Better Auth email/password with PostgreSQL/Drizzle, verified email before access, server-side sessions, password reset with session revocation, database rate limits, and normal origin/CSRF protections. No social login or custom password hashing in this pass.

Use ZeptoMail as the only email provider; keep only the database local. No token logging or public inbox endpoint. Configure secrets locally without committing them. Build remains possible without runtime secrets; authentication fails closed when missing.

Separate the fictional localStorage demo at /demo from the authenticated /dashboard. Never import browser demo records as real business data. Real workspace creation and membership insertion are transactional. Each read/write checks the current session and current database membership. Owner manages configuration and invites; staff sees the assigned workspace without owner controls. Invitations use hashed random tokens, expiration, recipient email matching, and atomic consumption. Registration alone grants no access to existing workspaces.

Save business onboarding, services/prices, staff/hours, and staff-service assignment to existing relational tables, with validation and workspace scoping. Bookings, invoices, Bedrock/MCP, and real notifications remain subsequent integrations. Retain the complete interactive demo for those flows and clearly identify the boundary.

Verify sign-up, actual email link, unverified rejection, sign-in/out, recovery/reset, workspace creation and refresh persistence, cross-user isolation, role restrictions, invitation expiry/replay/wrong-recipient behavior, and existing database regressions. Document ZeptoMail setup and remaining deployment configuration.
