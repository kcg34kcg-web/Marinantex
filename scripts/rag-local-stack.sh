#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.rag-serving.local.yml"

# Docker Desktop ships credential helpers in this directory on macOS.
if [[ -d "/Applications/Docker.app/Contents/Resources/bin" ]]; then
  export PATH="${PATH}:/Applications/Docker.app/Contents/Resources/bin"
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/rag-local-stack.sh <compose-args>"
  echo "Example: scripts/rag-local-stack.sh up -d redis ollama backend-rag"
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" "$@"
