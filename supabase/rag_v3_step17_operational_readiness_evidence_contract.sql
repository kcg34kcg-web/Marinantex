-- ============================================================================
-- RAG V3 Step 17: Operational readiness evidence contract
-- ============================================================================
-- Goal:
--   1) Persist backup/restore and rollback drill evidence rows.
--   2) Persist human-eval rubric governance artifacts.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.rag_v3_backup_restore_drill_log (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at timestamptz NOT NULL DEFAULT now(),
    bureau_id uuid,
    executed_at timestamptz NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('success', 'failed', 'partial')),
    runbook_version text,
    actor_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_backup_restore_drill_created
    ON public.rag_v3_backup_restore_drill_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_backup_restore_drill_bureau
    ON public.rag_v3_backup_restore_drill_log (bureau_id, created_at DESC);

ALTER TABLE public.rag_v3_backup_restore_drill_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_backup_restore_drill_service_all ON public.rag_v3_backup_restore_drill_log;
CREATE POLICY rag_v3_backup_restore_drill_service_all
ON public.rag_v3_backup_restore_drill_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rag_v3_rollback_drill_log (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at timestamptz NOT NULL DEFAULT now(),
    bureau_id uuid,
    executed_at timestamptz NOT NULL,
    rollout_target text,
    outcome text NOT NULL CHECK (outcome IN ('success', 'failed', 'partial')),
    actor_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_rollback_drill_created
    ON public.rag_v3_rollback_drill_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_rollback_drill_bureau
    ON public.rag_v3_rollback_drill_log (bureau_id, created_at DESC);

ALTER TABLE public.rag_v3_rollback_drill_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_rollback_drill_service_all ON public.rag_v3_rollback_drill_log;
CREATE POLICY rag_v3_rollback_drill_service_all
ON public.rag_v3_rollback_drill_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rag_v3_human_eval_rubrics (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    bureau_id uuid,
    rubric_key text NOT NULL,
    version text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated')),
    dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
    scoring_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    owner text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_v3_human_eval_rubric_unique
    ON public.rag_v3_human_eval_rubrics (coalesce(bureau_id::text, 'global'), rubric_key, version);

CREATE INDEX IF NOT EXISTS idx_rag_v3_human_eval_rubric_status
    ON public.rag_v3_human_eval_rubrics (status, created_at DESC);

ALTER TABLE public.rag_v3_human_eval_rubrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_human_eval_rubric_service_all ON public.rag_v3_human_eval_rubrics;
CREATE POLICY rag_v3_human_eval_rubric_service_all
ON public.rag_v3_human_eval_rubrics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON TABLE public.rag_v3_backup_restore_drill_log TO service_role;
GRANT ALL ON TABLE public.rag_v3_rollback_drill_log TO service_role;
GRANT ALL ON TABLE public.rag_v3_human_eval_rubrics TO service_role;

COMMIT;
