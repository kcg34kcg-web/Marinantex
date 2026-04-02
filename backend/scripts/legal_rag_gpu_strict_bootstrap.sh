#!/usr/bin/env bash
set -euo pipefail

# One-shot bootstrap for GPU hosts:
# 1) compose config sanity
# 2) start strict serving stack (vLLM + SGLang + embedding + reranker + backend)
# 3) strict endpoint health wait
# 4) strict production-readiness gate

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.rag-serving.yml}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-artifacts/prod-readiness}"
WAIT_TIMEOUT_S="${WAIT_TIMEOUT_S:-900}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-10}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<'EOF'
Usage:
  backend/scripts/legal_rag_gpu_strict_bootstrap.sh [--artifacts-dir <path>] [--wait-timeout-s <seconds>] [--poll-interval-s <seconds>]

Examples:
  backend/scripts/legal_rag_gpu_strict_bootstrap.sh
  ARTIFACTS_DIR=artifacts/prod-readiness backend/scripts/legal_rag_gpu_strict_bootstrap.sh
  DRY_RUN=1 backend/scripts/legal_rag_gpu_strict_bootstrap.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifacts-dir)
      ARTIFACTS_DIR="$2"
      shift 2
      ;;
    --wait-timeout-s)
      WAIT_TIMEOUT_S="$2"
      shift 2
      ;;
    --poll-interval-s)
      POLL_INTERVAL_S="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '+'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

need_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Required command not found: ${cmd}" >&2
    exit 127
  fi
}

if [[ "${DRY_RUN}" != "1" ]]; then
  need_cmd docker
  need_cmd python3
  need_cmd curl
  need_cmd nvidia-smi
fi

cd "${REPO_ROOT}"
mkdir -p "${ARTIFACTS_DIR}"

echo "[1/5] Compose config validation"
run_cmd docker compose -f "${COMPOSE_FILE}" config >/dev/null

echo "[2/5] GPU preflight"
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "+ nvidia-smi"
else
  nvidia-smi >/dev/null
fi

echo "[3/5] Start strict serving stack"
run_cmd docker compose -f "${COMPOSE_FILE}" up -d redis tei-embed vllm backend-rag
run_cmd docker compose -f "${COMPOSE_FILE}" --profile sglang --profile reranker up -d sglang reranker

echo "[4/5] Wait strict endpoint health"
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "+ bash backend/ops/serving/healthcheck.sh"
else
  started_at="$(date +%s)"
  while true; do
    if bash backend/ops/serving/healthcheck.sh >/dev/null 2>&1; then
      break
    fi
    now="$(date +%s)"
    elapsed="$((now - started_at))"
    if (( elapsed >= WAIT_TIMEOUT_S )); then
      echo "Strict endpoint health timed out after ${WAIT_TIMEOUT_S}s" >&2
      docker compose -f "${COMPOSE_FILE}" ps >&2 || true
      exit 1
    fi
    sleep "${POLL_INTERVAL_S}"
  done
fi

echo "[5/5] Run strict production-readiness gate"
run_cmd python3 backend/scripts/legal_rag_prod_readiness.py \
  --output "${ARTIFACTS_DIR}/legal-rag-prod-readiness-report.json" \
  --artifacts-dir "${ARTIFACTS_DIR}"

echo "Strict GPU bootstrap completed."
echo "Report: ${ARTIFACTS_DIR}/legal-rag-prod-readiness-report.json"
