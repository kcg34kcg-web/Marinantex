-- ============================================================================
-- RAG V3 Step 11: Chunk metadata contract (order/type/token/index lineage)
-- ============================================================================
-- Goal:
--   1) Persist chunk-level lineage fields required by legal audit workflows.
--   2) Keep schema backward-compatible by adding defaults + safe backfills.
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_chunks
    ADD COLUMN IF NOT EXISTS chunk_order int,
    ADD COLUMN IF NOT EXISTS chunk_type text,
    ADD COLUMN IF NOT EXISTS token_count int,
    ADD COLUMN IF NOT EXISTS embedding_version text,
    ADD COLUMN IF NOT EXISTS index_version text;

WITH ordered AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY document_id
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM public.rag_chunks
)
UPDATE public.rag_chunks c
SET chunk_order = ordered.rn
FROM ordered
WHERE c.id = ordered.id
  AND (c.chunk_order IS NULL OR c.chunk_order < 1);

UPDATE public.rag_chunks
SET token_count = GREATEST(
    0,
    COALESCE(
        cardinality(
            regexp_split_to_array(
                NULLIF(btrim(regexp_replace(COALESCE(text, ''), '\s+', ' ', 'g')), ''),
                ' '
            )
        ),
        0
    )
)
WHERE token_count IS NULL
   OR token_count < 0;

UPDATE public.rag_chunks
SET chunk_type = CASE
    WHEN COALESCE(text, '') ILIKE '%gerekçe%'
      OR COALESCE(text, '') ILIKE '%gerekce%' THEN 'reasoning'
    WHEN COALESCE(text, '') ILIKE '%hüküm%'
      OR COALESCE(text, '') ILIKE '%hukum%'
      OR COALESCE(text, '') ILIKE '%sonuç%'
      OR COALESCE(text, '') ILIKE '%sonuc%' THEN 'judgment_outcome'
    WHEN COALESCE(text, '') ILIKE '%özet%'
      OR COALESCE(text, '') ILIKE '%ozet%' THEN 'decision_summary'
    WHEN COALESCE(text, '') ILIKE '%tanım%'
      OR COALESCE(text, '') ILIKE '%tanim%' THEN 'definition'
    WHEN COALESCE(text, '') ILIKE '%istisna%'
      OR COALESCE(text, '') ILIKE '%şart%'
      OR COALESCE(text, '') ILIKE '%sart%'
      OR COALESCE(text, '') ILIKE '%koşul%'
      OR COALESCE(text, '') ILIKE '%kosul%' THEN 'exception_condition'
    ELSE 'normative_provision'
END
WHERE chunk_type IS NULL
   OR btrim(chunk_type) = '';

UPDATE public.rag_chunks
SET embedding_version = 'legacy/unknown'
WHERE embedding_version IS NULL
   OR btrim(embedding_version) = '';

UPDATE public.rag_chunks
SET index_version = 'legacy/unknown'
WHERE index_version IS NULL
   OR btrim(index_version) = '';

ALTER TABLE public.rag_chunks
    ALTER COLUMN chunk_order SET DEFAULT 0,
    ALTER COLUMN chunk_type SET DEFAULT 'normative_provision',
    ALTER COLUMN token_count SET DEFAULT 0,
    ALTER COLUMN embedding_version SET DEFAULT 'legacy/unknown',
    ALTER COLUMN index_version SET DEFAULT 'legacy/unknown';

ALTER TABLE public.rag_chunks
    ALTER COLUMN chunk_order SET NOT NULL,
    ALTER COLUMN chunk_type SET NOT NULL,
    ALTER COLUMN token_count SET NOT NULL,
    ALTER COLUMN embedding_version SET NOT NULL,
    ALTER COLUMN index_version SET NOT NULL;

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_chunk_order_nonnegative;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_chunk_order_nonnegative
    CHECK (chunk_order >= 0);

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_token_count_nonnegative;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_token_count_nonnegative
    CHECK (token_count >= 0);

ALTER TABLE public.rag_chunks
    DROP CONSTRAINT IF EXISTS rag_chunks_chunk_type_allowed;
ALTER TABLE public.rag_chunks
    ADD CONSTRAINT rag_chunks_chunk_type_allowed
    CHECK (
        chunk_type IN (
            'normative_provision',
            'definition',
            'exception_condition',
            'decision_summary',
            'reasoning',
            'judgment_outcome',
            'generic'
        )
    );

CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_order
    ON public.rag_chunks (document_id, chunk_order);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_chunk_type
    ON public.rag_chunks (chunk_type);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_index_version
    ON public.rag_chunks (index_version);

COMMIT;
