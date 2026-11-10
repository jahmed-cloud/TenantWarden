#!/bin/sh
# The HTTPS listener needs /etc/nginx/certs/server.{crt,key}. When none are mounted (a fresh
# install from Docker Hub), create a self-signed pair so nginx can start; replace it with a real
# certificate later. A read-only mount without the files is left alone and nginx reports the error.
set -eu

dir=/etc/nginx/certs
host="${TW_HOSTNAME:-localhost}"

if [ -s "$dir/server.crt" ] && [ -s "$dir/server.key" ]; then
  exit 0
fi

if ! touch "$dir/.write-test" 2>/dev/null; then
  echo "tenantwarden: $dir has no server.crt/server.key and is read-only" >&2
  exit 0
fi
rm -f "$dir/.write-test"

echo "tenantwarden: no certificate in $dir, creating a self-signed one for $host"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=$host" \
  -addext "subjectAltName=DNS:$host,DNS:localhost,IP:127.0.0.1" \
  -keyout "$dir/server.key" -out "$dir/server.crt" 2>/dev/null
chmod 600 "$dir/server.key"
