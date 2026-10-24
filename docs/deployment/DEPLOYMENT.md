# TenantWarden Deployment Guide

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- An Azure App Registration (for Microsoft 365 data collection)
- A domain with a valid TLS certificate (for production)
- Minimum 8GB RAM, 4 vCPUs, 100GB disk for the full stack

---

## Quickstart (local development)

```bash
# 1. Clone
git clone https://github.com/your-org/tenantwarden.git
cd tenantwarden

# 2. Configure environment
make setup-env
nano .env   # fill in required values (see below)

# 3. Generate local TLS certs
make certs

# 4. Build all images
make build

# 5. Start everything
make up

# 6. Open the dashboard
open http://localhost
```

---

## Required .env values

| Variable                  | Description                                   |
| ------------------------- | --------------------------------------------- |
| `AZURE_CLIENT_ID`         | App registration client ID                    |
| `AZURE_CLIENT_SECRET`     | App registration client secret                |
| `AZURE_TENANT_ID`         | Primary Azure tenant ID                       |
| `POSTGRES_PASSWORD`       | Strong PostgreSQL password                    |
| `REDIS_PASSWORD`          | Strong Redis password                         |
| `CLICKHOUSE_PASSWORD`     | Strong ClickHouse password                    |
| `MINIO_ACCESS_KEY`        | MinIO access key (min 3 chars)                |
| `MINIO_SECRET_KEY`        | MinIO secret key (min 8 chars)                |
| `JWT_SIGNING_KEY`         | Random 64+ byte string for JWT signing        |
| `GRAFANA_PASSWORD`        | Grafana admin password                        |

---

## Azure App Registration setup

1. Go to [portal.azure.com](https://portal.azure.com) → Entra ID → App registrations → New
2. Set Redirect URI to `https://your-domain.com/auth/callback`
3. Under **API permissions**, add the following **Application** permissions:
   - `IdentityRiskyUser.Read.All`
   - `AuditLog.Read.All`
   - `Policy.Read.All`
   - `DeviceManagementManagedDevices.Read.All`
   - `SecurityIncident.Read.All`
   - `SecurityAlert.Read.All`
   - `SecurityEvents.Read.All`
   - `ServiceHealth.Read.All`
   - `Reports.Read.All`
4. Click **Grant admin consent**
5. Under **Certificates & secrets**, create a new client secret
6. Copy the `Application (client) ID` and secret into `.env`

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

### Windows

```powershell
# Download from dashboard or direct URL
Invoke-WebRequest -Uri "https://your-domain.com/download/agent/windows" -OutFile tenantwarden-agent.exe

# Register
.\tenantwarden-agent.exe register --gateway-url wss://your-domain.com:4433 --agent-token YOUR_TOKEN

# Start as service
.\tenantwarden-agent.exe start
```

### Linux (systemd)

```bash
# Download
curl -fsSL https://your-domain.com/download/agent/linux -o /usr/local/bin/tenantwarden-agent
chmod +x /usr/local/bin/tenantwarden-agent

# Register
tenantwarden-agent register --gateway-url wss://your-domain.com:4433 --agent-token YOUR_TOKEN

# Install as systemd service
cat > /etc/systemd/system/tenantwarden-agent.service << EOF
[Unit]
Description=TenantWarden Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/tenantwarden-agent start
Restart=always
RestartSec=10
User=tenantwarden

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now tenantwarden-agent
```

### Docker

```bash
docker run -d \
  --name tenantwarden-agent \
  --restart unless-stopped \
  -e TENANTWARDEN_GATEWAY_URL=wss://your-domain.com:4433 \
  -e TENANTWARDEN_AGENT_TOKEN=YOUR_TOKEN \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/your-org/tenantwarden/agent:latest start
```

---

## Monitoring

- Grafana dashboards: `http://localhost:3000` (admin / your GRAFANA_PASSWORD)
- Prometheus metrics: `http://localhost:9090`
- API health: `http://localhost/api/health`
- Agent gateway health: `http://localhost:8082/health`

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
