#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend/.env"

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/rag-profile.sh <dev-safe|staging-strict|local-serving-ollama>"
  exit 1
fi

PROFILE_NAME="$1"
PROFILE_FILE="${ROOT_DIR}/backend/env-profiles/${PROFILE_NAME}.env"

python3 "${ROOT_DIR}/backend/scripts/apply_env_profile.py" \
  --env "${ENV_FILE}" \
  --profile "${PROFILE_FILE}"

echo "Active profile: ${PROFILE_NAME}"
