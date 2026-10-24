#!/bin/sh
# Resolves *_FILE environment variables to their file contents at container start.
# Lets you mount secrets via Docker/Podman secrets or Vault Agent instead of .env.
# Usage in Dockerfile ENTRYPOINT: ["/scripts/load-secrets.sh", "your-app", "args"]
for var in $(env | grep '_FILE=' | cut -d= -f1); do
  target="${var%_FILE}"
  path=$(eval echo \$$var)
  if [ -f "$path" ]; then
    export "$target=$(cat "$path")"
  fi
done
exec "$@"
