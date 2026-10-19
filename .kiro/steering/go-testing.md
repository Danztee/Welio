---
inclusion: fileMatch
fileMatchPattern: '**/*_test.go'
---

# Go testing conventions

## Running tests

```sh
make test       # Go suite with race detector + disposable PostgreSQL
make check      # fast Go unit tests (env -u WELIO_TEST_DATABASE_URL)
```

Individual package: `go test -race -count=1 ./internal/bookings/...`

## Test style

- Table-driven tests are the norm. Use `t.Run` for subtests with descriptive
  names.
- Integration tests that need PostgreSQL use the `_test.go` suffix and rely on
  `WELIO_TEST_DATABASE_URL` being provisioned by `scripts/test-db.mjs`.
- Unit tests that do not need a database run under `make check`
  (`env -u WELIO_TEST_DATABASE_URL`).
- Use `context.Background()` or `context.TODO()` for test contexts; add
  timeouts when calling network-dependent code.
- Assert with the standard `testing` package. If the codebase already uses
  `testify` in a file, match that file's style.

## What to test

- Service methods: exercise the happy path and the key error/edge cases
  (availability conflicts, idempotency, workspace scoping).
- HTTP handlers: request validation, context establishment, and the shape of
  the response. Authorize every protected operation.
- Never let a test choose the authoritative workspace from untrusted input —
  mirror the production authorization path.
