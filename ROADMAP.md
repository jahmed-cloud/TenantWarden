# TenantWarden Roadmap

TenantWarden is self-hosted security monitoring for Microsoft 365.
This roadmap tracks the path from **v1.0 (current)** to an enterprise-grade release.
Maintainer: **Junaid Ahmed** ([@jahmed-cloud](https://github.com/jahmed-cloud)) · Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

Legend: ✅ shipped · 🔨 in progress · 🗳 planned · 💡 ideas / help wanted

---

## v1.0 — Current (shipped)

- ✅ Multi-tenant Microsoft 365 onboarding from the portal (AES-256-GCM encrypted secrets)
- ✅ Graph collection every 15 min: risky users, sign-ins, device compliance,
  Secure Score, Conditional Access, Defender incidents, service health
- ✅ On-demand scans (Identity scan / Compliance assessment)
- ✅ Alert engine (60s rule evaluation) with acknowledge/resolve workflow
- ✅ Notification channels with test-fire: Email (SMTP), Teams, Slack, Webhook, PagerDuty
- ✅ Local JWT auth + optional Microsoft Entra SSO; MFA (TOTP) support in auth service
- ✅ Go endpoint agent (Windows/Linux): event logs, services, BitLocker,
  installed software, system metrics, **pending Windows Updates**
- ✅ Anomaly detection engine (z-score baselines)
- ✅ JSON report export
- ✅ Optional observability stack (Grafana/Prometheus/Loki) via `make monitoring`

## v1.1 — Community hardening (next)

- 🗳 GitHub Actions CI: build + typecheck all services on every PR (`.github/workflows/ci.yml` exists as skeleton)
- 🗳 Published Docker Hub images + `docker compose pull` quickstart (no local build)
- 🗳 Versioned releases with pre-built agent binaries (Windows .exe, Linux, macOS)
- 🗳 Documentation site: setup guide, architecture diagram, screenshots, tenant onboarding walkthrough
- 🗳 Demo mode (synthetic data, no Azure required)
- 🗳 Issue & PR templates, good-first-issue backlog
- 🗳 Agent auto-update channel

## v1.2 — Product depth

- 🗳 Alert rule builder UI (rules are DB rows today — no editor)
- 🗳 Scheduled reports + PDF generation (Executive Summary, Compliance, Identity Risk)
- 🗳 ServiceNow / Jira ticketing dispatchers (config vars exist; dispatchers not built)
- 🗳 Additional Graph collectors: Exchange mail flow, SharePoint external sharing,
  Teams governance, OAuth app consent monitoring
- 🗳 ClickHouse-backed long-term analytics + trend dashboards (schema exists, pipeline partial)
- 🗳 Plugin SDK documentation + example plugins (plugin-engine ships undocumented)
- 💡 Remediation actions: revoke sessions, confirm/dismiss risky users, isolate device
  (requires the write-scope Graph permissions documented in the tenant guide)

## v2.0 — Enterprise readiness

**Security**
- 🗳 Secrets in Azure Key Vault / AWS KMS / Vault (replace `.env`)
- 🗳 Certificate-based Graph auth (replace client secrets)
- 🗳 Enforced SSO + SCIM user provisioning
- 🗳 Endpoint-level RBAC audit (roles exist; enforcement coverage incomplete)
- 🗳 Immutable audit log export (SIEM/S3 WORM)
- 🗳 SBOM + dependency scanning in CI, signed releases

**Reliability & scale**
- 🗳 Production Helm chart / Kubernetes deployment (chart is a stub)
- 🗳 HA PostgreSQL + Redis Sentinel; backup & DR runbooks
- 🗳 Real Kafka event bus (current implementation is a no-op stub) for >50 tenants
- 🗳 Horizontal collector sharding with per-tenant rate budgets

**Compliance & process**
- 🗳 Threat model + third-party pen test
- 🗳 SOC 2–aligned logging/retention controls
- 💡 FedRAMP/GCC High tenant support (Graph sovereign cloud endpoints)

---

### How to influence this roadmap
Open a GitHub issue titled `roadmap: <proposal>`. Items move to 🔨 when someone
claims them. Security-sensitive proposals go through [SECURITY.md](SECURITY.md).
