#!/usr/bin/env bash
# TenantWarden — generate development TLS certificates
# Usage: ./scripts/generate-certs.sh
set -euo pipefail

CERTS_DIR="gateway/certs"
AGENT_GW_DIR="agent-gateway/certs"

mkdir -p "$CERTS_DIR" "$AGENT_GW_DIR"

echo "🔐 Generating TenantWarden development certificates..."

# ── Root CA ────────────────────────────────────────────────────────────────────
openssl genrsa -out "$CERTS_DIR/ca.key" 4096 2>/dev/null
openssl req -new -x509 -days 3650 -key "$CERTS_DIR/ca.key" \
  -out "$CERTS_DIR/ca.crt" \
  -subj "/CN=TenantWarden Dev CA/O=TenantWarden/C=US" 2>/dev/null
echo "  ✓ Root CA"

# ── Gateway TLS cert ──────────────────────────────────────────────────────────
openssl genrsa -out "$CERTS_DIR/server.key" 4096 2>/dev/null

cat > /tmp/tenantwarden-san.cnf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = tenantwarden.local

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = tenantwarden.local
DNS.2 = localhost
DNS.3 = *.tenantwarden.local
IP.1  = 127.0.0.1
EOF

openssl req -new -key "$CERTS_DIR/server.key" \
  -out /tmp/tenantwarden-server.csr \
  -subj "/CN=tenantwarden.local" 2>/dev/null

openssl x509 -req -days 825 \
  -in /tmp/tenantwarden-server.csr \
  -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial \
  -out "$CERTS_DIR/server.crt" \
  -extensions v3_req -extfile /tmp/tenantwarden-san.cnf 2>/dev/null
echo "  ✓ Gateway TLS certificate"

# ── Agent gateway mTLS cert ───────────────────────────────────────────────────
openssl genrsa -out "$AGENT_GW_DIR/server.key" 4096 2>/dev/null

openssl req -new -key "$AGENT_GW_DIR/server.key" \
  -out /tmp/tenantwarden-agw.csr \
  -subj "/CN=agent-gateway.tenantwarden.local" 2>/dev/null

openssl x509 -req -days 825 \
  -in /tmp/tenantwarden-agw.csr \
  -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial \
  -out "$AGENT_GW_DIR/server.crt" 2>/dev/null

cp "$CERTS_DIR/ca.crt" "$AGENT_GW_DIR/ca.crt"
echo "  ✓ Agent gateway mTLS certificate"

# ── Sample agent client cert ──────────────────────────────────────────────────
AGENT_CERT_DIR="agent/dev-certs"
mkdir -p "$AGENT_CERT_DIR"

openssl genrsa -out "$AGENT_CERT_DIR/agent.key" 4096 2>/dev/null
openssl req -new -key "$AGENT_CERT_DIR/agent.key" \
  -out /tmp/tenantwarden-agent.csr \
  -subj "/CN=dev-agent-001/O=TenantWarden Agent" 2>/dev/null
openssl x509 -req -days 365 \
  -in /tmp/tenantwarden-agent.csr \
  -CA "$CERTS_DIR/ca.crt" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial \
  -out "$AGENT_CERT_DIR/agent.crt" 2>/dev/null
cp "$CERTS_DIR/ca.crt" "$AGENT_CERT_DIR/ca.crt"
echo "  ✓ Sample agent client certificate"

# Cleanup
rm -f /tmp/tenantwarden-san.cnf /tmp/tenantwarden-server.csr /tmp/tenantwarden-agw.csr /tmp/tenantwarden-agent.csr

echo ""
echo "✅ All certificates generated:"
echo "   $CERTS_DIR/server.crt    — nginx TLS"
echo "   $AGENT_GW_DIR/server.crt — agent gateway mTLS"
echo "   $AGENT_CERT_DIR/agent.crt — sample agent cert"
echo ""
echo "⚠️  These are development certs only. Use Let's Encrypt in production."
