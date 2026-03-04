-- =============================================================================
-- RAG V2.1 - Step 18 (Revised): Save Targets Core
-- =============================================================================
-- Migration: rag_v2_step18_save_targets.sql
--
-- Purpose:
--   Persists generated work products and user-owned personal documents so chat
--   output becomes a durable product artifact.
--
-- Tables:
--   1) public.saved_outputs
--   2) public.personal_documents
--
-- Dependencies:
--   - rag_v2_step6_tenant.sql   (bureaus / profiles.bureau_id)
--   - rag_v2_step17_memory.sql  (ai_threads / ai_messages)
--
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS patterns.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) saved_outputs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_outputs (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id           uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    case_id             uuid            REFERENCES public.cases(id) ON DELETE SET NULL,
    thread_id           uuid            REFERENCES public.ai_threads(id) ON DELETE SET NULL,
    source_message_id   uuid            REFERENCES public.ai_messages(id) ON DELETE SET NULL,
    title               text,
    output_type         text        NOT NULL DEFAULT 'analysis_note',
    content             text        NOT NULL CHECK (char_length(trim(content)) > 0),
    metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saved_outputs IS
    'Step 18 save targets: durable work-product outputs generated from chat.';

COMMENT ON COLUMN public.saved_outputs.output_type IS
    'High-level output class (e.g. analysis_note, memo, draft).';

CREATE INDEX IF NOT EXISTS idx_saved_outputs_bureau_created_at
    ON public.saved_outputs (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_outputs_user_created_at
    ON public.saved_outputs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_outputs_case_id
    ON public.saved_outputs (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_thread_id
    ON public.saved_outputs (thread_id)
    WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_source_message_id
    ON public.saved_outputs (source_message_id)
    WHERE source_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_saved_outputs_updated_at ON public.saved_outputs;
CREATE TRIGGER trg_saved_outputs_updated_at
BEFORE UPDATE ON public.saved_outputs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) personal_documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_documents (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id           uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    owner_user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    case_id             uuid            REFERENCES public.cases(id) ON DELETE SET NULL,
    file_name           text        NOT NULL,
    storage_path        text        NOT NULL,
    mime_type           text,
    size_bytes          bigint      NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    checksum_sha256     text,
    extracted_text      text,
    metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    is_deleted          boolean     NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.personal_documents IS
    'Step 18 save targets: user-owned document library for chat/retrieval workflows.';

CREATE INDEX IF NOT EXISTS idx_personal_documents_bureau_created_at
    ON public.personal_documents (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_documents_owner_created_at
    ON public.personal_documents (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_documents_case_id
    ON public.personal_documents (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personal_documents_not_deleted
    ON public.personal_documents (owner_user_id, is_deleted, created_at DESC);

DROP TRIGGER IF EXISTS trg_personal_documents_updated_at ON public.personal_documents;
CREATE TRIGGER trg_personal_documents_updated_at
BEFORE UPDATE ON public.personal_documents
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_outputs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_documents ENABLE ROW LEVEL SECURITY;

-- service_role bypass
DROP POLICY IF EXISTS saved_outputs_service_role_all ON public.saved_outputs;
CREATE POLICY saved_outputs_service_role_all
    ON public.saved_outputs FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS personal_documents_service_role_all ON public.personal_documents;
CREATE POLICY personal_documents_service_role_all
    ON public.personal_documents FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- saved_outputs: owner-only access + bureau match
DROP POLICY IF EXISTS saved_outputs_member_select ON public.saved_outputs;
CREATE POLICY saved_outputs_member_select
    ON public.saved_outputs FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_insert ON public.saved_outputs;
CREATE POLICY saved_outputs_member_insert
    ON public.saved_outputs FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_update ON public.saved_outputs;
CREATE POLICY saved_outputs_member_update
    ON public.saved_outputs FOR UPDATE TO authenticated
    USING (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_delete ON public.saved_outputs;
CREATE POLICY saved_outputs_member_delete
    ON public.saved_outputs FOR DELETE TO authenticated
    USING (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

-- personal_documents: owner-only access + bureau match
DROP POLICY IF EXISTS personal_documents_owner_select ON public.personal_documents;
CREATE POLICY personal_documents_owner_select
    ON public.personal_documents FOR SELECT TO authenticated
    USING (
        owner_user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS personal_documents_owner_insert ON public.personal_documents;
CREATE POLICY personal_documents_owner_insert
    ON public.personal_documents FOR INSERT TO authenticated
    WITH CHECK (
        owner_user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS personal_documents_owner_update ON public.personal_documents;
CREATE POLICY personal_documents_owner_update
    ON public.personal_documents FOR UPDATE TO authenticated
    USING (
        owner_user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    )
    WITH CHECK (
        owner_user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS personal_documents_owner_delete ON public.personal_documents;
CREATE POLICY personal_documents_owner_delete
    ON public.personal_documents FOR DELETE TO authenticated
    USING (
        owner_user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

-- ---------------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------------
GRANT ALL ON TABLE public.saved_outputs      TO service_role;
GRANT ALL ON TABLE public.personal_documents TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_outputs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_documents TO authenticated;

COMMIT;

