# Legal RAG Operations Runbook

## 1. Preflight
1. Validate environment:
```bash
uname -a
python3 --version
docker --version
docker compose version
```
2. Validate compose and env wiring:
```bash
docker compose -f docker-compose.rag-serving.yml config > /tmp/rag-serving.config.yaml
```

## 2. Migration / Schema
```bash
cd backend
python scripts/check_rag_v3_migration_manifest.py
python scripts/apply_rag_v3_migrations.py
```

## 3. Start Serving Stack
- vLLM primary:
```bash
docker compose -f docker-compose.rag-serving.yml up -d redis tei-embed vllm backend-rag
```
- SGLang secondary + reranker profile:
```bash
docker compose -f docker-compose.rag-serving.yml --profile sglang --profile reranker up -d sglang reranker
```
- One-shot strict bootstrap on GPU host:
```bash
backend/scripts/legal_rag_gpu_strict_bootstrap.sh --artifacts-dir artifacts/prod-readiness
```

## 4. Health Checks
```bash
bash backend/ops/serving/healthcheck.sh
curl -fsS http://localhost:8000/health
```

## 5. Regression and Quality Gates
```bash
cd backend
pytest tests/test_rag_v3_planner.py \
       tests/test_rag_v3_source_parser.py \
       tests/test_rag_v3_parser_orchestrator.py \
       tests/test_rag_v3_reranker.py \
       tests/test_rag_v3_new_layers.py \
       tests/test_privacy_ner_gate.py \
       tests/test_pii_ner_gliner.py \
       tests/test_redaction_store.py -q

python scripts/retrieval_quality_gate.py --output ../artifacts/retrieval-quality-report.json
python scripts/reranker_calibration_gate.py --allow-synthetic-fallback --output ../artifacts/reranker-calibration-report.json
python scripts/legal_rag_eval.py --output ../artifacts/legal-rag-eval-report.json
python scripts/legal_rag_smoke.py --endpoint-mode strict --output ../artifacts/legal-rag-smoke-report.json
python scripts/legal_rag_benchmark.py --output ../artifacts/legal-rag-benchmark-report.json
python scripts/legal_rag_acceptance.py --smoke-endpoint-mode strict --artifacts-dir ../artifacts
```

Single-command strict readiness gate:
```bash
python scripts/legal_rag_prod_readiness.py --output ../artifacts/legal-rag-prod-readiness-report.json
```

For local/macOS environments without live vLLM/SGLang/embedding/reranker services:
```bash
python scripts/legal_rag_smoke.py --endpoint-mode auto --output ../artifacts/legal-rag-smoke-report.json
python scripts/legal_rag_acceptance.py --smoke-endpoint-mode auto --artifacts-dir ../artifacts
```

## 6. Runtime Governance Checks
- Enforce legal disclaimer/human responsibility gates in query requests.
- Block final answers when unsupported claims are detected.
- Ensure citations include source/article/page anchors.
- Route low-confidence outputs to review queue.

## 7. Incident Handling
- If reranker endpoint fails: set `RAG_V3_RERANKER_PROVIDER=local` or `auto`.
- If OCR quality drops: force parser fallback order to `docling,builtin` temporarily.
- If claim verification spikes fail: enable stricter no-answer mode and review queue escalation.
