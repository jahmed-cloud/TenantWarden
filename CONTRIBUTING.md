# Contributing to TenantWarden

Thanks for your interest! TenantWarden is self-hosted security monitoring for
Microsoft 365, created and maintained by **Junaid Ahmed** ([@jahmed-cloud](https://github.com/jahmed-cloud)).
Project site: [tenantwarden.org](https://tenantwarden.org).

## Getting started
1. Fork the repo and clone your fork
2. `make setup-env && make certs && make build && make build-agent && make up && make seed`
3. Dashboard: http://localhost:8090. Sign in as `admin@tenantwarden.local` / `TenantWarden!`; you'll choose a new password on first login

## Project layout
| Path | Stack | Purpose |
|---|---|---|
| `frontend/` | React + TS + Vite | Dashboard UI (one file per page in `src/pages/`) |
| `api/` | ASP.NET Core 9 | REST API, audit log, agent telemetry consumer |
| `auth-service/` | ASP.NET Core 9 | Sign-in, TOTP, tokens, user admin, API keys |
| `agent-gateway/` | ASP.NET Core 9 | Endpoint agent WebSocket gateway |
| `collector-service/` | Node + TS | Microsoft Graph data collection |
| `alert-engine/` | Node + TS | Rule evaluation (60s loop) |
| `notification-service/` | Node + TS | Teams/Slack/email/webhook/PagerDuty/ServiceNow/Jira dispatch |
| `analytics-engine/` | Node + TS | Compliance scoring, anomaly detection, retention |
| `scheduler/` | Node + TS | Housekeeping jobs |
| `agent/` | Go | Cross-platform endpoint agent |

## How to contribute
- **Bugs**: open an issue with logs (`docker logs tenantwarden-<service>`) and repro steps
- **Features**: open an issue first to discuss scope, then a PR
- **PRs**: one focused change per PR; frontend must pass `npm run build`,
  Node services `npx tsc --noEmit`, .NET services `dotnet build`, agent `go vet ./...` for Linux, Windows and macOS
- **UI**: use the shared components in `frontend/src/components/ui.tsx` and the Material colour roles from
  `src/index.css` (`bg-surface-container-lowest`, `text-on-surface-variant`, …) — they cover light and dark, so no
  `dark:` classes. Charts take real data only and show an empty state when there is none.
- Commit style: `component: short description` (e.g. `collector: add Teams usage collection`)

## Good first issues
- Tests: start with the alert rule evaluator, the compliance scorer and the agent's `wsURL` / `readToken`
- Additional Graph collectors (OAuth consent grants, guest accounts, Exchange forwarding rules)
- Scheduled reports emailed through notification channels
- macOS agent: launchd installer and unified-log events
- Localization
