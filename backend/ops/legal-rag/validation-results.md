# Validation Results (2026-03-12)

## Acceptance Runner
- Command:
  - `python3 backend/scripts/legal_rag_acceptance.py --smoke-endpoint-mode auto --artifacts-dir artifacts`
- Result: `pass_all=true`

## Strict Prod Readiness Gate
- Command:
  - `python3 backend/scripts/legal_rag_prod_readiness.py --output artifacts/legal-rag-prod-readiness-report.json`
- Result: `pass_all=false` (expected on this host)
- Blocking checks:
  - `gpu_cuda_available=false` (`nvidia-smi` unavailable)
  - `live_endpoint_health_strict=false` (no live vLLM/SGLang/embedding/reranker endpoints)
  - `acceptance_strict=false` (smoke strict endpoint gate fails)

## GPU Bootstrap Script Validation
- Command:
  - `DRY_RUN=1 backend/scripts/legal_rag_gpu_strict_bootstrap.sh --artifacts-dir artifacts/prod-readiness`
- Result: passed (syntax + command flow validated on non-GPU host)

## Required Acceptance Checks
- 20 TR legal questions hybrid retrieval:
  - `artifacts/legal-rag-eval-report.json` -> `hybrid_retrieval_operational=true`
- Exact article search:
  - `artifacts/legal-rag-eval-report.json` -> `exact_article_search_passed=true`
- Dense vs dense+lexical+rerank:
  - `artifacts/legal-rag-eval-report.json` -> `dense_vs_hybrid_rerank_improved=true`
- OCR + layout on 10 scanned PDFs:
  - `artifacts/legal-rag-smoke-report.json` -> `parser_ocr_layout_10pdf.passed=true` (simulated OCR adapter mode)
- Citation span + page anchor:
  - `artifacts/legal-rag-smoke-report.json` -> `citation_span_page_anchor.passed=true`
- 10-case PII redaction:
  - `artifacts/legal-rag-smoke-report.json` -> `pii_redaction_10cases.passed=true`
- Unsupported claim detection:
  - `artifacts/legal-rag-smoke-report.json` -> `unsupported_claim_detection.passed=true`
- Delta comparison:
  - `artifacts/legal-rag-smoke-report.json` -> `delta_comparison.passed=true`
- vLLM launch recipe:
  - `artifacts/legal-rag-smoke-report.json` -> `vllm_launch_recipe.passed=true` (syntax + dry-run)
- SGLang launch recipe:
  - `artifacts/legal-rag-smoke-report.json` -> `sglang_launch_recipe.passed=true` (syntax + dry-run)
- LLM/embedding/reranker endpoint healthchecks:
  - `artifacts/legal-rag-smoke-report.json` -> `endpoint_healthcheck.passed=true` in `auto` mode (mock fallback)
  - `artifacts/legal-rag-smoke-report-strict.json` -> `endpoint_healthcheck.passed=false` in `strict` mode (no live model servers on this host)

## Regression/Quality Gates
- `python3 -m pytest ...` (8 files, 48 tests) -> all passed.
- `python3 backend/scripts/retrieval_quality_gate.py ...` -> passed.
- `python3 backend/scripts/reranker_calibration_gate.py ...` -> passed.
- `python3 backend/scripts/legal_rag_benchmark.py ...` -> passed.
