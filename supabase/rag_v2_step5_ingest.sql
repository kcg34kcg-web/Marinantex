-- =============================================================================
-- RAG V2.1 — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
-- =============================================================================
-- Purpose:
--   Adds ingest/parsing metadata columns to the documents table so that each
--   parsed segment (MADDE, FIKRA, ICTIHAT_HEADER, etc.) can be stored with
--   full structural context.  Also creates a document_citations table for
--   normalised citation tracking.
--
-- New columns on documents:
--   segment_type  text     — SegmentType enum value (MADDE, FIKRA, ICTIHAT_BODY…)
--   madde_no      text     — Article number "17", "17/A" (NULL for içtihat)
--   fikra_no      integer  — Paragraph number within article (NULL if not split)
--   bent_no       text     — Sub-item letter "a", "b" (NULL if not applicable)
--   citation_refs text[]   — Array of raw citation strings found in the segment
--
-- New table: document_citations
--   Normalised citation records extracted by CitationExtractor.
--   Each citation links back to the source document row.
--
-- Updated function: hybrid_legal_search
--   Returns the five new ingest columns.
--
-- Rollback section at the bottom (commented out).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add ingest columns to documents table
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS segment_type  text,
    ADD COLUMN IF NOT EXISTS madde_no      text,
    ADD COLUMN IF NOT EXISTS fikra_no      integer,
    ADD COLUMN IF NOT EXISTS bent_no       text,
    ADD COLUMN IF NOT EXISTS citation_refs text[];

-- CHECK constraint: only allow recognised SegmentType values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'documents_segment_type_check'
    ) THEN
        ALTER TABLE public.documents
            ADD CONSTRAINT documents_segment_type_check
            CHECK (
                segment_type IS NULL
                OR segment_type IN (
                    'MADDE',
                    'FIKRA',
                    'ICTIHAT_HEADER',
                    'ICTIHAT_BODY',
                    'ICTIHAT_HUKUM',
                    'FULL'
                )
            );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Indexes for ingest columns
-- ---------------------------------------------------------------------------

-- Filter by segment type (e.g. retrieve only MADDE segments)
CREATE INDEX IF NOT EXISTS idx_documents_segment_type
    ON public.documents (segment_type)
    WHERE segment_type IS NOT NULL;

-- Filter by article number within a case
CREATE INDEX IF NOT EXISTS idx_documents_madde_no
    ON public.documents (case_id, madde_no)
    WHERE madde_no IS NOT NULL;

-- GIN index for citation_refs array search
CREATE INDEX IF NOT EXISTS idx_documents_citation_refs
    ON public.documents USING GIN (citation_refs)
    WHERE citation_refs IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. document_citations table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_citations (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid         NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    citation_type   text         NOT NULL,   -- CitationType value
    raw_text        text         NOT NULL,   -- matched citation text as it appears
    kanun_no        text,                    -- "4857"
    madde_ref       text,                    -- "17", "17/1"
    court_name      text,                    -- "Yargıtay 9. HD"
    esas_no         text,                    -- "2023/1234"
    karar_no        text,                    -- "2024/5678"
    char_start      integer,                 -- character offset in segment text
    char_end        integer,
    created_at      timestamptz  NOT NULL DEFAULT now()
);

-- CHECK: allowed citation types
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_citations_type_check'
    ) THEN
        ALTER TABLE public.document_citations
            ADD CONSTRAINT document_citations_type_check
            CHECK (
                citation_type IN (
                    'KANUN_NO',
                    'MADDE_REF',
                    'YARGITAY',
                    'DANISTAY',
                    'AYM',
                    'RESMI_GAZETE',
                    'UNKNOWN'
                )
            );
    END IF;
END;
$$;

-- Indexes on citations
CREATE INDEX IF NOT EXISTS idx_document_citations_document_id
    ON public.document_citations (document_id);

CREATE INDEX IF NOT EXISTS idx_document_citations_kanun_no
    ON public.document_citations (kanun_no)
    WHERE kanun_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_citations_court_name
    ON public.document_citations (court_name)
    WHERE court_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_citations_esas_no
    ON public.document_citations (esas_no)
    WHERE esas_no IS NOT NULL;

-- RLS (inherit from documents table policy)
ALTER TABLE public.document_citations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Update hybrid_legal_search to surface Step 5 ingest columns
-- ---------------------------------------------------------------------------

-- Drop the existing 5-arg signature so the expanded return type can be applied.
DROP FUNCTION IF EXISTS public.hybrid_legal_search(vector, text, uuid, integer, date);

CREATE OR REPLACE FUNCTION public.hybrid_legal_search(
    query_embedding  vector(1536),
    query_text       text,
    case_scope       uuid    DEFAULT NULL,
    match_count      int     DEFAULT 12,
    p_event_date     date    DEFAULT NULL   -- Step 4: optional time-travel date
)
RETURNS TABLE (
    -- Identity
    id                      uuid,
    case_id                 uuid,
    content                 text,
    file_path               text,
    created_at              timestamptz,
    -- Step 2: Provenance
    source_url              text,
    version                 text,
    collected_at            timestamptz,
    -- Classification
    court_level             text,
    ruling_date             date,
    citation                text,
    norm_hierarchy          text,
    -- Step 3: Authority
    chamber                 text,
    majority_type           text,
    dissent_present         boolean,
    -- Step 4: Versioning + AYM cancellation
    effective_date          date,
    expiry_date             date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no            text,
    aym_karar_tarihi        date,
    -- Step 5: Ingest / Parsing metadata  (NEW)
    segment_type            text,
    madde_no                text,
    fikra_no                integer,
    bent_no                 text,
    citation_refs           text[],
    -- Scores
    semantic_score          float,
    keyword_score           float,
    recency_score           float,
    hierarchy_score         float,
    final_score             float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT
            d.id,
            d.case_id,
            d.content,
            d.file_path,
            d.created_at,
            -- Provenance
            d.source_url,
            d.version,
            d.collected_at,
            -- Classification
            d.court_level,
            d.ruling_date,
            d.citation,
            d.norm_hierarchy,
            -- Authority (Step 3)
            d.chamber,
            d.majority_type,
            COALESCE(d.dissent_present, false)  AS dissent_present,
            -- Versioning (Step 4)
            d.effective_date,
            d.expiry_date,
            d.aym_iptal_durumu,
            d.iptal_yururluk_tarihi,
            d.aym_karar_no,
            d.aym_karar_tarihi,
            -- Ingest metadata (Step 5)
            d.segment_type,
            d.madde_no,
            d.fikra_no,
            d.bent_no,
            d.citation_refs,
            -- Scores
            1 - (d.embedding <=> query_embedding)                   AS semantic_score,
            ts_rank_cd(d.search_vector, plainto_tsquery('turkish', query_text)) AS keyword_score,
            CASE
                WHEN d.ruling_date IS NULL THEN 0.0
                ELSE GREATEST(0.0, 1.0 - (CURRENT_DATE - d.ruling_date)::float / 3650.0)
            END                                                      AS recency_score,
            compute_authority_score(
                d.court_level, d.majority_type,
                COALESCE(d.dissent_present, false)
            )                                                        AS hierarchy_score
        FROM public.documents d
        WHERE
            (case_scope IS NULL OR d.case_id = case_scope)
            AND (
                p_event_date IS NULL
                OR public.is_provision_effective_on(
                    d.effective_date,
                    d.expiry_date,
                    d.aym_iptal_durumu,
                    d.iptal_yururluk_tarihi,
                    p_event_date
                )
            )
        ORDER BY d.embedding <=> query_embedding
        LIMIT match_count * 3
    )
    SELECT
        r.id, r.case_id, r.content, r.file_path, r.created_at,
        r.source_url, r.version, r.collected_at,
        r.court_level, r.ruling_date, r.citation, r.norm_hierarchy,
        r.chamber, r.majority_type, r.dissent_present,
        r.effective_date, r.expiry_date, r.aym_iptal_durumu,
        r.iptal_yururluk_tarihi, r.aym_karar_no, r.aym_karar_tarihi,
        -- Step 5 ingest columns
        r.segment_type,
        r.madde_no,
        r.fikra_no,
        r.bent_no,
        r.citation_refs,
        r.semantic_score,
        r.keyword_score,
        r.recency_score,
        r.hierarchy_score,
        0.45 * r.semantic_score
        + 0.30 * LEAST(r.keyword_score, 1.0)
        + 0.10 * r.recency_score
        + 0.15 * r.hierarchy_score AS final_score
    FROM ranked r
    ORDER BY final_score DESC
    LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Comments on new columns
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.documents.segment_type IS
    'Step 5: Structural segment type. One of: MADDE, FIKRA, ICTIHAT_HEADER, ICTIHAT_BODY, ICTIHAT_HUKUM, FULL.';

COMMENT ON COLUMN public.documents.madde_no IS
    'Step 5: Article number extracted by LegalParser, e.g. "17" or "17/A". NULL for içtihat segments.';

COMMENT ON COLUMN public.documents.fikra_no IS
    'Step 5: Paragraph number within article (1-based). NULL for MADDE-level and içtihat segments.';

COMMENT ON COLUMN public.documents.bent_no IS
    'Step 5: Sub-item letter, e.g. "a", "b". NULL when not applicable.';

COMMENT ON COLUMN public.documents.citation_refs IS
    'Step 5: Array of raw citation strings extracted by CitationExtractor from this segment.';

COMMENT ON TABLE public.document_citations IS
    'Step 5: Normalised citation records extracted from documents by CitationExtractor.';

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

GRANT ALL ON TABLE public.document_citations TO service_role;
GRANT SELECT ON TABLE public.document_citations TO authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_legal_search(vector, text, uuid, int, date)
    TO authenticated, service_role;

-- =============================================================================
-- ROLLBACK (run to undo — keep commented in production):
-- =============================================================================
-- DROP TABLE IF EXISTS public.document_citations;
-- ALTER TABLE public.documents
--     DROP CONSTRAINT IF EXISTS documents_segment_type_check,
--     DROP COLUMN IF EXISTS segment_type,
--     DROP COLUMN IF EXISTS madde_no,
--     DROP COLUMN IF EXISTS fikra_no,
--     DROP COLUMN IF EXISTS bent_no,
--     DROP COLUMN IF EXISTS citation_refs;
