# TenantWarden

**Self-hosted security monitoring for Microsoft 365.**

TenantWarden connects to your Microsoft 365 tenants through Microsoft Graph and keeps an eye on
identity risk, device compliance, Conditional Access, Secure Score and service health. It then
raises alerts and shows everything in one dashboard. It runs on your own infrastructure with
Docker Compose, and supports several tenants from one install.

Created and maintained by **Junaid Ahmed** · MIT licensed · contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## What it does

- **Tenant onboarding:** connect Microsoft 365 tenants from the portal (client secrets are AES-256-GCM encrypted at rest)
- **Graph collection:** risky users, risky sign-ins, Intune devices, Conditional Access policies, Secure Score,
  service health and authentication-method registrations, on a schedule or on demand
- **Alerts:** severity/status workflow (acknowledge, assign, resolve) with tenant-scoped access control
- **Compliance scoring:** framework controls scored from the collected signals, with history and trends
- **Notifications:** email, Microsoft Teams, Slack, webhooks, PagerDuty, ServiceNow and Jira channels
- **Endpoint agent:** a cross-platform Go agent (Windows, Linux, macOS) that streams host metrics to the
  agent gateway, authenticated with per-tenant enrollment tokens

See [ROADMAP.md](ROADMAP.md) for what's planned, and [TASK.md](TASK.md) for the open work.

---

## Architecture

```
Browser ──► Gateway (nginx: TLS, routing, rate limiting)
              ├── Frontend      React + TypeScript dashboard
              ├── Auth service  ASP.NET Core 9 — local login, MFA, JWT
              ├── Core API      ASP.NET Core 9 — REST + SignalR
              └── /agent/ws ──► Agent gateway (token-authenticated WebSocket hub)
                                    ▲
                     TenantWarden agents (Windows · Linux · macOS)

Collector ──(Microsoft Graph)──► PostgreSQL ◄── Alert engine · Analytics engine · Scheduler
Notification service ◄── Redis pub/sub
Data: PostgreSQL · Redis · ClickHouse   Optional: MinIO, Prometheus · Grafana · Loki
```

| Service                | Tech              | Internal port | Purpose                                    |
| ---------------------- | ----------------- | ------------- | ------------------------------------------ |
| `gateway`              | nginx             | 80 / 443      | TLS termination, routing, rate limiting    |
| `frontend`             | React + TS + Vite | 3000          | Dashboard                                  |
| `api`                  | ASP.NET Core 9    | 8080          | REST API + SignalR                         |
| `auth-service`         | ASP.NET Core 9    | 8081          | Login, MFA (TOTP), JWT                     |
| `agent-gateway`        | ASP.NET Core 9    | 8082 / 4433   | WebSocket hub for agents                   |
| `collector-service`    | Node.js + TS      | 3001          | Microsoft Graph collection                 |
| `alert-engine`         | Node.js + TS      | 3002          | Alert rule evaluation                      |
| `notification-service` | Node.js + TS      | 3003          | Notification dispatch                      |
| `analytics-engine`     | Node.js + TS      | 3004          | Compliance scoring, anomaly detection      |
| `plugin-engine`        | Node.js + TS      | 3005          | Plugin registry                            |
| `scheduler`            | Node.js + TS      | 3006          | Scheduled jobs and housekeeping            |
| `postgres` / `redis` / `clickhouse` | — | 5432 / 6379 / 8123 | Data stores                            |

---

## Quickstart (Docker Compose)

**Prerequisites:** Docker Engine 24+ with Compose v2, Python 3 and OpenSSL (for the setup scripts),
and an Azure app registration with the Graph permissions listed below.

```bash
git clone https://github.com/jahmed-cloud/TenantWarden.git
cd TenantWarden

make setup-env    # writes .env with fresh random secrets
make certs        # development TLS certificates
make build        # builds the images in sequential batches
make up
```

Open **http://localhost:8090** and sign in with the default admin, `admin@tenantwarden.local` /
`TenantWarden!`. You'll be asked to choose a new password on first login. If port 8090 or 8443 is
already in use, set `GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT` in `.env`.

Want sample data to explore? `make demo-data` loads a placeholder tenant with sample alerts.
Don't run it on an install with real tenants connected.

### Required Microsoft Graph permissions (application)

| Permission                                | Used for       |
| ----------------------------------------- | -------------- |
| `IdentityRiskyUser.Read.All`              | Identity       |
| `AuditLog.Read.All`                       | Identity       |
| `Policy.Read.All`                         | Identity       |
| `DeviceManagementManagedDevices.Read.All` | Intune         |
| `SecurityIncident.Read.All`               | Defender       |
| `SecurityAlert.Read.All`                  | Defender       |
| `SecurityEvents.Read.All`                 | Defender       |
| `ServiceHealth.Read.All`                  | Service health |
| `Reports.Read.All`                        | Compliance     |
| `InformationProtectionPolicy.Read.All`    | Purview        |

---

## Endpoint agent

Agents authenticate with a per-tenant **enrollment token**. An admin (super_admin, org_admin or
security_admin) mints one through the API. The response's `token` is the agent token, and its
`tokenId` revokes it via `DELETE /api/v1/agents/enrollment-tokens/{tokenId}`.

```bash
curl -X POST https://your-domain.com:8443/api/v1/agents/enrollment-tokens \
  -H "Authorization: Bearer <your access token>" -H "Content-Type: application/json" \
  -d '{"tenantId":"<tenant id>","expiresInDays":365}'
```

```bash
# Linux / macOS
./tenantwarden-agent start --gateway-url wss://your-domain.com:4433 --agent-token YOUR_TOKEN

# Windows (PowerShell)
.\tenantwarden-agent.exe start --gateway-url wss://your-domain.com:4433 --agent-token YOUR_TOKEN
```

Build the binaries from source with `cd agent && make all` (Windows, Linux amd64/arm64, macOS).

---

## Development

```bash
make dev-api        # start the data stores, run the API locally with dotnet watch
make dev-frontend   # run the frontend with hot reload
make lint
```

Checks used before a pull request: frontend `npm run build`, Node services `npx tsc --noEmit`,
.NET services `dotnet build`, agent `go vet ./...`.

**Build troubleshooting:** if Docker drops with `error reading from server: EOF`, too many images
are building in parallel. `make build` builds in batches. If it still fails, give Docker Desktop
more memory (8 GB+).

### Production TLS

```bash
./scripts/setup-tls.sh tenantwarden.yourdomain.com you@email.com   # Let's Encrypt
docker compose restart gateway
```

HTTPS is also required for Microsoft SSO in the browser.

---

## Project status

TenantWarden is under active development. The collection, alerting, compliance and access-control
paths work end to end. Live dashboard updates, Microsoft SSO, refresh tokens, alert-rule
evaluation and agent telemetry storage are still being finished. [TASK.md](TASK.md) tracks the
details and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) covers the current security posture: run it on
a private network or VPN for now.

---

## About the author

TenantWarden is designed, built and maintained by **Junaid Ahmed**
([@jahmed-cloud](https://github.com/jahmed-cloud) on GitHub).

- Questions, bugs and ideas: [open an issue](https://github.com/jahmed-cloud/TenantWarden/issues)
- Security reports: follow [SECURITY.md](SECURITY.md) rather than opening a public issue

## License

[MIT](LICENSE) © 2026 Junaid Ahmed
