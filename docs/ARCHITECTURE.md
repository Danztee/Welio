# Welio architecture and code conventions

Welio is a modular Go backend with a standalone Next.js frontend. PostgreSQL
stores application state and River jobs. The browser and Next.js server code
use the same Go HTTP API.

## Backend boundaries

- `internal/app` is the composition root. `build.go` creates shared infrastructure,
  `areas.go` lists feature registrations, `router.go` assembles middleware and
  HTTP routes, and `server.go` owns process startup and shutdown.
- `internal/deps` holds shared infrastructure and configuration, rather than
  application business rules.
- `internal/core` owns accounts, workspaces, membership, and platform maintenance.
- `internal/catalog` owns service, staff, assignment, and schedule administration.
- `internal/bookings` owns booking policies, availability, appointment writes,
  and customer reads. Chat, MCP, and web requests reuse these operations.
- `internal/receptionist` adapts models and conversations to booking operations.
  Its model, repository, and booking ports keep provider details outside the
  conversation flow.
- `internal/jobs` defines persisted job arguments. Queue insertions remain inside
  the transaction that creates the work; `internal/mailer` handles delivery.

Booking route registration is grouped into focused `routes_owner_*.go` files.
The exported registration functions describe which groups belong to the area;
the group functions register their own operations. These functions preserve
route contracts and call the same booking service. Moving a handler between
files must not create a second implementation of its business rules.

## Frontend data flow

Workspace pages use three separate responsibilities:

1. `web/src/features/workspaces/api.ts` defines typed endpoint operations using
   Hey API generated operation functions and OpenAPI response models.
2. `models.ts` converts transport values into UI models: dates, enums, nullable
   collections, and dashboard aggregates.
3. `queries.ts` selects a page's dependencies and runs independent requests
   concurrently. It caches workspace membership reads within the server render.

Server Actions validate their inputs and call the feature API. The backend
continues to authorize every operation. Components render the resulting models
and call actions, rather than assembling private API URLs themselves.

## Patterns adapted from OpenDesk

The local OpenDesk repository was inspected as a reference, without editing it.
These are adaptations of its organization, rather than copies of product code:

| OpenDesk reference | Welio application |
| --- | --- |
| `internal/core/register.go`: short area entry point calling focused registrations | Booking area entry points call route groups for policies, appointments, customers, time off, and overview |
| `web/src/lib/api/endpoints.ts`: typed named endpoint operations | Feature-owned workspace API helpers shared by loaders and read actions |
| `internal/app/app.go`: explicit composition of infrastructure and areas | Welio retains the composition root and makes build, routing, and lifecycle responsibilities separately navigable |
| Shared domain writes and transactional River insertion | Welio retains its canonical booking service and transactional job insertion |

OpenDesk's broker, realtime gateway, multi-provider email infrastructure, billing,
and native clients solve product requirements Welio does not currently share.
Those systems are not prerequisites for clean area boundaries. Welio also keeps
its Next.js server-rendering and cookie architecture rather than replacing it
with OpenDesk's Vite frontend and in-memory access-token strategy.

## Formatting and verification

Run `make fmt` to apply pinned goimports and Prettier formatting to handwritten
code. Run `make format-check` to verify formatting without modifying files.
The editor settings recommend the corresponding formatters and format on save.

Go imports are grouped into standard-library, third-party, and Welio packages.
Frontend source uses two spaces, semicolons, double quotes, and an 80-column
formatter target. Generated API models, the OpenAPI snapshot, lockfiles, build
outputs, assets, and Markdown are outside the formatter sweep. Regenerate API
artifacts with `make contracts`, then verify them with `make contracts-check`.

`make check` runs formatting, contract, migration, Go vet and unit tests, web
unit tests, TypeScript checks, and lint. `make test` and `make test-e2e` run the
Go and browser suites with a disposable PostgreSQL database. `make verify` runs
the complete suite, including PostgreSQL integration and race tests, production
builds, browser tests, and an isolated API/worker container smoke test.

## Readability assessment

The clean-code assessment for the targeted areas improved from approximately
6/10 to 8/10: route entry points, endpoint definitions, model conversion, and
application composition now have distinct responsibilities, and formatting is
automated. This is a subjective readability assessment, not a correctness metric.

A higher score would require further measured work on the larger auth/service
coordinators and the workspace view's component responsibilities, supported by
focused regressions. Avoid splitting functions merely to meet a line count or
adding generic repositories around every SQL query.

## Cleanup verification

The cleanup passed formatting and import checks, the unchanged OpenAPI snapshot
check, the Go/PostgreSQL suite with race detection, Go vet, frontend unit tests,
type checking, lint, the production build, four browser scenarios, and the
isolated API/worker container smoke test. The disposable test database and smoke
containers were removed after verification.

While separating the customer handlers, the customer-history endpoint was found
to accept a cursor and limit without passing them to the service. That forwarding
was corrected and covered by an HTTP/database regression for successive pages.
The browser assertion timeout also accounts for cold Next.js route compilation;
product request timeouts are unchanged.

## Development workflow

The root Makefile is the public command menu. `dev.mjs` owns environment loading,
process lifecycle, and prerequisite checks. `make dev` starts the API, worker,
and web app as separate processes with prefixed output and shared shutdown; it
keeps each role's environment separate. PostgreSQL is the sole Compose
dependency. Production still runs migrations as an explicit release step before
starting API and worker processes.

`make setup` preserves existing env files. `make doctor` diagnoses local setup.
`make check` runs fast checks and unit/integration tests. `make verify` runs the
full test suite, production builds, browser tests, and image smoke test.

## Current contracts only

The frontend calls generated Hey API operations and uses the canonical dashboard
paths. The old `?section=` redirect has been removed. Go callers use job argument
and queue definitions from `internal/jobs` directly, and customer detail callers
supply explicit pagination options. Obsolete aliases and optional legacy call
signatures are removed rather than maintained alongside the current interfaces.
Database migrations and persisted job schemas remain part of the data model.

## Workflow and SDK verification (2026-10-19)

`make verify` passed after the Hey API and developer-workflow migration:
formatting, contract freshness, migration pairs, Go vet and unit tests, Go race
and PostgreSQL integration tests, five frontend unit tests, TypeScript, ESLint,
production builds, five browser scenarios, and the isolated image smoke test.
The fifth browser scenario signs in through the generated authentication SDK,
creates a service through a server action, and verifies it after reloading.
Temporary database and image-smoke containers were removed.

Setup was checked for random secret generation and preservation of existing env
files. Launcher checks covered startup, shutdown, signal forwarding, and occupied
ports. A real startup check verified API/worker readiness and the sign-in page;
Ctrl+C removed its service processes. An existing API on port 8081 was preserved.

## Script consolidation

The scripts directory contains migration validation, contract generation,
development tooling, disposable database orchestration, and image smoke tests.
`dev.mjs` owns setup, diagnostics, and service lifecycle. Make remains the
command menu.
