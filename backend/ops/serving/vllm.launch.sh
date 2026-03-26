#!/usr/bin/env bash
set -euo pipefail

# Production-first Qwen launch recipe (vLLM primary).
# Fallback chain:
#   1) Qwen/Qwen3.5-397B-A17B
#   2) Qwen/Qwen3.5-122B-A10B
#   3) Qwen/Qwen3.5-35B-A3B  (default production)
#   4) Qwen/Qwen3.5-27B or Qwen/Qwen3.5-9B (dev/test)

MODEL="${VLLM_MODEL:-Qwen/Qwen3.5-35B-A3B}"
SERVED_MODEL="${VLLM_SERVED_MODEL:-qwen3.5-35b-a3b}"
HOST="${VLLM_HOST:-0.0.0.0}"
PORT="${VLLM_PORT:-8008}"
DTYPE="${VLLM_DTYPE:-auto}"
MAX_LEN="${VLLM_MAX_MODEL_LEN:-32768}"
GPU_UTIL="${VLLM_GPU_MEMORY_UTILIZATION:-0.9}"
MAX_BATCHED_TOKENS="${VLLM_MAX_BATCHED_TOKENS:-16384}"
QUANT="${VLLM_QUANTIZATION:-}"

ARGS=(
  --model "$MODEL"
  --served-model-name "$SERVED_MODEL"
  --host "$HOST"
  --port "$PORT"
  --dtype "$DTYPE"
  --max-model-len "$MAX_LEN"
  --gpu-memory-utilization "$GPU_UTIL"
  --max-num-batched-tokens "$MAX_BATCHED_TOKENS"
  --enable-prefix-caching
)

# Optional quantization fallback: fp8, gptq, awq.
if [[ -n "${QUANT}" ]]; then
  ARGS+=(--quantization "$QUANT")
fi

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "python -m vllm.entrypoints.openai.api_server ${ARGS[*]}"
  exit 0
fi

if ! python -c "import vllm" >/dev/null 2>&1; then
  echo "vLLM python package is not available in current environment." >&2
  exit 2
fi

exec python -m vllm.entrypoints.openai.api_server "${ARGS[@]}"
