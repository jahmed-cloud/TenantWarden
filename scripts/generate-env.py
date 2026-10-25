#!/usr/bin/env python3
"""Generates a .env file with secure random credentials for TenantWarden."""
import secrets, sys, os

def randpw(n=24):  return secrets.token_urlsafe(n)
def randkey(n=48): return secrets.token_hex(n)

pg   = randpw()
rd   = randpw()
ch   = randpw()
mk   = randpw(12)
ms   = randpw(24)
jwt  = randkey()
gf   = randpw()
enc  = randkey(32)

env = f"""##############################################################################
# TenantWarden Enterprise — Environment Variables
# Auto-generated {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}
# Fill in AZURE_* values to connect real Microsoft 365 tenants.
##############################################################################

APP_VERSION=1.0.0
APP_EDITION=Enterprise
ENVIRONMENT=Development

# ── Azure / Entra ID (fill these in to monitor real tenants) ──────────────
AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000
AZURE_CLIENT_SECRET=replace-with-real-secret
AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000
AUTH_AUTHORITY=https://login.microsoftonline.com/common

# ── JWT ───────────────────────────────────────────────────────────────────
JWT_SIGNING_KEY={jwt}
JWT_ISSUER=tenantwarden
JWT_AUDIENCE=tenantwarden-api

# ── PostgreSQL ────────────────────────────────────────────────────────────
POSTGRES_DB=tenantwarden
POSTGRES_USER=tenantwarden
POSTGRES_PASSWORD={pg}
POSTGRES_URL=postgresql://tenantwarden:{pg}@postgres:5432/tenantwarden
POSTGRES_CONNECTION=Host=postgres;Database=tenantwarden;Username=tenantwarden;Password={pg}

# ── ClickHouse ────────────────────────────────────────────────────────────
CLICKHOUSE_DB=tenantwarden_analytics
CLICKHOUSE_USER=tenantwarden
CLICKHOUSE_PASSWORD={ch}
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_CONNECTION=http://tenantwarden:{ch}@clickhouse:8123/tenantwarden_analytics

# ── Redis ─────────────────────────────────────────────────────────────────
REDIS_PASSWORD={rd}
REDIS_URL=redis://:{rd}@redis:6379
REDIS_CONNECTION=redis:6379,password={rd},abortConnect=false

# ── MinIO ─────────────────────────────────────────────────────────────────
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY={mk}
MINIO_SECRET_KEY={ms}

# ── Grafana ───────────────────────────────────────────────────────────────
GRAFANA_USER=admin
GRAFANA_PASSWORD={gf}

# ── Encryption ────────────────────────────────────────────────────────────
ENCRYPTION_KEY={enc}

# ── Optional: Email / Notifications (leave blank for dev) ─────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@tenantwarden.local
TEAMS_WEBHOOK_URL=
SLACK_BOT_TOKEN=
PAGERDUTY_ROUTING_KEY=
SERVICENOW_INSTANCE=
SERVICENOW_USER=
SERVICENOW_PASS=
JIRA_URL=
JIRA_EMAIL=
JIRA_TOKEN=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# ── Collector ─────────────────────────────────────────────────────────────
# ── Collection cadence (tiered) ──────────────────────────────────────────
# Tier 1 — alerting (near real-time): evaluate alert rules every N seconds
EVAL_INTERVAL=60
# Tier 2 — security signals: pull from Microsoft Graph every N seconds (3600 = 1h)
COLLECTOR_INTERVAL=3600
# Tier 3 — posture & compliance scoring every N seconds (14400 = 4h)
ANALYTICS_INTERVAL=14400
GRAPH_BATCH_SIZE=20
AGENT_GATEWAY_URL=ws://localhost:8082
# Agent gateway internal API (/command, /agents). Blank = disabled.
AGENT_INTERNAL_API_TOKEN=
# Gateway host ports — change if 8090/8443 are taken on this machine (update APP_URL too)
GATEWAY_HTTP_PORT=8090
GATEWAY_HTTPS_PORT=8443
APP_URL=http://localhost:8090
"""

dest = sys.argv[1] if len(sys.argv) > 1 else '.env'
with open(dest, 'w', encoding='utf-8') as f:   # explicit: Windows defaults to cp1252, which can't encode the box-drawing comments
    f.write(env)
print(f"✅ {dest} generated with secure random credentials")
print(f"   PostgreSQL password: {pg[:8]}...")
print(f"   Redis password:      {rd[:8]}...")
print(f"   Grafana password:    {gf}")
print(f"   JWT signing key:     {jwt[:16]}...")
print()
print("⚠️  Fill in AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID")
print("   to connect real Microsoft 365 tenants.")
