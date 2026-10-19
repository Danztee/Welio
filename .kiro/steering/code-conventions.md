---
inclusion: always
---

# Code conventions

## Build and verify commands

Run from the repository root unless noted:

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `make check`         | Formatting, contracts, Go vet, Go unit tests, web checks  |
| `make test`          | Go tests with race detector and a disposable PostgreSQL DB |
| `make test-e2e`      | Browser tests with a disposable PostgreSQL DB              |
| `make verify`        | Full Go, web, browser, and container verification         |
| `make fmt`           | Format Go (`goimports`), web, and docs                     |
| `make format-check`  | Check formatting without writing                           |
| `make contracts`     | Regenerate OpenAPI contract and web client types           |
| `make build`         | Build Go binary and Next.js production build              |

Frontend commands run from `web/`: `pnpm test`, `pnpm check`, `pnpm lint`,
`pnpm format`.

## Go conventions

- Module path: `github.com/danztee/welio`. `goimports` local prefix is
  `github.com/danztee/welio`.
- Backend is organized by business area under `internal/`. Each area owns its
  rules and persistence — do not reach across areas directly; go through the
  area's service.
- HTTP handlers validate input, establish context (authenticated user or public
  business scope), then call area services. Handlers do not contain business
  logic.
- Use `context.Context` as the first parameter on service methods.
- Database transactions wrap related writes; booking changes and notification
  jobs share one transaction.
- Never choose the authoritative workspace from untrusted input — the Go API
  authorizes every protected operation.
- Run `goimports -w -local github.com/danztee/welio` on handwritten Go before
  committing. CI runs `make fmt-check`.

## Web conventions

- Next.js app lives in `web/`. TypeScript strict mode.
- Feature data flow: `api.ts` (generated from OpenAPI) → `models.ts` (transport
  → UI models) → `queries.ts` (concurrent data loading). Do not bypass this flow.
- Server Actions validate input and call the feature API. The Go API
  authorizes each request, including Server Action requests.
- Components render UI models and invoke actions; they never construct private
  API URLs.
- Keep backend credentials out of the web environment. The launcher gives
  Next.js only its web configuration.
- Run `pnpm format` and `pnpm lint` from `web/` before committing.

## Database migrations

SQL and River migrations live in `migrations/`. After adding migrations, run
`make migrate` or restart `make dev`. `make check-migrations` validates
migration files in CI. See [contracts/README.md](../../contracts/README.md)
for the API contract generation guide.
