# Email verification pending flow — retrospective requirements

This records behavior introduced in commit `b71e5e6` on 19 October 2026. The
document was written after implementation and does not establish that Kiro
produced the original feature.

## Requirements

### REQ-001: Dedicated pending screen

**When** a new account is created or a sign-in attempt finds an unverified
email, **the web app shall** direct the user to `/verify-email` with their email
and a safe return path. The screen shall explain that the user needs to follow
the email link.

### REQ-002: Process verification links

**When** `/verify-email` receives a token, **the screen shall** submit it for
verification, show progress, and then check the session. A verified session
shall continue to the safe return path; otherwise the user shall be directed
to sign in.

### REQ-003: Recover from invalid links

**When** verification fails or the link is marked invalid or expired, **the
screen shall** show an error and offer to resend verification email when the
account email is available.

### REQ-004: Prevent repeated requests

**While** submission or navigation is pending, **the relevant form controls
shall** remain disabled. The same token shall reuse an in-flight verification
request during the component lifecycle.

### REQ-005: Protect navigation context

**The screen shall** validate the `next` return path before redirecting and
shall avoid sending the verification URL as a referrer.

## Out of scope

- Changes to the Go verification endpoint or email template.
- Claims about delivery of the verification email.
