# CHANGES APPLIED

## Planner / Router
- `backend/infrastructure/rag_v3/planner.py`
- Added query class taxonomy (8 classes), route targets, and dynamic rerank cutoff output.
- Added planner outputs used by retrieval execution metadata.

## RAG Service Integration
- `backend/application/services/rag_v3_service.py`
- Wired planner `rerank_top_n` into rerank execution path.
- Wired parser orchestration into ingest flow.

## Parser / OCR / Layout
- `backend/infrastructure/rag_v3/parser_orchestrator.py` (new)
- Engine order orchestration: MinerU -> Docling -> PaddleOCR-VL -> builtin.
- Fallback-safe behavior and parser engine warning trace.
- `backend/infrastructure/rag_v3/source_parser.py`
- Added `eml`, `zip`, and image OCR ingest support.

## PII / Redaction / NER
- `backend/infrastructure/security/redaction_store.py` (new)
- Added reversible redaction map store abstraction with TTL and optional encryption.
- `backend/infrastructure/security/pii_ner.py`
- Added GLiNER optional detection lane.
- `backend/api/middleware/privacy_gateway.py`
- Added reversible/irreversible mode routing and secure map-store integration.
- `backend/ops/policies/redaction-policy.yaml` (new)

## Reranker
- `backend/infrastructure/rag_v3/reranker.py`
- Added external HTTP reranker provider support (`/rerank` and `/v1/rerank` compatibility).

## Qwen Serving Layer
- `backend/infrastructure/serving/qwen_deployment.py`
- Added primary/secondary backend metadata and metrics URL support.
- `docker-compose.rag-serving.yml`
- Added SGLang profile service and reranker service profile.
- Added backend env wiring for serving/reranker endpoint configuration.
- `backend/ops/serving/vllm.launch.sh` (new)
- `backend/ops/serving/sglang.launch.sh` (new)
- `backend/ops/serving/healthcheck.sh` (new)

## Configuration / Dependencies
- `backend/infrastructure/config.py`
- Added parser orchestration, GLiNER, redaction map, reranker HTTP provider, and serving env fields.
- `backend/.env.example`
- Added new env examples for serving/reranker/parser/privacy lanes.
- `backend/requirements.txt`
- Added OCR/NER dependencies (`gliner`, `pillow`, `pypdfium2`, `pytesseract`).

## Validation / Acceptance Tooling
- `backend/scripts/legal_rag_eval.py` (new)
- Added deterministic 20-question TR legal retrieval evaluation (dense vs hybrid vs hybrid+rerank) + exact article search check.
- `backend/scripts/legal_rag_smoke.py` (new)
- Added parser/OCR, citation anchors, PII redaction, claim verification, delta, serving recipe, and endpoint health checks.
- Added endpoint healthcheck modes: `strict` (live-only), `auto` (live then mock fallback), `mock`.
- `backend/scripts/legal_rag_benchmark.py` (new)
- Added repeated eval latency metrics (`p50/p95/avg`) + quality summary.
- `backend/scripts/legal_rag_acceptance.py` (new)
- Added one-shot acceptance runner; forwards smoke endpoint mode.
- `backend/scripts/legal_rag_prod_readiness.py` (new)
- Added strict production-readiness single-command gate (compose config, GPU/CUDA check, strict endpoint health, strict quality gates, strict acceptance).
- `backend/scripts/legal_rag_gpu_strict_bootstrap.sh` (new)
- Added one-shot GPU bootstrap script to bring up strict serving stack and execute strict production-readiness report end-to-end.

## Tests Added/Updated
- `backend/tests/test_rag_v3_parser_orchestrator.py`
- `backend/tests/test_pii_ner_gliner.py`
- `backend/tests/test_redaction_store.py`
- `backend/tests/test_rag_v3_source_parser.py`
- `backend/tests/test_privacy_ner_gate.py`
- `backend/tests/test_rag_v3_planner.py`
- `backend/tests/test_rag_v3_reranker.py`
- `backend/tests/test_rag_v3_new_layers.py`
