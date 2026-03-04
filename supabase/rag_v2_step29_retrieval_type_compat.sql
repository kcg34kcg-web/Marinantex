-- ============================================================================
-- Step 29: Retrieval RPC Type Compatibility Patch
-- ============================================================================
-- Purpose:
--   1) Fix hybrid_rrf_search rank-type mismatch by adding rrf_score(bigint, int)
--   2) Remove legacy hybrid_legal_search overloads that break PostgREST RPC
--      resolution (PGRST203).
--   3) Fix hybrid_legal_search return-type mismatch by forcing all score fields
--      to double precision in the SELECT list.
--
-- Safe to re-run (idempotent): uses CREATE OR REPLACE.
-- ============================================================================

BEGIN;

-- row_number() returns bigint; ensure rrf_score accepts it.
CREATE OR REPLACE FUNCTION public.rrf_score(rank int, k int DEFAULT 60)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT 1.0::double precision / (k + rank)::double precision;
$$;

CREATE OR REPLACE FUNCTION public.rrf_score(rank bigint, k int DEFAULT 60)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT 1.0::double precision / (k + rank)::double precision;
$$;

-- Keep a single RPC signature for PostgREST.
DROP FUNCTION IF EXISTS public.hybrid_legal_search(vector, text, uuid, integer);
DROP FUNCTION IF EXISTS public.hybrid_legal_search(vector, text, uuid, integer, date);

CREATE OR REPLACE FUNCTION public.hybrid_legal_search(
    query_embedding  vector(1536),
    query_text       text,
    case_scope       uuid    DEFAULT NULL,
    match_count      int     DEFAULT 12,
    p_event_date     date    DEFAULT NULL,
    p_bureau_id      uuid    DEFAULT NULL
)
RETURNS TABLE (
    id                      uuid,
    case_id                 uuid,
    content                 text,
    file_path               text,
    created_at              timestamptz,
    source_url              text,
    version                 text,
    collected_at            timestamptz,
    court_level             text,
    ruling_date             date,
    citation                text,
    norm_hierarchy          text,
    chamber                 text,
    majority_type           text,
    dissent_present         boolean,
    effective_date          date,
    expiry_date             date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no            text,
    aym_karar_tarihi        date,
    segment_type            text,
    madde_no                text,
    fikra_no                integer,
    bent_no                 text,
    citation_refs           text[],
    semantic_score          double precision,
    keyword_score           double precision,
    recency_score           double precision,
    hierarchy_score         double precision,
    final_score             double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
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
            d.source_url,
            d.version,
            d.collected_at,
            d.court_level,
            d.ruling_date,
            d.citation,
            d.norm_hierarchy,
            d.chamber,
            d.majority_type,
            COALESCE(d.dissent_present, false) AS dissent_present,
            d.effective_date,
            d.expiry_date,
            d.aym_iptal_durumu,
            d.iptal_yururluk_tarihi,
            d.aym_karar_no,
            d.aym_karar_tarihi,
            d.segment_type,
            d.madde_no,
            d.fikra_no,
            d.bent_no,
            d.citation_refs,
            (1 - (d.embedding <=> query_embedding))::double precision AS semantic_score,
            ts_rank_cd(
                d.search_vector,
                plainto_tsquery('turkish', query_text)
            )::double precision AS keyword_score,
            CASE
                WHEN d.ruling_date IS NULL THEN 0.0::double precision
                ELSE GREATEST(
                    0.0::double precision,
                    1.0::double precision
                    - (CURRENT_DATE - d.ruling_date)::double precision
                      / 3650.0::double precision
                )
            END AS recency_score,
            compute_authority_score(
                d.court_level,
                d.majority_type,
                COALESCE(d.dissent_present, false)
            )::double precision AS hierarchy_score
        FROM public.documents d
        WHERE
            (case_scope IS NULL OR d.case_id = case_scope)
            AND (
                p_bureau_id IS NULL
                OR d.bureau_id IS NULL
                OR d.bureau_id = p_bureau_id
            )
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
            AND (d.is_deleted IS NULL OR d.is_deleted = false)
        ORDER BY d.embedding <=> query_embedding
        LIMIT GREATEST(1, match_count) * 3
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
        r.segment_type,
        r.madde_no,
        r.fikra_no,
        r.bent_no,
        r.citation_refs,
        r.semantic_score::double precision,
        r.keyword_score::double precision,
        r.recency_score::double precision,
        r.hierarchy_score::double precision,
        (
            0.45::double precision * r.semantic_score
            + 0.30::double precision * LEAST(r.keyword_score, 1.0::double precision)
            + 0.10::double precision * r.recency_score
            + 0.15::double precision * r.hierarchy_score
        )::double precision AS final_score
    FROM ranked r
    ORDER BY final_score DESC
    LIMIT GREATEST(1, match_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_legal_search(vector, text, uuid, int, date, uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rrf_score(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rrf_score(bigint, int) TO authenticated, service_role;

COMMIT;
