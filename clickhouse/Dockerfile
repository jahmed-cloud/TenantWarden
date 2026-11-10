# ClickHouse with the TenantWarden analytics schema built in, for installs that pull images
# instead of cloning the repository. The schema is created in $CLICKHOUSE_DB on the first start
# of an empty volume; after an upgrade: docker compose exec clickhouse tenantwarden-migrate
FROM clickhouse/clickhouse-server:24.3
COPY migrations/ /tenantwarden/migrations/
COPY --chmod=755 tenantwarden-migrate.sh /usr/local/bin/tenantwarden-migrate
RUN ln -s /usr/local/bin/tenantwarden-migrate /docker-entrypoint-initdb.d/10-tenantwarden-schema.sh
