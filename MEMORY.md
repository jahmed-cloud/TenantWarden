# TenantWarden — Project Memory

> Working context for contributors picking up this codebase.
> Derived from a full source review on **2026-10-24**, updated after the feature-completion pass on
> **2026-10-25**. Update it when architecture, ports, or feature status change. Open work lives in [TASK.md](TASK.md).

---

## 1. What this is

**TenantWarden: self-hosted security monitoring for Microsoft 365.** It polls Microsoft
Graph for each connected M365 tenant, stores posture data in PostgreSQL, evaluates alert
rules, sends notifications, and shows everything in a React dashboard. A Go endpoint agent
streams host metrics, OS events and a security inventory through an agent gateway. The project was
called *Guardian365* until 2026-10-25; it was renamed because of a clash with an existing Microsoft-partner service.

- **Maintainer:** Junaid Ahmed ([@jahmed-cloud](https://github.com/jahmed-cloud)) · **License:** MIT ([LICENSE](LICENSE)).
- **Website:** https://tenantwarden.org · **Repository:** https://github.com/jahmed-cloud/TenantWarden · version 1.0.0.
- **Honest status:** security posture is suited to **LAN/VPN only**. SSO, mTLS, plugins, Helm and tests are
  still missing (see §6). Graph write paths (remediation, incidents) were only checked with demo data.

---

## 2. Architecture (as actually wired)

```
Browser ──► gateway (nginx :8090 http / :8443 https)
              ├─ /           → frontend   (nginx serving Vite build, :3000)
              ├─ /auth/      → auth-service (:8081)   [prefix stripped → browser calls /auth/auth/...]
              ├─ /api/       → api          (:8080)
              ├─ /agent/ws   → agent-gateway /ws (:8082)   [any other /agent/ path → 404]
              └─ /downloads/ → ./agent/dist (agent binaries, SHA256SUMS, dev ca.crt)
Agents ──► gateway /agent/ws or agent-gateway :4433 (TLS if certs exist)
           — enrollment-token JWT required; no client-cert (mTLS) check

agent-gateway ──Redis tenantwarden:agent_{registration|metrics|events|inventory|checks}──► api AgentTelemetryConsumer
                 └► PostgreSQL agents / agent_events (+ alert on critical) / endpoint_checks · ClickHouse agent_metrics
api ──PUT /v1/agents/profile──► agent_profiles + Redis agent_profile:{tenant} + publish tenantwarden:agent_profile
                                 └► agent-gateway pushes a "config" message to that tenant's connected agents
collector-service ──(Graph, every COLLECTOR_INTERVAL_SECONDS, default 900)──► PostgreSQL
                 └─ HTTP :3001 /collect, /remediate (called by the API only)
alert-engine (60 s loop) ──reads alert_rules──► INSERT/auto-resolve alerts
                 └─ HTTP :3002 /catalogue, /query, /query/validate (called by the API only)
analytics-engine (loop) ──► compliance scoring, z-score anomaly → Redis, retention pruning
alert-engine · collector · api AlertService ──Redis "tenantwarden:alerts"──► notification-service
scheduler (node-cron) ──► DB housekeeping only (old alerts, stale agents, audit partitions)
plugin-engine ──► in-memory registry, GET /plugins only (not routed by nginx)
```

**Data stores:** PostgreSQL 16 holds almost everything. ClickHouse 24 holds `agent_metrics` (read by
`GET /agents/{id}/metrics`) and `custom_events`. Redis 7: heartbeats, locks, cooldowns, refresh tokens,
enrollment-token registry, pub/sub. MinIO is registered in the API but unused (`--profile storage`).
**Kafka:** referenced in config but there is no Kafka container and `KafkaEventBus` is a no-op logger.

### Services, real ports, and stacks

| Service | Path | Stack | Internal port | Host port |
|---|---|---|---|---|
| gateway | [gateway/](gateway/nginx.conf) | nginx 1.25 | 80/443 | **8090 / 8443** by default (`GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT`) |
| frontend | [frontend/](frontend/) | React 18 + TS (strict) + Vite 5 + Tailwind + Zustand + React Query + ECharts | 3000 | — |
| api | [api/](api/src/Program.cs) | ASP.NET Core 9, Dapper, SignalR, Hangfire, Serilog, OTel | 8080 | — |
| auth-service | [auth-service/](auth-service/src/Program.cs) | ASP.NET Core 9, BCrypt, Otp.NET | 8081 | — |
| agent-gateway | [agent-gateway/](agent-gateway/src/Program.cs) | ASP.NET Core 9 minimal API, raw WebSockets | 8082 / 4433 | 4433 |
| collector-service | [collector-service/](collector-service/src/index.ts) | Node 20 + TS (ESM), Graph SDK, `@azure/identity`, pg, ioredis | 3001 | — |
| alert-engine | [alert-engine/](alert-engine/src/index.ts) | Node + TS | 3002 | — |
| notification-service | [notification-service/](notification-service/src/index.ts) | Node + TS, axios, nodemailer | **3003** | — |
| analytics-engine | [analytics-engine/](analytics-engine/src/index.ts) | Node + TS | **3004** | — |
| plugin-engine | [plugin-engine/](plugin-engine/src/index.ts) | Node + TS | 3005 | — |
| scheduler | [scheduler/](scheduler/src/index.ts) | Node + TS, node-cron | 3006 | — |
| agent | [agent/](agent/main.go) | Go 1.22, cobra/viper, gorilla/websocket, gopsutil, zap, x/sys/windows/svc | — | — |
| postgres / clickhouse / redis / minio | compose images | — | 5432 / 8123 / 6379 / 9000 | 127.0.0.1:5433 / 8123 / 6379 / 9002 |
| prometheus / grafana / loki | `--profile monitoring` | — | — | 127.0.0.1:9090 / **3001** / 3100 |

---

## 3. Key conventions & patterns

- **API routes:** `api/v1/<resource>` with `[Authorize]` at the class level and role
  lists on mutating actions. Roles (`user_role` enum): `super_admin, org_admin,
  security_admin, global_reader, soc_analyst, helpdesk, auditor, viewer, api_user`.
  The frontend mirrors the lists in `useCan()` ([tenantWardenStore.ts](frontend/src/store/tenantWardenStore.ts)) to hide controls.
- **Data access:** raw SQL through Dapper (.NET) or `pg` (Node). No ORM. Dynamic rows **must alias every column
  to camelCase** (`AS "camelCase"`); `SELECT *` leaks snake_case to the frontend. Cast `COUNT(*)` to `::int`.
- **Tenant scoping:** endpoints take `?tenantId=` and check it with
  [TenantAccess.cs](api/src/infrastructure/TenantAccess.cs): `User.CanAccessTenant(id)` / `User.TryScopeTenant(optional, out scoped)`.
  `super_admin` sees all tenants, every other role only its `tenant_id` claim (no claim → 403). By-id endpoints
  return 404 for another tenant's rows. **New endpoints must do the same.** Use `User.UserId()` (JwtBearer maps
  `sub` to NameIdentifier) and `User.Actor()` (email, for "who did it" columns).
- **Auth schemes (API):** policy scheme `BearerOrApiKey` → `ApiKey` when `X-API-Key` is present, else JwtBearer.
  API keys are `twk_` + 32 random bytes, stored as SHA-256 hex in `platform_users.api_key_hash`
  ([ApiKeyAuthentication.cs](api/src/infrastructure/ApiKeyAuthentication.cs), `UserService.HashApiKey`).
- **User tokens:** HS256 JWT signed with `JWT_SIGNING_KEY`, issuer `tenantwarden`, audience `tenantwarden-api`,
  15 minutes. Claims: `sub, email, name, jti, role, tenant_id, azure_oid, mfa_verified`. Refresh token in Redis
  `refresh:{token}` + httpOnly cookie `tenantwarden_refresh` (path `/auth`, SameSite=Strict, Secure on HTTPS);
  **one-time use** — every refresh rotates it. The frontend keeps the access token in memory and calls
  `/auth/auth/refresh` on load and on a 401 ([client.ts](frontend/src/services/api/client.ts)).
- **Agent auth:** `Authorization: Bearer <enrollment token>` + `X-Agent-ID` (GUID). Token: HS256, audience
  `tenantwarden-agent`, claims `tenant_id` + `jti`, minted by the API ([AgentService.cs](api/src/services/AgentService.cs)).
  Each agent ID is bound to its first tenant. The gateway overwrites `agent_id`/`tenant_id` in forwarded messages.
- **Agent messages:** `registration` (owns OS name/version/arch/IP), `heartbeat`, `metrics` (gopsutil snapshot),
  `event` (`{events:[{level,source,message,occurred_at}]}`), `inventory` (free-form JSON per OS). Event levels:
  `critical` raises an alert with `external_id = agent-event:{agentId}:{source}`.
- **Alerts** de-duplicate on `external_id`: `rule:{ruleId}` (auto-resolved when the rule stops matching),
  `defender:{incidentId}`, `agent-event:…`. Publish to `tenantwarden:alerts` as `{tenantId, alert:{camelCase}}`.
- **Alert metrics** live in one place, [catalogue.ts](alert-engine/src/catalogue.ts) (40 metrics + 10 query templates);
  the API proxies and validates against it ([AlertEngineClient.cs](api/src/services/AlertEngineClient.cs)), the UI's
  rule library reads it. Rule `condition` = `{metric, operator, param?, query?}`; `param` is a per-item limit
  ("CPU above 95"), `threshold` the count. New metric = a catalogue entry + a `case` in
  [ruleEvaluator.ts](alert-engine/src/evaluators/ruleEvaluator.ts).
- **Query language** ([kql.ts](alert-engine/src/query/kql.ts)): KQL-style pipeline compiled to nested parameterised SQL
  over the whitelisted datasets in [datasets.ts](alert-engine/src/query/datasets.ts); `$1` is always the tenant; runs in
  a READ ONLY transaction with an 8 s statement timeout. `custom_query` rules: no summarize → row count; `summarize … by`
  → each group compared with the threshold. New dataset/field = an entry in datasets.ts (no SQL from user text).
- **Agent event sources:** OS sources keep their provider name; custom logs are `log:<name>`; discovered workloads use
  `SQL Server`, `nginx`, `apache`, `MySQL`, `PostgreSQL`, `Redis`, `MongoDB`, `Directory Service`, `DNS Server` …
  Failed logins are folded to `"N failed logins from X"` messages (metrics parse that shape).
- **Agent inventory** is replaced by the full report (6 h) and merged by partial ones (`"_partial": true`, workloads +
  certificates every 5 min). Network throughput goes to ClickHouse `rx_bps`/`tx_bps` (the old `bytes_*` columns held
  cumulative counters and are no longer read).
- **Client IP / rate limiting:** `UseForwardedHeaders` (ForwardLimit 1) in both .NET services; rate limiting only in
  nginx (`api_limit` 60 r/m, `auth_limit` 10 r/m, per IP).
- **Audit log:** API `AuditLogMiddleware` and auth-service `AuditMiddleware` write one `audit_logs` row per
  authenticated POST/PUT/PATCH/DELETE (`action = "<method> <controller action>"`); logins are written by `UserService`.
- **Secrets:** tenant Graph client secrets are AES-256-GCM, `base64(nonce[12] | tag[16] | ciphertext)`, key =
  `SHA256(ENCRYPTION_KEY)`. Encrypted in [TenantService.cs](api/src/services/TenantService.cs), decrypted in
  [decrypt.ts](collector-service/src/utils/decrypt.ts) (throws `SecretDecryptionError` on a key mismatch). Keep both
  byte-compatible. **Losing `ENCRYPTION_KEY` makes every tenant secret unrecoverable.**
- **Frontend:** one file per page in [pages/](frontend/src/pages/), shared pieces in
  [components/ui.tsx](frontend/src/components/ui.tsx) and [charts.tsx](frontend/src/components/charts.tsx), all API
  calls and types in [hooks.ts](frontend/src/services/api/hooks.ts). **Colours are Material 3 roles** defined as CSS
  variables in [index.css](frontend/src/index.css) (`bg-surface-container-lowest`, `text-on-surface-variant`,
  `bg-primary-container`…), so dark mode needs no `dark:` classes. Charts never show placeholder numbers: no data →
  `EmptyChart`. Zustand persists only theme, nav state and the active tenant (`tenantwarden-store`, v2).
- **Redis keys:** `agent_heartbeat:{agentId}` (120 s TTL), `agent_tenant:{agentId}`, `agent_token:{jti}` (owning tenant),
  `agent_token_revoked:{jti}`, `agent_tokens:{tenantId}` (hash: token metadata for the portal list),
  `agent_profile:{tenantId}` (monitoring profile JSON, re-synced from Postgres when the API starts),
  `collector_lock:{tenantId}`, `alert_rule_cooldown:{ruleId}`, `login_fail:/login_lock:{email|ip}`, `refresh:{token}`,
  `analytics:{tenantId}:risky_users`.
- **Redis channels:** `tenantwarden:alerts` (notification-service), `tenantwarden:agent_registration|metrics|events|inventory|checks`
  (API consumer), `tenantwarden:agent_profile` (API → gateway), `tenantwarden:analytics_alerts` (published, no subscriber).
- **Commit style** ([CONTRIBUTING.md](CONTRIBUTING.md)): `component: short description`.

---

## 4. Database

PostgreSQL migrations in [postgres/migrations/](postgres/migrations/) (001–012) run automatically only on a
**fresh** volume. Otherwise run `make seed`, which re-applies all of them (idempotent) and the ClickHouse schema.

`tenants, platform_users, alerts, agents, agent_events, risky_users, risky_signins, managed_devices, ca_policies,
alert_rules, notification_channels, notification_failures, audit_logs (yearly partitions + default),
service_health, secure_scores, security_incidents, auth_method_summary, posture_history, compliance_frameworks,
compliance_controls, compliance_assessments, compliance_history, retention_config`.

- **011** adds `security_incidents`, `agent_events`, agent `uptime_seconds/inventory/inventory_at`, alert indexes,
  retention rows, `api_key_created_at`, and `create_default_alert_rules(tenant)` (5 rules; run for every tenant
  and on tenant creation).
- **012** adds `endpoint_checks` (latest per agent + check) and `endpoint_check_results` (history, 14-day retention),
  `agent_profiles`, agent `net_rx_bps / net_tx_bps / connections`, and grows the default rules to 15 (disk, CPU,
  brute force, audit log cleared, firewall, antivirus, endpoint checks, SQL Server stopped, certificates, admins without MFA).
- Every tenant-owned table cascades on tenant delete, except `platform_users` and `audit_logs` (SET NULL).
- **Default admin:** `admin@tenantwarden.local` / `TenantWarden!` with `must_change_password` (migration 003).
- ClickHouse ([001_analytics_schema.sql](clickhouse/migrations/001_analytics_schema.sql)): `agent_metrics`
  (written by the API consumer), `custom_events` (`/v1/events`), and unused `signin_events, alert_history,
  secure_score_history`.

---

## 5. Running it

```bash
make setup-env   # python3 scripts/generate-env.py .env
make certs       # dev TLS certs for gateway + agent-gateway
make build       # sequential batches (parallel builds crash Docker Desktop)
make build-agent # agent/dist binaries + SHA256SUMS + ca.crt (Docker fallback when Go is missing)
make up          # dashboard → http://localhost:8090
make seed        # (re)apply Postgres migrations + ClickHouse schema
```

- `make demo-data` loads the placeholder tenant "Contoso Ltd." with sample alerts.
- If host ports 8090/8443 are taken, set `GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT` (and `APP_URL`) in `.env`.
- **Windows without `make`:** run the Makefile's `docker compose` lines directly. Certs in Git Bash:
  `MSYS2_ARG_CONV_EXCL="/CN=" bash scripts/generate-certs.sh`. Docker volume paths: prefix with `MSYS_NO_PATHCONV=1`.
- .NET and Go checks run in containers when the SDKs aren't installed (`mcr.microsoft.com/dotnet/sdk:9.0`, `golang:1.22`).
  Agent: `docker run --rm -v <repo>/agent:/src -w /src -e GOFLAGS=-buildvcs=false golang:1.22 make all VERSION=1.0.0`.
- **Testing the API locally:** mint a user token with the dev `JWT_SIGNING_KEY` (issuer `tenantwarden`, audience
  `tenantwarden-api`, `role` + `tenant_id` claims) instead of using a real password. POSTs through nginx need a body
  (`-d ''`), or nginx answers 400.
- MinIO is behind `--profile storage` (unused, and its Docker Hub image is gone).

---

## 6. Feature inventory: claimed vs. actual

✅ works (verified locally) · 🔶 implemented, needs a live tenant or host to verify · ⚠️ partial · ❌ missing

| Feature | Status | Notes |
|---|---|---|
| Tenant onboarding, edit, pause, delete | ✅ | Delete really deletes (cascade); pause keeps data |
| Graph collection (risky users/sign-ins, devices, CA, Secure Score, service health, auth methods, user count) | 🔶 | Per-dataset failure tolerance; `enabled_modules` honoured |
| Defender incidents → `security_incidents` + alerts | 🔶 | Security page lists them |
| Identity response actions (dismiss / confirm compromised / revoke sessions) | 🔶 | Needs `IdentityRiskyUser.ReadWrite.All`, `User.RevokeSessions.All` |
| Alert rule engine + builder + default rules | ✅ | 40 metrics, rule library (50), 15 defaults, cooldown, de-dupe, auto-resolve |
| Query language + custom query rules | ✅ | 11 datasets; table/chart/CSV; "Create alert rule"; rule test shows which groups would fire |
| Agent custom logs, event channels, journal units | ✅ | Portal profile pushed live (verified on Windows + Linux); platform/host/tag targeting |
| Workload discovery + role logs | ✅ / 🔶 | Verified: Hyper-V (Windows), nginx (container). SQL Server / IIS / AD paths need a host that has them |
| Network: throughput, connections, risky ports, endpoint checks | ✅ | TCP/HTTP/DNS checks verified from Windows and Linux agents |
| Alert workflow (ack with comment / assign / resolve / delete) | ✅ | Actor stored as email |
| Notifications (Teams, Slack, email, webhook, PagerDuty, ServiceNow, Jira) | ✅ | Real alerts publish; webhook secret is sent raw (TASK P2) |
| Compliance scoring + history | ✅ | ISO 27001, NIST CSF, SOC 2 |
| Analytics (KPIs vs previous period, MTTA/MTTR, sources, anomaly) | ✅ | Anomaly needs a few days of history |
| MFA status / auth methods | 🔶 | From `auth_method_summary` (no fake numbers); demo data has none |
| Endpoint agent (Windows, Linux) | ✅ | register/start verified on both; `--install` service setup ⚠️ not yet run on a real host |
| Agent macOS | ⚠️ | Metrics + minimal inventory, no events, no service installer |
| Agent telemetry → dashboard | ✅ | Fleet, host sheet, metric history (ClickHouse), events, inventory checks |
| Enrollment tokens (create / list / revoke) | ✅ | |
| Local login, TOTP two-step, forced password change | ✅ | Password change enforced in the UI only; TOTP secret plaintext |
| Refresh tokens | ✅ | Rotating, one-time use |
| API keys | ✅ | `X-API-Key` |
| User administration | ✅ | `/auth/users` |
| Audit log | ✅ | Every authenticated change in API + auth-service |
| Tenant isolation | ✅ | |
| Reports (executive summary, CSV, JSON) | ✅ | On demand only |
| Live dashboard push | ❌ | Removed; pages poll every 20–60 s |
| Microsoft Entra SSO | ❌ | Backend validation broken; frontend no longer ships MSAL |
| Custom event ingestion (`/v1/events`) | ⚠️ | Writes to ClickHouse; nothing reads it |
| Plugin engine | ❌ | Registry listing only |
| Docker secrets (`*_FILE`) | ❌ | Script exists, unused |
| Helm chart | ❌ | Only `api` + `ingress` templates |
| Tests | ❌ | **Zero test files** |
| CI | ⚠️ | Not yet run on GitHub |

---

## 7. Gotchas worth remembering

- **Existing deployments must run `make seed`** (migrations 010 + 011) — before 2027-01-01 at the latest.
- Users without a `tenant_id` (other than super_admin) get 403 everywhere; removing a tenant leaves its users without one.
- Enums ↔ Postgres: labels are the lower-cased C# member names, except `entra_id`. Bind with `value.ToPg()`
  ([Entities.cs](api/src/models/Entities.cs)); JSON uses the same labels (`PgEnum.JsonConverter()`).
- `inet` values serialise through `IPAddressJsonConverter`; in SQL prefer `host(ip_address)`.
- Agent transport: with gorilla/websocket, never retry a read after a read error (it panics).
- The agent appends `/ws` to the gateway URL unless it already ends with it; `http(s)://` is accepted.
- On Windows a running `agent/dist/tenantwarden-agent.exe` locks the file: stop the test agent before `make build-agent`.
- `.env.example.filled` and `.env.generated` hold the old generated secrets (gitignored; may hold a live `ENCRYPTION_KEY`).
- Docker Desktop accepts connections on a published port before the app listens: wait with
  `curl --retry 60 --retry-all-errors`, not `--retry-connrefused`.
- nginx `listen 80` serves the whole app over HTTP (no redirect). Port 4433 is published for agents.
- The ECharts chunk is ~180 kB gzipped (core + 4 chart types); it loads after sign-in.
- The gateway (nginx 1.27) re-resolves upstreams (`server … resolve`), so recreating one container no longer leaves
  502s until a gateway restart. Older images needed `docker compose restart gateway`.
- Building .NET in a mounted folder leaves `obj/`; each .NET service has a `.dockerignore` so image builds ignore it.
- The agent sends its first reports only after the first connection; queued earlier, they reached the API before
  the registration that creates the agent's row and were dropped.
- Container images often link `/var/log/nginx/error.log` to `/dev/stderr`; the tailer skips anything resolving into
  `/dev` or `/proc` (it would otherwise read the agent's own output).
