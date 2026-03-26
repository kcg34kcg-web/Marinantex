-- ============================================================================
-- RAG V3 Step 12: Query trace audit completeness contract
-- ============================================================================
-- Goal:
--   1) Promote critical audit fields from metadata JSON to typed columns.
--   2) Enable deterministic filtering/alerting for disclaimer, confidence, and
--      SME review workflows.
-- ============================================================================

BEGIN;

ALTER TABLE public.rag_v3_query_traces
    ADD COLUMN IF NOT EXISTS legal_disclaimer_ack boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS human_responsibility_ack boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tier_policy_route_reason text,
    ADD COLUMN IF NOT EXISTS query_expansion jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS prompt_scenario text,
    ADD COLUMN IF NOT EXISTS prompt_registry_version text,
    ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS review_reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS low_confidence boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS low_confidence_reason text;

UPDATE public.rag_v3_query_traces
SET
    legal_disclaimer_ack = CASE
        WHEN lower(COALESCE(metadata->>'legal_disclaimer_ack', '')) IN ('1', 'true', 't', 'yes', 'on') THEN true
        WHEN lower(COALESCE(metadata->>'legal_disclaimer_ack', '')) IN ('0', 'false', 'f', 'no', 'off') THEN false
        ELSE legal_disclaimer_ack
    END,
    human_responsibility_ack = CASE
        WHEN lower(COALESCE(metadata->>'human_responsibility_ack', '')) IN ('1', 'true', 't', 'yes', 'on') THEN true
        WHEN lower(COALESCE(metadata->>'human_responsibility_ack', '')) IN ('0', 'false', 'f', 'no', 'off') THEN false
        ELSE human_responsibility_ack
    END,
    tier_policy_route_reason = COALESCE(
        NULLIF(metadata->>'tier_policy_route_reason', ''),
        tier_policy_route_reason
    ),
    query_expansion = CASE
        WHEN jsonb_typeof(metadata->'query_expansion') = 'object' THEN metadata->'query_expansion'
        ELSE query_expansion
    END,
    prompt_scenario = COALESCE(
        NULLIF(metadata->>'prompt_scenario', ''),
        prompt_scenario
    ),
    prompt_registry_version = COALESCE(
        NULLIF(metadata->>'prompt_registry_version', ''),
        prompt_registry_version
    ),
    source_documents = CASE
        WHEN jsonb_typeof(metadata->'source_documents') = 'array' THEN metadata->'source_documents'
        ELSE source_documents
    END,
    review_required = CASE
        WHEN lower(COALESCE(metadata->>'review_required', '')) IN ('1', 'true', 't', 'yes', 'on') THEN true
        WHEN lower(COALESCE(metadata->>'review_required', '')) IN ('0', 'false', 'f', 'no', 'off') THEN false
        ELSE review_required
    END,
    review_reason_codes = CASE
        WHEN jsonb_typeof(metadata->'review_reason_codes') = 'array' THEN (
            SELECT COALESCE(array_agg(value), ARRAY[]::text[])
            FROM jsonb_array_elements_text(metadata->'review_reason_codes') AS value
        )
        ELSE review_reason_codes
    END,
    low_confidence = CASE
        WHEN lower(COALESCE(metadata->>'low_confidence', '')) IN ('1', 'true', 't', 'yes', 'on') THEN true
        WHEN lower(COALESCE(metadata->>'low_confidence', '')) IN ('0', 'false', 'f', 'no', 'off') THEN false
        ELSE low_confidence
    END,
    low_confidence_reason = COALESCE(
        NULLIF(metadata->>'low_confidence_reason', ''),
        low_confidence_reason
    );

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_review_required_created
    ON public.rag_v3_query_traces (review_required, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_low_confidence_created
    ON public.rag_v3_query_traces (low_confidence, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_prompt_scenario_created
    ON public.rag_v3_query_traces (prompt_scenario, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_source_documents_gin
    ON public.rag_v3_query_traces USING GIN (source_documents);

COMMIT;
