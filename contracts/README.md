# API contracts

The Go router and its Huma route definitions are the source of truth for the
HTTP API. The runtime publishes the OpenAPI schema at
`/v1/openapi.json`; update route input and output types before changing its
behavior. This avoids maintaining a second, drifting copy of generated OpenAPI.

The externally callable receptionist contract is described in [mcp.md](./mcp.md).
The REST conventions and route groups are described in [api.md](./api.md). See
[the API guide](../docs/API.md) for local setup, authentication configuration,
and verification.
