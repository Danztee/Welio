#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
contract_dir=$(mktemp -d)
trap 'rm -rf "$contract_dir"' EXIT HUP INT TERM
go run ./cmd/welio openapi > "$contract_dir/openapi.json"
(cd web && pnpm exec openapi-ts -i "$contract_dir/openapi.json" -o "$contract_dir/generated")
case "${1:---check}" in
  --write)
    cp "$contract_dir/openapi.json" contracts/openapi.json
    rm -rf web/src/lib/backend/generated
    cp -R "$contract_dir/generated" web/src/lib/backend/generated
    ;;
  --check)
    diff -u contracts/openapi.json "$contract_dir/openapi.json"
    diff -ru web/src/lib/backend/generated "$contract_dir/generated"
    ;;
  *) echo 'usage: scripts/contracts.sh [--write|--check]' >&2; exit 2 ;;
esac
