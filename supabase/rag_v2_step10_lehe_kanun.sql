-- ============================================================================
-- Babylexit v3.0 — Step 10: Time-Travel Search ve "Lehe Kanun" Motoru
-- ============================================================================
-- Migration: rag_v2_step10_lehe_kanun.sql
--
-- Purpose:
--   1. hybrid_lehe_kanun_search() — single RPC that retrieves documents at
--      BOTH event_date AND decision_date in one round-trip, tagged with
--      version_type = 'EVENT_DATE' | 'DECISION_DATE'.
--   2. lehe_kanun_searches audit table — records each lehe kanun comparison
--      for compliance / cost dashboards (Step 17 prerequisite).
--
-- Legal Basis:
--   TCK Madde 7/2: Lehe kanun ilkesi (favor rei / in dubio mitius)
--   TCK Madde 7/3: Zamanaşımı sürelerine de uygulanır
--   Kabahatler Kanunu md. 5: İdari yaptırımlarda lehe kanun
--   VUK md. 360: Vergi cezalarında lehe hüküm
--
-- Dependencies:
--   rag_v2_step6_tenant.sql   (hybrid_legal_search with p_bureau_id)
--   rag_v2_step4_versioning.sql (p_event_date param)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit table for lehe kanun searches
--    Records each time the lehe kanun engine activates for compliance.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lehe_kanun_searches (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         uuid        REFERENCES cases(id) ON DELETE SET NULL,
    bureau_id       uuid        REFERENCES bureaus(id) ON DELETE SET NULL,
    query_hash      text        NOT NULL,
    law_domain      text        NOT NULL CHECK (law_domain IN (
                                    'CEZA', 'IDARI_CEZA', 'VERGI_CEZA', 'DIGER', 'UNKNOWN'
                                )),
    event_date      date        NOT NULL,
    decision_date   date        NOT NULL,
    event_doc_count int         DEFAULT 0,
    decision_doc_count int      DEFAULT 0,
    created_at      timestamptz DEFAULT now()
);

-- Index for compliance reporting: bureau + date range queries
CREATE INDEX IF NOT EXISTS lehe_kanun_searches_bureau_date_idx
    ON lehe_kanun_searches (bureau_id, created_at DESC);

-- Index for case-level audit trail
CREATE INDEX IF NOT EXISTS lehe_kanun_searches_case_idx
    ON lehe_kanun_searches (case_id, created_at DESC);

COMMENT ON TABLE lehe_kanun_searches IS
    'Audit log of lehe kanun (TCK md. 7/2) two-version searches. '
    'Each row = one activation of the lehe kanun engine. Required for Step 17 audit trail.';


-- ---------------------------------------------------------------------------
-- 2. hybrid_lehe_kanun_search — retrieves BOTH law versions in one round trip
--
--    Returns the same columns as hybrid_legal_search, plus:
--      version_type  text  — 'EVENT_DATE' | 'DECISION_DATE'
--
--    Deduplication: if event_date == decision_date, only EVENT_DATE rows are returned.
--    Bureau isolation: p_bureau_id filter is applied to BOTH version queries.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hybrid_lehe_kanun_search(
    query_embedding  vector(1536),
    query_text       text,
    case_scope       uuid    DEFAULT NULL,
    match_count      int     DEFAULT 10,
    p_event_date     date    DEFAULT NULL,
    p_decision_date  date    DEFAULT NULL,
    p_bureau_id      uuid    DEFAULT NULL
)
RETURNS TABLE (
    -- All columns from hybrid_legal_search
    id                    uuid,
    case_id               uuid,
    content               text,
    file_path             text,
    created_at            timestamptz,
    source_url            text,
    version               text,
    collected_at          timestamptz,
    court_level           text,
    ruling_date           date,
    citation              text,
    norm_hierarchy        text,
    chamber               text,
    majority_type         text,
    dissent_present       boolean,
    effective_date        date,
    expiry_date           date,
    aym_iptal_durumu      text,
    iptal_yururluk_tarihi date,
    aym_karar_no          text,
    aym_karar_tarihi      date,
    authority_score       float,
    is_binding_precedent  boolean,
    bureau_id             uuid,
    semantic_score        float,
    keyword_score         float,
    recency_score         float,
    hierarchy_score       float,
    final_score           float,
    -- Step 10 additions
    version_type          text    -- 'EVENT_DATE' | 'DECISION_DATE'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    -- EVENT_DATE version — always retrieved
    SELECT
        h.*,
        'EVENT_DATE'::text AS version_type
    FROM hybrid_legal_search(
        query_embedding,
        query_text,
        case_scope,
        match_count,
        p_event_date,
        p_bureau_id
    ) h

    UNION ALL

    -- DECISION_DATE version — only when different from event_date
    SELECT
        h.*,
        'DECISION_DATE'::text AS version_type
    FROM hybrid_legal_search(
        query_embedding,
        query_text,
        case_scope,
        match_count,
        p_decision_date,
        p_bureau_id
    ) h
    WHERE
        p_decision_date IS NOT NULL
        AND (p_event_date IS NULL OR p_decision_date <> p_event_date)
$$;

COMMENT ON FUNCTION hybrid_lehe_kanun_search IS
    'Retrieves documents at BOTH event_date AND decision_date for the lehe kanun '
    '(TCK md. 7/2) comparison. Returns version_type to allow the caller to label '
    'which law version each document belongs to. Part of Step 10.';

-- Grant execution to service role only (RLS enforced inside hybrid_legal_search)
REVOKE ALL ON FUNCTION hybrid_lehe_kanun_search FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hybrid_lehe_kanun_search TO service_role;


-- ---------------------------------------------------------------------------
-- 3. RLS policies for lehe_kanun_searches audit table
-- ---------------------------------------------------------------------------

ALTER TABLE lehe_kanun_searches ENABLE ROW LEVEL SECURITY;

-- Service role can read and write all rows
CREATE POLICY lehe_searches_service_all ON lehe_kanun_searches
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Bureau members can read their own bureau's audit rows
CREATE POLICY lehe_searches_bureau_read ON lehe_kanun_searches
    FOR SELECT
    TO authenticated
    USING (bureau_id = (
        SELECT bureau_id FROM profiles WHERE id = auth.uid() LIMIT 1
    ));


-- ---------------------------------------------------------------------------
-- 4. Enable updated_at trigger on lehe_kanun_searches
-- ---------------------------------------------------------------------------

-- (lehe_kanun_searches has no updated_at — it's append-only.  No trigger needed.)

-- ---------------------------------------------------------------------------
-- Migration complete
-- ---------------------------------------------------------------------------
COMMENT ON SCHEMA public IS
    'Babylexit v3.0 — rag_v2_step10_lehe_kanun migration applied';
