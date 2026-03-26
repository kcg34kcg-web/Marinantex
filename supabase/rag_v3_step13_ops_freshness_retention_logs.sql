-- ============================================================================
-- RAG V3 Step 13: Ops logs for official source freshness + retention deletes
-- ============================================================================
-- Goal:
--   1) Persist official-source freshness scheduler output for auditability.
--   2) Persist retention/deletion evidence rows for compliance controls.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.rag_v3_source_freshness_log (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    source_registry_id text NOT NULL,
    source_url         text NOT NULL,
    latest_remote_at   timestamptz,
    ingested_latest_at timestamptz,
    lag_hours          double precision NOT NULL DEFAULT 0.0
                    CHECK (lag_hours >= 0.0),
    freshness_state    text NOT NULL DEFAULT 'unknown'
                    CHECK (freshness_state IN ('fresh', 'stale', 'unknown', 'error')),
    scheduler_job      text NOT NULL DEFAULT 'manual',
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_created
    ON public.rag_v3_source_freshness_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_source
    ON public.rag_v3_source_freshness_log (source_registry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_state
    ON public.rag_v3_source_freshness_log (freshness_state, created_at DESC);

ALTER TABLE public.rag_v3_source_freshness_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_source_freshness_service_all ON public.rag_v3_source_freshness_log;
CREATE POLICY rag_v3_source_freshness_service_all
ON public.rag_v3_source_freshness_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rag_v3_retention_deletion_log (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    bureau_id    uuid,
    target_table text NOT NULL,
    target_id    text NOT NULL,
    reason       text,
    delete_mode  text NOT NULL DEFAULT 'soft'
              CHECK (delete_mode IN ('soft', 'hard')),
    deleted_by   text,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_retention_deletion_created
    ON public.rag_v3_retention_deletion_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_retention_deletion_bureau
    ON public.rag_v3_retention_deletion_log (bureau_id, created_at DESC);

ALTER TABLE public.rag_v3_retention_deletion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_retention_deletion_service_all ON public.rag_v3_retention_deletion_log;
CREATE POLICY rag_v3_retention_deletion_service_all
ON public.rag_v3_retention_deletion_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON TABLE public.rag_v3_source_freshness_log TO service_role;
GRANT ALL ON TABLE public.rag_v3_retention_deletion_log TO service_role;

COMMIT;
