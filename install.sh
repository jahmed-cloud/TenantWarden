#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  TenantWarden — one-command installer
#  Usage:  ./install.sh
# ═══════════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
say() { echo -e "${BLUE}▶ $1${NC}"; }
ok()  { echo -e "${GREEN}✓ $1${NC}"; }

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║        TenantWarden Installer          ║"
echo "  ║  M365 Security Monitoring Platform    ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Preflight ────────────────────────────────────────────────────────────────
command -v docker >/dev/null || { echo "Docker not found. Install Docker first."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 not found."; exit 1; }
ok "Docker and Compose detected"

# ── Environment ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  say "Generating secure credentials (.env)…"
  make setup-env
else
  ok ".env already exists — keeping it"
fi

# ── TLS (dev certs) ──────────────────────────────────────────────────────────
if [ ! -f gateway/certs/server.crt ]; then
  say "Generating development TLS certificates…"
  make certs
else
  ok "TLS certs present"
fi

# ── Build ────────────────────────────────────────────────────────────────────
say "Building all service images (first run: 5–8 min)…"
make build
ok "Images built"

# ── Start ────────────────────────────────────────────────────────────────────
say "Starting the platform…"
make up

say "Waiting for databases to initialise…"
sleep 25

# ── Seed (schema + sample data + default admin) ──────────────────────────────
say "Applying schema, sample data, and default admin…"
make seed
ok "Database ready"

# ── Restart gateway (picks up fresh container IPs) ───────────────────────────
docker compose restart gateway >/dev/null 2>&1 || true

# ── Summary ──────────────────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  TenantWarden is running!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  Dashboard:  ${BLUE}http://${IP:-localhost}:8090${NC}"
echo ""
echo -e "  ${YEL}Default login (you MUST change on first sign-in):${NC}"
echo -e "    Email:    admin@tenantwarden.local"
echo -e "    Password: TenantWarden!"
echo ""
echo -e "  Next steps:"
echo -e "    • Connect a real M365 tenant  → Tenants page"
echo -e "    • Enable email alerts         → set SMTP_* in .env"
echo -e "    • Go online securely          → see README (Tailscale / Cloudflare)"
echo -e "    • Production TLS              → ./scripts/setup-tls.sh <domain> <email>"
echo ""
echo -e "  Manage: ${BLUE}make ps${NC} · ${BLUE}make logs${NC} · ${BLUE}make health${NC} · ${BLUE}make down${NC}"
echo ""
