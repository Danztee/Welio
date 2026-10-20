# API contracts

The Go router and its Huma route definitions are the source of truth for the
HTTP API. The runtime publishes the OpenAPI schema at `/v1/openapi.json`; update
route input and output types before changing its behavior. This avoids
maintaining a second, drifting copy of generated OpenAPI.

See [the receptionist guide](../docs/RECEPTIONIST.md#external-mcp-server) for
the MCP transport and tools, and [the API guide](../docs/API.md) for service
configuration and authentication.

## HTTP conventions

- REST JSON fields use `snake_case`; the web boundary converts them to camelCase
  in `web/src/lib/api-contract.ts`.
- IDs are UUID strings and timestamps use RFC 3339.
- Errors use `application/problem+json` with `status`, `title`, `detail`,
  optional `code`, `request_id`, and field-level `errors`. Handlers return
  `httpx.Wrap(err)` or a typed `httpx.E(...)` problem instead of exposing
  internal errors.
- Workspace requests send `X-Welio-Workspace`. Go verifies membership and scopes
  database operations to that workspace. Public booking and MCP scope comes from
  the business slug; an untrusted request body never selects it.
- Chat and MCP retain their protocol field names; REST conversion does not apply
  to their messages.

The schema lists all routes and request/response types. Change Huma definitions
first, regenerate the artifacts, and run `make verify` before shipping.

## Generated frontend contract

Run `make contracts` after changing Huma inputs or outputs. This exports the
actual router schema without database access and generates
`web/src/lib/backend/generated/` with the pinned Hey API generator. The
generated Fetch client, operation functions, and models share one contract.
Server requests use a request-scoped client so user cookies are never stored in
shared state. The web queries convert generated response models for the UI;
domain enum values are validated when converting them into UI models.
`make contracts-check` and CI fail if either artifact is stale.

Customer and appointment lists return `{ items, total, next_cursor }`. Send
`limit` (1–200, default 50), `cursor`, and optional `search`. Appointments also
accept `customer_id`, `from`, and `to` (inclusive business-local dates).
Preserve the same filters while following a cursor. Empty `next_cursor` means
the final page. Customer detail history has the same `limit`/`cursor` controls
and returns `appointment_count` and `next_cursor` alongside `appointments`.

`GET /v1/workspaces/{workspaceId}/overview` returns complete tenant counts, 30
business-local days of aggregated booking activity, a bounded sample of today's
appointments, and recent activity. List sizes never determine totals.

REST key conversion applies to DTO fields. When a DTO contains caller-owned JSON
or a dictionary, pass its source-field path in `opaquePaths` to
`toAPIContract`/`fromAPIContract`; dictionary keys and values then remain
intact. Array paths use `[]` (for example `items[].metadata`). Current workspace
DTOs use fixed fields rather than arbitrary dictionaries.
