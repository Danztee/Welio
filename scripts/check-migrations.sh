#!/usr/bin/env bash
set -euo pipefail

directory="${1:-migrations}"
if [[ ! -d "$directory" ]]; then
	echo "check-migrations: no such directory: $directory" >&2
	exit 1
fi

shopt -s nullglob
sql_files=("$directory"/*.sql)
up_files=("$directory"/*.up.sql)
down_files=("$directory"/*.down.sql)
if [[ ${#sql_files[@]} -eq 0 ]]; then
	echo "check-migrations: no SQL migrations in $directory" >&2
	exit 1
fi
if [[ ${#up_files[@]} -eq 0 || ${#down_files[@]} -eq 0 ]]; then
	echo "check-migrations: expected at least one up/down migration pair in $directory" >&2
	exit 1
fi

status=0
fail() {
	echo "check-migrations: $*" >&2
	status=1
}

for path in "${sql_files[@]}"; do
	name=$(basename "$path")
	if [[ ! $name =~ ^[0-9]{14}_[a-z0-9_]+\.(up|down)\.sql$ ]]; then
		fail "bad filename '$name' (expected YYYYMMDDhhmmss_description.up.sql or .down.sql)"
	fi
done

versions=$(printf '%s\n' "${up_files[@]}" | xargs -n1 basename | cut -d_ -f1 | sort)
duplicates=$(printf '%s\n' "$versions" | uniq -d)
if [[ -n "$duplicates" ]]; then
	while IFS= read -r version; do
		[[ -n "$version" ]] || continue
		fail "duplicate migration version $version"
	done <<< "$duplicates"
fi

for path in "${up_files[@]}"; do
	if [[ ! -f ${path%.up.sql}.down.sql ]]; then
		fail "missing $(basename "${path%.up.sql}").down.sql"
	fi
done
for path in "${down_files[@]}"; do
	if [[ ! -f ${path%.down.sql}.up.sql ]]; then
		fail "missing $(basename "${path%.down.sql}").up.sql"
	fi
done

if [[ $status -ne 0 ]]; then
	exit 1
fi

echo "check-migrations: ${#up_files[@]} migrations; names and up/down pairs are valid."
