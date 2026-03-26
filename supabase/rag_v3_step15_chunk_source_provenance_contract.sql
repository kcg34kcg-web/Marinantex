-- ============================================================================
-- RAG V3 Step 15: Chunk provenance contract (section_path + source_url)
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_chunks
    ADD COLUMN IF NOT EXISTS section_path text,
    ADD COLUMN IF NOT EXISTS source_url text;

UPDATE public.rag_chunks c
SET source_url = NULLIF(TRIM(COALESCE((d.metadata ->> 'source_url'), '')), '')
FROM public.rag_documents d
WHERE d.id = c.document_id
  AND (c.source_url IS NULL OR TRIM(c.source_url) = '');

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_source_url_required;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_source_url_required
    CHECK (source_url IS NOT NULL AND char_length(trim(source_url)) > 0);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_url
    ON public.rag_chunks (source_url);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_section_path
    ON public.rag_chunks (section_path);

COMMIT;
