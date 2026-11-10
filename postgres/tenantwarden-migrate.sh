#!/bin/sh
# Re-applies every migration in order. They are idempotent, so this is safe to run after each
# upgrade (the image equivalent of `make seed`).
set -eu
for f in /docker-entrypoint-initdb.d/*.sql; do
  echo "applying $(basename "$f")"
  psql -v ON_ERROR_STOP=0 -q -U "${POSTGRES_USER:-tenantwarden}" -d "${POSTGRES_DB:-tenantwarden}" -f "$f"
done
echo "migrations applied"
