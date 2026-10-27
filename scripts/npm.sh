#!/usr/bin/env sh
# Run npm inside the official Node image, for hosts without Node installed
# (for example a Raspberry Pi that only has Docker).
#   ./scripts/npm.sh install
#   ./scripts/npm.sh test
set -eu
cd "$(dirname "$0")/.."
exec docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app -w /app \
  -e npm_config_cache=/app/.npm-cache \
  -e npm_config_update_notifier=false \
  node:22-bookworm-slim npm "$@"
