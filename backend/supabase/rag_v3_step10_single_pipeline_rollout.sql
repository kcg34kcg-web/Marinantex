-- =============================================================================
-- RAG V3 - Step 10: Single Pipeline Staged Rollout Seed
-- =============================================================================
-- Purpose:
--   Seeds rollout metadata for legacy /api/v1/rag/query shutdown migration.
--   Stage targets:
--     dev     -> 0%  (legacy fallback open)
--     staging -> 100%
--     prod    -> 100%
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ai_feature_flags'
    ) THEN
        INSERT INTO public.ai_feature_flags (
            bureau_id,
            flag_key,
            is_enabled,
            rollout_percentage,
            metadata
        )
        VALUES (
            NULL,
            'rag_v3_single_pipeline_enforced',
            false,
            0,
            jsonb_build_object(
                'owner', 'platform',
                'stages', jsonb_build_object(
                    'dev', 0,
                    'staging', 100,
                    'prod', 100
                ),
                'notes', 'Set RAG_V3_SINGLE_PIPELINE_ENFORCED=true in staging/prod deployments.'
            )
        )
        ON CONFLICT (flag_key) WHERE bureau_id IS NULL
        DO UPDATE SET
            metadata = COALESCE(public.ai_feature_flags.metadata, '{}'::jsonb) || EXCLUDED.metadata,
            updated_at = now();
    ELSE
        RAISE NOTICE 'ai_feature_flags table is missing. Apply rag_v2_step25_quality_gate_rollout_memory.sql first.';
    END IF;
END
$$;

COMMIT;
