-- ============================================================================
-- RAG V3 Step 05: Query Trace Contract (audit-forensic backbone)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.rag_v3_query_traces (
    request_id           text PRIMARY KEY,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    bureau_id            uuid,

    query_text           text NOT NULL,
    response_status      text NOT NULL DEFAULT 'ok' CHECK (response_status IN ('ok', 'no_answer')),
    gate_decision        text NOT NULL DEFAULT 'answered',

    requested_tier       int NOT NULL DEFAULT 2 CHECK (requested_tier BETWEEN 1 AND 4),
    effective_tier       int NOT NULL DEFAULT 2 CHECK (effective_tier BETWEEN 1 AND 4),
    top_k                int NOT NULL DEFAULT 10 CHECK (top_k BETWEEN 1 AND 50),
    jurisdiction         text NOT NULL DEFAULT 'TR',
    as_of_date           date,
    admission_reason     text NOT NULL DEFAULT 'accepted',

    retrieved_count      int NOT NULL DEFAULT 0 CHECK (retrieved_count >= 0),
    retrieved_chunk_ids  text[] NOT NULL DEFAULT ARRAY[]::text[],
    retrieval_trace      jsonb NOT NULL DEFAULT '[]'::jsonb,
    citations            jsonb NOT NULL DEFAULT '[]'::jsonb,
    fingerprint          jsonb NOT NULL DEFAULT '{}'::jsonb,

    warnings             text[] NOT NULL DEFAULT ARRAY[]::text[],
    contract_version     text NOT NULL DEFAULT 'rag.v3.query.response.v1',
    schema_version       text NOT NULL DEFAULT 'rag.v3.query.response.schema.v1',
    latency_ms           int NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_created
    ON public.rag_v3_query_traces (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_bureau_created
    ON public.rag_v3_query_traces (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_status
    ON public.rag_v3_query_traces (response_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_gate
    ON public.rag_v3_query_traces (gate_decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_contract_version
    ON public.rag_v3_query_traces (contract_version, schema_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_metadata
    ON public.rag_v3_query_traces USING GIN (metadata);

CREATE OR REPLACE FUNCTION public.rag_v3_query_traces_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_v3_query_traces_updated_at ON public.rag_v3_query_traces;
CREATE TRIGGER trg_rag_v3_query_traces_updated_at
BEFORE UPDATE ON public.rag_v3_query_traces
FOR EACH ROW
EXECUTE FUNCTION public.rag_v3_query_traces_set_updated_at();

ALTER TABLE public.rag_v3_query_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_query_traces_service_all ON public.rag_v3_query_traces;
CREATE POLICY rag_v3_query_traces_service_all
ON public.rag_v3_query_traces
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_query_traces_authenticated_read ON public.rag_v3_query_traces;
CREATE POLICY rag_v3_query_traces_authenticated_read
ON public.rag_v3_query_traces
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

GRANT ALL ON TABLE public.rag_v3_query_traces TO service_role;
GRANT SELECT ON TABLE public.rag_v3_query_traces TO authenticated;

COMMIT;
