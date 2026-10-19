---
inclusion: fileMatch
fileMatchPattern: 'web/**'
---

# Web (Next.js) conventions

The web app lives in `web/` and is a standalone Next.js application. Run all
frontend commands from that directory.

## Commands

```sh
cd web && pnpm dev      # dev server (or `make web` from root)
cd web && pnpm test     # unit tests
cd web && pnpm check    # TypeScript checks
cd web && pnpm lint      # ESLint
cd web && pnpm format    # Prettier
cd web && pnpm build     # production build
cd web && pnpm test:e2e  # Playwright browser tests
```

## Data flow

Workspace features keep API access, presentation models, and data loading
separate:

1. `web/src/features/<area>/api.ts` — typed endpoint operations generated from
   the Go API's OpenAPI contract via `openapi-ts`. Regenerate with
   `make contracts`.
2. `models.ts` — converts transport data into UI models (dates, enums,
   nullable values, dashboard aggregates).
3. `queries.ts` — loads the data a page needs; runs independent requests
   concurrently.

Do not bypass this flow. Components render UI models and invoke Server Actions;
they never construct private API URLs or call the API directly with raw fetch.

## Environment

- `NEXT_PUBLIC_WELIO_API_URL` — public API origin used by the browser.
- `WELIO_API_INTERNAL_URL` — private API origin for Next.js server code.
- Never put backend credentials in `.env.web`. The dev launcher gives Next.js
  only its web configuration.

## This is NOT the Next.js you know

This project may use a Next.js version with breaking changes. Read the relevant
guide in `node_modules/next/dist/docs/` before writing code if APIs seem
unfamiliar. Heed deprecation notices.
