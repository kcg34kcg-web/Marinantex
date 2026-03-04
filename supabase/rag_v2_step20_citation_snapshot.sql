-- =============================================================================
-- RAG V2.1 - Step 20: Citation Snapshot Persistence
-- =============================================================================
-- Migration: rag_v2_step20_citation_snapshot.sql
--
-- Purpose:
--   Persists immutable citation snapshots for saved legal outputs so we can
--   answer "which exact sources supported this output at save time?".
--
-- Approach:
--   Separate table model: public.saved_output_citations
--   + convenience read models (view + SQL function).
--
-- Dependencies:
--   - rag_v2_step18_save_targets.sql
--   - rag_v2_step19_work_product_versioning.sql
--
-- Safe to re-run: idempotent DDL and policy patterns.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Snapshot table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_output_citations (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    saved_output_id  uuid        NOT NULL REFERENCES public.saved_outputs(id) ON DELETE CASCADE,
    bureau_id        uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    source_id        text        NOT NULL,
    source_type      text        NOT NULL
                               CHECK (source_type IN ('kanun', 'ictihat', 'user_document', 'other')),
    source_anchor    text,
    page_no          integer     CHECK (page_no IS NULL OR page_no >= 1),
    char_start       integer     CHECK (char_start IS NULL OR char_start >= 0),
    char_end         integer     CHECK (char_end IS NULL OR char_end >= 0),
    source_hash      text,
    doc_version      text,
    citation_text    text,
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT saved_output_citations_char_range_check
        CHECK (
            char_start IS NULL
            OR char_end IS NULL
            OR char_end >= char_start
        )
);

COMMENT ON TABLE public.saved_output_citations IS
    'Step 20 citation snapshot rows captured when a legal output is saved.';

COMMENT ON COLUMN public.saved_output_citations.source_anchor IS
    'Locator anchor string used by source split-view (paragraph, section, xpath, etc.).';

COMMENT ON COLUMN public.saved_output_citations.doc_version IS
    'Document version tag at snapshot time (effective date, revision id, etc.).';

CREATE INDEX IF NOT EXISTS idx_saved_output_citations_output_id
    ON public.saved_output_citations (saved_output_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_saved_output_citations_bureau_created_at
    ON public.saved_output_citations (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_output_citations_source_type
    ON public.saved_output_citations (source_type);

-- ---------------------------------------------------------------------------
-- 2) Ownership consistency trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_saved_output_citation_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_bureau_id uuid;
    parent_user_id uuid;
BEGIN
    SELECT s.bureau_id, s.user_id
      INTO parent_bureau_id, parent_user_id
      FROM public.saved_outputs s
     WHERE s.id = NEW.saved_output_id
     LIMIT 1;

    IF parent_bureau_id IS NULL OR parent_user_id IS NULL THEN
        RAISE EXCEPTION 'saved_output_id (%) not found', NEW.saved_output_id;
    END IF;

    IF NEW.bureau_id IS NULL THEN
        NEW.bureau_id := parent_bureau_id;
    ELSIF NEW.bureau_id <> parent_bureau_id THEN
        RAISE EXCEPTION
            'citation bureau_id (%) must match saved_output bureau_id (%)',
            NEW.bureau_id, parent_bureau_id;
    END IF;

    IF NEW.user_id IS NULL THEN
        NEW.user_id := parent_user_id;
    ELSIF NEW.user_id <> parent_user_id THEN
        RAISE EXCEPTION
            'citation user_id (%) must match saved_output user_id (%)',
            NEW.user_id, parent_user_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_output_citations_sync_owner ON public.saved_output_citations;
CREATE TRIGGER trg_saved_output_citations_sync_owner
BEFORE INSERT OR UPDATE ON public.saved_output_citations
FOR EACH ROW
EXECUTE FUNCTION public.sync_saved_output_citation_owner();

-- ---------------------------------------------------------------------------
-- 3) Read models
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.saved_output_citation_snapshots AS
SELECT
    c.saved_output_id,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'source_id', c.source_id,
                'source_type', c.source_type,
                'source_anchor', c.source_anchor,
                'page_no', c.page_no,
                'char_start', c.char_start,
                'char_end', c.char_end,
                'source_hash', c.source_hash,
                'doc_version', c.doc_version,
                'citation_text', c.citation_text,
                'metadata', c.metadata
            )
            ORDER BY c.created_at ASC, c.id ASC
        ),
        '[]'::jsonb
    ) AS citation_snapshot,
    COUNT(*)::integer AS citation_count
FROM public.saved_output_citations c
GROUP BY c.saved_output_id;

COMMENT ON VIEW public.saved_output_citation_snapshots IS
    'Aggregated citation_snapshot JSON per saved_output_id.';

CREATE OR REPLACE FUNCTION public.get_saved_output_citation_snapshot(
    p_saved_output_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT scs.citation_snapshot
            FROM public.saved_output_citation_snapshots scs
            WHERE scs.saved_output_id = p_saved_output_id
            LIMIT 1
        ),
        '[]'::jsonb
    );
$$;

COMMENT ON FUNCTION public.get_saved_output_citation_snapshot(uuid) IS
    'Returns citation snapshot JSON for a saved output. Empty JSON array when none.';

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_output_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_output_citations_service_role_all ON public.saved_output_citations;
CREATE POLICY saved_output_citations_service_role_all
    ON public.saved_output_citations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS saved_output_citations_member_select ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_select
    ON public.saved_output_citations
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.user_id = auth.uid()
              AND s.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_insert ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_insert
    ON public.saved_output_citations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.user_id = auth.uid()
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND s.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_update ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_update
    ON public.saved_output_citations
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.user_id = auth.uid()
              AND s.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.user_id = auth.uid()
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND s.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_delete ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_delete
    ON public.saved_output_citations
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.user_id = auth.uid()
              AND s.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

-- ---------------------------------------------------------------------------
-- 5) Grants
-- ---------------------------------------------------------------------------
GRANT ALL ON TABLE public.saved_output_citations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_output_citations TO authenticated;

GRANT SELECT ON public.saved_output_citation_snapshots TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_saved_output_citation_snapshot(uuid) TO authenticated, service_role;

COMMIT;

