# Welio HTTP API

The Go API is the only owner of application data. The web app calls it through
`/v1`; Next.js forwards server-side requests to the private API origin and the
browser uses the public API origin for authenticated or public booking flows.
The Go router and its Huma route definitions generate the OpenAPI 3.1 contract
at `GET /v1/openapi.json`.

## Wire conventions

- JSON property names use `snake_case`. The web app keeps camelCase models and
  converts at the API boundary in `web/src/lib/api-contract.ts`.
- IDs are UUID strings. JSON timestamps use RFC 3339.
- API errors use `application/problem+json` with `status`, `title`, `detail`,
  an optional stable `code`, `request_id`, and field-level `errors` when input
  validation can identify them.
- Workspace-owned requests use the authenticated workspace selected by
  `X-Welio-Workspace`; the API verifies membership and scopes database queries
  to that workspace. The receptionist's public chat and MCP transports have
  separate contracts documented in `mcp.md` and the receptionist package.
- Huma route input and output types are the source of truth. Change those types
  first; do not maintain a second hand-written OpenAPI schema.

## Route groups

| Area                                     | Routes                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Authentication and account               | `/v1/auth/*`, `/v1/me`, `/v1/me/session*`                                    |
| Workspaces and team access               | `/v1/workspaces`, `/v1/workspaces/{workspaceID}/*`, `/v1/invitations/*`      |
| Service catalog and staff                | `/v1/catalog/*`                                                              |
| Public booking and customer self-service | `/v1/book/{slug}*`, `/v1/bookings/{id}`                                      |
| Workspace appointments and customers     | `/v1/workspaces/{workspaceId}/appointments*`, `/customers*`, `/availability` |
| Receptionist configuration and preview   | `/v1/workspaces/{workspaceID}/receptionist*`                                 |

Public booking routes do not require the workspace access token. They still
validate business publication, booking policy, slot availability, customer
consent, and origin limits in the booking service.

## Change checklist

When changing an API operation:

1. Update its Huma input/output type and preserve `snake_case` JSON tags.
2. Keep workspace identity derived from the authenticated principal or public
   business slug; never accept a workspace scope from an untrusted body.
3. Return `httpx.Wrap(err)` or a typed `httpx.E(...)` problem. Do not return raw
   internal errors to clients.
4. Update the browser adapter only when the response or request shape changes.
5. Regenerate the contract and run `make contracts-check` and `make verify` before shipping.

The public receptionist stream at `/v1/workspaces/{workspaceID}/receptionist/preview`
uses newline-delimited events for token streaming. The public chat endpoint
(`/api/chat/{slug}`) and MCP tools keep their own protocol field names because
they are not Huma REST resources.
