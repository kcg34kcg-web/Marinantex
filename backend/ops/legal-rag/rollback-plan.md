# Legal RAG Rollback Plan

## Rollback Principles
- Never drop working production services before standby is healthy.
- Prefer feature-flag rollback over schema rollback.
- Keep data-path backward compatibility (`rag_v3` contract fields remain additive).

## Level 1 - Soft Rollback (No Deploy Revert)
1. Disable new parser orchestration engines:
- `RAG_V3_PARSER_ORCHESTRATION_ENABLED=false`
2. Force local reranker fallback:
- `RAG_V3_RERANKER_PROVIDER=local`
3. Disable GLiNER lane:
- `KVKK_GLINER_ENABLED=false`
4. Keep vLLM as primary and ignore SGLang:
- `QWEN_SERVING_BACKEND=vllm`

## Level 2 - Serving Rollback
1. Stop SGLang/reranker profile containers:
```bash
docker compose -f docker-compose.rag-serving.yml --profile sglang --profile reranker down
```
2. Keep minimal stable stack:
```bash
docker compose -f docker-compose.rag-serving.yml up -d redis tei-embed vllm backend-rag
```

## Level 3 - App Rollback
1. Revert backend deployment image tag to previously known stable tag.
2. Keep database schema untouched if changes are additive.
3. If route-level issue exists, set feature flag:
- `rag_v3_single_pipeline_enforced=false` (temporary)

## Level 4 - Schema Rollback (Last Resort)
- Only if additive schema causes hard failures.
- Use controlled SQL down-migrations approved by DB owner.
- Preserve `rag_query_traces` and review/audit records.

## Post-Rollback Validation
```bash
curl -fsS http://localhost:8000/health
cd backend && pytest tests/test_rag_v3_route_guards.py tests/test_rag_v3_service.py -q
```

