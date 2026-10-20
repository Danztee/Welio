#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

DEPLOY_DIR="${WELIO_DEPLOY_DIR:-/opt/welio}"
exec 9>"$DEPLOY_DIR/deploy.lock"
flock -n 9 || { echo "Another deployment is running." >&2; exit 1; }

# Host setup lives here so a redeploy can repair an incomplete first boot.
if ! command -v docker >/dev/null 2>&1; then
  dnf install -y docker
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKER_CONFIG'
{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
DOCKER_CONFIG
systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl --fail --silent --show-error --location \
    https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-aarch64 \
    --output /usr/local/lib/docker/cli-plugins/docker-compose
  chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
fi

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab

compose() {
  docker compose --env-file "$PWD/runtime.env" -f deploy/aws/compose.yaml "$@"
}

point_current() {
  ln -s "$PWD" "$DEPLOY_DIR/current.new"
  mv -Tf "$DEPLOY_DIR/current.new" "$DEPLOY_DIR/current"
  install -m 600 runtime.env "$DEPLOY_DIR/.env.production"
}

rollback() {
  local previous
  previous=$(readlink -f "$DEPLOY_DIR/previous")
  test -d "$previous" || { echo "No previous release is available." >&2; return 1; }
  cd "$previous"
  compose up -d --wait
  compose up -d --wait --no-deps --force-recreate caddy
  point_current
  echo "Restored release $(basename "$previous"). Database migrations were not reversed."
}

if [ "${1:-}" = rollback ]; then
  rollback
  exit
fi

umask 077
if [ ! -f runtime.env ]; then
  install -m 600 "$DEPLOY_DIR/.env.production" runtime.env
fi
# Each release has immutable image tags and its own private configuration snapshot.
sed -i '/^WELIO_RELEASE=/d' runtime.env
printf '\nWELIO_RELEASE=%s\n' "$(basename "$PWD")" >> runtime.env
compose config --quiet
compose build
compose --profile release run --rm migrate

previous=$(readlink -f "$DEPLOY_DIR/current" || true)
if [ -n "$previous" ] && [ -d "$previous" ]; then
  ln -sfn "$previous" "$DEPLOY_DIR/previous"
fi
trap 'status=$?; trap - ERR; rollback || true; exit "$status"' ERR
compose up -d --wait
compose up -d --wait --no-deps --force-recreate caddy
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:8080/readyz >/dev/null
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:8080/api/health >/dev/null
point_current
trap - ERR
