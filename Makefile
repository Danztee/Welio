.PHONY: dev-db dev-db-down api worker migrate check-migrations fmt-check test vet build web web-check web-lint web-build check

COMPOSE ?= docker compose -f docker-compose.dev.yml -p welio-dev
# Next.js receives only its public API URL and optional private API origin.
WEB_ENV = env -i PATH="$$PATH" HOME="$$HOME" TMPDIR="$${TMPDIR:-/tmp}" LANG="$${LANG:-en_US.UTF-8}" APP_URL="$$APP_URL" NEXT_PUBLIC_WELIO_API_URL="$$NEXT_PUBLIC_WELIO_API_URL" WELIO_API_INTERNAL_URL="$$WELIO_API_INTERNAL_URL"

dev-db:
	$(COMPOSE) up -d --wait postgres

dev-db-down:
	$(COMPOSE) stop postgres

api:
	set -a && . ./.env.api && set +a && go run ./cmd/welio serve

worker:
	set -a && . ./.env.worker && set +a && go run ./cmd/welio serve

migrate:
	set -a && . ./.env.api && set +a && env -i PATH="$$PATH" HOME="$$HOME" TMPDIR="$${TMPDIR:-/tmp}" DATABASE_URL="$$DATABASE_URL" DATABASE_URL_DIRECT="$$DATABASE_URL_DIRECT" go run ./cmd/welio migrate

check-migrations:
	./scripts/check-migrations.sh

test:
	go test ./...

fmt-check:
	test -z "$$(gofmt -l .)"

vet:
	go vet ./...

build:
	mkdir -p bin
	go build -o bin/welio ./cmd/welio
	. ./.env.web && $(WEB_ENV) sh -c 'cd web && exec pnpm build'

web:
	. ./.env.web && $(WEB_ENV) sh -c 'cd web && exec pnpm dev -- --hostname 127.0.0.1'

web-check:
	cd web && pnpm check

web-lint:
	cd web && pnpm lint

web-build:
	. ./.env.web && $(WEB_ENV) sh -c 'cd web && exec pnpm build'

check: check-migrations fmt-check test vet web-check web-lint
