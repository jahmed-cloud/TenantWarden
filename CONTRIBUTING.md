# Contributing to TenantWarden

Thanks for your interest! TenantWarden is self-hosted security monitoring for
Microsoft 365, created and maintained by **Junaid Ahmed** ([@jahmed-cloud](https://github.com/jahmed-cloud)).

## Getting started
1. Fork the repo and clone your fork
2. `make setup-env && make certs && make build && make up && make seed`
3. Dashboard: http://localhost:8090. Sign in as `admin@tenantwarden.local` / `TenantWarden!`; you'll choose a new password on first login

## Project layout
| Path | Stack | Purpose |
|---|---|---|
| `frontend/` | React + TS + Vite | Dashboard UI |
| `api/` | ASP.NET Core 9 | Main REST API + SignalR |
| `auth-service/` | ASP.NET Core 9 | JWT auth, MFA, users |
| `agent-gateway/` | ASP.NET Core 9 | Endpoint agent WebSocket gateway |
| `collector-service/` | Node + TS | Microsoft Graph data collection |
| `alert-engine/` | Node + TS | Rule evaluation (60s loop) |
| `notification-service/` | Node + TS | Email/Teams/Slack/PagerDuty/webhook dispatch |
| `analytics-engine/` | Node + TS | Anomaly detection |
| `scheduler/` | Node + TS | Cron triggers |
| `agent/` | Go | Cross-platform endpoint agent |

## How to contribute
- **Bugs**: open an issue with logs (`docker logs tenantwarden-<service>`) and repro steps
- **Features**: open an issue first to discuss scope, then a PR
- **PRs**: one focused change per PR; frontend must pass `npm run build`,
  Node services `npx tsc --noEmit`, .NET services `dotnet build`
- Commit style: `component: short description` (e.g. `collector: add Teams usage collection`)

## Good first issues
- Additional Graph collectors (Exchange mail flow, SharePoint sharing, Teams)
- PDF report generation, scheduled reports
- Alert rule builder UI
- Localization
