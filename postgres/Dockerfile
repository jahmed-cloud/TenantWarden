# PostgreSQL with the TenantWarden schema built in, for installs that pull images instead of
# cloning the repository. The migrations run on the first start of an empty volume; after an
# upgrade, re-apply them with: docker compose exec postgres tenantwarden-migrate
FROM postgres:16-alpine
COPY migrations/ /docker-entrypoint-initdb.d/
COPY --chmod=755 tenantwarden-migrate.sh /usr/local/bin/tenantwarden-migrate
