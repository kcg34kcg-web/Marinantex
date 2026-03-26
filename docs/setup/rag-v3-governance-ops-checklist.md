# RAG v3 Governance + Ops Checklist

Bu runbook, RAG v3 icin eksik kalan operasyonel basliklari tek yerde toplar.

## 1) As-Of + Norm + Claim Gates

- Query tarihinde `as_of_date` yoksa sorgu metninden tarih cozulur.
- Retrieval sonrasinda norm-hiyerarsi + lex specialis + lex posterior skoru uygulanir.
- Final cevapta claim-evidence dogrulama calisir.
- Claim destek oranı esik altinda ise cevap `no_answer` olur ve insan incelemesine gider.

## 2) Human Review Queue

- Tablo: `public.rag_v3_review_queue`
- Kullanim: escalated cevaplar otomatik bu kuyruğa yazilir.
- Durumlar: `pending -> in_review -> resolved/rejected`
- Operasyonel API:
  - `GET /api/v1/rag-v3/review-queue`
  - `POST /api/v1/rag-v3/review-queue/{ticket_id}/assign`
  - `POST /api/v1/rag-v3/review-queue/{ticket_id}/close`
- Back-office UI:
  - `GET /api/rag/v3/review-queue`
  - `POST /api/rag/v3/review-queue/{ticketId}/assign`
  - `POST /api/rag/v3/review-queue/{ticketId}/close`
  - Ekran: `dashboard/corpus` altinda assignment + closure aksiyonlari
- Zorunlu alanlar:
  - SLA (`sla_minutes`), `due_at`, `risk_level`, `severity`, `closure_code`
  - `rag_v3_review_require_feedback_on_close=true` ise `reviewer_feedback` zorunlu.

## 3) Retrieval Release Gate

- Script: `backend/scripts/retrieval_quality_gate.py`
- Minimum metrikler:
  - `recall_at_k`
  - `mrr_at_k`
  - `ndcg_at_k`
  - `citation_precision`
- CI adimi: `Retrieval Quality Gate`

## 4) Reranker Calibration Gate

- Script: `backend/scripts/reranker_calibration_gate.py`
- Gercek eval seti: `evals/rag_v3_reranker_calibration_v1.jsonl` (`expert_verified`)
- Metrikler:
  - `top1_accuracy`
  - `mean_margin`
  - `mean_spread`
- Esikler:
  - default: `top1_accuracy>=0.88`, `mean_margin>=0.07`, `mean_spread>=0.05`
  - strict: `top1_accuracy>=0.95`, `mean_margin>=0.11`, `mean_spread>=0.08`
- CI adimi: `Reranker Calibration Gate`

## 5) Prompt Injection Regression Gate

- Script: `backend/scripts/prompt_injection_regression.py`
- Query + context yuzeyinde known-attack setine karsi regresyon kontrolu.
- CI adimi: `Prompt Injection Regression Gate`

## 6) PII / NER Redaction Gate

- Middleware: `backend/api/middleware/privacy_gateway.py`
- Regex + model-assisted NER birlikte calisir.
- Over-redaction korumasi: hukuki kurum terimleri NER maskesine alinmaz.
- Test dosyasi: `backend/tests/test_privacy_ner_gate.py`
- CI adimi: `PII Redaction Regression Gate`

## 7) Tenant Isolation Hard Fail

- `rag_v3` ingest/query endpointleri:
  - `multi_tenancy_enabled=true`
  - `rag_v3_tenant_hard_fail_missing_bureau=true`
  - `is_production=true` (veya `tenant_enforce_in_dev=true`)
- Bu kosullarda `X-Bureau-ID` yoksa istek `401` doner.

## 8) Index Lifecycle

- Tablo: `public.rag_v3_index_registry`
- Aktivasyon fonksiyonu: `public.rag_v3_activate_index(...)`
- CLI:
  - Register: `python backend/scripts/rag_v3_index_lifecycle.py register --index-version ... --embedding-model ... --embedding-dim ...`
  - Activate: `python backend/scripts/rag_v3_index_lifecycle.py activate --index-version ...`
  - Rollback: `python backend/scripts/rag_v3_index_lifecycle.py rollback`
  - List: `python backend/scripts/rag_v3_index_lifecycle.py list`

## 9) DR / Backup-Restore Event Log

- Tablo: `public.rag_v3_dr_events`
- Event tipleri:
  - `backup_started`, `backup_completed`
  - `restore_started`, `restore_completed`
  - `drill`
- RTO/RPO metrikleri bu tabloda tutulur.

## 10) Admission + Budget Guard

- Inflight limit: `rag_v3_max_inflight_requests`
- Queue timeout: `rag_v3_queue_timeout_ms`
- Query size limiti: `rag_v3_admission_max_query_chars`
- Input token tahmin limiti asilirsa tier degrade edilir.

## 11) Feedback Flywheel

- Tablo: `public.rag_v3_feedback_examples`
- Low-quality / escalated cevaplar otomatik capture edilir.
- JSONL export:
  - `python backend/scripts/export_rag_v3_feedback_dataset.py --output artifacts/rag_v3_feedback.jsonl --limit 500 --mark-exported`

## 12) Production Done Criteria

- CI'da `pytest + RAGAS gate + retrieval gate + reranker calibration gate + prompt-injection gate + PII redaction gate` yesil.
- Review queue'da ticket acilip kapanma akisi test edildi.
- Index activate/rollback dry-run tamamlandi.
- Backup/restore drill sonucu `rag_v3_dr_events` tablosuna yazildi.
- Feedback export scripti ile en az 1 batch JSONL uretildi.

## 13) Snapshot + Revoke Deployment

- Ayrintili adimlar:
  - `docs/setup/rag-v3-step07-snapshot-revocation-runbook.md`
- Minimum smoke senaryolari:
  - Ayni query, `snapshot_id` ile iki kez calistirildiginda `snapshot_id` sabit kalmali.
  - `revoke` cagrisi sonrasi yeni query'de `revocation_epoch` artmis donmeli.

## 14) Single Production Pipeline

- `rag_v3_single_pipeline_enforced=true` acildiginda:
  - `POST /api/v1/rag/query` -> `410 Gone`
  - Uretim sorgu hatti tek endpoint olarak `POST /api/v1/rag-v3/query` kalir.
- Staged rollout (dev -> staging -> prod):
  - `dev`: `RAG_V3_SINGLE_PIPELINE_ENFORCED=false` (legacy fallback acik)
  - `staging`: `RAG_V3_SINGLE_PIPELINE_ENFORCED=true` + strict gate'ler zorunlu
  - `prod`: `RAG_V3_SINGLE_PIPELINE_ENFORCED=true` + strict gate + review queue closure smoke gecmis olmali
  - Gate script: `python backend/scripts/rag_v3_single_pipeline_rollout_gate.py --stage <dev|staging|prod> --enforced <true|false> --reranker-release-gate <true|false>`
