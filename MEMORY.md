# TenantWarden — Project Memory

> Working context for contributors picking up this codebase.
> Derived from a full source review on **2026-10-24**. Update it when architecture,
> ports, or feature status change. Open work lives in [TASK.md](TASK.md).

---

## 1. What this is

**TenantWarden: self-hosted security monitoring for Microsoft 365.** It polls Microsoft
Graph for each connected M365 tenant, stores posture data in PostgreSQL, evaluates alert
rules, sends notifications, and shows everything in a React dashboard. A Go endpoint agent
streams host telemetry to an agent gateway. The project was called *Guardian365* until
2026-10-25; it was renamed because of a clash with an existing Microsoft-partner service.

- **Maintainer:** Junaid Ahmed ([@jahmed-cloud](https://github.com/jahmed-cloud)) · **License:** MIT ([LICENSE](LICENSE)).
- **Repository:** https://github.com/jahmed-cloud/TenantWarden · version 1.0.0.
- **Honest status:** security posture is suited to **LAN/VPN only**, and several
  features are still stubs (see §6). [ROADMAP.md](ROADMAP.md) and
  [SECURITY_AUDIT.md](SECURITY_AUDIT.md) still claim more than the code delivers.

---

## 2. Architecture (as actually wired)

```
Browser ──► gateway (nginx :8090 http / :8443 https)
              ├─ /           → frontend   (nginx serving Vite build, :3000)
              ├─ /auth/      → auth-service (:8081)   [prefix stripped]
              ├─ /api/       → api          (:8080)
              ├─ /ws/        → api SignalR hub /ws/hub
              ├─ /agent/ws   → agent-gateway /ws (:8082)   [any other /agent/ path → 404]
              └─ /downloads/ → ./agent/dist (autoindex)
Agents ──► agent-gateway :4433 (TLS if certs exist) or gateway /agent/ws
           — enrollment-token JWT required; no client-cert (mTLS) check

collector-service ──(Graph API, every COLLECTOR_INTERVAL)──► PostgreSQL
alert-engine (60s loop) ──reads alert_rules──► INSERT alerts (PostgreSQL)
analytics-engine (loop) ──► compliance scoring + z-score anomaly → Redis keys
notification-service ◄── Redis pub/sub "tenantwarden:alerts" ── (only API channel test publishes)
scheduler (node-cron) ──► HTTP triggers to api + DB cleanup jobs
plugin-engine ──► in-memory registry, GET /plugins only (not routed by nginx)
```

**Data stores:** PostgreSQL 16 holds everything the app reads. ClickHouse 24 has a schema
but is effectively unused. Redis 7 is used for heartbeats, locks, throttling, refresh
tokens, and pub/sub. MinIO is registered in the API but never used.
**Kafka:** referenced everywhere (`KAFKA_BOOTSTRAP`) but there is no Kafka container and
`KafkaEventBus` is a no-op logger.

### Services, real ports, and stacks

| Service | Path | Stack | Internal port | Host port |
|---|---|---|---|---|
| gateway | [gateway/](gateway/nginx.conf) | nginx 1.25 | 80/443 | **8090 / 8443** by default (`GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT`) |
| frontend | [frontend/](frontend/) | React 18 + TS + Vite 5 + Tailwind + Zustand + React Query + ECharts | 3000 | — |
| api | [api/](api/src/Program.cs) | ASP.NET Core 9, Dapper, SignalR, Hangfire, Serilog, OTel | 8080 | — |
| auth-service | [auth-service/](auth-service/src/Program.cs) | ASP.NET Core 9, BCrypt, Otp.NET | 8081 | — |
| agent-gateway | [agent-gateway/](agent-gateway/src/Program.cs) | ASP.NET Core 9 minimal API, raw WebSockets | 8082 / 4433 | 4433 |
| collector-service | [collector-service/](collector-service/src/index.ts) | Node 20 + TS (ESM), Graph SDK, `@azure/identity`, pg, ioredis | 3001 | — |
| alert-engine | [alert-engine/](alert-engine/src/index.ts) | Node + TS | 3002 | — |
| notification-service | [notification-service/](notification-service/src/index.ts) | Node + TS, axios, nodemailer | **3003** | — |
| analytics-engine | [analytics-engine/](analytics-engine/src/index.ts) | Node + TS | **3004** | — |
| plugin-engine | [plugin-engine/](plugin-engine/src/index.ts) | Node + TS | 3005 | — |
| scheduler | [scheduler/](scheduler/src/index.ts) | Node + TS, node-cron | 3006 | — |
| agent | [agent/](agent/main.go) | Go 1.22, cobra/viper, gorilla/websocket, gopsutil, zap | — | — |
| postgres / clickhouse / redis / minio | compose images | — | 5432 / 8123 / 6379 / 9000 | 127.0.0.1:5433 / 8123 / 6379 / 9002 |
| prometheus / grafana / loki | `--profile monitoring` | — | — | 127.0.0.1:9090 / **3001** / 3100 |

The README's port table is out of date. It lists gateway 80/443, notification 3004, and analytics 3003.

---

## 3. Key conventions & patterns

- **API routes:** `api/v1/<resource>` with `[Authorize]` at the class level and role
  lists on mutating actions. Roles (`user_role` enum): `super_admin, org_admin,
  security_admin, global_reader, soc_analyst, helpdesk, auditor, viewer, api_user`.
- **Data access:** raw SQL through Dapper (.NET) or `pg` (Node). There is no ORM, even though EF Core
  is referenced. `Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true`. A custom
  `StringListTypeHandler` maps `TEXT[]` to `List<string>`. Many controllers return
  anonymous `dynamic` rows with explicit `AS "camelCase"` aliases.
- **Node services** return snake_case column names unless SQL aliases them. Forgetting an
  alias is a known bug class (see TASK.md, alert-engine).
- **Tenant scoping:** endpoints take `?tenantId=` (the frontend auto-selects the first tenant in
  [App.tsx](frontend/src/App.tsx)). Each one checks it with the
  [TenantAccess.cs](api/src/infrastructure/TenantAccess.cs) helpers: `User.CanAccessTenant(id)` for
  a required tenant, and `User.TryScopeTenant(optional, out scoped)` for an optional filter. Model:
  `super_admin` sees all tenants, and every other role sees only its `tenant_id` claim (no claim → 403).
  By-id endpoints load the row and return 404 for another tenant's rows. **New endpoints must do the
  same.** Use `User.UserId()`, not `FindFirst("sub")`: JwtBearer maps `sub` to NameIdentifier.
- **Agent auth:** agents send `Authorization: Bearer <enrollment token>` plus `X-Agent-ID` (a GUID).
  The token is HS256 with the shared `JWT_SIGNING_KEY`, audience `tenantwarden-agent` (user tokens use
  `tenantwarden-api`, so neither works in the other's place), and claims `tenant_id` + `jti`. The API mints
  it ([AgentService.cs](api/src/services/AgentService.cs)), and the agent gateway validates it.
  Each agent ID is bound to its first tenant.
- **Client IP / rate limiting:** both .NET services use `UseForwardedHeaders` (ForwardLimit 1, trusting the
  nginx hop). Rate limiting happens only in nginx (`api_limit` 60 r/m, `auth_limit` 10 r/m, per IP).
- **Secrets:** tenant Graph client secrets are AES-256-GCM encrypted, stored as
  `base64(nonce[12] | tag[16] | ciphertext)`, with key = `SHA256(ENCRYPTION_KEY)`. Encrypted in
  [TenantService.cs](api/src/services/TenantService.cs), decrypted in
  [decrypt.ts](collector-service/src/utils/decrypt.ts). These two must stay byte-compatible.
  **Losing `ENCRYPTION_KEY` makes every tenant secret unrecoverable.**
- **Auth tokens:** HS256 JWT signed with the shared `JWT_SIGNING_KEY`, issued by auth-service and
  validated by the API. Claims: `sub, email, name, jti, role, tenant_id, azure_oid,
  mfa_verified`. 15-minute access token. The refresh token lives in Redis
  (`refresh:{token}`) and an httpOnly cookie scoped to `/auth`.
- **Frontend state:** a Zustand store persisted to localStorage (`tenantwarden-store`), which
  includes the access token. API calls go through [client.ts](frontend/src/services/api/client.ts).
  React Query hooks live in [hooks.ts](frontend/src/services/api/hooks.ts).
- **Redis keys:** `agent_heartbeat:{agentId}` (120s TTL), `agent_tenant:{agentId}` (binding),
  `agent_token:{jti}` (owning tenant, TTL = token expiry), `agent_token_revoked:{jti}`,
  `collector_lock:{tenantId}`, `alert_rule_cooldown:{ruleId}`, `login_fail:/login_lock:{email|ip}`,
  `refresh:{token}`, `revoked:{token}`, `analytics:{tenantId}:risky_users`.
- **Redis channels:** `tenantwarden:alerts` (notification-service subscribes),
  `tenantwarden:agent_metrics|agent_events|agent_registration` and
  `tenantwarden:analytics_alerts` (published, **no subscribers**).
- **Commit style** ([CONTRIBUTING.md](CONTRIBUTING.md)): `component: short description`.

---

## 4. Database

PostgreSQL migrations in [postgres/migrations/](postgres/migrations/) (001–010) run
automatically only on a **fresh** volume (`docker-entrypoint-initdb.d`). Otherwise run
`make seed`, which re-applies all of them. Tables:

`tenants, platform_users, alerts, agents, risky_users, risky_signins, managed_devices,
ca_policies, alert_rules, notification_channels, notification_failures, audit_logs
(yearly partitions plus `audit_logs_default`; `ensure_audit_log_partitions()` from 010 runs daily in the
scheduler), service_health, secure_scores, auth_method_summary,
posture_history, compliance_frameworks, compliance_controls, compliance_assessments,
compliance_history, retention_config`.

- **Default admin:** `admin@tenantwarden.local` / `TenantWarden!` with `must_change_password`
  set (migration 003). Re-running 003 via `make seed` is safe: it no longer resets an existing admin.
- ClickHouse schema ([clickhouse/migrations/](clickhouse/migrations/001_analytics_schema.sql)):
  `agent_metrics, signin_events, alert_history, secure_score_history, custom_events`.
  Only `custom_events` has a writer (the API `/v1/events`), and it writes an empty tenant_id.

---

## 5. Running it

```bash
make setup-env   # python3 scripts/generate-env.py .env
make certs       # dev TLS certs for gateway + agent-gateway
make build       # sequential batches (parallel builds crash Docker Desktop)
make up          # dashboard → http://localhost:8090
make seed        # (re)apply migrations
make monitoring  # optional Grafana/Prometheus/Loki
```

- Default admin: `admin@tenantwarden.local` / `TenantWarden!` (forced password change on first login).
  `make demo-data` loads the placeholder tenant "Contoso Ltd." with sample alerts.
- If host ports 8090/8443 are taken, set `GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT` (and `APP_URL`) in `.env`.
- **Windows without `make`:** run the Makefile's `docker compose` lines directly. For the cert script in
  Git Bash, use `MSYS2_ARG_CONV_EXCL="/CN=" bash scripts/generate-certs.sh`. Otherwise Git Bash rewrites the
  `-subj /CN=…` arguments, and `MSYS_NO_PATHCONV=1` breaks the `/tmp` paths instead.
- .NET and Go checks can run in containers when the SDKs aren't installed (`mcr.microsoft.com/dotnet/sdk:9.0`, `golang:1.22`).
- MinIO is behind `--profile storage` (unused, and its Docker Hub image is gone).
- The ClickHouse schema fails on first boot (TASK.md P1). The container restarts and runs without tables, so
  the first `docker compose up` can report "clickhouse unhealthy". Run `up` again.

**Frontend env gotcha:** `VITE_*` values are inlined at **build** time, but compose passes
them as runtime env vars to the frontend container, so they have no effect. The bundle
falls back to defaults (`/api`, `/auth`, `ws://localhost/ws`, an all-zero Azure client ID).

---

## 6. Feature inventory: claimed vs. actual

✅ works · ⚠️ partial or buggy · ❌ stub or broken

| Feature | Status | Notes |
|---|---|---|
| Tenant onboarding from portal (encrypted secret) | ✅ | `POST /v1/tenants` (super_admin) |
| Graph collection: risky users, risky sign-ins, Intune devices, CA policies, Secure Score, service health, auth-method registrations | ✅ | Tolerates partial failure (403 per dataset skipped) |
| Defender incidents | ❌ | Collected, but **never persisted** |
| Tenant user count | ⚠️ | Set to the *risky-user* count, not total users |
| `enabledModules` per tenant | ❌ | Ignored by the collector |
| On-demand scan (`POST /v1/collect`) | ✅ | From the UI. The scheduler's call gets a 401 (no token) |
| Alert rule engine | ❌ | Reads snake_case columns as camelCase, so it never fires correctly. Only 2 of 3 metrics are implemented |
| Alert workflow (ack/resolve/assign/delete) | ✅ | Ack ignores the comment. Resolve doesn't record who resolved |
| Notifications (Email, Teams, Slack, Webhook, PagerDuty, ServiceNow, Jira) | ⚠️ | Dispatchers exist and test-fire works, but **real alerts never publish to `tenantwarden:alerts`** |
| Compliance frameworks + controls scoring | ✅ | analytics-engine `scoreCompliance`, half credit for partial |
| Posture and compliance history trends + retention config | ✅ | `service_health` and `auth_method_summary` are never pruned |
| Anomaly detection | ⚠️ | z-score on daily risky-user counts. Result goes to Redis, which nobody reads |
| "AI insights" | ❌ | Template strings. `AI_PROVIDER` / API keys are unused |
| MFA status endpoint | ❌ | **Hard-coded fake numbers** (94%, fake departments) |
| Remediation: reset password / revoke sessions / dismiss risk | ❌ | Logs only, no Graph call. Dismiss changes the local DB only |
| Live dashboard (SignalR) | ❌ | Frontend uses a raw WebSocket, not the SignalR protocol, and returns early for local-login users |
| Local login + forced password change | ✅ | Change is enforced client-side only |
| Tenant isolation (API + SignalR hub) | ✅ | super_admin sees all tenants, other roles only their `tenant_id` claim (added 2026-10-24) |
| Account lockout (5 fails → 15 min) | ✅ | Keyed on email + real client IP (forwarded headers) |
| TOTP MFA | ⚠️ | Works, and failed codes count toward the lockout. Secret stored in plaintext. No server-side challenge |
| Refresh tokens | ❌ | `RefreshAsync` always returns null, and the frontend never calls it, so sessions end after 15 minutes |
| Microsoft Entra SSO | ❌ | `/auth/msal` validates MS tokens with TenantWarden's HMAC key. The frontend never calls the exchange |
| API keys | ❌ | Generated, but verified against `PasswordHash`, and no API-key auth scheme exists |
| Go agent | ⚠️ | Compiles, vets clean, and runs (fixed 2026-10-25). It connects with an enrollment token and sends registration, heartbeats, and system metrics (CPU/mem/disk/net). OS collectors (event log, BitLocker, Windows Update, journald) are still unreferenced dead code. `register` is fake |
| Agent gateway auth | ✅ | Enrollment-token JWT, tenant binding, verified ids stamped on forwarded messages. Internal endpoints need `X-Internal-Token`. No mTLS (the README's "mTLS" claim is still wrong) |
| Agent telemetry → dashboard | ❌ | Gateway publishes to Redis channels nobody consumes. The `agents` table is never populated by real agents |
| Custom event ingestion (`/v1/events`) | ❌ | Tenant is set correctly now, but the ClickHouse tables don't exist (schema init fails), so inserts fail. Reads are stubbed (`return []`) |
| Alerts UI (badges, severity/status filters) | ✅ | Works since enums became strings (verified in the browser 2026-10-25) |
| UI theme | ✅ | Light by default, with a dark toggle. Every page has light/dark class pairs; charts use `useChartColors()`. New UI must pair colours as `bg-white dark:bg-gray-900` |
| Identity page risky-users table | ❌ | API returns snake_case rows, and the UI reads camelCase, so the table shows `??` |
| Plugin engine / marketplace | ❌ | Registry listing only. No execution, sandbox, or route |
| Audit log | ⚠️ | Only login events go to the DB. Middleware only writes to the app log |
| Docker secrets (`*_FILE`) | ❌ | [load-secrets.sh](scripts/load-secrets.sh) exists but no Dockerfile uses it |
| Helm chart | ❌ | Only `api` + `ingress` templates |
| Tests | ❌ | **Zero test files** in any service. `make test` swallows failures with `|| true` |
| CI ([ci.yml](.github/workflows/ci.yml)) | ⚠️ | Go job should pass now (not yet run in CI). Node tests run `continue-on-error` |

---

## 7. Gotchas worth remembering

- **Existing deployments must apply migration 010 (`make seed`) before 2027-01-01.** Until they do,
  `audit_logs` has no 2027 partition, and login audit writes will fail. Login itself now survives that.
- Users without a `tenant_id` (other than super_admin) get 403 everywhere. SSO auto-provisioning
  creates such users.
- Enums ↔ Postgres: labels are the lower-cased C# member names, except `entra_id`. Bind enums into
  SQL with `value.ToPg()` ([Entities.cs](api/src/models/Entities.cs)), never `ToString().ToLower()`.
  Reads rely on Dapper's case-insensitive parse plus the hidden `AlertSource.Entra_Id` alias.
- API/SignalR JSON: enums are serialised as their Postgres label strings (`PgEnum.JsonConverter()`), and
  `inet` values as address strings (`IPAddressJsonConverter`). Both are registered in [Program.cs](api/src/Program.cs).
- Dapper record/constructor mapping needs exact types: cast `COUNT(*)` to `::int` when mapping into `int` members.
- `SELECT *` dynamic rows serialise with snake_case keys. The frontend mostly expects camelCase (TASK.md P1).
- The ClickHouse schema fails to load (TTL on `DateTime64`), so no ClickHouse tables exist yet.
- Agent transport: with gorilla/websocket, never retry a read after a read error (it panics). Use
  a dedicated reader goroutine.
- `.env.example.filled` and `.env.generated` hold the old generated secrets (now gitignored, kept
  because they may hold a live `ENCRYPTION_KEY`). `.env.example` itself only has placeholders.
- Testing tip: Docker Desktop accepts connections on a published port before the app listens. Wait
  with `curl --retry 60 --retry-all-errors`, not `--retry-connrefused`.
- Postgres migrations only auto-run on an empty volume. `make migrate` only applies 001–002.
- nginx `listen 80` serves the whole app over HTTP (no redirect, despite the comment).
- Port 4433 is published to the host for agents.
