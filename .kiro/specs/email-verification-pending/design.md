# Email verification pending flow — retrospective design

This describes the implementation in `b71e5e6`, written after the commit.

## Flow

`web/src/app/verify-email/page.tsx` renders a dedicated
`VerificationPending` client component within Suspense. The page has a specific
title, disallows indexing, and sets `referrer: "no-referrer"`.

The sign-up and unverified sign-in branches in `auth-form.tsx` navigate to the
pending page with an encoded email and `next` value. Navigation uses
`router.replace` in a React transition, and the submit button is disabled while
the request or navigation is pending.

On the pending page, a token starts `authClient.verifyEmail`. A ref holds the
token and request so rerenders do not start another request for that token.
After success, the component reads the session and uses `window.location.replace`
to continue to the validated return path or sign-in. Without a token, the page
shows inbox guidance. If the email query parameter is absent, it attempts to
read the account email from the current session. Resend uses
`authClient.sendVerificationEmail` and displays success or error feedback.

The generic `AccountFlow` remains for forgot and reset password; verification
is no longer one of its modes. The commit also adjusts auth shell presentation,
error display, and password guidance in adjacent components.

## Verification points

Review sign-up, unverified sign-in, valid token, invalid token, resend, and
unsafe `next` input. The commit diff establishes the implementation; it does
not record that these manual flows were executed.
