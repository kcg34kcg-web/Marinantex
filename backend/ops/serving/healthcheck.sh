#!/usr/bin/env bash
set -euo pipefail

VLLM_BASE="${VLLM_BASE_URL:-http://127.0.0.1:8008/v1}"
SGLANG_BASE="${SGLANG_BASE_URL:-http://127.0.0.1:30000/v1}"
EMBED_BASE="${EMBEDDING_BASE_URL:-http://127.0.0.1:8081/v1}"
RERANK_BASE="${RERANK_BASE_URL:-http://127.0.0.1:8091/v1}"

echo "[check] vLLM models"
curl -fsS "${VLLM_BASE%/}/models" > /dev/null

echo "[check] SGLang health"
curl -fsS "${SGLANG_BASE%/v1}/health" > /dev/null

echo "[check] embedding health"
curl -fsS "${EMBED_BASE%/v1}/health" > /dev/null

echo "[check] reranker health"
curl -fsS "${RERANK_BASE%/v1}/health" > /dev/null

echo "ok"
