# TenantWarden — Security Audit (self-assessment)

Date: 2026-07 · Scope: source-level review of auth, data access, containers,
network exposure. **Not** a substitute for a professional pen test.

## Verdict
Safe for **LAN / VPN / Tailscale** use today. **Not yet hardened** for direct
public-internet exposure without the v2.0 items in ROADMAP.md.

## ✅ Strengths found
- JWT: issuer/audience/lifetime/signing-key all validated; 30s clock skew
- Passwords: BCrypt (workfactor 12 for user passwords)
- SQL: fully parameterized; dynamic WHERE clauses insert only fixed fragments,
  never user input — no injection surface found
- CORS: origin allowlist (not wildcard), credentials scoped
- Rate limiting: nginx limits login (10/min), API (60/min), agents (300/min)
- Containers: all services run as non-root (frontend fixed this pass)
- Secrets: tenant client secrets AES-256-GCM encrypted at rest
- Security headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy; server_tokens off
- Internal datastores (Postgres/Redis/ClickHouse/MinIO) bound to 127.0.0.1

## ⚠️ Known gaps (fix before public exposure)
| Severity | Gap | Mitigation |
|---|---|---|
| ~~High~~ Mitigated | Secrets in `.env` | `*_FILE` env vars now supported (`scripts/load-secrets.sh`) — mount via Docker secrets or Vault Agent; `.env` remains the easy default for dev |
| ~~High~~ Resolved | Account lockout | Redis-backed: 5 failed attempts per email+IP → 15-min lock (`LoginThrottle.cs`) — already implemented |
| ~~Med~~ Resolved | Self-signed TLS | `scripts/setup-tls.sh` provisions Let's Encrypt certs |
| Med (accepted) | Kafka event bus is a stub | Inter-service traffic stays on the internal Docker bridge network, never exposed. Real Kafka w/ TLS is a v2.0 item — not a live vulnerability in single-host deploys |
| Med | No SSO enforcement / SCIM | Planned v2.0 |
| Low | JWT signing key shared via env | Rotate regularly; per-service keys later |
| Low | No SBOM / dependency scanning in CI | Add `npm audit` / `dotnet list package --vulnerable` to CI |

## Operator hardening checklist
- [ ] Change default admin password (was set in setup)
- [ ] `ufw enable` with only 80/443 (or nothing, if using Tailscale/Cloudflare Tunnel)
- [ ] Real TLS certs in `gateway/certs/`
- [ ] Back up `ENCRYPTION_KEY` (loss = unrecoverable tenant secrets)
- [ ] Rotate all `.env` secrets from the generated defaults
- [ ] Restrict SSH (key-only, no root, fail2ban)
- [ ] Regular `docker compose pull` + rebuild for base-image CVE patches
