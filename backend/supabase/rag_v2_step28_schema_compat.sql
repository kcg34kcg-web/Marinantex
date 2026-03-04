-- =============================================================================
-- RAG V2.1 - Step 28: Retrieval Schema Compatibility Hotfix
-- =============================================================================
-- Purpose:
--   Repair schema drift that breaks retrieval RPCs in partially migrated DBs.
--
-- Symptoms fixed:
--   - column d.search_vector does not exist   (hybrid_legal_search)
--   - column d.is_deleted does not exist      (hybrid_rrf_search)
--
-- This migration is idempotent and safe to run multiple times.
-- =============================================================================

-- 1) Soft-delete compatibility
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS is_deleted boolean;

ALTER TABLE public.documents
    ALTER COLUMN is_deleted SET DEFAULT false;

UPDATE public.documents
SET is_deleted = false
WHERE is_deleted IS NULL;

-- Keep nullable for backwards compatibility, but ensure new rows default false.
COMMENT ON COLUMN public.documents.is_deleted IS
    'Step 28 compatibility: soft-delete flag used by retrieval filters.';

CREATE INDEX IF NOT EXISTS idx_documents_is_deleted
    ON public.documents (is_deleted);

-- 2) search_vector compatibility for hybrid_legal_search
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE public.documents
            ADD COLUMN search_vector tsvector
            GENERATED ALWAYS AS (
                to_tsvector('turkish', COALESCE(content, ''))
            ) STORED;
    END IF;
END $$;

COMMENT ON COLUMN public.documents.search_vector IS
    'Step 28 compatibility: Turkish FTS vector for hybrid_legal_search.';

CREATE INDEX IF NOT EXISTS idx_documents_search_vector
    ON public.documents USING GIN (search_vector);

-- 3) Ensure fts_vector index exists (column is created by Step 11)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'fts_vector'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_documents_fts
            ON public.documents USING GIN (fts_vector);
    END IF;
END $$;

