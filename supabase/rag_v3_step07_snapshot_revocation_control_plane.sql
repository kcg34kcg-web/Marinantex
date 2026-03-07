-- Step 07: Snapshot / revocation control plane for RAG v3
-- Purpose:
--   1) Track publish_epoch for consistent read snapshots
--   2) Track revocation_epoch for cache invalidation and mid-turn revoke guards

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

-- Ensure a global control row exists for non-tenant deployments.
INSERT INTO public.rag_v3_control_plane (scope_key, bureau_id, publish_epoch, revocation_epoch)
VALUES ('global', NULL, 0, 0)
ON CONFLICT (scope_key) DO NOTHING;
