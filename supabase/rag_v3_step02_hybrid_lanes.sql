-- ============================================================================
-- RAG V3 Step 02: Hybrid lanes (dense + sparse) for RRF fusion
-- ============================================================================
-- Adds two retrieval RPCs:
--   1) rag_v3_match_chunks_dense  -> vector-only lane
--   2) rag_v3_match_chunks_sparse -> FTS-only lane
--
-- Service layer fuses both lanes via Reciprocal Rank Fusion (RRF).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_dense(vector, int, text, date, text[], uuid);
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_sparse(text, int, text, date, text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks_dense(
    query_embedding  vector(1536),
    p_top_k          int DEFAULT 50,
    p_jurisdiction   text DEFAULT 'TR',
    p_as_of_date     date DEFAULT NULL,
    p_acl_tags       text[] DEFAULT ARRAY['public']::text[],
    p_bureau_id      uuid DEFAULT NULL
)
RETURNS TABLE (
    chunk_id         uuid,
    document_id      uuid,
    title            text,
    source_type      text,
    source_id        text,
    jurisdiction     text,
    article_no       text,
    clause_no        text,
    subclause_no     text,
    heading_path     text,
    chunk_text       text,
    page_range       text,
    effective_from   date,
    effective_to     date,
    acl_tags         text[],
    doc_hash         text,
    chunk_hash       text,
    semantic_score   double precision,
    keyword_score    double precision,
    final_score      double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
WITH scoped AS (
    SELECT
        c.id AS chunk_id,
        c.document_id,
        d.title,
        d.source_type,
        d.source_id,
        d.jurisdiction,
        c.article_no,
        c.clause_no,
        c.subclause_no,
        c.heading_path,
        c.text AS chunk_text,
        c.page_range,
        COALESCE(c.effective_from, d.effective_from) AS effective_from,
        COALESCE(c.effective_to, d.effective_to) AS effective_to,
        d.acl_tags,
        d.doc_hash,
        c.chunk_hash,
        (1 - (c.embedding <=> query_embedding))::double precision AS semantic_score
    FROM public.rag_chunks c
    JOIN public.rag_documents d ON d.id = c.document_id
    WHERE
        c.embedding IS NOT NULL
        AND (p_jurisdiction IS NULL OR d.jurisdiction = p_jurisdiction)
        AND (
            p_bureau_id IS NULL
            OR d.bureau_id IS NULL
            OR d.bureau_id = p_bureau_id
        )
        AND (
            p_acl_tags IS NULL
            OR array_length(p_acl_tags, 1) IS NULL
            OR d.acl_tags && p_acl_tags
        )
        AND (
            p_as_of_date IS NULL
            OR (
                (COALESCE(c.effective_from, d.effective_from) IS NULL
                    OR COALESCE(c.effective_from, d.effective_from) <= p_as_of_date)
                AND
                (COALESCE(c.effective_to, d.effective_to) IS NULL
                    OR COALESCE(c.effective_to, d.effective_to) >= p_as_of_date)
            )
        )
)
SELECT
    s.chunk_id,
    s.document_id,
    s.title,
    s.source_type,
    s.source_id,
    s.jurisdiction,
    s.article_no,
    s.clause_no,
    s.subclause_no,
    s.heading_path,
    s.chunk_text,
    s.page_range,
    s.effective_from,
    s.effective_to,
    s.acl_tags,
    s.doc_hash,
    s.chunk_hash,
    s.semantic_score,
    0.0::double precision AS keyword_score,
    s.semantic_score AS final_score
FROM scoped s
ORDER BY s.semantic_score DESC
LIMIT GREATEST(1, LEAST(p_top_k, 200));
$$;

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks_sparse(
    query_text       text,
    p_top_k          int DEFAULT 50,
    p_jurisdiction   text DEFAULT 'TR',
    p_as_of_date     date DEFAULT NULL,
    p_acl_tags       text[] DEFAULT ARRAY['public']::text[],
    p_bureau_id      uuid DEFAULT NULL
)
RETURNS TABLE (
    chunk_id         uuid,
    document_id      uuid,
    title            text,
    source_type      text,
    source_id        text,
    jurisdiction     text,
    article_no       text,
    clause_no        text,
    subclause_no     text,
    heading_path     text,
    chunk_text       text,
    page_range       text,
    effective_from   date,
    effective_to     date,
    acl_tags         text[],
    doc_hash         text,
    chunk_hash       text,
    semantic_score   double precision,
    keyword_score    double precision,
    final_score      double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
WITH scoped AS (
    SELECT
        c.id AS chunk_id,
        c.document_id,
        d.title,
        d.source_type,
        d.source_id,
        d.jurisdiction,
        c.article_no,
        c.clause_no,
        c.subclause_no,
        c.heading_path,
        c.text AS chunk_text,
        c.page_range,
        COALESCE(c.effective_from, d.effective_from) AS effective_from,
        COALESCE(c.effective_to, d.effective_to) AS effective_to,
        d.acl_tags,
        d.doc_hash,
        c.chunk_hash,
        CASE
            WHEN COALESCE(NULLIF(btrim(query_text), ''), '') = '' THEN 0.0::double precision
            ELSE ts_rank_cd(c.text_tsv, websearch_to_tsquery('turkish', query_text))::double precision
        END AS keyword_score
    FROM public.rag_chunks c
    JOIN public.rag_documents d ON d.id = c.document_id
    WHERE
        (p_jurisdiction IS NULL OR d.jurisdiction = p_jurisdiction)
        AND (
            p_bureau_id IS NULL
            OR d.bureau_id IS NULL
            OR d.bureau_id = p_bureau_id
        )
        AND (
            p_acl_tags IS NULL
            OR array_length(p_acl_tags, 1) IS NULL
            OR d.acl_tags && p_acl_tags
        )
        AND (
            p_as_of_date IS NULL
            OR (
                (COALESCE(c.effective_from, d.effective_from) IS NULL
                    OR COALESCE(c.effective_from, d.effective_from) <= p_as_of_date)
                AND
                (COALESCE(c.effective_to, d.effective_to) IS NULL
                    OR COALESCE(c.effective_to, d.effective_to) >= p_as_of_date)
            )
        )
)
SELECT
    s.chunk_id,
    s.document_id,
    s.title,
    s.source_type,
    s.source_id,
    s.jurisdiction,
    s.article_no,
    s.clause_no,
    s.subclause_no,
    s.heading_path,
    s.chunk_text,
    s.page_range,
    s.effective_from,
    s.effective_to,
    s.acl_tags,
    s.doc_hash,
    s.chunk_hash,
    0.0::double precision AS semantic_score,
    s.keyword_score,
    s.keyword_score AS final_score
FROM scoped s
WHERE s.keyword_score > 0.0
ORDER BY s.keyword_score DESC
LIMIT GREATEST(1, LEAST(p_top_k, 200));
$$;

GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks_dense(vector, int, text, date, text[], uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks_sparse(text, int, text, date, text[], uuid)
    TO authenticated, service_role;

COMMIT;
