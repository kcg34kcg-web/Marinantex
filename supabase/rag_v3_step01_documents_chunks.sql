-- ============================================================================
-- RAG V3 Step 01: Canonical Documents + Chunks schema
-- ============================================================================
-- Goal:
--   Keep source identity, provenance, and legal effect context explicit
--   at both document and chunk level.
--
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE is used throughout.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Documents table (source-level metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_documents (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           text NOT NULL,
    source_type     text NOT NULL,
    source_id       text NOT NULL,
    jurisdiction    text NOT NULL DEFAULT 'TR',
    effective_from  date,
    effective_to    date,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    doc_hash        text NOT NULL,
    acl_tags        text[] NOT NULL DEFAULT ARRAY['public']::text[],
    created_at      timestamptz NOT NULL DEFAULT now(),
    bureau_id       uuid,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_documents_doc_hash
    ON public.rag_documents (doc_hash);

CREATE INDEX IF NOT EXISTS idx_rag_documents_source
    ON public.rag_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_rag_documents_jurisdiction
    ON public.rag_documents (jurisdiction);

CREATE INDEX IF NOT EXISTS idx_rag_documents_updated_at
    ON public.rag_documents (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_documents_acl_tags
    ON public.rag_documents USING GIN (acl_tags);

-- ---------------------------------------------------------------------------
-- 2) Chunks table (retrieval-level records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_chunks (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id     uuid NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
    article_no      text,
    clause_no       text,
    subclause_no    text,
    heading_path    text,
    text            text NOT NULL,
    text_tsv        tsvector GENERATED ALWAYS AS (
        to_tsvector('turkish', COALESCE(text, ''))
    ) STORED,
    embedding       vector(1536),
    chunk_hash      text NOT NULL,
    page_range      text,
    effective_from  date,
    effective_to    date,
    source_id       text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_chunks_document_hash
    ON public.rag_chunks (document_id, chunk_hash);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id
    ON public.rag_chunks (document_id);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_article_clause
    ON public.rag_chunks (article_no, clause_no, subclause_no);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_text_tsv
    ON public.rag_chunks USING GIN (text_tsv);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_cosine
    ON public.rag_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ---------------------------------------------------------------------------
-- 3) updated_at trigger on rag_documents
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rag_documents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_documents_updated_at ON public.rag_documents;
CREATE TRIGGER trg_rag_documents_updated_at
BEFORE UPDATE ON public.rag_documents
FOR EACH ROW
EXECUTE FUNCTION public.rag_documents_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Baseline vector retrieval RPC
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rag_v3_match_chunks(vector, text, int, text, date, text[], uuid);

CREATE OR REPLACE FUNCTION public.rag_v3_match_chunks(
    query_embedding  vector(1536),
    query_text       text,
    p_top_k          int DEFAULT 10,
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
-- 5) RLS + grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_documents_service_all ON public.rag_documents;
CREATE POLICY rag_documents_service_all
ON public.rag_documents
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_chunks_service_all ON public.rag_chunks;
CREATE POLICY rag_chunks_service_all
ON public.rag_chunks
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_documents_authenticated_public_read ON public.rag_documents;
CREATE POLICY rag_documents_authenticated_public_read
ON public.rag_documents
FOR SELECT
TO authenticated
USING (acl_tags && ARRAY['public']::text[]);

DROP POLICY IF EXISTS rag_chunks_authenticated_public_read ON public.rag_chunks;
CREATE POLICY rag_chunks_authenticated_public_read
ON public.rag_chunks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.rag_documents d
        WHERE d.id = rag_chunks.document_id
          AND d.acl_tags && ARRAY['public']::text[]
    )
);

GRANT ALL ON TABLE public.rag_documents TO service_role;
GRANT ALL ON TABLE public.rag_chunks TO service_role;
GRANT SELECT ON TABLE public.rag_documents TO authenticated;
GRANT SELECT ON TABLE public.rag_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION public.rag_v3_match_chunks(vector, text, int, text, date, text[], uuid)
    TO authenticated, service_role;

COMMIT;
