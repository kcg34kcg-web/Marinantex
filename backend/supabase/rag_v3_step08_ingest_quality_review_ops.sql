-- ============================================================================
-- RAG V3 Step 08: Ingest quality reprocess queue + human-review lifecycle ops
-- ============================================================================
-- Adds:
--   1) rag_v3_ingest_reprocess_queue for failed parser/OCR/metadata ingests
--   2) operational lifecycle columns to rag_v3_review_queue (assignment/SLA/closure)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Ingest reprocess queue (fail-closed ingest back-office lane)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_ingest_reprocess_queue (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    bureau_id          uuid,
    title              text NOT NULL,
    source_type        text NOT NULL,
    source_id          text NOT NULL,
    jurisdiction       text NOT NULL DEFAULT 'TR',
    reason_codes       text[] NOT NULL DEFAULT ARRAY[]::text[],
    quality_score      double precision NOT NULL DEFAULT 0.0 CHECK (quality_score >= 0.0 AND quality_score <= 1.0),
    parser_confidence  double precision NOT NULL DEFAULT 0.0 CHECK (parser_confidence >= 0.0 AND parser_confidence <= 1.0),
    ocr_confidence     double precision NOT NULL DEFAULT 0.0 CHECK (ocr_confidence >= 0.0 AND ocr_confidence <= 1.0),
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_review', 'reprocessed', 'rejected')),
    assigned_to        uuid,
    assigned_at        timestamptz,
    due_at             timestamptz,
    resolved_at        timestamptz,
    resolution_code    text,
    reviewer_feedback  text,
    escalation_reason  text,
    audit_trail        jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_ingest_reprocess_created
    ON public.rag_v3_ingest_reprocess_queue (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_ingest_reprocess_status
    ON public.rag_v3_ingest_reprocess_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_ingest_reprocess_bureau_status
    ON public.rag_v3_ingest_reprocess_queue (bureau_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) Human review queue lifecycle hardening
-- ---------------------------------------------------------------------------
ALTER TABLE public.rag_v3_review_queue
    ADD COLUMN IF NOT EXISTS assigned_to uuid,
    ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
    ADD COLUMN IF NOT EXISTS due_at timestamptz,
    ADD COLUMN IF NOT EXISTS sla_minutes int,
    ADD COLUMN IF NOT EXISTS risk_level text,
    ADD COLUMN IF NOT EXISTS severity text,
    ADD COLUMN IF NOT EXISTS closure_code text,
    ADD COLUMN IF NOT EXISTS reviewer_feedback text,
    ADD COLUMN IF NOT EXISTS escalation_reason text,
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
    ADD COLUMN IF NOT EXISTS audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_rag_v3_review_queue_sla_minutes'
    ) THEN
        ALTER TABLE public.rag_v3_review_queue
            ADD CONSTRAINT chk_rag_v3_review_queue_sla_minutes
            CHECK (sla_minutes IS NULL OR sla_minutes > 0);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_rag_v3_review_queue_risk_level'
    ) THEN
        ALTER TABLE public.rag_v3_review_queue
            ADD CONSTRAINT chk_rag_v3_review_queue_risk_level
            CHECK (risk_level IS NULL OR risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_rag_v3_review_queue_severity'
    ) THEN
        ALTER TABLE public.rag_v3_review_queue
            ADD CONSTRAINT chk_rag_v3_review_queue_severity
            CHECK (severity IS NULL OR severity IN ('P0', 'P1', 'P2', 'P3'));
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_rag_v3_review_queue_closure_code'
    ) THEN
        ALTER TABLE public.rag_v3_review_queue
            ADD CONSTRAINT chk_rag_v3_review_queue_closure_code
            CHECK (
                closure_code IS NULL
                OR closure_code IN (
                    'approved',
                    'rejected_unsupported',
                    'rejected_policy',
                    'needs_more_evidence',
                    'duplicate',
                    'escalated'
                )
            );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_rag_v3_review_queue_assigned_status
    ON public.rag_v3_review_queue (assigned_to, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_review_queue_due
    ON public.rag_v3_review_queue (due_at)
    WHERE status IN ('pending', 'in_review');

-- ---------------------------------------------------------------------------
-- 3) Official source freshness + retention/deletion evidence logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_v3_source_freshness_log (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    bureau_id          uuid,
    source_registry_id text NOT NULL,
    source_url         text NOT NULL,
    latest_remote_at   timestamptz,
    ingested_latest_at timestamptz,
    lag_hours          double precision NOT NULL DEFAULT 0.0 CHECK (lag_hours >= 0.0),
    freshness_state    text NOT NULL DEFAULT 'unknown'
                    CHECK (freshness_state IN ('fresh', 'stale', 'unknown', 'error')),
    scheduler_job      text,
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_created
    ON public.rag_v3_source_freshness_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_source
    ON public.rag_v3_source_freshness_log (source_registry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_source_freshness_state
    ON public.rag_v3_source_freshness_log (freshness_state, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rag_v3_retention_deletion_log (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    bureau_id          uuid,
    actor_id           uuid,
    action             text NOT NULL
                    CHECK (action IN ('delete_document', 'tombstone_document', 'hard_delete_document', 'retention_purge')),
    target_document_id uuid,
    target_source_id   text,
    result_status      text NOT NULL DEFAULT 'ok' CHECK (result_status IN ('ok', 'failed')),
    evidence           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_retention_deletion_created
    ON public.rag_v3_retention_deletion_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_retention_deletion_bureau
    ON public.rag_v3_retention_deletion_log (bureau_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4) Shared updated_at trigger for new queues
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_rag_v3_ingest_reprocess_queue_updated_at ON public.rag_v3_ingest_reprocess_queue;
CREATE TRIGGER trg_rag_v3_ingest_reprocess_queue_updated_at
BEFORE UPDATE ON public.rag_v3_ingest_reprocess_queue
FOR EACH ROW
EXECUTE FUNCTION public.rag_v3_set_updated_at();

DROP TRIGGER IF EXISTS trg_rag_v3_source_freshness_log_updated_at ON public.rag_v3_source_freshness_log;
CREATE TRIGGER trg_rag_v3_source_freshness_log_updated_at
BEFORE UPDATE ON public.rag_v3_source_freshness_log
FOR EACH ROW
EXECUTE FUNCTION public.rag_v3_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS + grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.rag_v3_ingest_reprocess_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_v3_source_freshness_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_v3_retention_deletion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_ingest_reprocess_service_all ON public.rag_v3_ingest_reprocess_queue;
CREATE POLICY rag_v3_ingest_reprocess_service_all
ON public.rag_v3_ingest_reprocess_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_ingest_reprocess_authenticated_read ON public.rag_v3_ingest_reprocess_queue;
CREATE POLICY rag_v3_ingest_reprocess_authenticated_read
ON public.rag_v3_ingest_reprocess_queue
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

DROP POLICY IF EXISTS rag_v3_source_freshness_service_all ON public.rag_v3_source_freshness_log;
CREATE POLICY rag_v3_source_freshness_service_all
ON public.rag_v3_source_freshness_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_source_freshness_authenticated_read ON public.rag_v3_source_freshness_log;
CREATE POLICY rag_v3_source_freshness_authenticated_read
ON public.rag_v3_source_freshness_log
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

DROP POLICY IF EXISTS rag_v3_retention_deletion_service_all ON public.rag_v3_retention_deletion_log;
CREATE POLICY rag_v3_retention_deletion_service_all
ON public.rag_v3_retention_deletion_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_retention_deletion_authenticated_read ON public.rag_v3_retention_deletion_log;
CREATE POLICY rag_v3_retention_deletion_authenticated_read
ON public.rag_v3_retention_deletion_log
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

GRANT ALL ON TABLE public.rag_v3_ingest_reprocess_queue TO service_role;
GRANT SELECT ON TABLE public.rag_v3_ingest_reprocess_queue TO authenticated;
GRANT ALL ON TABLE public.rag_v3_source_freshness_log TO service_role;
GRANT SELECT ON TABLE public.rag_v3_source_freshness_log TO authenticated;
GRANT ALL ON TABLE public.rag_v3_retention_deletion_log TO service_role;
GRANT SELECT ON TABLE public.rag_v3_retention_deletion_log TO authenticated;

COMMIT;
