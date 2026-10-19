# Welio architecture review — 19 October 2026

## Remediation status

The fixes from this review are implemented in the working tree. See
[the implementation and verification record](./ARCHITECTURE-FIXES-2026-10-19.md)
for the completed changes, regression checks, and migration requirement. The
findings below describe the original reviewed state.

## Verdict and scope

The Go API plus Next.js frontend is a sensible modular monolith for this product. The implementation has useful correctness protections, but the current migration is not ready for an unqualified production sign-off. Session handling, dashboard data access, and the authorization test contract need attention first.

This review examines the current working tree, including the uncommitted Go extraction. It covers application composition, authentication, tenant access, booking transactions, receptionist adapters, jobs, frontend data loading, API contracts, and build/CI setup. It does not establish the configuration or behavior of a deployed environment. No application behavior was changed during the review.

## Prioritized findings

### 1. High: server-rendered navigation cannot renew an expired access session

Evidence: `web/src/lib/auth/session.ts:7–34`, `web/src/lib/backend/server-api.ts`, `internal/core/auth/service.go:522–524`, and `docs/API.md:65–66`.

The access cookie lasts 15 minutes. `currentUser()` returns null when it is missing or rejected and `requireUser()` redirects to sign-in. Neither this path nor `backendRequest()` renews the session. Browser renewal exists only in selected auth-client methods. The recommended refresh-cookie path is `/v1/auth`, so a dashboard request does not even carry that cookie to Next.js.

Reproduction by code path: sign in, leave the app idle past the access-cookie lifetime, then navigate to or reload a dashboard page while the longer-lived refresh session remains valid. The server treats the user as signed out.

Choose an explicit browser/server renewal flow that can return cookies to the browser before rendering protected pages. A server-side fetch alone cannot update browser cookies; the installed Next.js cookies guide requires a Route Handler or Server Function for writes. Add an end-to-end test for expiry, renewal, and return-path preservation.

### 2. Medium: concurrent browser requests race refresh-token rotation

Evidence: `web/src/lib/auth-client.ts:61–69,148–155`, `internal/core/auth/service.go:186–260`.

`getSession()` sends two requests in parallel, and each independently attempts refresh after a 401. If both refresh calls use the same token, one rotates it and the other receives `refresh_race`. The latter does not retry its original request after the other refresh completes; `getSession()` can therefore report failure even though renewal succeeded.

Coordinate refresh calls within the browser client and explicitly handle rotation races, including another tab renewing the session. Test two simultaneous 401 responses and renewal from multiple tabs.

### 3. High for data correctness: dashboard lists silently truncate business data

Evidence: `internal/bookings/management.go:326–390`, `web/src/components/workspace/workspace-dashboard-view.tsx:246–278`.

Appointment and customer list queries each use `LIMIT 1000` without pagination or total-count metadata. The dashboard derives customer count from `data.customers.length` and derives appointment activity from the returned appointment array. Customer totals stop at 1,000. Appointments are ordered by start time descending, so sufficiently many future appointments can displace current or recent appointments from the dataset used for charts.

Add paginated list contracts with filtering and stable cursors. Compute totals and overview aggregates in dedicated database queries over the requested reporting range. Do not infer business totals from a page of records.

### 4. Medium: every dashboard section loads the entire workspace dataset

Evidence: `web/src/components/workspace/dashboard-page.tsx:48–99`, `web/src/features/workspaces/queries.ts:51–111`, and the dashboard route pages.

All sections call the same loader. A normal owner-page load issues approximately twelve API requests: account lookup, workspace list, another workspace list inside the loader, workspace details, catalog, six owner datasets, and the booking catalog. The owner datasets are joined with `Promise.all`, so a notifications or receptionist-settings failure can prevent an unrelated services page from rendering. The combined data is passed into the client WorkspaceApp.

Keep shared account/workspace navigation small, then load each section's own data. Make the overview use purpose-built aggregates. Remove repeated workspace-list reads and give unrelated panels independent failure boundaries. Measure API calls and serialized payload size per route.

### 5. Medium: the database authorization suite fails on an inconsistent service boundary

Evidence: `internal/receptionist/owner_integration_test.go:55–59`, `internal/receptionist/owner.go:206–222`, `internal/receptionist/postgres.go:65–82`, and `internal/core/auth/principal.go:78–86`.

The database integration run fails `TestOwnerSettingsPersistInPostgresForTheSameWorkspace`: an injected principal with an unrelated user ID but the target workspace and owner role can read settings. Re-running that test alone reproduces the failure.

The receptionist read path trusts the principal's workspace and role; its repository selects by workspace ID without checking the user. In contrast, the HTTP resolver constructs those principal fields from database membership, and settings writes check membership again in SQL. This is an inconsistency between the service's trusted-context contract and its integration test. It is not evidence that an external caller can forge a principal through the HTTP API.

Decide and document whether service methods independently enforce membership or accept a resolver-verified principal. Align implementations and tests with that decision, and retain a full HTTP test for nonmembers and revoked memberships. Resolve the failing test before treating CI as green.

### 6. Medium before horizontal scaling: abuse limits are local to each API process

Evidence: `internal/httpx/middleware.go:253–291`, `internal/app/app.go:57`, and login/reset limits in `internal/core/auth/service.go`.

The shared limiter is a mutex-protected in-memory map. Replicas each have their own quota, and restarts reset it. Auth and public-request limits therefore do not represent a deployment-wide budget. This is acceptable only if deployment explicitly accounts for it, for example through equivalent edge limits.

Use shared counters or enforced gateway limits before scaling API replicas. The AI daily model-call budget already uses an atomic PostgreSQL counter in `internal/receptionist/postgres.go:358–372`; that budget is shared and should be preserved.

## Structural and delivery debt

- **API contract enforcement:** Huma owns the OpenAPI schema, but web response types are handwritten and `fromAPIContract<T>()` recursively renames keys then asserts `T`. Type checking cannot establish that the Go response matches the web model. Generate client types from OpenAPI and add representative wire-contract checks. Treat arbitrary dictionary keys explicitly rather than assuming every JSON key is a field name. This is a maintainability risk, not a demonstrated current casing failure; catalog already has explicit wire DTOs.
- **Backend coupling:** bookings and catalog combine SQL and use-case rules and accept concrete database dependencies. This is workable at the present size, but makes most behavior depend on database integration tests. Extract pure booking policies and narrow external ports where they improve testing. The receptionist's Model, Repository, and BookingPort boundaries are useful precedents. Avoid adding interfaces for every SQL operation merely for symmetry.
- **Booking concurrency:** creating/changing bookings locks the workspace row, which provides a simple serialization point. This helps protect availability checks but serializes independent staff bookings in one workspace. Retain it until measured contention justifies a narrower design; coordinate all schedule and booking writers before changing locks.
- **Deployment artifact:** the current `Dockerfile` is empty despite the README describing an API/worker image. Local compilation and CI do not validate that image. Complete and exercise the image and runtime role configuration before relying on container deployment.
- **Frontend verification:** the web scripts cover types, lint, and build, but there is no configured automated browser suite for cross-process authentication and dashboard behavior. These are precisely the boundaries the passing compiler checks do not cover.

## Strengths worth preserving

- The web app has no direct PostgreSQL dependency; backend business operations have one execution boundary.
- Chat and MCP adapt to the canonical booking service rather than implementing separate booking writes.
- Booking creation rechecks availability and quote state inside a transaction, with idempotency fingerprints. Changes also check record versions.
- Tenant-scoped composite foreign keys protect appointment/customer/staff relationships in the database.
- System emails use River transaction insertion, so token/invitation creation and enqueueing succeed or fail together.
- Worker role exposes health endpoints instead of the customer API. API and worker secrets have separate development environments.
- The backend contains substantive database integration tests and the CI workflow supplies PostgreSQL and enables race detection.

## Verification

- `go vet ./...`: passed.
- `go test -count=1 ./...` without database configuration: passed; database tests skip in this mode.
- Full suite with `WELIO_TEST_DATABASE_URL` pointing to a separate disposable local database and `go test -race -p 1 -count=1 ./...`: failed only in the receptionist owner-settings test described above. Other package results passed; no race was reported.
- Targeted rerun of the failing database test: reproduced the failure.
- `pnpm check`, `pnpm lint`, and `pnpm build` in `web/`: passed.
- Browser behavior, live Bedrock, external MCP clients, mail delivery, and deployment were not exercised. Session and dashboard findings are based on the traced implementation, not browser reproduction.

## Recommended order

1. Establish and test a complete access-session renewal flow, including concurrent renewal.
2. Resolve the owner-settings authorization contract and failing integration test.
3. Separate dashboard loaders, paginate lists, and introduce correct overview aggregates.
4. Enforce the API/web contract automatically.
5. Finish the container artifact and choose deployment-wide rate limiting before scaling.

Keep the modular-monolith direction. These findings call for clearer contracts and a few targeted boundaries, rather than a wholesale architectural rewrite.
