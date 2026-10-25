##############################################################################
# TenantWarden Enterprise — Root Makefile
##############################################################################
.PHONY: all up down build build-agent test lint setup-env certs seed health clean help logs ps

COMPOSE := docker compose
VERSION ?= 1.0.0

all: help

setup-env:
	@python3 scripts/generate-env.py .env

certs:
	@chmod +x scripts/generate-certs.sh && bash scripts/generate-certs.sh

# Build in two waves to avoid overwhelming Docker daemon:
#   Wave 1: infrastructure services (gateway, .NET services)
#   Wave 2: Node.js services + frontend
build:
	@echo "Building infrastructure services..."
	$(COMPOSE) build gateway api auth-service agent-gateway
	@echo "Building Node.js services..."
	$(COMPOSE) build collector-service alert-engine analytics-engine notification-service scheduler plugin-engine
	@echo "Building frontend..."
	$(COMPOSE) build frontend
	@echo "✅ All images built"

# Alternative: build everything but with limited parallelism
build-parallel:
	$(COMPOSE) build --parallel

up:
	$(COMPOSE) up -d

# Optional: start Grafana/Prometheus/Loki observability stack
monitoring:
	$(COMPOSE) --profile monitoring up -d
	@echo "✅ Monitoring up — Grafana: http://localhost:3001 | Prometheus: http://localhost:9090"

monitoring-down:
	$(COMPOSE) --profile monitoring stop grafana prometheus loki
	@echo "" && echo "✅ TenantWarden starting" && echo "" \
	&& echo "  Dashboard  → http://localhost" \
	&& echo "  API docs   → http://localhost:8090/api/swagger" \
	&& echo "  (optional) make monitoring → Grafana/Prometheus" && echo ""

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

seed:
	@echo "Applying migrations (safe to re-run)..."
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/001_initial_schema.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/002_additional_tables.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/003_default_admin.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/004_performance_indexes.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/005_secure_score.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/006_compliance.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/007_history_retention.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/008_more_controls.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/009_auth_methods.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/010_audit_partitions.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/011_incidents_agents_rules.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/012_monitoring.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < postgres/migrations/013_machine_groups.sql || true
	@$(COMPOSE) exec -T clickhouse sh -c 'clickhouse-client --user "$$CLICKHOUSE_USER" --password "$$CLICKHOUSE_PASSWORD" --database "$$CLICKHOUSE_DB" --multiquery' < clickhouse/migrations/001_analytics_schema.sql || true
	@echo "✅ Schema up to date (migrations applied)."
	@echo "   Demo/sample data is NOT loaded — run 'make demo-data' if you want it."

# Optional: sample tenant + alerts for evaluation. DO NOT run on a system with
# real tenants connected — it inserts a placeholder tenant that cannot authenticate.
demo-data:
	@echo "⚠️  Loading DEMO data (placeholder tenant + sample alerts)..."
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden -v ON_ERROR_STOP=1 < scripts/seed-db.sql \
	  && echo "✅ Demo data loaded" \
	  || { echo "❌ Demo data failed — see errors above"; exit 1; }

db-shell:
	$(COMPOSE) exec postgres psql -U tenantwarden -d tenantwarden

health:
	@chmod +x scripts/health-check.sh && bash scripts/health-check.sh

dev-api:
	$(COMPOSE) up -d postgres redis clickhouse minio && cd api && dotnet watch run

dev-frontend:
	cd frontend && npm run dev

# Uses a local Go toolchain when there is one, otherwise the golang:1.22 image
build-agent:
	@if command -v go >/dev/null 2>&1; then cd agent && $(MAKE) all VERSION=$(VERSION); \
	else docker run --rm -v "$(CURDIR)/agent:/src" -w /src -e GOFLAGS=-buildvcs=false golang:1.22 make all VERSION=$(VERSION); fi
	@# The dev CA lets agents trust a self-signed gateway: --ca-file ca.crt
	@if [ -f gateway/certs/ca.crt ]; then cp gateway/certs/ca.crt agent/dist/ca.crt; fi
	@echo "✅ Binaries in agent/dist/ (served at /downloads/)"

test:
	cd frontend && npm test -- --run || true
	cd collector-service && npm test -- --run || true
	cd alert-engine && npm test -- --run || true
	cd api && dotnet test || true
	cd agent && go test ./... -v -race || true

lint:
	cd frontend && npm run lint || true
	cd agent && go vet ./... || true

backup:
	@mkdir -p backups && DATE=$$(date +%Y%m%d-%H%M%S) && \
	$(COMPOSE) exec -T postgres pg_dump -U tenantwarden tenantwarden | gzip > backups/postgres-$$DATE.sql.gz && \
	echo "✅ Backup saved to backups/postgres-$$DATE.sql.gz"

helm-install:
	helm install tenantwarden ./helm -n tenantwarden --create-namespace -f helm/values.yaml

clean:
	$(COMPOSE) down -v --remove-orphans
	find . -name node_modules -type d -maxdepth 3 -exec rm -rf {} + 2>/dev/null || true
	find . -name dist -type d -maxdepth 3 -exec rm -rf {} + 2>/dev/null || true

help:
	@echo "" \
	&& echo "  TenantWarden Enterprise" \
	&& echo "  ════════════════════════════════" \
	&& echo "  make setup-env   → Configure .env" \
	&& echo "  make certs       → Generate dev TLS" \
	&& echo "  make build       → Build all images (sequential batches)" \
	&& echo "  make up          → Start platform" \
	&& echo "  make seed        → Add sample data" \
	&& echo "  make health      → Health check all services" \
	&& echo "  make build-agent → Cross-compile agents" \
	&& echo "  make test        → Run all tests" \
	&& echo "  make logs        → Tail all logs" \
	&& echo "  make clean       → Remove everything" \
	&& echo ""

# Apply database migrations manually (needed if postgres volume pre-existed)
migrate:
	@echo "Applying PostgreSQL migrations..."
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden -f /dev/stdin < postgres/migrations/001_initial_schema.sql || true
	@$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden -f /dev/stdin < postgres/migrations/002_additional_tables.sql || true
	@echo "✅ Migrations applied"

# Fresh start — drops all volumes and rebuilds from scratch
fresh:
	@echo "⚠️  Stopping and removing ALL data volumes..."
	$(COMPOSE) down -v
	$(COMPOSE) up -d
	@echo "Waiting 20s for databases to initialise..."
	@sleep 20
	$(COMPOSE) exec -T postgres psql -U tenantwarden -d tenantwarden < scripts/seed-db.sql || true
	@echo "✅ Fresh start complete — http://localhost:8090"
