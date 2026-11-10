#!/bin/bash
# Creates or updates the TenantWarden analytics schema in $CLICKHOUSE_DB. Runs from
# /docker-entrypoint-initdb.d on the first start of an empty volume, and by hand after an
# upgrade: docker compose exec clickhouse tenantwarden-migrate
# The SQL files name no database, so they must not be run as plain init scripts (they would
# land in "default", where the API doesn't look).
set -euo pipefail
db="${CLICKHOUSE_DB:-tenantwarden_analytics}"
for f in /tenantwarden/migrations/*.sql; do
  echo "tenantwarden: applying $(basename "$f") to $db"
  clickhouse client --host 127.0.0.1 --user "${CLICKHOUSE_USER:-default}" --password "${CLICKHOUSE_PASSWORD:-}" \
    --database "$db" --multiquery < "$f"
done
