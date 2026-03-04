-- ============================================================================
-- RAG V3 Step 04: Stable chunk identity (chunk_hash + deterministic upsert key)
-- ============================================================================
-- Goal:
--   1) Ensure chunk_hash column exists in all environments.
--   2) Backfill missing chunk_hash values for legacy rows.
--   3) Guarantee unique (document_id, chunk_hash) for idempotent upsert flows.
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_chunks
    ADD COLUMN IF NOT EXISTS chunk_hash text;

UPDATE public.rag_chunks
SET chunk_hash = md5(
    concat_ws(
        '|',
        coalesce(source_id, ''),
        coalesce(article_no, ''),
        coalesce(clause_no, ''),
        coalesce(subclause_no, ''),
        coalesce(heading_path, ''),
        coalesce(page_range, ''),
        regexp_replace(coalesce(text, ''), '\s+', ' ', 'g')
    )
)
WHERE chunk_hash IS NULL
   OR btrim(chunk_hash) = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_chunks_document_hash
    ON public.rag_chunks (document_id, chunk_hash);

COMMIT;
