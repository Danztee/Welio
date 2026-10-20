.DEFAULT_GOAL := help
.PHONY: help setup doctor dev dev-db dev-db-down api worker web migrate \
        check-migrations test test-e2e verify verify-with-db \
        fmt fmt-check format-check vet build web-check web-lint web-build check \
        contracts contracts-check image image-test deploy-check \
        aws-up aws-start aws-stop aws-down aws-logs aws-status

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
	@echo 'aws-up         Deploy the current source to the AWS demo stack'
	@echo 'aws-start      Start the AWS host and its app containers'
	@echo 'aws-stop       Stop the AWS host to reduce compute charges'
	@echo 'aws-down       Stop app containers and preserve AWS data volumes'
	@echo 'aws-status     Show AWS host and app URL'
	@echo 'aws-logs       Show recent AWS app logs'

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
	go test ./migrations -run '^TestMigrationFiles$$' -count=1

test:
	node scripts/test-db.mjs go test -race -p 1 -count=1 ./...

test-e2e:
	node scripts/test-db.mjs sh -c 'cd web && pnpm exec playwright install chromium && pnpm test:e2e'

verify:
	node scripts/test-db.mjs $(MAKE) verify-with-db

# Internal target: verify owns the temporary database for this complete sequence.
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

check: contracts-check check-migrations format-check vet web-check web-lint deploy-check
	env -u WELIO_TEST_DATABASE_URL go test ./...

contracts contracts-check:
	@set -eu; \
	contract_dir=$$(mktemp -d); \
	trap 'rm -rf "$$contract_dir"' EXIT HUP INT TERM; \
	go run ./cmd/welio openapi > "$$contract_dir/openapi.json"; \
	(cd web && pnpm exec openapi-ts -i "$$contract_dir/openapi.json" -o "$$contract_dir/generated"); \
	if [ "$@" = contracts ]; then \
		cp "$$contract_dir/openapi.json" contracts/openapi.json; \
		rm -rf web/src/lib/backend/generated; \
		cp -R "$$contract_dir/generated" web/src/lib/backend/generated; \
	else \
		diff -u contracts/openapi.json "$$contract_dir/openapi.json"; \
		diff -ru web/src/lib/backend/generated "$$contract_dir/generated"; \
	fi

image:
	docker build -t welio:local .

image-test: image
	./scripts/smoke-image.sh welio:local

aws-up:
	python3 deploy/aws/deploy.py deploy

aws-start aws-stop aws-down aws-status aws-logs:
	python3 deploy/aws/deploy.py $(patsubst aws-%,%,$@)

deploy-check:
	python3 -m unittest discover -s deploy/aws -p 'test_*.py'
	bash -n deploy/aws/release.sh
	docker compose --env-file deploy/aws/.env.production.example -f deploy/aws/compose.yaml config --quiet
	docker run --rm -e PUBLIC_IP=192.0.2.1 -v "$(CURDIR)/deploy/aws/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile
