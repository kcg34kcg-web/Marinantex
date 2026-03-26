# IMPLEMENTATION PLAN (Idempotent)

## Phase 1 - Audit and Freeze
1. Capture environment, runtime, running services, and model-serving availability.
2. Validate existing RAG v3 modules and keep stable components unchanged.
3. Enumerate missing deliverables and non-breaking additions.

## Phase 2 - Fill Missing Layers/Artifacts
1. Complete planner/rerank/parser/privacy/serving integrations (already applied in code).
2. Produce operational manifests:
- endpoint inventory
- index schemas
- retrieval/rerank/parser pipeline configs
- model manifest (multi-profile)
- env/helm examples
3. Add legal-RAG specific runbook and rollback plan.

## Phase 3 - Acceptance Automation
1. Add evaluation script for 20 Turkish legal questions and dense-vs-hybrid-vs-rerank comparison.
2. Add smoke script for:
- exact article search
- OCR/layout parsing batch
- citation span + page anchor
- PII redaction set
- unsupported claim detection
- delta comparison
- vLLM/SGLang recipe checks
- endpoint health checks
3. Add benchmark script for retrieval/rerank latency and quality trend snapshot.

## Phase 4 - Validation and Handover
1. Run pytest regression for modified modules.
2. Run acceptance/eval/smoke/benchmark scripts and collect artifacts.
3. Publish final manifest and known-risk list with blocked items (if any hardware constraints exist).

