# Architecture

Welio is a modular application with a Go API, a standalone Next.js web app, and
PostgreSQL. The API owns authentication, workspace authorization, business
rules, persistence, the AI receptionist, MCP, and background jobs. The web app
renders the interface and calls the API; it does not access PostgreSQL.

```text
Browser ──> Next.js web app ──> Go API ──> PostgreSQL
Browser ────────────────────> Go API
MCP client ─────────────────> Go API
                                  ├──> Amazon Bedrock
                                  └──> River worker ──> ZeptoMail
```

## Backend areas

| Package                 | Responsibility                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `internal/app`          | Application composition, route registration, and process lifecycle |
| `internal/deps`         | Shared configuration and infrastructure clients                    |
| `internal/core`         | Accounts, workspaces, membership, and platform maintenance         |
| `internal/catalog`      | Business profile, services, staff, assignments, and schedules      |
| `internal/bookings`     | Booking policies, availability, appointments, and customer records |
| `internal/receptionist` | AI conversations and MCP tools backed by booking services          |
| `internal/jobs`         | Durable River job definitions and queue operations                 |
| `internal/mailer`       | Transactional email delivery through ZeptoMail                     |

Each area owns its business rules and persistence operations. HTTP handlers
validate requests, establish the authenticated or public business context, and
call area services. The same booking services are used by the dashboard,
customer chat, and MCP tools. A model or browser never chooses the authoritative
workspace for a protected operation.

Booking changes and their notification jobs are inserted in the same database
transaction. The API and worker run as separate process roles; the worker
delivers queued email and performs scheduled maintenance.

## Web data flow

Workspace features keep API access, presentation models, and data loading
separate:

1. `web/src/features/workspaces/api.ts` contains typed endpoint operations
   generated from the Go API's OpenAPI contract.
2. `models.ts` converts transport data into UI models, including dates, enums,
   nullable values, and dashboard aggregates.
3. `queries.ts` loads the data required by a page and runs independent requests
   concurrently.

Server Actions validate input and call the feature API. The Go API authorizes
each request, including requests that originate from a Server Action. Components
render UI models and invoke actions instead of constructing private API URLs.

The browser uses `NEXT_PUBLIC_WELIO_API_URL`. Next.js server code uses
`WELIO_API_INTERNAL_URL` when it needs a private API origin. Keep backend
credentials out of the web app environment.

## Development and checks

The root Makefile is the command menu. `make setup` installs dependencies and
creates missing local environment files. `make dev` starts PostgreSQL, applies
migrations, and runs the API, worker, and web app as separate processes. Use
`make doctor` to check local prerequisites and configuration.

Run `make fmt` to format source and `make format-check` to check it. Run
`make check` for formatting, contract and migration checks, Go tests and vet,
web tests, TypeScript, and lint. Run `make verify` for the full suite, including
race-enabled Go tests, production builds, browser tests, and the container
smoke test.

The Go route definitions are the HTTP contract source. Run `make contracts`
after changing API routes and `make contracts-check` to verify generated
artifacts. See [the contract guide](../contracts/README.md) for details.
