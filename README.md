# Welio

Welio helps service businesses manage appointments, customers, staff, and
services. Its AI receptionist answers business questions and prepares bookings
using live availability. Customers explicitly approve booking details before an
appointment is created.

## Architecture

The Go API owns authentication, workspace access, booking rules, PostgreSQL,
background jobs, and the AI receptionist. The standalone Next.js app renders the
web interface and calls the API. The web app does not connect to PostgreSQL.

The receptionist and external Model Context Protocol (MCP) clients use the same
tenant-scoped booking services. See the
[architecture guide](./docs/ARCHITECTURE.md) and
[receptionist guide](./docs/RECEPTIONIST.md) for details.

## Run locally

Requirements: Docker Compose, Node.js 24, pnpm 11.9.0, and Go 1.26. Bedrock
access is needed only to try live AI receptionist responses.

```sh
make setup
make dev
```

`make setup` checks prerequisites, installs dependencies, creates missing
private environment files, and generates a local auth secret. It preserves
existing environment files. `make dev` starts PostgreSQL, applies migrations,
then runs the API, worker, and web app in one terminal. Press Ctrl+C to stop the
processes. PostgreSQL keeps its data volume; run `make dev-db-down` to stop the
database.

Open [http://127.0.0.1:3000/sign-up](http://127.0.0.1:3000/sign-up). Run
`make doctor` to check prerequisites, environment settings, and local ports. You
can also run `make api`, `make worker`, `make web`, and `make migrate`
separately.

## Configure integrations

Keep Go API credentials in `.env.api`, worker database and mail settings in
`.env.worker`, and web URLs in `.env.web`. Never put backend credentials in the
web environment. Set `ZEPTOMAIL_SEND_MAIL_TOKEN` and a verified `EMAIL_FROM` to
send email. See the [Go API guide](./docs/API.md) for service settings and the
[receptionist guide](./docs/RECEPTIONIST.md) for Bedrock and MCP configuration.

## Verify changes

Run these commands from the repository root:

```sh
make check
make test
make verify
```

`make check` checks API contracts, migrations, formatting, Go code, web types
and lint, deployment configuration, and standard Go tests. `make test` runs the
Go suite with the race detector and a disposable PostgreSQL database.
`make verify` runs the full checks, builds the Go and web apps, and smoke-tests
the container image. Frontend checks use type generation, TypeScript, lint, and
the production build. GitHub Actions runs the Go, web, and container checks.

## Deploy the AWS demo

The demo runs the web app, Go API, worker, PostgreSQL, and Caddy on one EC2
host. Sign in with AWS CLI, then deploy from the repository root:

```sh
aws login --region eu-north-1
make aws-up
```

See the [AWS deployment guide](./deploy/aws/README.md) for setup, operations,
and costs.

## Documentation

Use the [documentation index](./docs/README.md) to find the architecture,
booking, API, receptionist, contract, and deployment guides.

## Repository layout

```text
cmd/welio/                Go API and command entry point
contracts/                OpenAPI source and generation guide
internal/                 Backend application areas
migrations/               PostgreSQL schema and queue migrations
web/                      Next.js application
docs/                     Architecture, API, and product guides
deploy/aws/               AWS provisioning and operations
scripts/                  Development launcher and disposable test DB helper
```

Go commands run from the repository root. Frontend commands run from `web/`.

## License

Welio is licensed under the Apache License 2.0. See [LICENSE](./LICENSE) for the
complete terms.
