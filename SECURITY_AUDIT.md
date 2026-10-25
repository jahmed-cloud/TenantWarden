# TenantWarden — Security Audit (self-assessment)

Updated 2026-10-25 · Scope: source-level review of authentication, authorisation, data access, agent transport,
containers and network exposure. **Not** a substitute for a professional penetration test.

## Verdict

Suitable for **LAN / VPN / Tailscale** deployments. **Not yet hardened** for direct exposure to the internet:
see the gaps below and the v2.0 items in [ROADMAP.md](ROADMAP.md).

## Controls in place

- **Tokens:** HS256 JWTs with issuer, audience, lifetime and signing key validated (30 s skew). User tokens
  (`tenantwarden-api`) and agent enrollment tokens (`tenantwarden-agent`) can't stand in for each other.
  Access tokens last 15 minutes and live in browser memory only; refresh tokens are httpOnly, SameSite=Strict
  cookies scoped to `/auth` and are **single-use** (rotated on every refresh, reuse rejected).
- **Passwords:** BCrypt (work factor 12), minimum 12 characters, temporary passwords must be changed at first sign-in.
- **Account lockout:** 5 failed passwords **or TOTP codes** per email + client IP → 15-minute lock (Redis).
- **API keys:** 256-bit random, stored as SHA-256, sent as `X-API-Key`, revocable; they carry the owner's role and tenant.
- **Authorisation:** role lists on every mutating endpoint; strict tenant isolation (every role except
  super_admin is pinned to its own tenant; other tenants' records return 404).
- **Audit log:** every authenticated change in the API and auth-service, and every sign-in, with IP and user agent.
- **Agents:** the gateway requires a tenant-bound enrollment token, binds each agent ID to its first tenant,
  overwrites the identity fields in every forwarded message, caps message size (1 MB), and keeps its internal
  endpoints behind a shared token. Tokens are revocable. The agent's config file is readable by root/SYSTEM and
  Administrators only.
- **SQL:** fully parameterised; dynamic fragments are fixed strings, never user input.
- **Secrets at rest:** tenant client secrets AES-256-GCM encrypted; decryption fails loudly on a key mismatch.
- **Network:** nginx rate limits (login 10/min, API 60/min, agents), security headers (HSTS, X-Frame-Options DENY,
  nosniff, Referrer-Policy, Permissions-Policy), `server_tokens off`; Postgres/Redis/ClickHouse bound to 127.0.0.1.
  Real client IPs come from `X-Forwarded-For` with a forward limit of 1.
- **Containers:** services run as non-root.

## Known gaps

| Severity | Gap | Plan |
|---|---|---|
| High | Plain HTTP on port 80 serves the whole app (no redirect) | Redirect to HTTPS or close port 80 in production |
| Medium | No mutual TLS for agents (token auth only) | v2.0 |
| Medium | Secrets live in `.env`; `*_FILE` Docker secrets are not wired into the images | v2.0 |
| Medium | TOTP secrets and notification channel configs are stored in plaintext | Encrypt like tenant secrets |
| Medium | Password step and MFA step aren't bound by a server-side challenge | Opaque challenge after the password step |
| Medium | `must_change_password` is enforced by the UI, not the API | Enforce in the auth pipeline |
| Medium | Webhook "signature" header carries the raw shared secret | HMAC-SHA256 of the body |
| Low | One JWT signing key shared by all services | Per-service keys; rotation runbook |
| Low | `/downloads/` sets its own headers, dropping the server-level security headers | Repeat them in the location |
| Low | No dependency scanning or SBOM in CI | `npm audit`, `dotnet list package --vulnerable`, `govulncheck` |
| Info | Microsoft Entra SSO endpoint exists but can't validate Microsoft tokens | Fixed before SSO ships; the portal doesn't offer it |

## Operator hardening checklist

- [ ] Change the default admin password (forced at first sign-in) and turn on two-step sign-in
- [ ] Real TLS certificates (`scripts/setup-tls.sh`) and no plain-HTTP exposure
- [ ] Firewall: only 443 (and 4433 if agents connect directly), or nothing behind Tailscale / Cloudflare Tunnel
- [ ] Back up `ENCRYPTION_KEY` (losing it makes tenant secrets unrecoverable)
- [ ] Rotate every `.env` secret from the generated defaults
- [ ] Revoke agent enrollment tokens you no longer need (Agents → Enrollment tokens)
- [ ] Review the audit log (Admin → Audit log) regularly
- [ ] Rebuild regularly for base-image CVE patches
