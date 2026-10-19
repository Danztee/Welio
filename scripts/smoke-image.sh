#!/bin/sh
set -eu
image=${1:-welio:local}
smoke_name="welio-smoke-$$"
cleanup() {
  docker rm -f "$smoke_name-api" "$smoke_name-worker" "$smoke_name-db" "$smoke_name-migrate" >/dev/null 2>&1 || true
  docker network rm "$smoke_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
docker network create "$smoke_name" >/dev/null
docker run -d --name "$smoke_name-db" --network "$smoke_name" --network-alias database \
  -e POSTGRES_USER=welio -e POSTGRES_PASSWORD=welio -e POSTGRES_DB=welio_smoke_test postgres:17-alpine >/dev/null
attempt=0
until docker exec "$smoke_name-db" pg_isready -U welio -d welio_smoke_test >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { echo 'PostgreSQL did not start' >&2; exit 1; }
  sleep 1
done
smoke_url='postgres://welio:welio@database:5432/welio_smoke_test?sslmode=disable'
docker run --rm --name "$smoke_name-migrate" --network "$smoke_name" -e DATABASE_URL="$smoke_url" "$image" migrate
for role in api worker; do
  docker run -d --name "$smoke_name-$role" --network "$smoke_name" \
    -e DATABASE_URL="$smoke_url" -e WELIO_ROLE="$role" -e WELIO_ENV=test \
    -e AUTH_SECRET=welio-container-smoke-test-secret-12345 \
    -e PUBLIC_URL=http://app.example.test -e API_SERVER_URL=http://api.example.test "$image" serve >/dev/null
  attempt=0
  until docker exec "$smoke_name-$role" welio healthcheck >/dev/null 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { docker logs "$smoke_name-$role"; exit 1; }
    sleep 1
  done
  docker exec "$smoke_name-$role" wget -q -O - http://127.0.0.1:8081/readyz >/dev/null
done
docker exec "$smoke_name-api" wget -q -O - http://127.0.0.1:8081/v1/auth/config >/dev/null
if docker exec "$smoke_name-worker" wget -q -O - http://127.0.0.1:8081/v1/auth/config >/dev/null 2>&1; then
  echo 'Worker exposed the customer API' >&2; exit 1
fi
[ "$(docker inspect --format '{{.Config.User}}' "$smoke_name-api")" = welio ]
echo 'Container migrations, API readiness, worker readiness, nonroot user, and role isolation passed.'
