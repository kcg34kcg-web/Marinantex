-- =========================================================================
-- RAG V3 Step 07: Snapshot / revocation control plane
-- =========================================================================
-- Purpose:
--   1) Track publish_epoch for consistent read snapshots
--   2) Track revocation_epoch for cache invalidation and mid-turn revoke guards
--   3) Provide tenant-scoped RLS + service-role write contract
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.rag_v3_control_plane (
    scope_key        text PRIMARY KEY,
    bureau_id        uuid NULL,
    publish_epoch    bigint NOT NULL DEFAULT 0,
    revocation_epoch bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_rag_v3_control_plane_bureau
    ON public.rag_v3_control_plane (bureau_id);

CREATE OR REPLACE FUNCTION public.rag_v3_control_plane_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_v3_control_plane_updated_at ON public.rag_v3_control_plane;
CREATE TRIGGER trg_rag_v3_control_plane_updated_at
BEFORE UPDATE ON public.rag_v3_control_plane
FOR EACH ROW
EXECUTE FUNCTION public.rag_v3_control_plane_set_updated_at();

-- Ensure global row for non-tenant / mixed deployments.
INSERT INTO public.rag_v3_control_plane (scope_key, bureau_id, publish_epoch, revocation_epoch)
VALUES ('global', NULL, 0, 0)
ON CONFLICT (scope_key) DO NOTHING;

ALTER TABLE public.rag_v3_control_plane ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_v3_control_plane_service_all ON public.rag_v3_control_plane;
CREATE POLICY rag_v3_control_plane_service_all
ON public.rag_v3_control_plane
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS rag_v3_control_plane_authenticated_read ON public.rag_v3_control_plane;
CREATE POLICY rag_v3_control_plane_authenticated_read
ON public.rag_v3_control_plane
FOR SELECT
TO authenticated
USING (
    bureau_id IS NULL
    OR bureau_id::text = auth.jwt()->>'bureau_id'
);

GRANT ALL ON TABLE public.rag_v3_control_plane TO service_role;
GRANT SELECT ON TABLE public.rag_v3_control_plane TO authenticated;

COMMIT;
