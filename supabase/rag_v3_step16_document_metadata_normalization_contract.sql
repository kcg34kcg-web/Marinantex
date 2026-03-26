-- ============================================================================
-- RAG V3 Step 16: Document metadata normalization contract
-- ============================================================================
-- Goal:
--   1) Promote critical legal metadata into first-class typed columns.
--   2) Enforce explicit mulga_state + topic_tags defaults for governance/reporting.
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_documents
    ADD COLUMN IF NOT EXISTS law_no text,
    ADD COLUMN IF NOT EXISTS article_no text,
    ADD COLUMN IF NOT EXISTS docket_no text,
    ADD COLUMN IF NOT EXISTS decision_no text,
    ADD COLUMN IF NOT EXISTS decision_date date,
    ADD COLUMN IF NOT EXISTS publish_date date,
    ADD COLUMN IF NOT EXISTS court text,
    ADD COLUMN IF NOT EXISTS chamber text,
    ADD COLUMN IF NOT EXISTS mulga_state text,
    ADD COLUMN IF NOT EXISTS topic_tags text[];

UPDATE public.rag_documents
SET law_no = NULLIF(TRIM(COALESCE(metadata->>'law_no', metadata->>'kanun_no', '')), '')
WHERE law_no IS NULL;

UPDATE public.rag_documents
SET article_no = NULLIF(TRIM(COALESCE(metadata->>'article_no', metadata->>'article', metadata->>'madde_no', '')), '')
WHERE article_no IS NULL;

UPDATE public.rag_documents
SET docket_no = NULLIF(TRIM(COALESCE(metadata->>'docket_no', metadata->>'esas_no', metadata->>'esasNo', '')), '')
WHERE docket_no IS NULL;

UPDATE public.rag_documents
SET decision_no = NULLIF(TRIM(COALESCE(metadata->>'decision_no', metadata->>'karar_no', metadata->>'kararNo', '')), '')
WHERE decision_no IS NULL;

UPDATE public.rag_documents
SET court = NULLIF(TRIM(COALESCE(metadata->>'court', metadata->>'mahkeme', '')), '')
WHERE court IS NULL;

UPDATE public.rag_documents
SET chamber = NULLIF(TRIM(COALESCE(metadata->>'chamber', metadata->>'daire', '')), '')
WHERE chamber IS NULL;

UPDATE public.rag_documents
SET decision_date = NULLIF(COALESCE(metadata->>'decision_date', metadata->>'karar_tarihi', ''), '')::date
WHERE decision_date IS NULL
  AND COALESCE(metadata->>'decision_date', metadata->>'karar_tarihi', '') ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE public.rag_documents
SET publish_date = NULLIF(COALESCE(metadata->>'publish_date', metadata->>'yayim_tarihi', ''), '')::date
WHERE publish_date IS NULL
  AND COALESCE(metadata->>'publish_date', metadata->>'yayim_tarihi', '') ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE public.rag_documents
SET mulga_state = upper(NULLIF(TRIM(COALESCE(metadata->>'mulga_state', '')), ''))
WHERE mulga_state IS NULL;

UPDATE public.rag_documents
SET mulga_state = 'UNKNOWN'
WHERE mulga_state IS NULL OR btrim(mulga_state) = '';

UPDATE public.rag_documents
SET topic_tags = (
    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    FROM jsonb_array_elements_text(
        CASE
            WHEN jsonb_typeof(metadata->'topic_tags') = 'array' THEN metadata->'topic_tags'
            ELSE '[]'::jsonb
        END
    ) AS value
)
WHERE topic_tags IS NULL;

ALTER TABLE public.rag_documents
    ALTER COLUMN mulga_state SET DEFAULT 'UNKNOWN',
    ALTER COLUMN topic_tags SET DEFAULT ARRAY[]::text[];

ALTER TABLE public.rag_documents
    ALTER COLUMN mulga_state SET NOT NULL,
    ALTER COLUMN topic_tags SET NOT NULL;

ALTER TABLE public.rag_documents
    DROP CONSTRAINT IF EXISTS rag_documents_mulga_state_allowed;
ALTER TABLE public.rag_documents
    ADD CONSTRAINT rag_documents_mulga_state_allowed
    CHECK (mulga_state IN ('IN_FORCE', 'REPEALED', 'AMENDED', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_rag_documents_law_article
    ON public.rag_documents (law_no, article_no);

CREATE INDEX IF NOT EXISTS idx_rag_documents_docket_decision_no
    ON public.rag_documents (docket_no, decision_no);

CREATE INDEX IF NOT EXISTS idx_rag_documents_decision_publish_date
    ON public.rag_documents (decision_date, publish_date);

CREATE INDEX IF NOT EXISTS idx_rag_documents_court_chamber
    ON public.rag_documents (court, chamber);

CREATE INDEX IF NOT EXISTS idx_rag_documents_mulga_state
    ON public.rag_documents (mulga_state);

CREATE INDEX IF NOT EXISTS idx_rag_documents_topic_tags_gin
    ON public.rag_documents USING GIN (topic_tags);

COMMIT;
