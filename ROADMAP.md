# TenantWarden Roadmap

TenantWarden is self-hosted security monitoring for Microsoft 365 · [tenantwarden.org](https://tenantwarden.org)
This roadmap tracks the path from **v1.0 (current)** to an enterprise-grade release. Day-to-day work is in
[TASK.md](TASK.md). Maintainer: **Junaid Ahmed** ([@jahmed-cloud](https://github.com/jahmed-cloud)) · contributions
welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

Legend: ✅ shipped · 🔨 in progress · 🗳 planned · 💡 ideas / help wanted

---

## v1.0 — Current

**Microsoft 365**
- ✅ Multi-tenant onboarding from the portal (AES-256-GCM encrypted secrets), per-tenant modules, pause, remove
- ✅ Graph collection every 15 min: risky users and sign-ins, MFA registration, Conditional Access, Intune devices,
  Secure Score, Defender XDR incidents, service health, directory size — plus on-demand collection
- ✅ Identity response actions in Entra ID: dismiss risk, confirm compromised, revoke sessions (optional write permissions)

**Detection & response**
- ✅ Alert engine with a rule builder, default rules per tenant, cooldowns, de-duplication and auto-resolve
- ✅ Alerts from Defender incidents and critical agent events
- ✅ Alert workflow: acknowledge (with comment), assign, resolve, delete
- ✅ Notifications: Teams, Slack, email, webhook, PagerDuty, ServiceNow, Jira — with test-fire
- ✅ Anomaly detection (z-score baselines), analytics with period-over-period KPIs and MTTA/MTTR
- ✅ Compliance scoring for ISO 27001, NIST CSF and SOC 2 with history

**Monitoring**
- ✅ KQL-style query language over events, hosts, roles, checks, alerts, sign-ins, devices and the audit log; any query can be an alert rule
- ✅ Rule library: 40 metrics and 10 query templates
- ✅ Custom log files, extra Windows event channels and journal units, managed centrally in a monitoring profile
- ✅ Server-role discovery (SQL Server, IIS, AD DS, DNS, Hyper-V, nginx, Apache, MySQL, PostgreSQL, Redis, Docker …) with their logs and dashboards
- ✅ Network monitoring: throughput, connections, risky open ports, TCP/HTTP/DNS endpoint checks

**Endpoints**
- ✅ Go agent for Windows and Linux: one-command install as a service, metrics with history, Windows Event Log /
  journald events with brute-force detection, inventory (patches, BitLocker/LUKS, firewall, Defender, SSH,
  admins, ports, software)
- ✅ Enrollment tokens with revocation; binaries and checksums served by the portal
- 🔨 macOS: metrics and a minimal inventory today; events and a launchd installer to come

**Platform**
- ✅ Material-style dashboard (light and dark), reports (executive summary, CSV, JSON)
- ✅ Local accounts with TOTP two-step sign-in, rotating refresh tokens, per-user API keys, user administration
- ✅ Role-based access with strict tenant isolation, full audit log, configurable data retention
- ✅ Optional observability stack (Grafana/Prometheus/Loki) via `make monitoring`

## v1.1 — Community hardening (next)

- 🗳 Automated tests (none yet) and a CI pipeline that fails on errors
- 🗳 Published Docker images + `docker compose pull` quickstart
- 🗳 Versioned GitHub releases with signed agent binaries
- 🗳 Documentation site on tenantwarden.org: setup guide, screenshots, tenant onboarding walkthrough
- 🗳 Demo mode (synthetic tenant, no Azure required)
- 🗳 Agent auto-update; portal commands to agents (collect now, restart)
- 🗳 Issue & PR templates, good-first-issue backlog

## v1.2 — Product depth

- 🗳 Microsoft Entra single sign-on for the portal (OIDC validation, tenant allowlist)
- 🗳 Scheduled reports emailed through notification channels
- 🗳 More Graph collectors: OAuth consent grants, risky service principals, PIM role assignments, stale and guest
  accounts, legacy-auth sign-ins, Exchange forwarding rules, SharePoint external sharing
- 🗳 Alert correlation (group related alerts into incidents)
- 🗳 AI-written alert summaries and weekly posture briefs (Anthropic SDK; `AI_PROVIDER` already in `.env`)
- 💡 Plugin SDK (plugin-engine is a registry stub today)
- 💡 Device isolation through Defender for Endpoint

## v2.0 — Enterprise readiness

**Security**
- 🗳 Secrets in Azure Key Vault / AWS KMS / Vault; `*_FILE` Docker secrets wired into every image
- 🗳 Certificate-based Graph auth (replace client secrets)
- 🗳 Mutual TLS for agents; SSO enforcement + SCIM provisioning
- 🗳 Immutable audit log export (SIEM, S3 WORM); SBOM + dependency scanning, signed releases

**Reliability & scale**
- 🗳 Production Helm chart (today a stub)
- 🗳 HA PostgreSQL + Redis Sentinel; backup & DR runbooks
- 🗳 A real event bus for large installs (the Kafka adapter is a no-op)
- 🗳 Horizontal collector sharding with per-tenant rate budgets

**Compliance & process**
- 🗳 Threat model + third-party penetration test
- 💡 GCC High / sovereign cloud endpoints

---

### How to influence this roadmap
Open a GitHub issue titled `roadmap: <proposal>`. Items move to 🔨 when someone claims them. Security-sensitive
proposals go through [SECURITY.md](SECURITY.md).
