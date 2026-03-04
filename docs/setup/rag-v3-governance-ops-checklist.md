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

## 3) Retrieval Release Gate

- Script: `backend/scripts/retrieval_quality_gate.py`
- Minimum metrikler:
  - `recall_at_k`
  - `mrr_at_k`
  - `ndcg_at_k`
  - `citation_precision`
- CI adimi: `Retrieval Quality Gate`

## 4) Prompt Injection Regression Gate

- Script: `backend/scripts/prompt_injection_regression.py`
- Query + context yuzeyinde known-attack setine karsi regresyon kontrolu.
- CI adimi: `Prompt Injection Regression Gate`

## 5) Tenant Isolation Hard Fail

- `rag_v3` ingest/query endpointleri:
  - `multi_tenancy_enabled=true`
  - `rag_v3_tenant_hard_fail_missing_bureau=true`
  - `is_production=true` (veya `tenant_enforce_in_dev=true`)
- Bu kosullarda `X-Bureau-ID` yoksa istek `401` doner.

## 6) Index Lifecycle

- Tablo: `public.rag_v3_index_registry`
- Aktivasyon fonksiyonu: `public.rag_v3_activate_index(...)`
- CLI:
  - Register: `python backend/scripts/rag_v3_index_lifecycle.py register --index-version ... --embedding-model ... --embedding-dim ...`
  - Activate: `python backend/scripts/rag_v3_index_lifecycle.py activate --index-version ...`
  - Rollback: `python backend/scripts/rag_v3_index_lifecycle.py rollback`
  - List: `python backend/scripts/rag_v3_index_lifecycle.py list`

## 7) DR / Backup-Restore Event Log

- Tablo: `public.rag_v3_dr_events`
- Event tipleri:
  - `backup_started`, `backup_completed`
  - `restore_started`, `restore_completed`
  - `drill`
- RTO/RPO metrikleri bu tabloda tutulur.

## 8) Admission + Budget Guard

- Inflight limit: `rag_v3_max_inflight_requests`
- Queue timeout: `rag_v3_queue_timeout_ms`
- Query size limiti: `rag_v3_admission_max_query_chars`
- Input token tahmin limiti asilirsa tier degrade edilir.

## 9) Feedback Flywheel

- Tablo: `public.rag_v3_feedback_examples`
- Low-quality / escalated cevaplar otomatik capture edilir.
- JSONL export:
  - `python backend/scripts/export_rag_v3_feedback_dataset.py --output artifacts/rag_v3_feedback.jsonl --limit 500 --mark-exported`

## 10) Production Done Criteria

- CI'da `pytest + RAGAS gate + retrieval gate + prompt-injection gate` yesil.
- Review queue'da ticket acilip kapanma akisi test edildi.
- Index activate/rollback dry-run tamamlandi.
- Backup/restore drill sonucu `rag_v3_dr_events` tablosuna yazildi.
- Feedback export scripti ile en az 1 batch JSONL uretildi.
