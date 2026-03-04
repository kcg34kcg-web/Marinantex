-- ============================================================================
-- RAG V3 Step 05: Request-level audit trace + response contract versioning
-- ============================================================================
-- Goal:
--   1) Persist one row per query request with retrieval/gate/model trace.
--   2) Keep contract/schema version metadata per response for deterministic
--      SaaS rollouts and backward-compatible clients.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.rag_v3_query_traces (
    request_id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    bureau_id          uuid,
    query_text         text NOT NULL,
    response_status    text NOT NULL DEFAULT 'ok'
                    CHECK (response_status IN ('ok', 'no_answer')),
    gate_decision      text NOT NULL DEFAULT 'answered',
    requested_tier     int NOT NULL DEFAULT 2
                    CHECK (requested_tier BETWEEN 1 AND 4),
    effective_tier     int NOT NULL DEFAULT 2
                    CHECK (effective_tier BETWEEN 1 AND 4),
    top_k              int NOT NULL DEFAULT 10
                    CHECK (top_k >= 1 AND top_k <= 50),
    jurisdiction       text NOT NULL DEFAULT 'TR',
    as_of_date         date,
    admission_reason   text NOT NULL DEFAULT 'accepted',
    retrieved_count    int NOT NULL DEFAULT 0
                    CHECK (retrieved_count >= 0),
    retrieved_chunk_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    retrieval_trace    jsonb NOT NULL DEFAULT '[]'::jsonb,
    citations          jsonb NOT NULL DEFAULT '[]'::jsonb,
    fingerprint        jsonb NOT NULL DEFAULT '{}'::jsonb,
    warnings           text[] NOT NULL DEFAULT ARRAY[]::text[],
    contract_version   text NOT NULL DEFAULT 'rag.v3.query.response.v1',
    schema_version     text NOT NULL DEFAULT 'rag.v3.query.response.schema.v1',
    latency_ms         int NOT NULL DEFAULT 0
                    CHECK (latency_ms >= 0),
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.rag_v3_query_traces
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS bureau_id uuid,
    ADD COLUMN IF NOT EXISTS query_text text,
    ADD COLUMN IF NOT EXISTS response_status text NOT NULL DEFAULT 'ok',
    ADD COLUMN IF NOT EXISTS gate_decision text NOT NULL DEFAULT 'answered',
    ADD COLUMN IF NOT EXISTS requested_tier int NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS effective_tier int NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS top_k int NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS jurisdiction text NOT NULL DEFAULT 'TR',
    ADD COLUMN IF NOT EXISTS as_of_date date,
    ADD COLUMN IF NOT EXISTS admission_reason text NOT NULL DEFAULT 'accepted',
    ADD COLUMN IF NOT EXISTS retrieved_count int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS retrieved_chunk_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS retrieval_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS warnings text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS contract_version text NOT NULL DEFAULT 'rag.v3.query.response.v1',
    ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'rag.v3.query.response.schema.v1',
    ADD COLUMN IF NOT EXISTS latency_ms int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_created
    ON public.rag_v3_query_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_bureau_created
    ON public.rag_v3_query_traces (bureau_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_status_created
    ON public.rag_v3_query_traces (response_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_gate_decision
    ON public.rag_v3_query_traces (gate_decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_v3_query_traces_contract_version
    ON public.rag_v3_query_traces (contract_version, created_at DESC);

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
