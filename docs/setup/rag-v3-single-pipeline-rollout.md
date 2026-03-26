# RAG v3 Single Pipeline Staged Rollout (dev -> staging -> prod)

Bu runbook, `rag_v3_single_pipeline_enforced` gecisini kontrollu sekilde uygulamak icin kullanilir.

## 1) Migrations

- `supabase/rag_v3_step10_single_pipeline_rollout.sql`
- Uygulama:
  - `python backend/scripts/apply_rag_v3_migrations.py`

Bu adim `ai_feature_flags` tablosuna `rag_v3_single_pipeline_enforced` kaydini ve stage metadata'sini yazar.

## 2) Stage matrix

- `dev`
  - `RAG_V3_SINGLE_PIPELINE_ENFORCED=false`
  - `RAG_V3_RERANKER_RELEASE_GATE_ENABLED=false`
- `staging`
  - `RAG_V3_SINGLE_PIPELINE_ENFORCED=true`
  - `RAG_V3_RERANKER_RELEASE_GATE_ENABLED=true`
- `prod`
  - `RAG_V3_SINGLE_PIPELINE_ENFORCED=true`
  - `RAG_V3_RERANKER_RELEASE_GATE_ENABLED=true`

## 3) Gate komutu

```bash
python backend/scripts/rag_v3_single_pipeline_rollout_gate.py \
  --stage staging \
  --enforced true \
  --reranker-release-gate true \
  --output backend/single-pipeline-rollout-staging.json
```

- Exit code `0`: stage policy gecti
- Exit code `1`: rollout policy ihlali var, deploy bloklanmali

## 4) CI

CI'da `Single Pipeline Rollout Gate` isi dev/staging/prod matrix'i ile calisir.

- `dev`: legacy route acik
- `staging`: legacy route kapali (tek hat yaklasimi)
- `prod`: legacy route kapali + strict gate zorunlu

## 5) API davranis dogrulama

`RAG_V3_SINGLE_PIPELINE_ENFORCED=true` oldugunda:

- `POST /api/v1/rag/query` -> `410 Gone`
- `POST /api/v1/rag-v3/query` -> aktif production query endpoint

## 6) Rollback

Acil rollback gerekiyorsa:

- `RAG_V3_SINGLE_PIPELINE_ENFORCED=false`
- deploy
- incident notunda kapanis nedeni + etki analizi yaz
