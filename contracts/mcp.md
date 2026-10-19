# Receptionist MCP contract

Welio exposes one business-scoped MCP endpoint per public business slug:

```text
POST /api/mcp/{slug}
```

The endpoint uses the official Go MCP SDK's stateless Streamable HTTP
transport, JSON responses, and the MCP protocol version
`2025-11-25` or later. Requests require a server-side bearer credential and
pass configured host, origin, and rate limits. Credentials are never exposed to
the browser. The optional OAuth configuration currently supports a
service-level `client_credentials` grant.

## Tools

- `list_services` returns the business's active services, assigned team names,
  prices, appointment locations, time zone, and booking policies.
- `check_availability` returns live slots for an active service and explicit
  `YYYY-MM-DD` date. It is available when the business permits availability
  checks.
- `prepare_booking` validates customer details and a currently available slot,
  then stores a short-lived proposal. It does not create an appointment.
- `confirm_booking` is exposed only when booking is enabled and
  `MCP_BOOKING_CONFIRMATION_ENABLED=true`. It requires an explicit approval of
  the exact proposal and separate consent to booking emails before creating an
  appointment.

Every operation is scoped to the business slug in the endpoint. Booking
confirmation reuses the Go booking service and checks the proposal's workspace,
expiry, approval token, idempotency, and current availability. A repeated
confirmation returns the same appointment; a conflicting booking is rejected
and requires a new proposal.

The OAuth grant currently provides service-level access. It does not implement
Alexa+'s user-level authorization-code/PKCE account-linking flow, so the
endpoint is not a native Alexa+ connection.
