# CURRENT STATE (2026-03-12)

## Environment Discovery
- OS: macOS 26.3.1 (`Darwin 25.3.0`, arm64)
- Host: Apple M4, RAM 16 GB, disk free ~139 GB (`/`)
- Python: 3.9.6 (`/usr/bin/python3`)
- Docker: 29.2.1, Docker Compose v5.0.2
- NVIDIA/CUDA/cuDNN: not available on this host

## Running Core Infrastructure
- `marinantex-postgres` (healthy)
- `marinantex-redis` (healthy)
- `marinantex-minio` (running)

## Model/Serving Runtime Status
- vLLM: not running (no CUDA GPU)
- SGLang: not running (no CUDA GPU)
- TGI/Ollama/llama.cpp: not detected
- Embedding service (TEI): not running currently
- Reranker HTTP service: not running currently

## RAG v3 Codebase Status (Backend)
- Existing and integrated:
  - Query planner/router output schema (`query_class`, route targets, dynamic rerank depth)
  - Dense+lexical hybrid retrieval + exact legal boosting + doc shortlist
  - Claim verification (lexical + semantic fallback)
  - Parser orchestration (MinerU/Docling/PaddleOCR-VL/builtin with fallback)
  - Metadata authority tagging + contract validation
  - Dedup/delta comparison
  - Context summarizer and constrained synthesis support
  - Human review queue endpoints and service methods
  - Qwen serving resolver with vLLM/SGLang dual compatibility
- Added in this remediation window:
  - GLiNER lane in PII/NER pipeline
  - Reversible redaction map secure store abstraction
  - Reranker external HTTP provider path
  - Serving recipes and healthcheck scripts

## Database / Index Layer Status
- Supabase/Postgres schema migration scripts exist up to `rag_v3_step14_*`
- Legal exact lane RPC + doc shortlist RPC defined (`rag_v3_step09_*`)
- Chunk metadata lineage contract migration exists (`rag_v3_step11_*`)
- OpenSearch/Qdrant are not provisioned in this local host; pgvector/supabase route is primary in code

## Validation Runtime Notes
- Smoke endpoint check supports `strict` (live-only) and `auto` (live+mock fallback for local no-GPU hosts).
- On this host, strict mode fails on model endpoint reachability; auto mode passes with mock endpoint fallback.

## Governance / Legal Safety Status
- Legal disclaimer and human responsibility acknowledgement gates enabled in query flow
- Citation core field contract enforcement exists
- Unsupported-claim fallback to safe/no-answer path exists
- Review escalation + reason code generation exists
- Temporal scope fields and revocation/publish epochs are present in pipeline
