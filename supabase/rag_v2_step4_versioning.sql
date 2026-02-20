-- =============================================================================
-- RAG V2.1 — Step 4: Granüler Sürümleme + AYM İptal Yönetimi
-- =============================================================================
-- Purpose:
--   Adds six versioning / AYM-cancellation columns to the documents table
--   and updates both the hybrid_legal_search and get_must_cite_documents
--   functions to expose those columns to the Python retrieval layer.
--
-- New columns (all nullable — existing rows default to NULL / in-force):
--   effective_date          date     — when this madde/fıkra/bent entered force
--   expiry_date             date     — when superseded/repealed (NULL = still active)
--   aym_iptal_durumu        text     — AYM cancellation status (see CHECK constraint)
--   iptal_yururluk_tarihi   date     — when the cancellation takes effect
--   aym_karar_no            text     — AYM decision number
--   aym_karar_tarihi        date     — date of the AYM decision
--
-- Time-travel:
--   hybrid_legal_search gains a new optional p_event_date date parameter.
--   When provided, results are filtered to documents in force on that date:
--     effective_date <= p_event_date  AND  (expiry_date IS NULL OR expiry_date > p_event_date)
--   AYM-cancelled provisions whose iptal_yururluk_tarihi has passed are also
--   excluded from time-travel results (they were not in force on p_event_date).
--
-- Rollback:
--   See the DROP section at the bottom of this file (commented out).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add versioning columns to documents table
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS effective_date          date,
    ADD COLUMN IF NOT EXISTS expiry_date             date,
    ADD COLUMN IF NOT EXISTS aym_iptal_durumu        text,
    ADD COLUMN IF NOT EXISTS iptal_yururluk_tarihi   date,
    ADD COLUMN IF NOT EXISTS aym_karar_no            text,
    ADD COLUMN IF NOT EXISTS aym_karar_tarihi        date;

-- CHECK constraint: only allow recognised AYM status strings
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'documents_aym_iptal_durumu_check'
    ) THEN
        ALTER TABLE public.documents
            ADD CONSTRAINT documents_aym_iptal_durumu_check
            CHECK (
                aym_iptal_durumu IS NULL
                OR aym_iptal_durumu IN (
                    'YURURLUKTE',
                    'IPTAL_EDILDI',
                    'IPTAL_EDILDI_ERTELENDI',
                    'KISMI_IPTAL'
                )
            );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Indexes for common query patterns
-- ---------------------------------------------------------------------------

-- Partial index: quickly find cancelled provisions (warning surface)
CREATE INDEX IF NOT EXISTS idx_documents_aym_iptal
    ON public.documents (aym_iptal_durumu)
    WHERE aym_iptal_durumu IS NOT NULL
      AND aym_iptal_durumu <> 'YURURLUKTE';

-- Index for time-travel range scans
CREATE INDEX IF NOT EXISTS idx_documents_effective_expiry
    ON public.documents (effective_date, expiry_date);

-- ---------------------------------------------------------------------------
-- 3. Helper function: is_provision_effective_on(row, check_date)
--    Returns TRUE when the document row is in legal force on check_date.
--    Used inside hybrid_legal_search for time-travel filtering.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_provision_effective_on(
    p_effective_date        date,
    p_expiry_date           date,
    p_aym_iptal_durumu      text,
    p_iptal_yururluk_tarihi date,
    p_check_date            date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Not yet enacted
    IF p_effective_date IS NOT NULL AND p_effective_date > p_check_date THEN
        RETURN false;
    END IF;

    -- Superseded by a later amendment
    IF p_expiry_date IS NOT NULL AND p_expiry_date <= p_check_date THEN
        RETURN false;
    END IF;

    -- AYM cancellation that was already in force on p_check_date
    IF p_aym_iptal_durumu IN ('IPTAL_EDILDI', 'IPTAL_EDILDI_ERTELENDI') THEN
        IF p_iptal_yururluk_tarihi IS NULL THEN
            -- Immediate cancellation — treat as not effective
            RETURN false;
        END IF;
        IF p_iptal_yururluk_tarihi <= p_check_date THEN
            -- Grace period had already expired on p_check_date
            RETURN false;
        END IF;
    END IF;

    -- All checks passed — document was in force on p_check_date
    RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Update hybrid_legal_search to surface Step 4 columns + time-travel
-- ---------------------------------------------------------------------------

-- Drop both the old 4-arg signature (Step 3) and the new 5-arg signature so
-- CREATE OR REPLACE can freely change the return type.
DROP FUNCTION IF EXISTS public.hybrid_legal_search(vector, text, uuid, integer);
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

    -- Step 4: Versioning + AYM cancellation  (NEW)
    effective_date          date,
    expiry_date             date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no            text,
    aym_karar_tarihi        date,

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
            -- Step 4: time-travel filter — only include docs in force on p_event_date
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
        LIMIT match_count * 3          -- over-fetch for keyword re-ranking headroom
    )
    SELECT
        r.id,
        r.case_id,
        r.content,
        r.file_path,
        r.created_at,
        r.source_url,
        r.version,
        r.collected_at,
        r.court_level,
        r.ruling_date,
        r.citation,
        r.norm_hierarchy,
        r.chamber,
        r.majority_type,
        r.dissent_present,
        r.effective_date,
        r.expiry_date,
        r.aym_iptal_durumu,
        r.iptal_yururluk_tarihi,
        r.aym_karar_no,
        r.aym_karar_tarihi,
        r.semantic_score,
        r.keyword_score,
        r.recency_score,
        r.hierarchy_score,
        -- Preliminary final_score (Python recomputes with config weights)
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
-- 5. Update get_must_cite_documents to also return Step 4 columns
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_must_cite_documents(uuid);

CREATE OR REPLACE FUNCTION public.get_must_cite_documents(
    p_case_id uuid
)
RETURNS TABLE (
    -- Identity
    id                      uuid,
    case_id                 uuid,
    content                 text,
    file_path               text,
    created_at              timestamptz,

    -- Provenance
    source_url              text,
    version                 text,
    collected_at            timestamptz,

    -- Classification
    court_level             text,
    ruling_date             date,
    citation                text,
    norm_hierarchy          text,

    -- Authority (Step 3)
    chamber                 text,
    majority_type           text,
    dissent_present         boolean,

    -- Versioning (Step 4)
    effective_date          date,
    expiry_date             date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no            text,
    aym_karar_tarihi        date,

    -- Dummy scores (must-cites bypass the scoring pipeline)
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
    SELECT
        d.id,
        d.case_id,
        d.content,
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
        COALESCE(d.dissent_present, false)  AS dissent_present,
        -- Step 4: versioning columns
        d.effective_date,
        d.expiry_date,
        d.aym_iptal_durumu,
        d.iptal_yururluk_tarihi,
        d.aym_karar_no,
        d.aym_karar_tarihi,
        -- Placeholder scores — retrieval_client recomputes the real final_score
        0.0::float AS semantic_score,
        0.0::float AS keyword_score,
        0.0::float AS recency_score,
        compute_authority_score(
            d.court_level, d.majority_type,
            COALESCE(d.dissent_present, false)
        )          AS hierarchy_score,
        compute_authority_score(
            d.court_level, d.majority_type,
            COALESCE(d.dissent_present, false)
        )          AS final_score
    FROM public.documents d
    INNER JOIN public.case_must_cites mc
        ON mc.document_id = d.id
       AND mc.case_id = p_case_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (maintain existing row-level security)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.is_provision_effective_on(date, date, text, date, date)
    TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.hybrid_legal_search(vector, text, uuid, int, date)
    TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_must_cite_documents(uuid)
    TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Comment on new columns
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.documents.effective_date IS
    'Step 4: Date this madde/fıkra/bent entered into legal force. NULL = unknown.';

COMMENT ON COLUMN public.documents.expiry_date IS
    'Step 4: Date this version was superseded or repealed. NULL = still in force.';

COMMENT ON COLUMN public.documents.aym_iptal_durumu IS
    'Step 4: AYM cancellation status. One of: YURURLUKTE, IPTAL_EDILDI, IPTAL_EDILDI_ERTELENDI, KISMI_IPTAL. NULL = no cancellation.';

COMMENT ON COLUMN public.documents.iptal_yururluk_tarihi IS
    'Step 4: Date the AYM cancellation takes effect (Anayasa md. 153/3 erteleme). NULL = immediate cancellation.';

COMMENT ON COLUMN public.documents.aym_karar_no IS
    'Step 4: AYM decision number, e.g. "2023/45 E., 2024/78 K.".';

COMMENT ON COLUMN public.documents.aym_karar_tarihi IS
    'Step 4: Date the AYM issued its cancellation decision.';

-- =============================================================================
-- ROLLBACK (run to undo — keep commented in production):
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.is_provision_effective_on(date, date, text, date, date);
-- ALTER TABLE public.documents
--     DROP CONSTRAINT IF EXISTS documents_aym_iptal_durumu_check,
--     DROP COLUMN IF EXISTS effective_date,
--     DROP COLUMN IF EXISTS expiry_date,
--     DROP COLUMN IF EXISTS aym_iptal_durumu,
--     DROP COLUMN IF EXISTS iptal_yururluk_tarihi,
--     DROP COLUMN IF EXISTS aym_karar_no,
--     DROP COLUMN IF EXISTS aym_karar_tarihi;
