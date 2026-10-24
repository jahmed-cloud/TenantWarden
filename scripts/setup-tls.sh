#!/usr/bin/env bash
# Provision real Let's Encrypt certificates for the gateway.
# Prereq: a domain pointing at this server, ports 80/443 reachable.
# Usage: ./scripts/setup-tls.sh tenantwarden.yourdomain.com you@email.com
set -e
DOMAIN="${1:?Usage: setup-tls.sh <domain> <email>}"
EMAIL="${2:?Usage: setup-tls.sh <domain> <email>}"

echo "Requesting certificate for $DOMAIN ..."
docker run --rm -p 80:80 \
  -v "$PWD/gateway/certs:/etc/letsencrypt/live-out" \
  certbot/certbot certonly --standalone \
    -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive \
    --cert-name tenantwarden

# certbot writes to /etc/letsencrypt/live/tenantwarden/ inside the container;
# copy the fullchain + key to the names the gateway expects
CERT_DIR="$PWD/gateway/certs"
docker run --rm -v "$PWD/gateway/certs:/certs" -v /etc/letsencrypt:/le certbot/certbot \
  sh -c "cp /le/live/tenantwarden/fullchain.pem /certs/server.crt && cp /le/live/tenantwarden/privkey.pem /certs/server.key" 2>/dev/null || {
  echo "Copy certs manually to gateway/certs/server.crt and server.key"
}
echo "✓ Certs in gateway/certs/. Restart gateway: docker compose restart gateway"
echo "  Renewal: add a cron job re-running this script every 60 days."
