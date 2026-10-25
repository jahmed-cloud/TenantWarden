# TenantWarden — Task Backlog

> Prioritised from a full source review on **2026-10-24**, updated **2026-10-25** after the feature-completion
> pass. Project context lives in [MEMORY.md](MEMORY.md); long-range vision is in [ROADMAP.md](ROADMAP.md).
> Tick items off as they land; add new ones under the right priority.

**Priority key:** P0 = security hole or imminent breakage · P1 = advertised feature is
broken · P2 = correctness / hygiene · P3 = docs drift · P4 = tests & CI · P5 = new features

**Verified** below means exercised against the running local stack (compose project `tenantwarden`).
"Needs a live tenant" means the code path calls Microsoft Graph and was only checked with demo data.

---

## P0 — Critical

- [x] **Audit-log partitions expire 2027-01-01.** Migration 010 adds `ensure_audit_log_partitions()`, partitions
      through 2028 and a `DEFAULT` partition; the scheduler runs it daily at 03:00.
- [ ] **→ Existing deployments: run `make seed` before 2027-01-01** (applies 010, and 011 below).
- [x] **Agent gateway was unauthenticated.** Enrollment-token JWTs (audience `tenantwarden-agent`), tenant binding,
      verified ids stamped on forwarded messages, internal endpoints behind `X-Internal-Token`.
- [ ] Optional mTLS on :4433 (can't work through nginx `/agent/ws`; token auth closes the hole).
- [x] **Tenant isolation**, **secret exposure**, **privileged endpoints**, **`make seed` admin reset**,
      **secrets in env templates**, **real client IP**, **TOTP brute force** — all fixed 2026-10-24.
- [ ] Delete `.env.example.filled` and `.env.generated` **after** confirming no deployment uses their
      `ENCRYPTION_KEY` (losing it makes tenant secrets unrecoverable).
- [ ] Server-side MFA challenge: today `requiresMfa: true` still confirms the password was right.

## P1 — Broken core features

### Endpoint agent ([agent/](agent/))
- [x] Compile errors, missing `go.sum`, read-loop panic (2026-10-25).
- [x] **OS collectors wired in** as build-tagged `shared/collectors/os_{linux,windows,other}.go`: events (journald /
      Windows Event Log + Security + Defender, brute-force folding) and an inventory message. The unused
      `agent/linux`, `agent/windows`, `shared/config`, `shared/auth` packages are gone. Verified: Windows host
      (7 events, 22-field inventory) and a Debian container (dpkg, apt, platform `docker`).
- [x] **`register` is real**: decodes the token, probes the gateway, writes a private `agent.yaml`; `--install`
      sets up a systemd unit or Windows service; `install`/`uninstall`/`status` commands. Verified: register + start
      on Windows and Linux; the install step's error path in a container.
- [ ] **Verify `--install` on real hosts**: a systemd host and an elevated Windows prompt (service start, recovery
      actions, `agent.log`). Not run yet — the dev box isn't elevated and containers have no systemd.
- [x] Per-OS config/ID paths (`/etc/tenantwarden`, `%ProgramData%\TenantWarden`), URL normalisation (no more
      `/agent/ws/ws`), registration re-sent on every reconnect, event bookmark survives restarts.
- [x] Binaries served at `/downloads/` with `SHA256SUMS` and the dev CA; `make build-agent` falls back to Docker.
- [ ] macOS: no launchd installer; inventory is minimal (firewall, FileVault, kernel); no event collection.

### Agent telemetry pipeline
- [x] `AgentTelemetryConsumer` (API hosted service) consumes `tenantwarden:agent_*`: upserts agents (registration
      owns the OS details), stores metrics in ClickHouse, events in `agent_events` (critical → alert), inventory as
      JSONB. Verified end to end. Removing an agent also removes its events.
- [ ] Live push (SignalR) is gone from the frontend; pages poll every 20–60 s. Re-add push only if needed.

### Alerting & notifications
- [x] Enum strings, `inet` serialisation, `AgentStats` casts, `entra_id` alias (2026-10-25).
- [x] **Alert engine rewritten**: aliased columns, all 8 metrics, cooldown via `SET NX`, de-dupe by
      `external_id`, `last_triggered_at`, **auto-resolve when the condition clears**. Verified: default rules fired on
      demo data, "Agent offline" opened and closed itself.
- [x] **Real alerts notify**: alert-engine, collector (Defender) and API `CreateAsync` publish `tenantwarden:alerts`.
      Verified in notification-service logs (Teams + Slack dispatch).
- [x] Rule CRUD API (`/v1/alert-rules`, metric catalogue) + rule builder UI; 5 default rules per new tenant
      (`create_default_alert_rules`, migration 011).
- [x] Ack stores its comment (`metadata.ackComment`) and acknowledge/resolve/assign all record the actor's email.

### Collector ([collector-service/](collector-service/src/))
- [x] Defender incidents persisted (`security_incidents`), high/medium raise alerts, resolved ones close them.
      *Needs a live tenant.*
- [x] `user_count` from `/users/$count`; `enabled_modules` honoured; `decryptSecret` fails loudly
      (`SecretDecryptionError`) instead of passing ciphertext to Entra ID. *Needs a live tenant.*
- [x] **Identity response actions** through Graph (`POST /remediate`): dismiss, confirm compromised, revoke sessions;
      403/502 carry Graph's message to the UI. *Needs a live tenant with the two optional permissions.*

### Auth & sessions
- [x] **Refresh tokens rotate** (one-time use). Verified: refresh 200, reusing the old cookie 401.
      The frontend keeps the access token in memory only and restores the session from the cookie on load.
- [x] **API keys**: `twk_…`, SHA-256 hashed, `X-API-Key` auth scheme in the API. Verified: 200 with key, 401 wrong or
      revoked. Old bcrypt hashes are cleared by migration 011.
- [x] **User admin** (`/auth/users`): create with temporary password, edit role/tenant/active, reset password.
- [x] Minimum password length 12 everywhere.
- [ ] **Entra SSO is non-functional** (backend validates Microsoft tokens with the local HMAC key). The frontend
      no longer ships MSAL; fix the backend (OIDC metadata/JWKS, `tid` allowlist, no auto-link by email) before
      re-adding the button.
- [ ] `RevokeAllUserTokensAsync` writes `force_logout:{id}`, but nothing checks it.
- [ ] Enforce `must_change_password` server-side (today the UI blocks everything until it's changed).

### Frontend ([frontend/](frontend/src/))
- [x] **Rewritten (2026-10-25)**: Material 3-style theme from colour-role tokens (light/dark without `dark:` pairs),
      one file per page, duplicate pages and the WebSocket hook deleted, no fake data — every chart has an empty
      state, detailed tooltips (all series + totals). New: rule builder, agent onboarding + host sheet, identity
      response actions, Security page (Secure Score, incidents, service health), real Reports exports, Admin
      (users, channels, API key, audit, retention), two-step sign-in setup. Strict TypeScript.
- [x] MSAL removed (−267 KB); `VITE_*` runtime vars no longer matter (fixed `/api`, `/auth`).
- [ ] Check layouts at phone width (tables scroll horizontally; not reviewed below ~550 px).

### Platform plumbing
- [x] Scheduler no longer calls the API (collection, rules and analytics run on their own timers); the two anonymous
      no-op trigger endpoints are removed. Stale agents are marked offline every 5 minutes.
- [x] ClickHouse schema loads (TTL fix); `QueryAsync` is real (agent metric history). `make seed` applies it.
- [ ] `*_FILE` secrets: [load-secrets.sh](scripts/load-secrets.sh) is still not used by any Dockerfile.

## P2 — Correctness & hygiene

- [ ] A real migration runner (`schema_migrations`); initdb only runs on an empty volume.
- [ ] Exception handler logs the path but not the exception.
- [x] Audit log: API and auth-service write one `audit_logs` row per authenticated change (method, action, resource,
      id, IP, user agent, success). Verified.
- [x] Retention covers `service_health`, `auth_method_summary`, `agent_events`, `security_incidents`.
- [x] Access token no longer in localStorage. `ListAsync` uses one `MGET`.
- [x] Removing a tenant deletes it (it used to only pause); pausing is a separate action.
- [ ] Webhook dispatcher sends the raw shared secret as `X-TenantWarden-Signature`; send an HMAC of the body.
- [ ] Encrypt `platform_users.totp_secret` and notification channel configs at rest.
- [ ] nginx: `listen 80` serves the full app; `add_header` in `/downloads/` drops the security headers.
- [ ] Dead weight: Hangfire server with no jobs, MinIO, `KafkaEventBus`, EF Core, plugin-engine.
- [ ] Frontend Dockerfile: copy the lockfile and use `npm ci`.
- [ ] Config drift: `COLLECTOR_INTERVAL` (compose 3600 vs code 900), `ANALYTICS_INTERVAL`, `AI_PROVIDER`.

## P3 — Documentation

- [x] README rewritten (real ports, features, agent, API keys, tenantwarden.org); [docs/AGENT.md](docs/AGENT.md) added.
- [x] ROADMAP and SECURITY_AUDIT brought in line with the code (2026-10-25).
- [ ] [docs/architecture/ADR.md](docs/architecture/ADR.md) ADR-001: ClickHouse now holds agent metrics and custom
      events only; everything else is PostgreSQL.
- [ ] [docs/api/openapi.yml](docs/api/openapi.yml) predates most endpoints.

## P4 — Tests & CI

- [ ] There are **zero tests**. Start with: AES-GCM TS ↔ C# round trip, `ruleEvaluator`, `anomaly.ts`, `scorer.ts`;
      xUnit for `TokenService` (rotation), `LoginThrottle`, tenant scoping, `ApiKeyAuthenticationHandler`;
      Go for `wsURL`, `readToken`, the brute-force folding, transport reconnect.
- [ ] CI: remove `continue-on-error`, add `npm audit`, `dotnet list package --vulnerable`, `govulncheck`,
      `gofmt -l`. `make test` / `make lint` still end with `|| true`.

## Monitoring expansion (2026-10-25)

- [x] Dark-mode native dropdowns were white with white text: `select`/`option` now use the theme palette.
- [x] 32 new alert metrics (identity, Secure Score drop, devices, host health, firewall/AV/encryption, risky ports,
      certificates, failed logins, audit-log cleared, endpoint checks, SQL Server / role status) and a rule library.
- [x] KQL-style query language + Query page + `custom_query` rules with a live test.
- [x] Agent: custom log files, extra Windows channels, journal units, workload discovery with role logs, certificates,
      network throughput + connections, TCP/HTTP/DNS checks; monitoring profile pushed from the portal.
- [x] Workloads and Network dashboards; agent sheet network chart and roles tab.
- [ ] Verify SQL Server discovery + Application-log parsing on a real SQL Server host, and IIS / AD DS / DNS roles.
- [ ] Verify `--install` (Windows service, systemd) on real hosts — still outstanding from the first pass.
- [ ] Per-check alert routing (today one rule covers all checks); check history beyond 14 days.
- [ ] Query language: `extend`, `join`, `bin()` on numbers; saved queries; query-based dashboard tiles.
- [ ] Log monitoring: multi-line records (stack traces), timestamps parsed from lines, Windows Event Log XPath filters.

## Machine groups & filters (2026-10-26)

- [x] Machine groups (`agents.groups`, migration 013), set in the portal: Agents → select hosts → Add to / Remove from
      group. `GET/PATCH /v1/agents/groups`.
- [x] Machine scope in the top bar (all machines, a group, or hand-picked hosts), kept per tenant. Agents, Workloads
      (including the role-log charts) and Network follow it through `?agents=` / the query's `agents` list.
- [x] Fleet filters on the Agents page: status, platform, group chips; search covers groups and tags.

### Filter backlog
- [ ] **Alert rules scoped to a group** (e.g. disk rule for "SQL servers" only): `scope` on `alert_rules`,
      honoured by every agent metric in `ruleEvaluator.ts`.
- [ ] **Monitoring profile targeting by portal group** (today: host names, agent tags, platform).
- [ ] **Dynamic groups**: membership by OS, platform, tag, discovered role, IP range / subnet or host-name pattern,
      re-evaluated as agents report.
- [ ] **Saved views per user**: named filter sets (scope + page filters), a default view, shareable by URL.
- [ ] **More fleet filters**: OS version, agent version (outdated), last report age, role (has SQL Server …),
      pending updates, failing security checks; multi-select chips.
- [ ] **Alerts and agent events filtered by machine or group** (Alerts page, Recent events, alert list API).
- [ ] **Overview and Reports scoped to a group** (endpoint KPIs, executive summary per group).
- [ ] **Query page scope**: optional "apply machine scope" toggle (the API already accepts `agents`), and a
      `groups` field on AgentEvents / Checks so queries can filter by group directly.
- [ ] Group admin page: rename, merge, delete a group, and a group description.
- [ ] URL-encode the scope (`?scope=group:web`) so a filtered page can be bookmarked or shared.

## Brand & website (2026-10-26)

- [x] Portal uses the tenantwarden.org identity: the shield mark (favicon + inline `Logo`), navy/mint palette
      (dark mode matches the site), DM Sans / Space Grotesk / DM Mono bundled via @fontsource, website links in the
      sidebar, account menu and sign-in page.
- [x] Motion: logo draws itself and its watch point pings, pages fade up on navigation, dialogs scale in, sheets slide
      in, menus pop, online hosts pulse, sign-in hero floats. All off under `prefers-reduced-motion`.
- [x] README screenshots (synthetic "Northwind Traders" tenant) in `docs/screenshots/`.
- [x] Fixed on the way: dialogs opened from the top bar were clipped inside it (Dialog/Sheet now portal to `<body>`);
      nginx `api_limit` of 60 r/m blanked pages after a few clicks (now 600 r/m, burst 120, answers 429);
      long bar-chart labels were clipped and the bar legend swatch didn't match.
- [ ] **Agent PowerShell trips Microsoft Defender**: a Windows host reported `Trojan:PowerShell/Agentl!MSR` on
      2026-10-25, most likely the agent's `-EncodedCommand` scripts (inventory, events, discovery). Write the scripts
      to `%ProgramData%\TenantWarden\scripts\*.ps1` and run them with `-File`, sign them, and document a Defender
      exclusion / submit the binary to Microsoft as a false positive.
- [ ] nginx: `/auth/me` and `/auth/refresh` share `auth_limit` (10 r/m) with sign-in, so a few quick reloads get 429
      and the account menu shows "?". Keep the strict zone for login / MFA / password endpoints only.
- [ ] Brand assets beyond the portal: PNG app icons + web manifest (PWA install), apple-touch-icon, social card for
      the repo, logo in notification e-mails / Teams cards and in the executive report, Windows agent `.exe` icon and
      version resource.
- [ ] Dark-first option: follow the OS theme by default (`theme: 'system'`) and remember per user server-side.
- [ ] Repeatable screenshots: commit the demo dataset and the headless capture script (`make screenshots`), so the
      README images can be regenerated after UI changes.
- [ ] Richer `make demo-data`: the Contoso seed has no Secure Score history, sign-ins, incidents or agents; reuse the
      Northwind dataset.
- [ ] Website ↔ portal: changelog / release notes on tenantwarden.org linked from the portal's "What's new", and a
      version check against the latest GitHub release.

## P5 — New features (proposed)

- [x] Alert rule builder, user & role management, enrollment-token UI, Defender incident view, on-demand reports
      (2026-10-25).
- [ ] **More Graph collectors**: OAuth consent grants, risky service principals, PIM role assignments,
      stale/guest accounts, legacy-auth sign-ins, Exchange forwarding rules, SharePoint sharing.
- [ ] **Scheduled reports** emailed through the notification channels.
- [ ] **Real AI insights** with the Anthropic SDK (`AI_PROVIDER=anthropic` is already in `.env`).
- [ ] **Demo mode**, **SIEM export** (syslog/CEF, Sentinel), **certificate-based Graph auth**, **alert correlation**.
- [ ] **Agent**: auto-update, process list, per-container stats, macOS launchd installer, commands from the portal
      (`collect_now` exists in the agent; no UI or API route yet).
