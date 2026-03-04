-- =============================================================================
-- RAG V3 - Step 25: Quality Gate, Observability, Rollout Flags, Memory Core
-- =============================================================================
-- Migration: rag_v2_step25_quality_gate_rollout_memory.sql
--
-- Purpose:
--   1) Add rollout feature-flag storage (global + bureau override support).
--   2) Add user memory controls and long-term memory tables.
--   3) Add observability snapshot function/view (p95 latency + TTFT estimate).
--
-- Dependencies:
--   - rag_v2_step17_memory.sql
--   - rag_v2_step18_save_targets.sql
--   - rag_v2_step22_audit_foundation.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Rollout feature flags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_feature_flags (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id           uuid            REFERENCES public.bureaus(id) ON DELETE CASCADE,
    flag_key            text        NOT NULL CHECK (char_length(trim(flag_key)) > 0),
    is_enabled          boolean     NOT NULL DEFAULT true,
    rollout_percentage  integer     NOT NULL DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
    metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_feature_flags IS
    'Step 25 rollout flags. bureau_id NULL rows are global defaults, non-NULL rows are bureau overrides.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feature_flags_global_key
    ON public.ai_feature_flags (flag_key)
    WHERE bureau_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feature_flags_bureau_key
    ON public.ai_feature_flags (bureau_id, flag_key)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_feature_flags_bureau
    ON public.ai_feature_flags (bureau_id, flag_key);

DROP TRIGGER IF EXISTS trg_ai_feature_flags_updated_at ON public.ai_feature_flags;
CREATE TRIGGER trg_ai_feature_flags_updated_at
BEFORE UPDATE ON public.ai_feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_feature_flags_service_role_all ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_service_role_all
    ON public.ai_feature_flags FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ai_feature_flags_member_select ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_member_select
    ON public.ai_feature_flags FOR SELECT TO authenticated
    USING (
        ai_feature_flags.bureau_id IS NULL
        OR ai_feature_flags.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_feature_flags_member_insert ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_member_insert
    ON public.ai_feature_flags FOR INSERT TO authenticated
    WITH CHECK (
        ai_feature_flags.bureau_id IS NOT NULL
        AND ai_feature_flags.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_feature_flags_member_update ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_member_update
    ON public.ai_feature_flags FOR UPDATE TO authenticated
    USING (
        ai_feature_flags.bureau_id IS NOT NULL
        AND ai_feature_flags.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        ai_feature_flags.bureau_id IS NOT NULL
        AND ai_feature_flags.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_feature_flags_member_delete ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_member_delete
    ON public.ai_feature_flags FOR DELETE TO authenticated
    USING (
        ai_feature_flags.bureau_id IS NOT NULL
        AND ai_feature_flags.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.ai_feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_feature_flags TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'strict_grounding_v2'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'strict_grounding_v2', true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'tier_selector_ui'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'tier_selector_ui', true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'router_hybrid_v3'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'router_hybrid_v3', true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'save_targets_v2'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'save_targets_v2', true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'client_translator_draft'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'client_translator_draft', true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.ai_feature_flags
        WHERE bureau_id IS NULL AND flag_key = 'memory_dashboard_v1'
    ) THEN
        INSERT INTO public.ai_feature_flags (bureau_id, flag_key, is_enabled)
        VALUES (NULL, 'memory_dashboard_v1', false);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_feature_enabled(
    p_flag_key text,
    p_bureau_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    WITH bureau_override AS (
        SELECT f.is_enabled
        FROM public.ai_feature_flags f
        WHERE f.flag_key = p_flag_key
          AND p_bureau_id IS NOT NULL
          AND f.bureau_id = p_bureau_id
        LIMIT 1
    ),
    global_default AS (
        SELECT f.is_enabled
        FROM public.ai_feature_flags f
        WHERE f.flag_key = p_flag_key
          AND f.bureau_id IS NULL
        LIMIT 1
    )
    SELECT COALESCE(
        (SELECT is_enabled FROM bureau_override),
        (SELECT is_enabled FROM global_default),
        false
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_feature_enabled(text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Memory settings + memory graph tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_user_settings (
    user_id                  uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    bureau_id                uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    memory_writeback_enabled boolean     NOT NULL DEFAULT false,
    metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_user_settings IS
    'Step 25 user-level AI settings (memory writeback toggle and future prefs).';

DROP TRIGGER IF EXISTS trg_ai_user_settings_updated_at ON public.ai_user_settings;
CREATE TRIGGER trg_ai_user_settings_updated_at
BEFORE UPDATE ON public.ai_user_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_user_settings_service_role_all ON public.ai_user_settings;
CREATE POLICY ai_user_settings_service_role_all
    ON public.ai_user_settings FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ai_user_settings_member_select ON public.ai_user_settings;
CREATE POLICY ai_user_settings_member_select
    ON public.ai_user_settings FOR SELECT TO authenticated
    USING (
        ai_user_settings.user_id = auth.uid()
        AND ai_user_settings.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_user_settings_member_insert ON public.ai_user_settings;
CREATE POLICY ai_user_settings_member_insert
    ON public.ai_user_settings FOR INSERT TO authenticated
    WITH CHECK (
        ai_user_settings.user_id = auth.uid()
        AND ai_user_settings.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_user_settings_member_update ON public.ai_user_settings;
CREATE POLICY ai_user_settings_member_update
    ON public.ai_user_settings FOR UPDATE TO authenticated
    USING (
        ai_user_settings.user_id = auth.uid()
        AND ai_user_settings.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        ai_user_settings.user_id = auth.uid()
        AND ai_user_settings.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.ai_user_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_user_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.memory_facts (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id               uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id                 uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    fact_text               text        NOT NULL CHECK (char_length(trim(fact_text)) > 0),
    confidence              numeric(4,3) NOT NULL DEFAULT 0.700 CHECK (confidence >= 0 AND confidence <= 1),
    source_type             text        NOT NULL DEFAULT 'user_input'
                                      CHECK (source_type IN ('user_input', 'assistant_output', 'system_inferred')),
    source_message_id       uuid            REFERENCES public.ai_messages(id) ON DELETE SET NULL,
    source_saved_output_id  uuid            REFERENCES public.saved_outputs(id) ON DELETE SET NULL,
    metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.memory_facts IS
    'Step 25 long-term memory facts extracted from user interactions and approved writeback.';

CREATE INDEX IF NOT EXISTS idx_memory_facts_user_created_at
    ON public.memory_facts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_facts_bureau_created_at
    ON public.memory_facts (bureau_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_memory_facts_updated_at ON public.memory_facts;
CREATE TRIGGER trg_memory_facts_updated_at
BEFORE UPDATE ON public.memory_facts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.memory_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_facts_service_role_all ON public.memory_facts;
CREATE POLICY memory_facts_service_role_all
    ON public.memory_facts FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS memory_facts_member_select ON public.memory_facts;
CREATE POLICY memory_facts_member_select
    ON public.memory_facts FOR SELECT TO authenticated
    USING (
        memory_facts.user_id = auth.uid()
        AND memory_facts.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_facts_member_insert ON public.memory_facts;
CREATE POLICY memory_facts_member_insert
    ON public.memory_facts FOR INSERT TO authenticated
    WITH CHECK (
        memory_facts.user_id = auth.uid()
        AND memory_facts.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_facts_member_update ON public.memory_facts;
CREATE POLICY memory_facts_member_update
    ON public.memory_facts FOR UPDATE TO authenticated
    USING (
        memory_facts.user_id = auth.uid()
        AND memory_facts.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        memory_facts.user_id = auth.uid()
        AND memory_facts.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_facts_member_delete ON public.memory_facts;
CREATE POLICY memory_facts_member_delete
    ON public.memory_facts FOR DELETE TO authenticated
    USING (
        memory_facts.user_id = auth.uid()
        AND memory_facts.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.memory_facts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memory_facts TO authenticated;

CREATE TABLE IF NOT EXISTS public.memory_preferences (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id               uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id                 uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    pref_key                text        NOT NULL CHECK (char_length(trim(pref_key)) > 0),
    pref_value              text        NOT NULL,
    metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memory_preferences_user_key_unique UNIQUE (user_id, pref_key)
);

COMMENT ON TABLE public.memory_preferences IS
    'Step 25 long-term user preferences for collaborative AI behaviour.';

CREATE INDEX IF NOT EXISTS idx_memory_preferences_user_updated_at
    ON public.memory_preferences (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_memory_preferences_updated_at ON public.memory_preferences;
CREATE TRIGGER trg_memory_preferences_updated_at
BEFORE UPDATE ON public.memory_preferences
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.memory_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_preferences_service_role_all ON public.memory_preferences;
CREATE POLICY memory_preferences_service_role_all
    ON public.memory_preferences FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS memory_preferences_member_select ON public.memory_preferences;
CREATE POLICY memory_preferences_member_select
    ON public.memory_preferences FOR SELECT TO authenticated
    USING (
        memory_preferences.user_id = auth.uid()
        AND memory_preferences.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_preferences_member_insert ON public.memory_preferences;
CREATE POLICY memory_preferences_member_insert
    ON public.memory_preferences FOR INSERT TO authenticated
    WITH CHECK (
        memory_preferences.user_id = auth.uid()
        AND memory_preferences.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_preferences_member_update ON public.memory_preferences;
CREATE POLICY memory_preferences_member_update
    ON public.memory_preferences FOR UPDATE TO authenticated
    USING (
        memory_preferences.user_id = auth.uid()
        AND memory_preferences.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        memory_preferences.user_id = auth.uid()
        AND memory_preferences.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_preferences_member_delete ON public.memory_preferences;
CREATE POLICY memory_preferences_member_delete
    ON public.memory_preferences FOR DELETE TO authenticated
    USING (
        memory_preferences.user_id = auth.uid()
        AND memory_preferences.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.memory_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memory_preferences TO authenticated;

CREATE TABLE IF NOT EXISTS public.memory_edges (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id        uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    from_fact_id     uuid        NOT NULL REFERENCES public.memory_facts(id) ON DELETE CASCADE,
    to_fact_id       uuid        NOT NULL REFERENCES public.memory_facts(id) ON DELETE CASCADE,
    relation_type    text        NOT NULL DEFAULT 'related',
    weight           numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (weight >= 0 AND weight <= 1),
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memory_edges_distinct_facts CHECK (from_fact_id <> to_fact_id),
    CONSTRAINT memory_edges_unique UNIQUE (from_fact_id, to_fact_id, relation_type)
);

COMMENT ON TABLE public.memory_edges IS
    'Step 25 graph edges between memory_facts for user-visible relationship tracking.';

CREATE INDEX IF NOT EXISTS idx_memory_edges_user_created_at
    ON public.memory_edges (user_id, created_at DESC);

ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_edges_service_role_all ON public.memory_edges;
CREATE POLICY memory_edges_service_role_all
    ON public.memory_edges FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS memory_edges_member_select ON public.memory_edges;
CREATE POLICY memory_edges_member_select
    ON public.memory_edges FOR SELECT TO authenticated
    USING (
        memory_edges.user_id = auth.uid()
        AND memory_edges.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_edges_member_insert ON public.memory_edges;
CREATE POLICY memory_edges_member_insert
    ON public.memory_edges FOR INSERT TO authenticated
    WITH CHECK (
        memory_edges.user_id = auth.uid()
        AND memory_edges.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS memory_edges_member_delete ON public.memory_edges;
CREATE POLICY memory_edges_member_delete
    ON public.memory_edges FOR DELETE TO authenticated
    USING (
        memory_edges.user_id = auth.uid()
        AND memory_edges.bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

GRANT ALL ON TABLE public.memory_edges TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.memory_edges TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Observability snapshot (tenant-scoped)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rag_observability_snapshot(
    p_bureau_id uuid DEFAULT NULL,
    p_window_hours integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT GREATEST(1, LEAST(COALESCE(p_window_hours, 24), 720))::integer AS window_hours
    ),
    filtered AS (
        SELECT
            a.latency_ms::numeric AS latency_ms,
            a.grounding_ratio::numeric AS grounding_ratio,
            a.cost_estimate_usd::numeric AS cost_estimate_usd
        FROM public.audit_log a, params p
        WHERE a.timestamp_utc >= (now() - ((p.window_hours::text || ' hours')::interval))
          AND (p_bureau_id IS NULL OR a.bureau_id = p_bureau_id)
    ),
    agg AS (
        SELECT
            COUNT(*)::integer AS request_count,
            COALESCE(AVG(latency_ms), 0)::numeric AS avg_query_latency_ms,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::numeric AS p95_query_latency_ms,
            COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY GREATEST(1.0::numeric, latency_ms * 0.35)), 0)::numeric AS stream_ttft_ms_estimate,
            COALESCE(AVG(grounding_ratio), 0)::numeric AS avg_grounding_ratio,
            COALESCE(AVG(cost_estimate_usd), 0)::numeric AS avg_estimated_cost_usd
        FROM filtered
    )
    SELECT jsonb_build_object(
        'window_hours', (SELECT window_hours FROM params),
        'request_count', agg.request_count,
        'avg_query_latency_ms', ROUND(agg.avg_query_latency_ms, 3),
        'p95_query_latency_ms', ROUND(agg.p95_query_latency_ms, 3),
        'stream_ttft_ms_estimate', ROUND(agg.stream_ttft_ms_estimate, 3),
        'avg_grounding_ratio', ROUND(agg.avg_grounding_ratio, 6),
        'avg_estimated_cost_usd', ROUND(agg.avg_estimated_cost_usd, 6)
    )
    FROM agg;
$$;

COMMENT ON FUNCTION public.get_rag_observability_snapshot(uuid, integer) IS
    'Step 25 tenant-scoped observability snapshot (latency/grounding/cost + TTFT estimate).';

CREATE OR REPLACE VIEW public.rag_observability_v1 AS
SELECT
    a.bureau_id,
    date_trunc('hour', a.timestamp_utc) AS hour_bucket,
    COUNT(*)::integer AS request_count,
    ROUND(AVG(a.latency_ms)::numeric, 3) AS avg_query_latency_ms,
    ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY a.latency_ms::numeric))::numeric, 3) AS p95_query_latency_ms,
    ROUND(AVG(a.grounding_ratio)::numeric, 6) AS avg_grounding_ratio,
    ROUND(AVG(a.cost_estimate_usd)::numeric, 6) AS avg_estimated_cost_usd
FROM public.audit_log a
GROUP BY a.bureau_id, date_trunc('hour', a.timestamp_utc);

COMMENT ON VIEW public.rag_observability_v1 IS
    'Step 25 hourly tenant observability aggregates derived from audit_log.';

GRANT EXECUTE ON FUNCTION public.get_rag_observability_snapshot(uuid, integer) TO authenticated, service_role;
GRANT SELECT ON public.rag_observability_v1 TO authenticated, service_role;

COMMIT;
