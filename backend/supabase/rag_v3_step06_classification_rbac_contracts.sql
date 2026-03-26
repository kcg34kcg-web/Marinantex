-- ============================================================================
-- RAG V3 Step 06: Classification RBAC + retrieval contract hardening
-- ============================================================================
-- Covers:
--   1) Mandatory document classification taxonomy
--   2) Classification-aware retrieval RPC signatures
--   3) Classification filter parameter for role-based access scoping
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_documents
    ADD COLUMN IF NOT EXISTS classification text;

UPDATE public.rag_documents
SET classification = CASE
    WHEN upper(coalesce(metadata->>'classification', '')) IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SENSITIVE')
        THEN upper(metadata->>'classification')
    WHEN acl_tags && ARRAY['public']::text[] THEN 'PUBLIC'
    WHEN acl_tags && ARRAY['sensitive']::text[] THEN 'SENSITIVE'
    WHEN acl_tags && ARRAY['confidential']::text[] THEN 'CONFIDENTIAL'
    ELSE 'INTERNAL'
END
WHERE classification IS NULL
   OR btrim(classification) = '';

ALTER TABLE public.rag_documents
    ALTER COLUMN classification SET DEFAULT 'INTERNAL';

UPDATE public.rag_documents
SET classification = 'INTERNAL'
WHERE classification IS NULL
   OR btrim(classification) = '';

ALTER TABLE public.rag_documents
    ALTER COLUMN classification SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_rag_documents_classification'
    ) THEN
        ALTER TABLE public.rag_documents
            ADD CONSTRAINT chk_rag_documents_classification
            CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SENSITIVE'));
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_rag_documents_classification
    ON public.rag_documents (classification);

-- ---------------------------------------------------------------------------
-- Classification-aware baseline RPC
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks(vector, text, int, text, date, text[], uuid);
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks(vector, text, int, text, date, text[], text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks(
    query_embedding  vector(1536),
    query_text       text,
    p_top_k          int DEFAULT 10,
    p_jurisdiction   text DEFAULT 'TR',
    p_as_of_date     date DEFAULT NULL,
    p_acl_tags       text[] DEFAULT ARRAY['public']::text[],
    p_allowed_classifications text[] DEFAULT ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE']::text[],
    p_bureau_id      uuid DEFAULT NULL
)
RETURNS TABLE (
    chunk_id         uuid,
    document_id      uuid,
    title            text,
    source_type      text,
    source_id        text,
    classification   text,
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
        d.classification,
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
        (1 - (c.embedding <=> query_embedding))::double precision AS semantic_score,
        CASE
            WHEN COALESCE(NULLIF(btrim(query_text), ''), '') = '' THEN 0.0::double precision
            ELSE ts_rank_cd(c.text_tsv, websearch_to_tsquery('turkish', query_text))::double precision
        END AS keyword_score
    FROM public.rag_chunks c
    JOIN public.rag_documents d
      ON d.id = c.document_id
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
            p_allowed_classifications IS NULL
            OR array_length(p_allowed_classifications, 1) IS NULL
            OR d.classification = ANY (p_allowed_classifications)
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
    s.classification,
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
    s.keyword_score,
    (
        (0.80::double precision * s.semantic_score)
        + (0.20::double precision * LEAST(s.keyword_score, 1.0::double precision))
    )::double precision AS final_score
FROM scoped s
ORDER BY final_score DESC
LIMIT GREATEST(1, LEAST(p_top_k, 50));
$$;

-- ---------------------------------------------------------------------------
-- Classification-aware dense lane RPC
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_dense(vector, int, text, date, text[], uuid);
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_dense(vector, int, text, date, text[], text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks_dense(
    query_embedding  vector(1536),
    p_top_k          int DEFAULT 50,
    p_jurisdiction   text DEFAULT 'TR',
    p_as_of_date     date DEFAULT NULL,
    p_acl_tags       text[] DEFAULT ARRAY['public']::text[],
    p_allowed_classifications text[] DEFAULT ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE']::text[],
    p_bureau_id      uuid DEFAULT NULL
)
RETURNS TABLE (
    chunk_id         uuid,
    document_id      uuid,
    title            text,
    source_type      text,
    source_id        text,
    classification   text,
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
        d.classification,
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
            p_allowed_classifications IS NULL
            OR array_length(p_allowed_classifications, 1) IS NULL
            OR d.classification = ANY (p_allowed_classifications)
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
    s.classification,
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

-- ---------------------------------------------------------------------------
-- Classification-aware sparse lane RPC
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_sparse(text, int, text, date, text[], uuid);
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_sparse(text, int, text, date, text[], text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks_sparse(
    query_text       text,
    p_top_k          int DEFAULT 50,
    p_jurisdiction   text DEFAULT 'TR',
    p_as_of_date     date DEFAULT NULL,
    p_acl_tags       text[] DEFAULT ARRAY['public']::text[],
    p_allowed_classifications text[] DEFAULT ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE']::text[],
    p_bureau_id      uuid DEFAULT NULL
)
RETURNS TABLE (
    chunk_id         uuid,
    document_id      uuid,
    title            text,
    source_type      text,
    source_id        text,
    classification   text,
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
        d.classification,
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
            p_allowed_classifications IS NULL
            OR array_length(p_allowed_classifications, 1) IS NULL
            OR d.classification = ANY (p_allowed_classifications)
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
    s.classification,
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

GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks(vector, text, int, text, date, text[], text[], uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks_dense(vector, int, text, date, text[], text[], uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks_sparse(text, int, text, date, text[], text[], uuid)
    TO authenticated, service_role;

COMMIT;
