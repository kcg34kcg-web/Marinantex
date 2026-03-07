# RAG v3 Step07 Snapshot + Revocation Runbook

Bu runbook, `rag_v3_step07_snapshot_revocation_control_plane.sql` migrasyonunu guvenli sekilde dev/stage/prod ortamina alma adimlarini tanimlar.

## 1) On Hazirlik

- `rag_v3` query trafiğini dusuk saatlerde planla.
- DB yedeği al:
  - Supabase: proje backup/export.
  - Self-host: `pg_dump` ile schema+data yedeği.
- Backend release notlari:
  - `backend/application/services/rag_v3_service.py`
  - `backend/infrastructure/rag_v3/repository.py`
  - `backend/api/routes/rag_v3.py`

## 2) SQL Migrasyonunu Uygula

- Dosya: `supabase/rag_v3_step07_snapshot_revocation_control_plane.sql`
- SQL Editor veya migration pipeline ile uygula.
- Beklenen objeler:
  - `public.rag_v3_control_plane` tablosu
  - `idx_rag_v3_control_plane_bureau` indexi
  - `scope_key='global'` seed satiri

## 3) DB Dogrulama (Post-Deploy)

Asagidaki sorgularin basarili olmasi gerekir:

```sql
select scope_key, bureau_id, publish_epoch, revocation_epoch
from public.rag_v3_control_plane
order by scope_key;
```

```sql
select count(*) as docs_with_snapshot
from public.rag_documents
where coalesce((metadata->>'snapshot_id')::int, 0) >= 0;
```

## 4) API Smoke Testleri

- Query:
  - `POST /api/v1/rag-v3/query` isteginde `snapshot_id` opsiyonel calismali.
  - Response alanlari:
    - `snapshot_id`
    - `revocation_epoch`
- Revoke:
  - `POST /api/v1/rag-v3/revoke` ile `action=revoke|tombstone|restore` dene.
  - Islem sonrasi `revocation_epoch` artmali.

## 5) Guvenlik Kontrolleri

- Tenant izolasyonu:
  - `X-Bureau-ID` olmadan hard-fail acik ortamlarda istek reddedilmeli.
- Mid-turn revoke:
  - Uzun bir query calisirken revoke tetiklenirse cevap `no_answer` donmeli.
- Tombstone:
  - Tombstoned belge retrieval sonucundan dusmeli.

## 6) Rollback Plani

- Kod rollback:
  - Snapshot/revoke kullanan backend release onceki tag'e alin.
- DB rollback:
  - Tabloyu silmek yerine kodu fail-open davranisinda onceki surume cek.
  - Gerekirse sadece `rag_v3_control_plane` yazimlarini durdur.
- Trafik normale donunce incident kaydi ac ve postmortem cikar.

## 7) Basari Kriteri

- Query endpointinde `snapshot_id`/`revocation_epoch` tutarli.
- Revoke sonrasi eski evidence ile final cevap uretilmiyor.
- Denetim kayitlarinda provider+snapshot+revocation bilgisi gorunuyor.
