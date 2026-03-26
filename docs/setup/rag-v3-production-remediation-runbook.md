# RAG v3 Production Remediation Runbook

## 1) Migration Integrity Gate

```bash
cd backend
python scripts/check_rag_v3_migration_manifest.py
python scripts/apply_rag_v3_migrations.py
```

Beklenen: `step01 -> step13` uygulanır ve `RAG v3 migrations applied successfully.` döner.

## 2) Runtime Security Contract Gate

```bash
cd backend
python -m pytest tests/test_security_runtime_contract.py -q
```

Beklenen: TLS/KMS/rotation evidence kontrat testleri yeşil geçer.

## 3) Prompt Registry + Alert Contract Gate

```bash
cd backend
python scripts/validate_prompt_registry.py --path prompts/rag_v3/registry.json
python scripts/validate_rag_v3_alert_rules.py --path ops/rag_v3_alert_rules.json
```

Beklenen: iki komut da `OK` döner.

## 4) Official Source Freshness Smoke

```bash
cd backend
python scripts/official_source_freshness_scheduler.py \
  --registry ../docs/compliance/official-source-registry.json \
  --dry-run \
  --fail-on-error \
  --output official-source-freshness-report.json
```

Beklenen: `error=0` ve JSON raporu üretilir.

## 5) Query Trace Audit Completeness

```bash
cd backend
python -m pytest tests/test_rag_v3_repository.py tests/test_rag_v3_route_guards.py -q
```

Beklenen: trace alanları (`legal_disclaimer_ack`, `review_required`, `low_confidence`, `source_documents`, `query_expansion`) regressionsuz kalır.

## 6) End-to-End Smoke (Route + Disclaimer + Citation Contract)

```bash
cd backend
python -m pytest tests/test_rag_v3_route_guards.py -q
```

Beklenen: disclaimer ack yoksa `422`, route fail-open ve citation contract warningleri response’da korunur.
