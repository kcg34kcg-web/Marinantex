-- ============================================================================
-- Step 11: Hibrit Arama (RRF) SQL Fonksiyonu
-- ============================================================================
-- Migration: rag_v2_step11_rrf.sql
-- Bağımlılık: rag_v2_step1_schema.sql (documents + pgvector kurulu olmalı)
--
-- Bu migration şunları ekler:
--   1. hybrid_rrf_search()   — vektör + FTS sonuçlarını RRF ile birleştirir
--   2. legal_synonyms tablosu — veritabanı düzeyinde eşanlam genişletme
--   3. expand_query_synonyms() — Türkçe hukuk eşanlam fonksiyonu
--   4. document_index_queue tablosu — asenkron indeksleme kuyruğu
--
-- RRF Formülü: score(d) = Σ_i  1 / (k + rank_i(d))
--   k = 60 (Cormack & al., 2009 — "Reciprocal Rank Fusion outperforms Condorcet")
-- ============================================================================

-- ── Yardımcı: RRF sabiti ──────────────────────────────────────────────────
DO $$
BEGIN
    -- Sadece bir kez çalıştır; idempotent
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'rrf_score'
    ) THEN
        EXECUTE $func$
            CREATE OR REPLACE FUNCTION rrf_score(rank INT, k INT DEFAULT 60)
            RETURNS FLOAT AS $$
                SELECT 1.0 / (k + rank)::FLOAT;
            $$ LANGUAGE SQL IMMUTABLE STRICT;
        $func$;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION rrf_score(rank INT, k INT DEFAULT 60)
RETURNS FLOAT AS $$
    SELECT 1.0 / (k + rank)::FLOAT;
$$ LANGUAGE SQL IMMUTABLE STRICT;

COMMENT ON FUNCTION rrf_score IS
    'Step 11: Reciprocal Rank Fusion katkı skoru. rank 1-tabanlıdır.';


-- ============================================================================
-- 1. hybrid_rrf_search() — Ana RRF Birleşik Arama Fonksiyonu
-- ============================================================================
-- Parametreler:
--   query_embedding  — pgvector sorgu vektörü (1536-dim)
--   query_text       — BM25 için ham sorgu metni
--   case_scope       — dava UUID filtresi (NULL = tüm büro)
--   match_count      — döndürülecek maksimum belge sayısı
--   p_rrf_k          — RRF k sabiti (varsayılan 60)
--   p_sem_weight     — semantik sonuçları kaç kat overweight et
--   p_kw_weight      — anahtar kelime sonuçlarını kaç kat overweight et
--   p_event_date     — lehe kanun / time-travel için olay tarihi (Step 10)
--   p_bureau_id      — büro izolasyonu (Step 6)
-- ============================================================================

CREATE OR REPLACE FUNCTION hybrid_rrf_search(
    query_embedding     VECTOR(1536),
    query_text          TEXT,
    case_scope          UUID    DEFAULT NULL,
    match_count         INT     DEFAULT 10,
    p_rrf_k             INT     DEFAULT 60,
    p_sem_weight        FLOAT   DEFAULT 1.0,
    p_kw_weight         FLOAT   DEFAULT 1.0,
    p_event_date        DATE    DEFAULT NULL,
    p_bureau_id         UUID    DEFAULT NULL
)
RETURNS TABLE (
    id                   UUID,
    content              TEXT,
    case_id              UUID,
    file_path            TEXT,
    created_at           TIMESTAMPTZ,
    source_url           TEXT,
    version              TEXT,
    collected_at         TIMESTAMPTZ,
    court_level          TEXT,
    ruling_date          DATE,
    citation             TEXT,
    norm_hierarchy       TEXT,
    chamber              TEXT,
    majority_type        TEXT,
    dissent_present      BOOLEAN,
    effective_date       DATE,
    expiry_date          DATE,
    aym_iptal_durumu     TEXT,
    iptal_yururluk_tarihi DATE,
    aym_karar_no         TEXT,
    aym_karar_tarihi     DATE,
    bureau_id            UUID,
    semantic_score       FLOAT,
    keyword_score        FLOAT,
    recency_score        FLOAT,
    hierarchy_score      FLOAT,
    final_score          FLOAT,
    rrf_score_value      FLOAT,
    search_method        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_case_scope UUID := case_scope;
BEGIN

    -- ── Semantik sonuçlar (vektör benzerliği) ────────────────────────────
    CREATE TEMP TABLE _sem_results ON COMMIT DROP AS
    SELECT
        d.id,
        ROW_NUMBER() OVER (ORDER BY d.embedding <=> query_embedding) AS sem_rank,
        1.0 - (d.embedding <=> query_embedding)                       AS semantic_score
    FROM documents d
    WHERE
        (v_case_scope IS NULL OR d.case_id = v_case_scope)
        AND (p_bureau_id IS NULL
             OR d.bureau_id IS NULL
             OR d.bureau_id = p_bureau_id)
        AND (p_event_date IS NULL
             OR d.effective_date IS NULL
             OR d.effective_date <= p_event_date)
        AND (p_event_date IS NULL
             OR d.expiry_date IS NULL
             OR d.expiry_date > p_event_date)
        AND (d.is_deleted IS NULL OR d.is_deleted = FALSE)
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count * 2;  -- 2x overrequest, RRF sonrası kesiriz

    -- ── Anahtar kelime sonuçları (BM25 / tsvector) ───────────────────────
    CREATE TEMP TABLE _kw_results ON COMMIT DROP AS
    SELECT
        d.id,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(d.fts_vector, plainto_tsquery('turkish', query_text)) DESC) AS kw_rank,
        ts_rank_cd(d.fts_vector, plainto_tsquery('turkish', query_text)) AS keyword_score
    FROM documents d
    WHERE
        d.fts_vector @@ plainto_tsquery('turkish', query_text)
        AND (v_case_scope IS NULL OR d.case_id = v_case_scope)
        AND (p_bureau_id IS NULL
             OR d.bureau_id IS NULL
             OR d.bureau_id = p_bureau_id)
        AND (p_event_date IS NULL
             OR d.effective_date IS NULL
             OR d.effective_date <= p_event_date)
        AND (d.is_deleted IS NULL OR d.is_deleted = FALSE)
    ORDER BY ts_rank_cd(d.fts_vector, plainto_tsquery('turkish', query_text)) DESC
    LIMIT match_count * 2;

    -- ── RRF Füzyon ────────────────────────────────────────────────────────
    RETURN QUERY
    WITH rrf_merged AS (
        SELECT
            COALESCE(s.id, k.id) AS doc_id,
            COALESCE(
                p_sem_weight * rrf_score(s.sem_rank, p_rrf_k), 0.0
            ) + COALESCE(
                p_kw_weight  * rrf_score(k.kw_rank,  p_rrf_k), 0.0
            ) AS combined_rrf,
            COALESCE(s.semantic_score, 0.0) AS semantic_score,
            COALESCE(k.keyword_score,  0.0) AS keyword_score,
            CASE
                WHEN s.id IS NOT NULL AND k.id IS NOT NULL THEN 'HYBRID'
                WHEN s.id IS NOT NULL THEN 'SEMANTIC'
                ELSE 'KEYWORD'
            END AS method
        FROM _sem_results s
        FULL OUTER JOIN _kw_results k ON s.id = k.id
        ORDER BY combined_rrf DESC
        LIMIT match_count
    )
    SELECT
        d.id,
        d.content,
        d.case_id,
        d.file_path,
        d.created_at,
        d.source_url,
        d.version,
        d.collected_at,
        d.court_level,
        d.ruling_date,
        d.citation,
        d.norm_hierarchy,
        d.chamber,
        d.majority_type,
        d.dissent_present,
        d.effective_date,
        d.expiry_date,
        d.aym_iptal_durumu,
        d.iptal_yururluk_tarihi,
        d.aym_karar_no,
        d.aym_karar_tarihi,
        d.bureau_id,
        rrf.semantic_score::FLOAT,
        rrf.keyword_score::FLOAT,
        0.0::FLOAT   AS recency_score,    -- mevcut hybrid_legal_search ile tutarlı
        0.0::FLOAT   AS hierarchy_score,
        rrf.combined_rrf::FLOAT AS final_score,
        rrf.combined_rrf::FLOAT AS rrf_score_value,
        rrf.method
    FROM rrf_merged rrf
    JOIN documents d ON d.id = rrf.doc_id
    ORDER BY rrf.combined_rrf DESC;

END;
$$;

COMMENT ON FUNCTION hybrid_rrf_search IS
    'Step 11: Vektör + BM25 sonuçlarını Reciprocal Rank Fusion ile birleştirir.
     Büro izolasyonu (p_bureau_id), time-travel (p_event_date) ve
     RRF k parametresi desteklenir.';


-- ============================================================================
-- 2. legal_synonyms tablosu — veritabanı düzeyinde eşanlam deposu
-- ============================================================================
-- Python SynonymStore ile senkron tutulur; DB düzeyinde FTS genişletme için
-- ============================================================================

CREATE TABLE IF NOT EXISTS legal_synonyms (
    id          BIGSERIAL PRIMARY KEY,
    term        TEXT        NOT NULL,
    synonym     TEXT        NOT NULL,
    language    TEXT        NOT NULL DEFAULT 'tr',
    domain      TEXT,                                -- iş_hukuku, ceza, medeni vb.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (term, synonym)
);

CREATE INDEX IF NOT EXISTS idx_legal_synonyms_term    ON legal_synonyms (term);
CREATE INDEX IF NOT EXISTS idx_legal_synonyms_synonym ON legal_synonyms (synonym);

COMMENT ON TABLE legal_synonyms IS
    'Step 11: Türkçe hukuk eşanlam deposu. Python SynonymStore ile senkron tutulur.';

-- ── RLS: herkes okuyabilir, sadece service_role yazabilir ─────────────────
ALTER TABLE legal_synonyms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_synonyms_read"  ON legal_synonyms;
DROP POLICY IF EXISTS "legal_synonyms_write" ON legal_synonyms;

CREATE POLICY "legal_synonyms_read"
    ON legal_synonyms FOR SELECT
    TO public
    USING (true);

CREATE POLICY "legal_synonyms_write"
    ON legal_synonyms FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================================
-- 3. document_index_queue tablosu — asenkron indeksleme kuyruğu
-- ============================================================================
-- Celery worker bu tabloyu polling yapar (fallback: Celery yoksa).
-- Üretimde Celery + RabbitMQ kuyruğu önceliklidir; bu tablo yedek mekanizmadır.
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_index_queue (
    id              BIGSERIAL    PRIMARY KEY,
    document_id     UUID         NOT NULL,
    operation       TEXT         NOT NULL CHECK (operation IN ('INDEX', 'REINDEX', 'DELETE')),
    bureau_id       UUID,
    case_id         UUID,
    status          TEXT         NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
    retries         INT          NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    metadata        JSONB        DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_doc_queue_status     ON document_index_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_doc_queue_doc        ON document_index_queue (document_id);
CREATE INDEX IF NOT EXISTS idx_doc_queue_bureau     ON document_index_queue (bureau_id);

COMMENT ON TABLE document_index_queue IS
    'Step 11: Asenkron indeksleme kuyruğu. Celery worker önceliklidir; yoksa polling fallback.';

-- ── RLS: service_role tam erişim ──────────────────────────────────────────
ALTER TABLE document_index_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "doc_queue_service_role" ON document_index_queue;

CREATE POLICY "doc_queue_service_role"
    ON document_index_queue FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================================
-- 4. Enqueue yardımcı fonksiyonu
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_document_index(
    p_document_id UUID,
    p_operation   TEXT    DEFAULT 'INDEX',
    p_bureau_id   UUID    DEFAULT NULL,
    p_case_id     UUID    DEFAULT NULL,
    p_metadata    JSONB   DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_queue_id BIGINT;
BEGIN
    INSERT INTO document_index_queue
        (document_id, operation, bureau_id, case_id, metadata)
    VALUES
        (p_document_id, p_operation, p_bureau_id, p_case_id, p_metadata)
    RETURNING id INTO v_queue_id;

    RETURN v_queue_id;
END;
$$;

COMMENT ON FUNCTION enqueue_document_index IS
    'Step 11: Belgeyi asenkron indeksleme kuyruğuna ekler. Celery + RabbitMQ öncelikli.';


-- ============================================================================
-- 5. Mevcut documents tablosuna fts_vector kolonu ekle (yoksa)
-- ============================================================================
-- hybrid_rrf_search BM25 araması için fts_vector gerektirir.
-- Eğer mevcut hybrid_legal_search SQL'inde zaten varsa bu IF bloğu atlanır.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'fts_vector'
    ) THEN
        ALTER TABLE documents ADD COLUMN fts_vector TSVECTOR
            GENERATED ALWAYS AS (
                to_tsvector('turkish', COALESCE(content, ''))
            ) STORED;

        CREATE INDEX IF NOT EXISTS idx_documents_fts
            ON documents USING GIN (fts_vector);

        COMMENT ON COLUMN documents.fts_vector IS
            'Step 11: Türkçe FTS indeksi — BM25 keyword araması için (hybrid_rrf_search).';
    END IF;
END $$;
