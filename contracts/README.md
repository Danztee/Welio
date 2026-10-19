# API contracts

The Go router and its Huma route definitions are the source of truth for the
HTTP API. The runtime publishes the OpenAPI schema at
`/v1/openapi.json`; update route input and output types before changing its
behavior. This avoids maintaining a second, drifting copy of generated OpenAPI.

The externally callable receptionist contract is described in [mcp.md](./mcp.md).
The REST conventions and route groups are described in [api.md](./api.md). See
[the API guide](../docs/API.md) for local setup, authentication configuration,
and verification.

## Generated frontend contract

Run `make contracts` after changing Huma inputs or outputs. This exports the
actual router schema without database access and generates
`web/src/lib/backend/generated/` with the pinned Hey API generator. The generated
Fetch client, operation functions, and models share one contract. Server requests
use a request-scoped client so user cookies are never stored in shared state.
The web queries convert generated response models for the UI; domain enum
values are validated when converting them into UI models. `make contracts-check`
and CI fail if either artifact is stale. Contract tests also validate serialized
catalog, list, and overview responses against Huma's schema.

Customer and appointment lists return `{ items, total, next_cursor }`. Send
`limit` (1–200, default 50), `cursor`, and optional `search`. Appointments also
accept `customer_id`, `from`, and `to` (inclusive business-local dates). Preserve
the same filters while following a cursor. Empty `next_cursor` means the final
page. Customer detail history has the same `limit`/`cursor` controls and returns
`appointment_count` and `next_cursor` alongside `appointments`.

`GET /v1/workspaces/{workspaceId}/overview` returns complete tenant counts,
30 business-local days of aggregated booking activity, a bounded sample of
today's appointments, and recent activity. List sizes never determine totals.

REST key conversion applies to DTO fields. When a DTO contains caller-owned
JSON or a dictionary, pass its source-field path in `opaquePaths` to
`toAPIContract`/`fromAPIContract`; dictionary keys and values then remain intact.
Array paths use `[]` (for example `items[].metadata`). Current workspace DTOs
use fixed fields rather than arbitrary dictionaries.
