-- =============================================================================
-- RAG V3 - Step 10: Audit Foundation Hardening
-- =============================================================================
-- Migration: rag_v2_step22_audit_foundation.sql
--
-- Goal:
--   Ensure every answer has a queryable audit backbone containing:
--   requested_tier, final_tier, model_used, response_type, source_count,
--   grounding_ratio, estimated_cost, case_id, thread_id, intent_class,
--   strict_grounding, temporal_fields.
--
-- Also:
--   - Link tool_call_log rows to audit request_id.
--   - Expose a trace view/query path for UI/admin lookup by audit_trail_id.
--
-- Dependencies:
--   - rag_v2_step15_audit.sql
--   - rag_v2_step17_memory.sql
--   - rag_v2_step21_tenant_hardening.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) audit_log schema expansion
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log
    ADD COLUMN IF NOT EXISTS requested_tier text,
    ADD COLUMN IF NOT EXISTS final_tier smallint,
    ADD COLUMN IF NOT EXISTS final_generation_tier smallint,
    ADD COLUMN IF NOT EXISTS final_model text,
    ADD COLUMN IF NOT EXISTS subtask_models jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS response_type text,
    ADD COLUMN IF NOT EXISTS source_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.ai_threads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS intent_class text,
    ADD COLUMN IF NOT EXISTS strict_grounding boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS temporal_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tenant_context jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'audit_log_final_tier_check'
    ) THEN
        ALTER TABLE public.audit_log
            ADD CONSTRAINT audit_log_final_tier_check
            CHECK (final_tier IS NULL OR final_tier BETWEEN 1 AND 4);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'audit_log_final_generation_tier_check'
    ) THEN
        ALTER TABLE public.audit_log
            ADD CONSTRAINT audit_log_final_generation_tier_check
            CHECK (
                final_generation_tier IS NULL
                OR final_generation_tier BETWEEN 1 AND 4
            );
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'audit_log_response_type_check'
    ) THEN
        ALTER TABLE public.audit_log
            ADD CONSTRAINT audit_log_response_type_check
            CHECK (
                response_type IS NULL
                OR response_type IN ('legal_grounded', 'social_ungrounded')
            );
    END IF;
END;
$$;

UPDATE public.audit_log
   SET final_tier = COALESCE(final_tier, tier),
       final_generation_tier = COALESCE(final_generation_tier, final_tier, tier),
       final_model = COALESCE(final_model, model_used),
       subtask_models = CASE
           WHEN jsonb_typeof(subtask_models) = 'array' THEN subtask_models
           ELSE '[]'::jsonb
       END,
       source_count = CASE
           WHEN source_count > 0 THEN source_count
           ELSE COALESCE(jsonb_array_length(source_versions), 0)
       END,
       response_type = COALESCE(response_type, 'legal_grounded');

CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
    ON public.audit_log (request_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_case_id
    ON public.audit_log (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_thread_id
    ON public.audit_log (thread_id)
    WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_intent_class
    ON public.audit_log (intent_class);

CREATE INDEX IF NOT EXISTS idx_audit_log_response_type
    ON public.audit_log (response_type);

CREATE INDEX IF NOT EXISTS idx_audit_log_temporal_fields
    ON public.audit_log USING gin (temporal_fields);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_context
    ON public.audit_log USING gin (tenant_context);

COMMENT ON COLUMN public.audit_log.requested_tier IS
    'User-selected tier label (hazir_cevap | dusunceli | uzman | muazzam).';
COMMENT ON COLUMN public.audit_log.final_tier IS
    'Final generation tier actually used after routing.';
COMMENT ON COLUMN public.audit_log.final_generation_tier IS
    'Step 22 explicit final generation tier (must not be below requested_tier).';
COMMENT ON COLUMN public.audit_log.final_model IS
    'Step 22 explicit final model used to generate the final answer.';
COMMENT ON COLUMN public.audit_log.subtask_models IS
    'Step 22 hybrid router subtask models array.';
COMMENT ON COLUMN public.audit_log.response_type IS
    'Response classification: legal_grounded | social_ungrounded.';
COMMENT ON COLUMN public.audit_log.source_count IS
    'Number of sources used in final answer context.';
COMMENT ON COLUMN public.audit_log.intent_class IS
    'Intent classifier output (social_simple, legal_query, legal_analysis, etc.).';
COMMENT ON COLUMN public.audit_log.strict_grounding IS
    'Grounding enforcement flag active for this request.';
COMMENT ON COLUMN public.audit_log.temporal_fields IS
    'Temporal contract snapshot (as_of_date, event_date, decision_date).';

-- ---------------------------------------------------------------------------
-- 2) tool_call_log linkage (if step14 table exists, this becomes an ALTER)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_call_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name       text        NOT NULL,
    tool_version    text        NOT NULL DEFAULT '1.0',
    start_date      date,
    deadline_date   date,
    input_params    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    result_json     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    legal_basis     text,
    description_tr  text,
    query_text      text,
    case_id         text,
    bureau_id       uuid        REFERENCES public.bureaus(id) ON DELETE SET NULL,
    error_message   text,
    success         boolean     NOT NULL DEFAULT true,
    called_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tool_call_log
    ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.audit_log(request_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.ai_threads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS latency_ms integer;

CREATE INDEX IF NOT EXISTS idx_tool_call_log_request_id
    ON public.tool_call_log (request_id)
    WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_call_log_thread_id
    ON public.tool_call_log (thread_id)
    WHERE thread_id IS NOT NULL;

-- Re-harden RLS with profile-based bureau checks.
ALTER TABLE public.tool_call_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_call_log_bureau_select ON public.tool_call_log;
DROP POLICY IF EXISTS tool_call_log_bureau_insert ON public.tool_call_log;
DROP POLICY IF EXISTS tool_call_log_service_role_all ON public.tool_call_log;

CREATE POLICY tool_call_log_service_role_all
    ON public.tool_call_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY tool_call_log_bureau_select
    ON public.tool_call_log FOR SELECT TO authenticated
    USING (
        bureau_id IS NULL
        OR bureau_id = (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

CREATE POLICY tool_call_log_bureau_insert
    ON public.tool_call_log FOR INSERT TO authenticated
    WITH CHECK (
        bureau_id IS NULL
        OR bureau_id = (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.tool_call_log TO service_role;
GRANT SELECT, INSERT ON TABLE public.tool_call_log TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Admin/UI trace read model
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.rag_audit_trace_v1 AS
SELECT
    a.request_id,
    a.timestamp_utc,
    a.bureau_id,
    a.requested_tier,
    COALESCE(a.final_tier, a.tier) AS final_tier,
    COALESCE(a.final_generation_tier, a.final_tier, a.tier) AS final_generation_tier,
    COALESCE(a.final_model, a.model_used) AS final_model,
    COALESCE(a.subtask_models, '[]'::jsonb) AS subtask_models,
    a.tier AS legacy_tier,
    a.model_used,
    COALESCE(a.response_type, 'legal_grounded') AS response_type,
    a.source_count,
    a.grounding_ratio,
    a.cost_estimate_usd AS estimated_cost_usd,
    a.case_id,
    a.thread_id,
    a.intent_class,
    a.strict_grounding,
    a.temporal_fields,
    a.tenant_context,
    a.created_at,
    c.model_id AS cost_model_id,
    c.input_tokens,
    c.output_tokens,
    c.total_cost_usd AS cost_log_total_usd,
    COALESCE(tc.tool_call_count, 0)::integer AS tool_call_count,
    COALESCE(tc.tool_error_count, 0)::integer AS tool_error_count
FROM public.audit_log a
LEFT JOIN LATERAL (
    SELECT
        cl.model_id,
        cl.input_tokens,
        cl.output_tokens,
        cl.total_cost_usd
    FROM public.cost_log cl
    WHERE cl.request_id = a.request_id
    ORDER BY cl.created_at DESC
    LIMIT 1
) c ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS tool_call_count,
        COUNT(*) FILTER (WHERE t.success = false) AS tool_error_count
    FROM public.tool_call_log t
    WHERE t.request_id = a.request_id
) tc ON true;

COMMENT ON VIEW public.rag_audit_trace_v1 IS
    'Step 10: One-row audit trace summary per request_id for UI/admin lookup.';

CREATE OR REPLACE FUNCTION public.get_rag_audit_trace(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_build_object(
                'request_id', v.request_id,
                'timestamp_utc', v.timestamp_utc,
                'bureau_id', v.bureau_id,
                'requested_tier', v.requested_tier,
                'final_tier', v.final_tier,
                'final_generation_tier', v.final_generation_tier,
                'final_model', v.final_model,
                'subtask_models', v.subtask_models,
                'model_used', v.model_used,
                'response_type', v.response_type,
                'source_count', v.source_count,
                'grounding_ratio', v.grounding_ratio,
                'estimated_cost_usd', v.estimated_cost_usd,
                'case_id', v.case_id,
                'thread_id', v.thread_id,
                'intent_class', v.intent_class,
                'strict_grounding', v.strict_grounding,
                'temporal_fields', v.temporal_fields,
                'tenant_context', v.tenant_context,
                'tool_call_count', v.tool_call_count,
                'tool_error_count', v.tool_error_count
            )
            FROM public.rag_audit_trace_v1 v
            WHERE v.request_id = p_request_id
            LIMIT 1
        ),
        '{}'::jsonb
    );
$$;

GRANT SELECT ON public.rag_audit_trace_v1 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rag_audit_trace(uuid) TO authenticated, service_role;

COMMIT;
