-- ============================================================================
-- RAG V3 Step 03: Governance + Operations tables
-- ============================================================================
-- Covers:
--   1) Human-review queue (escalation workflow)
--   2) Feedback candidate sink (eval/fine-tune flywheel)
--   3) Index lifecycle registry (activate/rollback)
--   4) DR event log (backup/restore drills and incidents)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Human review queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_review_queue (
    id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    bureau_id      uuid,
    query_text     text NOT NULL,
    answer_text    text NOT NULL,
    reason_codes   text[] NOT NULL DEFAULT ARRAY[]::text[],
    confidence     double precision NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    citations      jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_review', 'resolved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_review_queue_created
    ON public.rag_v3_review_queue (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_review_queue_status
    ON public.rag_v3_review_queue (status);
CREATE INDEX IF NOT EXISTS idx_rag_v3_review_queue_bureau_created
    ON public.rag_v3_review_queue (bureau_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) Feedback sink for eval/fine-tune pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_feedback_examples (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    bureau_id        uuid,
    query_text       text NOT NULL,
    answer_text      text NOT NULL,
    response_status  text NOT NULL CHECK (response_status IN ('ok', 'no_answer')),
    reasons          text[] NOT NULL DEFAULT ARRAY[]::text[],
    fingerprint      jsonb NOT NULL DEFAULT '{}'::jsonb,
    citations        jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
    exported_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_feedback_examples_created
    ON public.rag_v3_feedback_examples (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_feedback_examples_exported
    ON public.rag_v3_feedback_examples (exported_at);
CREATE INDEX IF NOT EXISTS idx_rag_v3_feedback_examples_bureau_created
    ON public.rag_v3_feedback_examples (bureau_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) Index lifecycle registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_index_registry (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    activated_at     timestamptz,
    index_version    text NOT NULL UNIQUE,
    embedding_model  text NOT NULL,
    embedding_dim    int NOT NULL CHECK (embedding_dim > 0),
    status           text NOT NULL DEFAULT 'building'
                  CHECK (status IN ('building', 'active', 'retired', 'failed')),
    notes            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_index_registry_status
    ON public.rag_v3_index_registry (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.rag_v3_activate_index(
    p_index_version text,
    p_notes jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.rag_v3_index_registry
       SET status = 'retired'
     WHERE status = 'active'
       AND index_version <> p_index_version;

    UPDATE public.rag_v3_index_registry
       SET status = 'active',
           activated_at = now(),
           notes = COALESCE(notes, '{}'::jsonb) || COALESCE(p_notes, '{}'::jsonb)
     WHERE index_version = p_index_version;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) DR event log (backup/restore operations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_dr_events (
    id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at     timestamptz NOT NULL DEFAULT now(),
    event_type     text NOT NULL
                 CHECK (event_type IN ('backup_started', 'backup_completed', 'restore_started', 'restore_completed', 'drill')),
    event_status   text NOT NULL
                 CHECK (event_status IN ('ok', 'failed', 'in_progress')),
    rto_minutes    int,
    rpo_minutes    int,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_dr_events_created
    ON public.rag_v3_dr_events (created_at DESC);

-- ---------------------------------------------------------------------------
-- Shared trigger for updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rag_v3_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_v3_review_queue_updated_at ON public.rag_v3_review_queue;
CREATE TRIGGER trg_rag_v3_review_queue_updated_at
BEFORE UPDATE ON public.rag_v3_review_queue
FOR EACH ROW
EXECUTE FUNCTION public.rag_v3_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: service-role full access + authenticated read-only in same bureau
-- ---------------------------------------------------------------------------
ALTER TABLE public.rag_v3_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_v3_feedback_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_v3_index_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_v3_dr_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_review_queue_service_all ON public.rag_v3_review_queue;
CREATE POLICY rag_v3_review_queue_service_all
ON public.rag_v3_review_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_feedback_examples_service_all ON public.rag_v3_feedback_examples;
CREATE POLICY rag_v3_feedback_examples_service_all
ON public.rag_v3_feedback_examples
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_index_registry_service_all ON public.rag_v3_index_registry;
CREATE POLICY rag_v3_index_registry_service_all
ON public.rag_v3_index_registry
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_dr_events_service_all ON public.rag_v3_dr_events;
CREATE POLICY rag_v3_dr_events_service_all
ON public.rag_v3_dr_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_review_queue_authenticated_read ON public.rag_v3_review_queue;
CREATE POLICY rag_v3_review_queue_authenticated_read
ON public.rag_v3_review_queue
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

DROP POLICY IF EXISTS rag_v3_feedback_examples_authenticated_read ON public.rag_v3_feedback_examples;
CREATE POLICY rag_v3_feedback_examples_authenticated_read
ON public.rag_v3_feedback_examples
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

GRANT ALL ON TABLE public.rag_v3_review_queue TO service_role;
GRANT ALL ON TABLE public.rag_v3_feedback_examples TO service_role;
GRANT ALL ON TABLE public.rag_v3_index_registry TO service_role;
GRANT ALL ON TABLE public.rag_v3_dr_events TO service_role;
GRANT SELECT ON TABLE public.rag_v3_review_queue TO authenticated;
GRANT SELECT ON TABLE public.rag_v3_feedback_examples TO authenticated;
GRANT SELECT ON TABLE public.rag_v3_index_registry TO authenticated;
GRANT SELECT ON TABLE public.rag_v3_dr_events TO authenticated;
GRANT EXECUTE ON FUNCTION public.rag_v3_activate_index(text, jsonb)
    TO authenticated, service_role;

COMMIT;
