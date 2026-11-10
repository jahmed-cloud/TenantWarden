#!/usr/bin/env bash
# Builds the TenantWarden images and pushes them to a registry (Docker Hub by default), tagged
# with the version and "latest". deploy/docker-compose.yml runs these images.
#
#   scripts/publish-images.sh 1.0.0              build and push
#   PUSH=0 scripts/publish-images.sh 1.0.0       build and tag only
#   REGISTRY=ghcr.io/you scripts/publish-images.sh 1.0.0
#
# Images build one at a time (parallel builds crash Docker Desktop) for linux/amd64.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-1.0.0}"
REGISTRY="${REGISTRY:-docker.io/jahmed22}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-1}"

# Published images must match a commit
if [ "$PUSH" = 1 ] && [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != 1 ]; then
  echo "Working tree has uncommitted changes; commit first (or ALLOW_DIRTY=1)." >&2
  exit 1
fi

REVISION="$(git rev-parse HEAD)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Directory = image suffix. plugin-engine is left out: it only lists an empty registry.
IMAGES=(gateway frontend api auth-service agent-gateway collector-service alert-engine
        notification-service analytics-engine scheduler postgres clickhouse)

for dir in "${IMAGES[@]}"; do
  image="$REGISTRY/tenantwarden-$dir"
  echo "==> $image:$VERSION"
  extra=()
  [ "$dir" = frontend ] && extra+=(--target production)
  docker build "${extra[@]}" --platform "$PLATFORM" \
    --label "org.opencontainers.image.title=TenantWarden $dir" \
    --label "org.opencontainers.image.description=TenantWarden: self-hosted security monitoring for Microsoft 365" \
    --label "org.opencontainers.image.url=https://tenantwarden.org" \
    --label "org.opencontainers.image.source=https://github.com/jahmed-cloud/TenantWarden" \
    --label "org.opencontainers.image.licenses=MIT" \
    --label "org.opencontainers.image.version=$VERSION" \
    --label "org.opencontainers.image.revision=$REVISION" \
    --label "org.opencontainers.image.created=$CREATED" \
    -t "$image:$VERSION" -t "$image:latest" "$dir"
done

if [ "$PUSH" = 1 ]; then
  for dir in "${IMAGES[@]}"; do
    image="$REGISTRY/tenantwarden-$dir"
    docker push "$image:$VERSION"
    docker push "$image:latest"
  done
  echo "Pushed ${#IMAGES[@]} images to $REGISTRY (tags $VERSION, latest)"
fi
