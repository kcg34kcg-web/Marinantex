#!/usr/bin/env bash
set -euo pipefail

# Secondary serving recipe (SGLang) for Qwen compatibility/fallback.

MODEL="${SGLANG_MODEL:-Qwen/Qwen3.5-35B-A3B}"
SERVED_MODEL="${SGLANG_SERVED_MODEL:-qwen3.5-35b-a3b}"
HOST="${SGLANG_HOST:-0.0.0.0}"
PORT="${SGLANG_PORT:-30000}"
CONTEXT="${SGLANG_MAX_MODEL_LEN:-32768}"
TP="${SGLANG_TP_SIZE:-1}"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "python -m sglang.launch_server --model-path $MODEL --served-model-name $SERVED_MODEL --host $HOST --port $PORT --context-length $CONTEXT --tp-size $TP --enable-metrics"
  exit 0
fi

if ! python -c "import sglang" >/dev/null 2>&1; then
  echo "SGLang python package is not available in current environment." >&2
  exit 2
fi

exec python -m sglang.launch_server \
  --model-path "$MODEL" \
  --served-model-name "$SERVED_MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --context-length "$CONTEXT" \
  --tp-size "$TP" \
  --enable-metrics
