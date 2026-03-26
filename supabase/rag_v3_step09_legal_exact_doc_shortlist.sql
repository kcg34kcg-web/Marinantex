-- ============================================================================
-- RAG V3 Step 09: Exact legal retrieval lane + doc-level shortlist RPC
-- ============================================================================
-- Adds:
--   1) rag_v3_match_chunks_legal_exact (deterministic legal lexical/citation lane)
--   2) rag_v3_doc_shortlist (document-level retrieval pre-filter)
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rag_v3_match_chunks_legal_exact(text, int, text, date, text[], text[], uuid);
DROP FUNCTION IF EXISTS public.rag_v3_doc_shortlist(vector, text, int, text, date, text[], text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks_legal_exact(
    query_text                text,
    p_top_k                   int DEFAULT 24,
    p_jurisdiction            text DEFAULT 'TR',
    p_as_of_date              date DEFAULT NULL,
    p_acl_tags                text[] DEFAULT ARRAY['public']::text[],
    p_allowed_classifications text[] DEFAULT ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE']::text[],
    p_bureau_id               uuid DEFAULT NULL
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
WITH hints AS (
    SELECT
        COALESCE(NULLIF(btrim(query_text), ''), '')                                                   AS q,
        lower(COALESCE((regexp_match(lower(query_text), '(?:madde|md\\.?)[[:space:]]*([0-9]+[a-z0-9/.-]*)'))[1], '')) AS article_hint,
        COALESCE((regexp_match(lower(query_text), '(?:fikra|f\\.?)[[:space:]]*([0-9]+)'))[1], '')  AS clause_hint,
        COALESCE((regexp_match(query_text, '\\b(\\d{3,5})\\b'))[1], '')                         AS source_id_hint,
        COALESCE((regexp_match(query_text, '(?:E\\.|Esas[[:space:]]*No[:[:space:]]*)[[:space:]]*([0-9]{4}/[0-9]+)'))[1], '') AS esas_hint,
        COALESCE((regexp_match(query_text, '(?:K\\.|Karar[[:space:]]*No[:[:space:]]*)[[:space:]]*([0-9]{4}/[0-9]+)'))[1], '') AS karar_hint
), scoped AS (
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
        h.q,
        h.article_hint,
        h.clause_hint,
        h.source_id_hint,
        h.esas_hint,
        h.karar_hint,
        CASE
            WHEN h.q = '' THEN 0.0::double precision
            ELSE ts_rank_cd(c.text_tsv, websearch_to_tsquery('turkish', h.q))::double precision
        END AS fts_score
    FROM public.rag_chunks c
    JOIN public.rag_documents d ON d.id = c.document_id
    CROSS JOIN hints h
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
), scored AS (
    SELECT
        s.*,
        (
            CASE WHEN s.article_hint <> '' AND lower(COALESCE(s.article_no, '')) = s.article_hint THEN 0.44 ELSE 0.0 END
            + CASE WHEN s.clause_hint <> '' AND COALESCE(s.clause_no, '') = s.clause_hint THEN 0.20 ELSE 0.0 END
            + CASE WHEN s.source_id_hint <> '' AND COALESCE(s.source_id, '') = s.source_id_hint THEN 0.24 ELSE 0.0 END
            + CASE
                WHEN s.esas_hint <> ''
                     AND s.karar_hint <> ''
                     AND s.chunk_text ~* ('E\\.\\s*' || regexp_replace(s.esas_hint, '/', '\\/', 'g'))
                     AND s.chunk_text ~* ('K\\.\\s*' || regexp_replace(s.karar_hint, '/', '\\/', 'g'))
                    THEN 0.40
                WHEN s.esas_hint <> ''
                     AND s.chunk_text ~* ('E\\.\\s*' || regexp_replace(s.esas_hint, '/', '\\/', 'g'))
                    THEN 0.22
                WHEN s.karar_hint <> ''
                     AND s.chunk_text ~* ('K\\.\\s*' || regexp_replace(s.karar_hint, '/', '\\/', 'g'))
                    THEN 0.22
                ELSE 0.0
              END
            + LEAST(s.fts_score, 1.0::double precision) * 0.34
        )::double precision AS exact_score
    FROM scoped s
)
SELECT
    sc.chunk_id,
    sc.document_id,
    sc.title,
    sc.source_type,
    sc.source_id,
    sc.classification,
    sc.jurisdiction,
    sc.article_no,
    sc.clause_no,
    sc.subclause_no,
    sc.heading_path,
    sc.chunk_text,
    sc.page_range,
    sc.effective_from,
    sc.effective_to,
    sc.acl_tags,
    sc.doc_hash,
    sc.chunk_hash,
    0.0::double precision AS semantic_score,
    sc.exact_score         AS keyword_score,
    sc.exact_score         AS final_score
FROM scored sc
WHERE sc.exact_score > 0.05
ORDER BY sc.exact_score DESC
LIMIT GREATEST(1, LEAST(p_top_k, 200));
$$;

CREATE OR REPLACE FUNCTION public.rag_v3_doc_shortlist(
    query_embedding          vector(1536),
    query_text               text,
    p_doc_k                  int DEFAULT 12,
    p_jurisdiction           text DEFAULT 'TR',
    p_as_of_date             date DEFAULT NULL,
    p_acl_tags               text[] DEFAULT ARRAY['public']::text[],
    p_allowed_classifications text[] DEFAULT ARRAY['PUBLIC','INTERNAL','CONFIDENTIAL','SENSITIVE']::text[],
    p_bureau_id              uuid DEFAULT NULL
)
RETURNS TABLE (
    document_id      uuid,
    source_id        text,
    source_type      text,
    classification   text,
    authority_rank   int,
    doc_score        double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
WITH scoped AS (
    SELECT
        d.id AS document_id,
        d.source_id,
        d.source_type,
        d.classification,
        COALESCE((d.metadata->>'authority_rank')::int, 0) AS authority_rank,
        CASE
            WHEN c.embedding IS NULL THEN 0.0::double precision
            ELSE (1 - (c.embedding <=> query_embedding))::double precision
        END AS semantic_score,
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
), agg AS (
    SELECT
        s.document_id,
        max(s.source_id) AS source_id,
        max(s.source_type) AS source_type,
        max(s.classification) AS classification,
        max(s.authority_rank) AS authority_rank,
        max(s.semantic_score) AS semantic_max,
        max(s.keyword_score) AS keyword_max
    FROM scoped s
    GROUP BY s.document_id
)
SELECT
    a.document_id,
    a.source_id,
    a.source_type,
    a.classification,
    a.authority_rank,
    (
        (0.62::double precision * LEAST(a.semantic_max, 1.0::double precision))
        + (0.28::double precision * LEAST(a.keyword_max, 1.0::double precision))
        + (0.10::double precision * LEAST(GREATEST(a.authority_rank, 0) / 100.0::double precision, 1.0::double precision))
    )::double precision AS doc_score
FROM agg a
ORDER BY doc_score DESC
LIMIT GREATEST(1, LEAST(p_doc_k, 100));
$$;

GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks_legal_exact(text, int, text, date, text[], text[], uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rag_v3_doc_shortlist(vector, text, int, text, date, text[], text[], uuid)
    TO authenticated, service_role;

COMMIT;
