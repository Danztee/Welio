# Architecture fixes — 19 October 2026

The scope is the six prioritized findings and supporting structural/delivery
work from the architecture review. The existing Go modular monolith, Next.js
frontend, shared booking service, transactional jobs, and workspace booking
locks remain the architectural direction.

## Changes

- Protected pages use a browser renewal page when access expires. The refresh
  cookie stays scoped to `/v1/auth`. Renewal preserves supported dashboard,
  settings, pagination, onboarding, and invitation destinations; redirects are
  restricted to local product routes. A shared promise and browser Web Locks
  coordinate refresh across requests and tabs. Rotation races and API outages
  remain retryable instead of silently discarding valid sessions.
- Real browser testing exposed an additional defect: Huma header tags were
  incorrectly written with JSON-style `,omitempty`. Login was not emitting
  usable session cookie headers. Login/refresh and logout now emit proper
  `Set-Cookie` headers, with HTTP and browser regressions.
- Receptionist settings reads check the requesting user's owner membership in
  SQL, matching the write boundary. Both the previously failing service test and
  HTTP tests for nonmembers/revoked membership pass.
- Customer and appointment lists return bounded cursor pages with complete
  counts, server-side text search, and appointment date/customer filters.
  Date boundaries are explicitly interpreted in the appointment timezone.
  Customer history is paginated and its counts come from SQL.
- Overview counts and 30-day chart aggregates query the complete workspace.
  Today's appointment samples and recent activity are bounded separately.
  Tests cover 1,005 customers and 1,005 appointments, equal-timestamp cursors,
  tenant isolation, and business-local midnight boundaries.
- Dashboard loaders fetch only a section's data and deduplicate workspace-list
  requests within a render. The notification drawer and customer histories load
  on demand and show local errors. Browser-run API logs show four requests for
  Services and Customers, three for Settings, and five for Overview, versus
  the roughly twelve-request owner loader before this change.
- Huma's actual route schema exports without database access. OpenAPI and
  generated TypeScript models are checked into the repository. Main workspace
  queries and authentication responses consume those generated types.
  `make contracts-check` rejects stale artifacts; serialized response contract
  tests exercise Huma schema compatibility, including nullable staff user IDs.
  DTO key conversion supports explicit opaque dictionary paths.
- Runtime abuse quotas use atomic PostgreSQL counters shared across replicas
  and restarts, with hashed keys and bounded timeouts. Storage failures fail
  closed. A River maintenance job removes expired quota/auth records in
  batches. The existing shared AI daily budget remains intact.
- Pure booking validation, quote, and fingerprint policies now live apart from
  SQL transaction orchestration. Existing workspace locks remain in place to
  protect booking correctness; changing lock granularity requires measured
  contention and coordination among every scheduling writer.
- A multistage, nonroot container includes certificates and timezone data.
  Its smoke test creates its own PostgreSQL container, runs migrations, checks
  API and worker readiness and worker route isolation, and removes test
  resources. CI now checks generated contracts, frontend unit/browser tests,
  and the container alongside the existing checks.

## Verification

- Full Go suite against a separate disposable local PostgreSQL database with
  `go test -race -p 1 -count=1 ./...`: passed.
- `go vet ./...`, migration pair validation, and diff whitespace checks: passed.
- Frontend unit regressions, type generation/type checking, lint, and Next.js
  production build: passed.
- Four browser scenarios against the real Go API and Next.js app: passed in
  installed Chrome and Playwright Chromium. These check actual login cookies,
  access expiry/renewal and destination preservation, simultaneous tabs sharing
  one refresh, revoked sessions returning to sign-in, and pagination/search and
  overview totals beyond 1,000 customers.
- Container build and isolated API/worker/migration smoke test: passed.
- Generated API contract freshness check: passed.

## Applying the change

The additive migration was applied successfully to the configured local
`localhost:5461/db` database during this task. Disposable test databases and
container smoke-test resources were removed afterward.

Apply the new `20261019120000_shared_limits` migration before starting the new
API/worker binaries (`make migrate` locally, or the image's `migrate` command
as a release step). Runtime limit checks require the new table. The appointment
and customer HTTP list response changes from an array to a page envelope, so
API and web changes should ship together; external clients must consume that
new contract.

Production rollout, external mail delivery, live Bedrock calls, and hosted MCP
clients were not exercised here. Deployment-specific TLS, trusted origins,
public/private URLs, and cookie-domain configuration still apply.
