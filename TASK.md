# TenantWarden — Task Backlog

> Prioritised from a full source review on **2026-10-24**. Project context lives in
> [MEMORY.md](MEMORY.md); long-range vision is in [ROADMAP.md](ROADMAP.md).
> Tick items off as they land; add new ones under the right priority.

**Priority key:** P0 = security hole or imminent breakage · P1 = advertised feature is
broken · P2 = correctness / hygiene · P3 = docs drift · P4 = tests & CI · P5 = new features

---

## P0 — Critical (do first)

Code fixes landed 2026-10-24 and were verified in throwaway containers: migrations against
Postgres 16, the gateway handshakes against Redis, and API role/tenant checks with minted tokens.
Not yet deployed anywhere.

- [x] **Audit-log partitions expire 2027-01-01.** Fixed by
      [010_audit_partitions.sql](postgres/migrations/010_audit_partitions.sql), which adds
      `ensure_audit_log_partitions()`, partitions through 2028, and a `DEFAULT` partition. The scheduler
      runs the function daily at 03:00, and a failed login-audit insert no longer blocks login.
- [ ] **→ Existing deployments: run `make seed` before 2027-01-01** to apply migration 010.
      Fresh volumes get it automatically. `make seed` no longer resets the admin password (see below).
- [x] **Agent gateway was unauthenticated.** Agents now need an enrollment token: an HS256 JWT with
      audience `tenantwarden-agent`, bound to one tenant, minted by
      `POST /api/v1/agents/enrollment-tokens` and revoked by `DELETE …/enrollment-tokens/{tokenId}`.
      The gateway ignores `X-Tenant-ID`, binds each agent ID to its first tenant, and overwrites
      `agent_id`/`tenant_id` in forwarded messages. `/command` and `/agents/connected` need
      `X-Internal-Token` (disabled unless `AGENT_INTERNAL_API_TOKEN` is set). nginx only routes `/agent/ws`.
- [ ] Optional mTLS on :4433 (`ClientCertificateMode.RequireCertificate` + chain check against
      `Tls:CaPath`). Not done yet: token auth closes the hole, and mTLS can't work through nginx `/agent/ws` anyway.
- [x] **Tenant isolation.** [TenantAccess.cs](api/src/infrastructure/TenantAccess.cs): `super_admin`
      sees every tenant, and every other role sees only the tenant in its `tenant_id` claim. A user
      with no tenant gets 403. That includes SSO-provisioned viewers, whose `tenant_id` is null; assign
      them one in `platform_users`. Applied to every `api/v1` controller, by-id lookups (404 for other
      tenants' rows), and the SignalR hub's `OnConnectedAsync`/`JoinTenant`.
- [x] **Secrets returned to any logged-in user.** Tenants are returned as `TenantDto` (no
      `encryptedClientSecret`). Channel `config` values are masked except `channelId`, `method`, and `recipients`.
- [x] **Privileged endpoints open to every role.** Users → `AdminOnly`. Audit → super_admin/org_admin/auditor.
      Channels → `AdminOnly`. Retention GET → `AdminOnly`, retention PUT → super_admin only (it's
      platform-wide). `POST /collect` → `SecurityTeam`.
- [x] **`make seed` reset the admin password.** 003 now uses `ON CONFLICT DO NOTHING`.
- [x] **Concrete secrets in env templates.** `.env.example` now holds `CHANGE_ME` placeholders, and
      `.gitignore` ignores every `.env.*` except `.env.example`.
- [ ] Delete `.env.example.filled` and `.env.generated` (identical copies of the old values) **after**
      confirming that no deployment uses their `ENCRYPTION_KEY`. Losing that key makes tenant secrets
      unrecoverable, so they were left in place. If any deployment uses those values, rotate them.
- [x] **Real client IP behind nginx.** `UseForwardedHeaders` (ForwardLimit 1) is on in api + auth-service.
      The API's in-process rate limiter is removed, so nginx's per-IP zones are the only limiter.
- [x] **TOTP brute force.** Wrong MFA codes now count toward the 5-attempt lockout.
- [ ] Server-side MFA challenge: return an opaque challenge after the password step, so the second
      step doesn't resend the password. Today `requiresMfa: true` still confirms the password was right.

## P1 — Broken core features

### Endpoint agent ([agent/](agent/))
- [x] **Agent didn't compile.** Fixed the misplaced `fmt`/`runtime` imports and the unused `zapcore` import in
      [cmd/agent.go](agent/cmd/agent.go). `go vet` is clean for linux/windows/darwin, and all four Makefile
      targets build (verified in `golang:1.22` on 2026-10-25).
- [x] **No `go.sum`.** `go mod tidy` generated it. `go.mod` also gained ~15 missing indirect deps (viper's)
      and dropped the unused `prometheus/procfs` and `x/crypto`.
- [x] **Agent crashed ~1 s after connecting:** `panic: repeated read on failed websocket connection`.
      `readWriteLoop` kept retrying reads after a 1 s read timeout, which gorilla treats as permanent. Reads now
      run in their own goroutine, and a read error ends the connection so `loop()` reconnects
      ([websocket.go](agent/shared/transport/websocket.go)). Verified against the gateway: registration and metrics
      flow, and the agent reconnects by itself after a gateway restart.
- [ ] Wire the OS collectors in: [linux/collectors.go](agent/linux/collectors.go) and
      [windows/collectors.go](agent/windows/collectors.go) (event logs, services, BitLocker,
      pending Windows Updates, journald, Docker) are separate packages that nothing imports.
      Move them into `shared/collectors` as `_linux.go` / `_windows.go` build-tagged files,
      and send them as `event` / `metrics` messages.
- [ ] Make `register` real: use [shared/auth/enrollment.go](agent/shared/auth/enrollment.go) and persist
      the returned credentials. There's no server endpoint for enrollment tokens yet (see P5).
- [ ] Use [shared/config/config.go](agent/shared/config/config.go) (currently unused). Fix the
      agent-ID path on Windows (it's hard-coded to `/etc/tenantwarden`), and add `agent.tenant_id` to the flags/docs.
- [ ] URL mismatch: [agent.yaml.example](agent/agent.yaml.example) uses `…:4433/agent/ws`, but the
      code appends `/ws`, which gives `/agent/ws/ws`.
- [x] Gateway read frames into a 4 KB buffer and ignored `EndOfMessage`. It now accumulates
      frames (1 MB cap) and answers the agent's close frame.

### Agent telemetry pipeline
- [ ] Nothing subscribes to `tenantwarden:agent_metrics`, `tenantwarden:agent_events`, or `tenantwarden:agent_registration`.
      Add a consumer (API hosted service or new worker) that upserts `agents`, updates
      `cpu/memory/disk_percent`, writes ClickHouse `agent_metrics`, and pushes `agent_status` via SignalR.

### Alerting & notifications
- [x] **Alerts with source `entra_id` broke the alert list (500).** Fixed in
      [Entities.cs](api/src/models/Entities.cs). A hidden `Entra_Id = EntraId` alias lets Dapper parse the Postgres
      label, and `PgEnum.ToPg()` now produces every enum label written to SQL (replacing `ToString().ToLower()`).
      Verified on 2026-10-25: list, `?source=EntraId` filter, and create all work.
- [x] **API sent enums as numbers; the frontend expects strings.** API and SignalR JSON now emit the Postgres
      labels (`"high"`, `"entra_id"`, `"active"`), via `PgEnum.JsonConverter()` + `[JsonStringEnumMemberName]`
      ([Entities.cs](api/src/models/Entities.cs)). Input still accepts numbers. Verified in the running portal on
      2026-10-25: severity/status badges render, and the severity, status, and source filters return the right rows.
- [x] **`inet` columns crashed responses (500).** `IPAddress` can't be serialised by System.Text.Json (its `ScopeId`
      getter throws), which broke risky users, sign-ins, and the audit log. Added `IPAddressJsonConverter` ([Program.cs](api/src/Program.cs)).
- [x] **Dashboard overview and `GET /agents/stats` always returned 500.** `AgentStats` has `int`s, but `COUNT(*)` is `bigint`.
      The counts are now cast `::int` ([AgentService.cs](api/src/services/AgentService.cs)).
- [ ] **Identity page risky-users table shows `??` and empty cells.** `SELECT *` dynamic rows come back snake_case
      (`user_principal_name`, `risk_level`), but the frontend reads camelCase. The same pattern probably affects other
      `SELECT *` endpoints (devices list, CA policies, sign-ins). Alias the columns, or map to DTOs.
- [ ] **Alert engine never fires correctly.** [ruleEvaluator.ts](alert-engine/src/evaluators/ruleEvaluator.ts)
      selects `tenant_id, cooldown_minutes, channel_ids, is_enabled` but reads `rule.tenantId`,
      `rule.cooldownMinutes`, and so on. Those are undefined, so every count is 0, and the cooldown `EX NaN`
      throws. Alias the columns (`tenant_id AS "tenantId"` …).
- [ ] Implement the `non_compliant_devices` metric (it always returns 0), update `last_triggered_at`,
      and dedupe while an identical alert is still active.
- [ ] **Real alerts never notify.** Only the channel *test* endpoint publishes `tenantwarden:alerts`.
      Publish from alert-engine after insert and from `AlertService.CreateAsync`, using the
      `{ alert, tenantId }` camelCase shape that [notification-service types](notification-service/src/types/index.ts) expect.
- [ ] Alert-engine inserts bypass the API, so there's no SignalR `alert_created` push. Publish
      to Redis and let the API relay it to the hub.
- [ ] There's no API or UI to create alert rules (rows exist only in demo [seed-db.sql](scripts/seed-db.sql)).
      A real tenant has **zero rules**. Ship sensible default rules on tenant creation (see P5 for the builder).

### Collector ([collector-service/](collector-service/src/))
- [ ] **Defender incidents are collected but never persisted.** Add a table and upsert them, then create
      alerts for new or high-severity incidents ([scheduler.ts](collector-service/src/scheduler.ts) `persistResults`).
- [ ] `tenants.user_count` is set to `data.riskyUsers.length`. Use Graph `/users/$count`
      (`ConsistencyLevel: eventual`) for the real total.
- [ ] Honour `tenants.enabled_modules`, which is currently ignored.
- [ ] `decryptSecret` silently returns the ciphertext when GCM auth fails (wrong `ENCRYPTION_KEY`),
      which surfaces as a confusing Graph 401. Log an error and mark the tenant `error` with a clear message.

### Auth & sessions
- [ ] **Refresh is a stub.** `TokenService.RefreshAsync` deletes the token and returns null
      ([TokenService.cs](auth-service/src/services/TokenService.cs)). Load the user and issue a rotated pair.
      In the frontend, call `/auth/refresh` on a 401 before calling `logout()`
      ([client.ts](frontend/src/services/api/client.ts)). Today every session dies after 15 min.
- [ ] **Entra SSO is non-functional.** `/auth/msal` validates Microsoft tokens with TenantWarden's
      own HMAC key, and the frontend never calls the exchange after `loginRedirect`. Fix it by:
      validating against Microsoft OIDC metadata/JWKS with audience = app client ID, keeping an
      allowlist of `tid` values, calling the exchange from `initializeMsal()`, and **not**
      auto-linking existing local accounts by email (`ON CONFLICT (email)` is an account-takeover
      path once validation works).
- [ ] API keys: `GetByApiKeyAsync` verifies against `PasswordHash` instead of `ApiKeyHash`,
      bcrypt-scans up to 1000 rows, and no auth handler reads `X-API-Key` (which the
      [Python SDK](sdk/python/tenantwarden.py) sends). Store a key prefix for lookup, and add an
      API-key authentication scheme to the API.
- [ ] `RevokeAllUserTokensAsync` writes `force_logout:{id}`, but nothing checks it.
- [ ] Enforce `must_change_password` server-side. Today only the UI modal enforces it.

### Frontend ([frontend/](frontend/src/))
- [ ] **Live updates never work.** In [useWebSocket.ts](frontend/src/hooks/useWebSocket.ts),
      `if (localToken) return localToken` exits before connecting. The hook also uses a raw
      WebSocket against a SignalR hub, with no handshake and the wrong message shape. Switch to
      `@microsoft/signalr` (`HubConnectionBuilder`, `accessTokenFactory`), and build the URL from
      `window.location`.
- [ ] `VITE_*` are build-time values, but compose passes them as runtime env vars. Add `ARG`/`ENV` to
      the [frontend Dockerfile](frontend/Dockerfile) builder stage and `build.args` to compose.
- [ ] More hard-coded UI data, seen in the running portal: the Identity page's "Recent sign-in events" (jdoe/akim/
      guest@fabrikam), the Overview's "Microsoft 365 service health" panel (shows "Entra ID Degraded" with no data
      collected), and the "Top 25% of organizations" Secure Score text.
- [ ] Charts show built-in demo numbers whenever data is missing or still loading: a 72 Secure Score, sample
      sign-in bars, sample CPU/MFA bars ([Charts.tsx](frontend/src/components/dashboard/Charts.tsx) defaults). Render
      an empty state instead.
- [x] **UI theme: light, simple, clean** (2026-10-25). Light is the default theme. Seven dark-only pages got light/dark
      class pairs. Charts follow the theme (`useChartColors`). Per-row actions are neutral buttons. The permanent
      "Connecting" pill is hidden.
- [x] **Lighter bundle:** modular ECharts (chart chunk 1,028 KB → 584 KB), and four unused dependencies removed
      (`framer-motion`, `@tanstack/react-table`, `date-fns`, `@microsoft/microsoft-graph-types`).
- [ ] MSAL (267 KB) still loads on every page view although SSO doesn't work yet. Lazy-load it on "Sign in with Microsoft".
- [ ] Alerts table column headers overlap at narrow widths (~550 px pane).
- [ ] Replace fake UI data: `GET /v1/identity/mfa-status` returns hard-coded 94% and fake departments
      ([IdentityAndDeviceService.cs](api/src/services/IdentityAndDeviceService.cs)). Derive it from `auth_method_summary`.
      The Admin page copies `grd_demo_key_replace_with_real` ([AdminPageFull.tsx](frontend/src/components/admin/AdminPageFull.tsx)).
      Call `POST /auth/api-keys` instead.
- [ ] Remediation buttons report success but do nothing. Reset password and revoke sessions only log, and dismiss
      only edits the local DB. Implement them with Graph (needs write permissions:
      `IdentityRiskyUser.ReadWrite.All`, `User.RevokeSessions.All`, …) or hide them.

### Platform plumbing
- [ ] Scheduler `POST /api/v1/collect` gets a 401 (no token). Call `COLLECTOR_URL/collect`
      directly (the env var is already set) and delete the two no-op trigger endpoints/jobs
      ([scheduler/src/index.ts](scheduler/src/index.ts), [OpsController.cs](api/src/controllers/OpsController.cs)).
- [ ] `*_FILE` secrets support is claimed but not wired: no Dockerfile uses
      [load-secrets.sh](scripts/load-secrets.sh). Add it as the ENTRYPOINT wrapper in every service image.
- [x] `POST /v1/events` wrote `tenant_id = ""`. It now uses the caller's tenant (fixed with tenant isolation).
      `ClickHouseService.QueryAsync` still always returns `[]` ([Infrastructure.cs](api/src/infrastructure/Infrastructure.cs)).
- [ ] **ClickHouse schema never loads.** [001_analytics_schema.sql](clickhouse/migrations/001_analytics_schema.sql) fails on
      ClickHouse 24.3 (`BAD_TTL_EXPRESSION`: a TTL on a `DateTime64` column needs `toDateTime(...)`). Init aborts, so no
      ClickHouse tables exist and `/v1/events` inserts fail. Fix the TTLs, then recreate the `clickhouse-data` volume.
- [x] `minio/minio` can no longer be pulled from Docker Hub, which made `docker compose up` fail. MinIO is unused, so it
      now sits behind `--profile storage`. Pick a maintained image before enabling it.
- [x] Windows dev setup: `generate-env.py` crashed writing `.env` (cp1252). It now writes UTF-8. Gateway host ports are
      configurable (`GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT`).

## P2 — Correctness & hygiene

- [ ] A real migration runner: `DatabaseMigrator` only pings the DB, initdb runs only on an empty volume,
      and `make migrate` applies only 001–002. Track applied files in `schema_migrations`.
- [ ] Exception handler logs the path but not the exception. Log `IExceptionHandlerFeature.Error`.
- [ ] `AuditLogMiddleware` reads `HttpContext` inside `Task.Run` after the response completes (unsafe),
      and writes only to the app log. Capture the values first and insert into `audit_logs`.
- [x] Replaced `Guid.Parse(tenantId)` on query strings with `Guid` binding (done with the tenant-isolation work).
- [x] `GET /v1/devices/summary` matched two actions (AmbiguousMatchException). Removed the duplicate in `DevicesController`.
- [ ] `GET /v1/service-health` without `tenantId` still mixes tenants for super_admin. Other roles
      are now pinned to their own tenant. The frontend calls it without the parameter in
      [OverviewPageFull.tsx](frontend/src/components/dashboard/OverviewPageFull.tsx).
- [ ] Retention: `service_health` and `auth_method_summary` are appended every cycle and never pruned.
      Add them to `retention_config` / `pruneHistory`.
- [ ] Webhook dispatcher sends the raw shared secret as `X-TenantWarden-Signature`. Send an HMAC-SHA256 of the body instead.
- [ ] Encrypt `platform_users.totp_secret` at rest (the schema comment says "encrypted", but it isn't).
- [ ] Notification channel configs: the schema says "sensitive values encrypted", but they're stored in plaintext.
- [ ] Access token persisted in localStorage (XSS-exposed). Keep it in memory and rely on the refresh cookie.
- [ ] nginx: `listen 80` serves the full app (no HTTPS redirect, despite the comment). `add_header` inside
      `/downloads/` drops the server-level security headers. Reconsider `autoindex on`.
- [ ] Remove dead weight, or use it: Hangfire server runs with `ProcessorCount*2` workers and no jobs.
      MinIO is registered but unused. `KafkaEventBus` is a no-op. EF Core is referenced but unused.
- [ ] Frontend Dockerfile copies only `package.json` and runs `npm install`. Copy the lockfile and use `npm ci`.
- [ ] Perf: `AgentService.ListAsync` does one Redis GET per agent (use `MGET`). The collector inserts
      row-by-row (batch with `UNNEST`). `HeartbeatAsync` passes the request `ct` to a fire-and-forget `Task.Run`.
- [ ] Ack ignores the `comment`. Resolve doesn't store who resolved. (`assigned_to` was always empty
      because controllers read the `sub` claim, which JwtBearer renames. Fixed via `User.UserId()`.)
- [ ] Config drift: `COLLECTOR_INTERVAL` defaults to 3600 in compose but 900 in code/.env. `AI_PROVIDER` defaults to `openai`
      in compose but `anthropic` in .env. `ANALYTICS_INTERVAL` is 14400 in compose vs 300 in code (and the "5m loop" message).

## P3 — Documentation drift

- [ ] [README.md](README.md): real ports (gateway 8090/8443, notification 3003, analytics 3004,
      Grafana host 3001). The dashboard URL is `http://localhost:8090`. The license line says Apache 2.0, but the project is MIT.
- [ ] [ROADMAP.md](ROADMAP.md): ServiceNow/Jira dispatchers *do* exist. CI is more than a skeleton.
      Mark agent event logs/BitLocker/Windows Update and Defender incidents as **not** shipped.
- [ ] [SECURITY_AUDIT.md](SECURITY_AUDIT.md): remove the `*_FILE` "Mitigated" claim until it's wired, and add the
      P0 findings above. The README calls the agent hub "mTLS", but there's no client-certificate check.
- [ ] [docs/architecture/ADR.md](docs/architecture/ADR.md) ADR-001 says analytics queries ClickHouse
      exclusively, but everything uses PostgreSQL.
- [ ] Document the default admin credentials and first-login flow in one place (CONTRIBUTING says "set via SQL").

## P4 — Tests & CI

- [ ] There are **zero tests** in the repo. Start with high-value units:
      - TS ↔ C# AES-GCM round-trip compatibility ([decrypt.ts](collector-service/src/utils/decrypt.ts) vs `TenantService.Encrypt`)
      - `ruleEvaluator` (would have caught the snake_case bug), `anomaly.ts`, the compliance `scorer.ts`
      - xUnit: `TokenService`, `LoginThrottle`, tenant-scope authorization
      - Go: transport reconnect/backoff, message envelope
- [ ] [ci.yml](.github/workflows/ci.yml): the Go job should now pass (compile + go.sum fixed). This is unconfirmed until
      CI actually runs. Remove `continue-on-error` on tests once they exist. Add `npm audit`,
      `dotnet list package --vulnerable`, and `govulncheck`.
- [ ] `gofmt -l` flags 7 agent files (alignment only). Run `gofmt -w` in its own commit, and add a CI check.
- [ ] `make test` / `make lint` end every line with `|| true`, so failures are invisible.
- [x] Under version control: https://github.com/jahmed-cloud/TenantWarden (first push 2026-10-25).

## Product name

- [x] **Renamed Guardian365 → TenantWarden** (2026-10-25), with "for Microsoft 365" as the descriptor. The old name
      collided with **Guardian 365**, Forsyte I.T. Solutions' Microsoft-partner MXDR service. Every identifier changed
      (.NET namespaces/assemblies, Go module `github.com/tenantwarden/agent`, JWT issuer/audiences, Redis channels, DB
      user/name, `TENANTWARDEN_` env prefix, container names, the localStorage key). The default admin is now
      `admin@tenantwarden.local` / `TenantWarden!`. A web search isn't trademark clearance: check USPTO/EUIPO before
      any commercial launch.

## P5 — New features (proposed)

Roughly in value order. Items marked *(roadmap)* already appear in [ROADMAP.md](ROADMAP.md).

- [ ] **Alert rule builder**: CRUD API for `alert_rules` + UI, plus default rule packs created with each tenant *(roadmap)*.
- [ ] **User & role management UI**: invite/create users, assign roles and tenant access, deactivate.
      Today the only paths are SQL and the (broken) SSO auto-provisioning.
- [ ] **Agent enrollment tokens UI**: the API exists (`POST/DELETE /v1/agents/enrollment-tokens`).
      The Agents page still shows a `TOKEN` placeholder. Add mint/copy/revoke there, and keep a list of issued tokens.
- [ ] **More Graph collectors** *(roadmap)*: OAuth app consent grants and risky service principals,
      privileged role assignments (PIM), stale/guest accounts, legacy-auth sign-ins,
      Exchange forwarding/inbox rules, SharePoint external sharing, Teams governance.
- [ ] **Defender incident view**: list and drill-down pages once incidents are persisted.
- [ ] **Scheduled PDF reports** (Executive, Compliance, Identity Risk), stored in MinIO, emailed via channels *(roadmap)*.
- [ ] **Real AI insights**: `AI_PROVIDER=anthropic` is already in `.env`. Use the Anthropic SDK for
      alert triage summaries and a natural-language weekly posture brief. Keep the model configurable.
- [ ] **Demo mode**: a synthetic tenant and data with no Azure needed *(roadmap)*.
- [ ] **SIEM export**: syslog/CEF, Microsoft Sentinel, or S3 WORM audit export *(roadmap v2.0)*.
- [ ] **Certificate-based Graph auth** and Key Vault / Vault secret backends *(roadmap v2.0)*.
- [ ] **Alert correlation**: group related alerts into incidents, with suppression windows.
- [ ] **Agent auto-update channel** *(roadmap)*.
