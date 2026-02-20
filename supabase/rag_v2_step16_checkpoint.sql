-- =============================================================================
-- rag_v2_step16_checkpoint.sql
-- LangGraph Agent Checkpoints — Step 16 (Multi-Agent State Persistence)
-- =============================================================================
-- Migrates AsyncPostgresCheckpointer.setup() out of runtime code and into
-- a proper Supabase migration.  This brings the agent_checkpoints table
-- under Supabase's RLS / RBAC umbrella.
--
-- Table: public.langgraph_checkpoints   (matches settings.checkpoint_table_name)
--
-- RLS tenant isolation:
--   Each row is scoped to a bureau_id. Rows without a bureau_id are
--   accessible only to service_role (system-level workflows).
--
-- Run order: after rag_v2_step15_audit.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Extension (idempotent)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.langgraph_checkpoints (
    checkpoint_id   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id       TEXT        NOT NULL,
    checkpoint_ns   TEXT        NOT NULL DEFAULT '',
    step            INTEGER     NOT NULL,
    data            JSONB       NOT NULL,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    bureau_id       UUID        REFERENCES public.bureaus(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_langgraph_thread_step
        UNIQUE (thread_id, checkpoint_ns, step)
);

COMMENT ON TABLE  public.langgraph_checkpoints IS
    'LangGraph multi-agent workflow checkpoints. '
    'Enables time-travel debugging and multi-turn conversation memory.';
COMMENT ON COLUMN public.langgraph_checkpoints.thread_id       IS 'Conversation or session identifier (UUID string).';
COMMENT ON COLUMN public.langgraph_checkpoints.checkpoint_ns   IS 'Workflow namespace, e.g. "agent:planner".';
COMMENT ON COLUMN public.langgraph_checkpoints.step            IS 'Monotonically increasing step counter within a thread.';
COMMENT ON COLUMN public.langgraph_checkpoints.data            IS 'Serialised agent state (JSON).';
COMMENT ON COLUMN public.langgraph_checkpoints.metadata        IS 'Supplementary context (model, latency, tool calls, …).';
COMMENT ON COLUMN public.langgraph_checkpoints.bureau_id       IS 'Tenant bureau. NULL = system-level workflow (service_role only).';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lgcp_thread_id
    ON public.langgraph_checkpoints (thread_id);

CREATE INDEX IF NOT EXISTS idx_lgcp_bureau_id
    ON public.langgraph_checkpoints (bureau_id)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lgcp_thread_step
    ON public.langgraph_checkpoints (thread_id, step DESC);

CREATE INDEX IF NOT EXISTS idx_lgcp_created_at
    ON public.langgraph_checkpoints (created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.langgraph_checkpoints ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS — all operations allowed
DROP POLICY IF EXISTS lgcp_service_role_all ON public.langgraph_checkpoints;
CREATE POLICY lgcp_service_role_all
    ON public.langgraph_checkpoints
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users see only checkpoints belonging to their bureau
DROP POLICY IF EXISTS lgcp_member_select ON public.langgraph_checkpoints;
CREATE POLICY lgcp_member_select
    ON public.langgraph_checkpoints
    FOR SELECT
    TO authenticated
    USING (
        bureau_id = (
            SELECT bureau_id
            FROM   public.profiles
            WHERE  id = auth.uid()
            LIMIT  1
        )
    );

-- Authenticated users may insert checkpoints for their own bureau
DROP POLICY IF EXISTS lgcp_member_insert ON public.langgraph_checkpoints;
CREATE POLICY lgcp_member_insert
    ON public.langgraph_checkpoints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bureau_id = (
            SELECT bureau_id
            FROM   public.profiles
            WHERE  id = auth.uid()
            LIMIT  1
        )
    );

-- Authenticated users may upsert (ON CONFLICT UPDATE) their own bureau rows
DROP POLICY IF EXISTS lgcp_member_update ON public.langgraph_checkpoints;
CREATE POLICY lgcp_member_update
    ON public.langgraph_checkpoints
    FOR UPDATE
    TO authenticated
    USING (
        bureau_id = (
            SELECT bureau_id
            FROM   public.profiles
            WHERE  id = auth.uid()
            LIMIT  1
        )
    )
    WITH CHECK (
        bureau_id = (
            SELECT bureau_id
            FROM   public.profiles
            WHERE  id = auth.uid()
            LIMIT  1
        )
    );

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.langgraph_checkpoints TO authenticated;
GRANT ALL                     ON public.langgraph_checkpoints TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Cleanup: oldest N checkpoints per thread (keep last 50 steps)
-- ---------------------------------------------------------------------------
-- Optional housekeeping function — called manually or via pg_cron.
CREATE OR REPLACE FUNCTION public.prune_old_checkpoints(
    p_keep_last INTEGER DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.langgraph_checkpoints
    WHERE checkpoint_id IN (
        SELECT checkpoint_id
        FROM (
            SELECT checkpoint_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY thread_id, checkpoint_ns
                       ORDER BY step DESC
                   ) AS rn
            FROM   public.langgraph_checkpoints
        ) ranked
        WHERE rn > p_keep_last
    );
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.prune_old_checkpoints(INTEGER) IS
    'Deletes old checkpoints beyond the last N steps per thread/namespace. '
    'Run periodically via pg_cron: SELECT prune_old_checkpoints(50);';

GRANT EXECUTE ON FUNCTION public.prune_old_checkpoints(INTEGER) TO service_role;

COMMIT;
