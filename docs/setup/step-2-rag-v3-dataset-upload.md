# Step 2 - RAG v3 Dataset Upload and Embedding

Bu dokuman, projede veri setlerini nereye yukleyecegini ve aktif embedding modelini netlestirir.

## 1) Dataset nereye yuklenir?

Not:
- Chat query proxy'si (`POST /api/rag`) artik backend'de `POST /api/v1/rag-v3/query` hattina yonlenir.

### Secenek A - UI (onerilen)
- Panel yolu: `/dashboard/corpus`
- Ekran: `Corpus Yonetimi (Admin)`
- Endpoint: `POST /api/admin/corpus`
- Format: `multipart/form-data`
  - `source_title` zorunlu
  - `source_type` (`legislation|case_law|article|internal_note`)
  - `file` (pdf/txt/md/csv/json/html) veya `raw_text`
  - opsiyonel: `citation`, `norm_hierarchy`, `court_level`, `case_id`, `source_url`

Bu yol, belgeyi RAG ingest hattina gonderir ve otomatik chunk + embedding + indexleme yapar.

### Secenek B - Chat icinden belge yukleme
- Endpoint: `POST /api/rag/upload`
- Akis: hukuk-ai chat icindeki `+ Belge` butonu bu endpointi kullanir.
- Format: `multipart/form-data` (`file`, `file_name`, opsiyonel `case_id`)

### Secenek C - RAG v3 dogrudan ingest API
- Endpoint: `POST /api/rag/v3/ingest`
- Body: JSON (`title`, `source_type`, `source_id`, `raw_text`, `effective_from`, `effective_to`, `acl_tags`, ...)

### Secenek D - Toplu resmi mevzuat import scriptleri
- `npm run import:tbmm:laws`
- `npm run import:mevzuat:laws`

Bu scriptler toplu kanun cekme/import isleri icin kullanilir.

## 2) Veriler nereye yaziliyor?

- Vektor + chunk tablosu: `public.rag_chunks`
- Dokuman metadata: `public.rag_documents`
- Raw payload kopyasi (best effort): Supabase Storage bucket `rag-v3-raw`
  - path formati: `rag-v3/{jurisdiction}/{source_type}/{YYYY-MM-DD}/{source_id}-{doc_hash_prefix}.txt|html`

## 3) Su an hangi embedding modeli aktif?

Backend varsayilani:
- `EMBEDDING_MODEL=text-embedding-3-small`
- `EMBEDDING_DIMENSIONS=1536`

Kaynak:
- `backend/infrastructure/config.py` (`embedding_model`, `embedding_dimensions`)
- `backend/infrastructure/embeddings/embedder.py` (OpenAI Async embeddings client)

Not:
- `lib/rag/hybrid-search.ts` icinde must-cite precompute icin ayri bir varsayilan vardir:
  - `OPENAI_EMBEDDING_MODEL` yoksa `text-embedding-3-large`
  - Bu, ana backend `rag_v3` query hattindan ayridir.

## 4) Embedding modelini degistirmek istersem?

Ornek (bge-m3):
1. `EMBEDDING_MODEL` ve `EMBEDDING_DIMENSIONS` degerlerini guncelle.
2. `rag_chunks.embedding` kolon boyutunu yeni dim ile uyumlu yap (su an `vector(1536)`).
3. Tum chunk embeddinglerini yeniden uret (backfill/re-index).

Kolon boyutu degismeden model degistirmek schema mismatch uretir.
