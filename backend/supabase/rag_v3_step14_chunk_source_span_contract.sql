-- ============================================================================
-- RAG V3 Step 14: Chunk source span + paragraph contract
-- ============================================================================
-- Goal:
--   1) Persist source character spans for each chunk (traceable evidence anchor).
--   2) Persist paragraph ranges for paragraph-level citation grounding.
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_chunks
    ADD COLUMN IF NOT EXISTS source_char_start int,
    ADD COLUMN IF NOT EXISTS source_char_end int,
    ADD COLUMN IF NOT EXISTS paragraph_start int,
    ADD COLUMN IF NOT EXISTS paragraph_end int;

UPDATE public.rag_chunks
SET source_char_start = 0
WHERE source_char_start IS NULL
   OR source_char_start < 0;

UPDATE public.rag_chunks
SET source_char_end = GREATEST(
    COALESCE(source_char_start, 0),
    COALESCE(char_length(text), 0)
)
WHERE source_char_end IS NULL
   OR source_char_end < COALESCE(source_char_start, 0);

UPDATE public.rag_chunks
SET paragraph_start = 1
WHERE paragraph_start IS NULL
   OR paragraph_start < 1;

UPDATE public.rag_chunks
SET paragraph_end = GREATEST(COALESCE(paragraph_start, 1), 1)
WHERE paragraph_end IS NULL
   OR paragraph_end < COALESCE(paragraph_start, 1);

ALTER TABLE public.rag_chunks
    ALTER COLUMN source_char_start SET DEFAULT 0,
    ALTER COLUMN source_char_end SET DEFAULT 0,
    ALTER COLUMN paragraph_start SET DEFAULT 1,
    ALTER COLUMN paragraph_end SET DEFAULT 1;

ALTER TABLE public.rag_chunks
    ALTER COLUMN source_char_start SET NOT NULL,
    ALTER COLUMN source_char_end SET NOT NULL,
    ALTER COLUMN paragraph_start SET NOT NULL,
    ALTER COLUMN paragraph_end SET NOT NULL;

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_source_char_start_nonnegative;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_source_char_start_nonnegative
    CHECK (source_char_start >= 0);

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_source_char_span_valid;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_source_char_span_valid
    CHECK (source_char_end >= source_char_start);

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_paragraph_start_positive;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_paragraph_start_positive
    CHECK (paragraph_start >= 1);

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_paragraph_range_valid;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_paragraph_range_valid
    CHECK (paragraph_end >= paragraph_start);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_span
    ON public.rag_chunks (document_id, source_char_start, source_char_end);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_paragraph_range
    ON public.rag_chunks (document_id, paragraph_start, paragraph_end);

COMMIT;
