# TenantWarden Deployment Guide

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- An Azure App Registration (for Microsoft 365 data collection)
- A domain with a valid TLS certificate (for production)
- Minimum 8GB RAM, 4 vCPUs, 100GB disk for the full stack

---

## Quickstart (local development)

```bash
git clone https://github.com/jahmed-cloud/TenantWarden.git
cd TenantWarden
make setup-env    # .env with fresh random secrets
make certs        # development TLS certificates
make build        # images, built in sequential batches
make build-agent  # agent binaries for /downloads
make up
```

Open http://localhost:8090 (or `GATEWAY_HTTP_PORT`) and sign in as `admin@tenantwarden.local` / `TenantWarden!`;
you choose a new password at first sign-in.

---

## .env

`make setup-env` generates every secret. Keep a copy of `ENCRYPTION_KEY` somewhere safe: losing it makes the
stored tenant client secrets unrecoverable. Values you may want to set yourself:

| Variable | Description |
| --- | --- |
| `GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT` | Host ports for the portal (default 8090 / 8443) |
| `APP_URL` | Public URL of the portal |
| `SMTP_*` | Mail server for email notification channels |
| `SERVICENOW_*`, `JIRA_*` | Defaults for ServiceNow / Jira channels (a channel's own settings win) |
| `COLLECTOR_INTERVAL_SECONDS` | Graph collection interval (default 900) |

---

## Connecting a Microsoft 365 tenant

Tenants are connected in the portal (**Tenants → Connect tenant**), not in `.env`. For each tenant:

1. Entra admin center → **App registrations → New registration** (single tenant, no redirect URI needed).
2. **API permissions → Add → Microsoft Graph → Application permissions**:
   `User.Read.All`, `IdentityRiskyUser.Read.All`, `AuditLog.Read.All`, `Policy.Read.All`,
   `DeviceManagementManagedDevices.Read.All`, `SecurityEvents.Read.All`, `SecurityIncident.Read.All`,
   `ServiceHealth.Read.All`. For response actions also `IdentityRiskyUser.ReadWrite.All` and
   `User.RevokeSessions.All`.
3. **Grant admin consent**.
4. **Certificates & secrets → New client secret**, then paste the tenant ID, client ID and secret value into the portal.

---

## Production deployment

### Docker Compose (single server)

```bash
# Set BUILD_TARGET=production in .env
# Replace localhost with your domain in .env
# Ensure TLS certs are in gateway/certs/

docker compose --profile production up -d
```

### Kubernetes (Helm)

```bash
# 1. Create namespace and secrets
kubectl create namespace tenantwarden

kubectl create secret generic tenantwarden-postgres-secret \
  --from-literal=password=YOUR_PASSWORD -n tenantwarden

kubectl create secret generic tenantwarden-redis-secret \
  --from-literal=password=YOUR_PASSWORD -n tenantwarden

kubectl create secret generic tenantwarden-azure-secret \
  --from-literal=clientId=YOUR_CLIENT_ID \
  --from-literal=clientSecret=YOUR_CLIENT_SECRET \
  --from-literal=tenantId=YOUR_TENANT_ID \
  -n tenantwarden

kubectl create secret generic tenantwarden-jwt-secret \
  --from-literal=signingKey=YOUR_64_BYTE_KEY -n tenantwarden

# 2. Install
helm install tenantwarden ./helm \
  -n tenantwarden \
  --set global.domain=your-domain.com \
  -f helm/values-production.yaml

# 3. Check status
kubectl get pods -n tenantwarden
```

---

## Deploying agents

Run `make build-agent` once so the portal serves the binaries at `/downloads/`. Then use **Agents → Add agent**
in the portal: it creates an enrollment token and shows the exact command for Windows, Linux or macOS, e.g.

```bash
# Linux: downloads, checks the token and connection, installs a systemd service
curl -fsSLo tenantwarden-agent https://your-domain.com/downloads/tenantwarden-agent-linux-amd64 && chmod +x tenantwarden-agent
sudo ./tenantwarden-agent register --gateway-url wss://your-domain.com/agent --agent-token YOUR_TOKEN --install
```

```powershell
# Windows, elevated PowerShell: installs the TenantWardenAgent service
Invoke-WebRequest -Uri "https://your-domain.com/downloads/tenantwarden-agent.exe" -OutFile tenantwarden-agent.exe
.	enantwarden-agent.exe register --gateway-url "wss://your-domain.com/agent" --agent-token "YOUR_TOKEN" --install
```

### Docker

```bash
docker build -t tenantwarden/agent:1.0.0 agent/
docker run -d --name tenantwarden-agent --restart unless-stopped   -e TENANTWARDEN_GATEWAY_URL=wss://your-domain.com/agent   -e TENANTWARDEN_AGENT_TOKEN=YOUR_TOKEN   tenantwarden/agent:1.0.0
```

The full agent guide (what it collects, files, commands, revoking) is in [docs/AGENT.md](../AGENT.md).

---

## Monitoring

- Grafana dashboards: `http://localhost:3001` (admin / your GRAFANA_PASSWORD; `make monitoring`)
- Prometheus metrics: `http://localhost:9090`
- API health: `docker exec tenantwarden-api curl -s localhost:8080/health` (internal only)
- Agent gateway health: `docker exec tenantwarden-agent-gw curl -s localhost:8082/health`

---

## Backup

```bash
# PostgreSQL
docker exec tenantwarden-postgres pg_dump -U tenantwarden tenantwarden | gzip > backup-$(date +%Y%m%d).sql.gz

# ClickHouse
docker exec tenantwarden-clickhouse clickhouse-client --query "BACKUP DATABASE tenantwarden_analytics TO Disk('backups', 'backup-$(date +%Y%m%d)')"

# MinIO
docker run --rm -v minio-data:/data -v $(pwd):/backup alpine tar czf /backup/minio-$(date +%Y%m%d).tar.gz -C /data .
```
