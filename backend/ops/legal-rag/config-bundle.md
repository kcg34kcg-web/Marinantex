# CONFIG BUNDLE

## Requirements / Python
- Primary file: `backend/requirements.txt`
- Added relevant packages:
- `gliner`
- `pillow`
- `pypdfium2`
- `pytesseract`

## Docker Compose
- Primary serving compose: `docker-compose.rag-serving.yml`
- Profiles:
- default: `redis`, `tei-embed`, `vllm`, `backend-rag`
- `sglang`: enables `sglang`
- `reranker`: enables `reranker`

## Environment Examples
- Base backend env: `backend/.env.example`
- Legal-RAG focused env sample: `backend/ops/legal-rag/env/legal-rag.env.example`

## Helm Examples
- `backend/ops/legal-rag/helm/values.dev.yaml`
- `backend/ops/legal-rag/helm/values.staging.yaml`
- `backend/ops/legal-rag/helm/values.prod.yaml`

## Serving Recipes
- vLLM recipe: `backend/ops/serving/vllm.launch.sh`
- SGLang recipe: `backend/ops/serving/sglang.launch.sh`
- Endpoint health checks: `backend/ops/serving/healthcheck.sh`

