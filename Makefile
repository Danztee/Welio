.DEFAULT_GOAL := help
.PHONY: help setup doctor dev dev-db dev-db-down api worker web migrate check-migrations test test-e2e verify fmt fmt-check format-check vet build web-check web-lint web-build check contracts contracts-check image image-test

COMPOSE ?= docker compose -f docker-compose.dev.yml -p welio-dev
GOIMPORTS = go run golang.org/x/tools/cmd/goimports@v0.51.0

help:
	@echo 'setup          Install dependencies and create missing local environment files'
	@echo 'dev            Start database, migrate, and run API + worker + web with reload'
	@echo 'doctor         Check local development prerequisites'
	@echo 'check          Run fast formatting, contract, Go and web checks'
	@echo 'test           Run Go tests with an automatic disposable PostgreSQL database'
	@echo 'test-e2e       Run browser tests with an automatic disposable database'
	@echo 'verify         Run full checks, race tests, builds, browser and image smoke tests'
	@echo 'fmt            Format Go and web source'
	@echo 'api/worker/web Run one service (database and migration managed separately)'

setup:
	node scripts/dev.mjs setup

doctor:
	node scripts/dev.mjs doctor

dev:
	node scripts/dev.mjs

dev-db:
	$(COMPOSE) up -d --wait postgres

dev-db-down:
	$(COMPOSE) stop postgres

api worker:
	@set -eu; set -a; . ./.env.$@; set +a; if [ -n "$${WELIO_DEV_BINARY:-}" ]; then exec "$$WELIO_DEV_BINARY" serve; else exec go run ./cmd/welio serve; fi

# Keep backend credentials out of the Next.js environment.
WEB_ENV = env -i PATH="$$PATH" HOME="$$HOME" TMPDIR="$${TMPDIR:-/tmp}" LANG="$${LANG:-en_US.UTF-8}" APP_URL="$${APP_URL:-http://127.0.0.1:3000}" NEXT_PUBLIC_WELIO_API_URL="$${NEXT_PUBLIC_WELIO_API_URL:-}" WELIO_API_INTERNAL_URL="$${WELIO_API_INTERNAL_URL:-}"

web:
	@set -eu; . ./.env.web; cd web; exec $(WEB_ENV) pnpm dev --hostname 127.0.0.1

migrate:
	@set -eu; set -a; . ./.env.api; set +a; exec env -i PATH="$$PATH" HOME="$$HOME" TMPDIR="$${TMPDIR:-/tmp}" DATABASE_URL="$$DATABASE_URL" DATABASE_URL_DIRECT="$${DATABASE_URL_DIRECT:-}" go run ./cmd/welio migrate

check-migrations:
	./scripts/check-migrations.sh

test:
	node scripts/test-db.mjs go test -race -p 1 -count=1 ./...

test-e2e:
	node scripts/test-db.mjs sh -c 'cd web && pnpm exec playwright install chromium && pnpm test:e2e'

verify:
	node scripts/test-db.mjs $(MAKE) verify-with-db

# Internal target: verify owns the temporary database for this complete sequence.
.PHONY: verify-with-db
verify-with-db:
	@test -n "$${WELIO_TEST_DATABASE_URL:-}" || { echo 'Run make verify to provision the test database.'; exit 1; }
	$(MAKE) check
	go test -race -p 1 -count=1 ./...
	$(MAKE) build
	cd web && pnpm exec playwright install chromium && pnpm test:e2e
	$(MAKE) image-test

fmt:
	$(GOIMPORTS) -w -local github.com/danztee/welio cmd internal migrations
	cd web && pnpm format

fmt-check:
	test -z "$$($(GOIMPORTS) -l -local github.com/danztee/welio cmd internal migrations)"

format-check: fmt-check
	cd web && pnpm format:check

vet:
	go vet ./...

build:
	mkdir -p bin
	go build -o bin/welio ./cmd/welio
	$(MAKE) web-build

web-check:
	cd web && pnpm test && pnpm check

web-lint:
	cd web && pnpm lint

web-build:
	@set -eu; . ./.env.web; cd web; exec $(WEB_ENV) pnpm build

check: contracts-check check-migrations format-check vet web-check web-lint
	env -u WELIO_TEST_DATABASE_URL go test ./...

contracts:
	./scripts/contracts.sh --write

contracts-check:
	./scripts/contracts.sh --check

image:
	docker build -t welio:local .

image-test: image
	./scripts/smoke-image.sh welio:local
