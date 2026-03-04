-- =============================================================================
-- RAG V2.1 - Step 17: Conversational Memory Core
-- =============================================================================
-- Migration: rag_v2_step17_memory.sql
--
-- Purpose:
--   Introduces normalized chat persistence tables to replace monolithic ai_chats
--   payloads and support product-level thread/message workflows.
--
-- Tables:
--   1) public.ai_threads   (case_id optional)
--   2) public.ai_messages
--
-- Dependencies:
--   - rag_v2_step6_tenant.sql (public.bureaus + profiles.bureau_id)
--
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS patterns.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) ai_threads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_threads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id        uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    case_id          uuid            REFERENCES public.cases(id) ON DELETE SET NULL,
    chat_mode        text        NOT NULL DEFAULT 'general_chat'
                               CHECK (chat_mode IN ('general_chat', 'document_analysis')),
    title            text,
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    last_message_at  timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_threads IS
    'Step 17 memory: normalized AI chat threads. case_id is optional in all modes.';

COMMENT ON COLUMN public.ai_threads.chat_mode IS
    'Product mode: general_chat | document_analysis.';

CREATE INDEX IF NOT EXISTS idx_ai_threads_bureau_created_at
    ON public.ai_threads (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_threads_user_created_at
    ON public.ai_threads (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_threads_case_id
    ON public.ai_threads (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_threads_last_message_at
    ON public.ai_threads (last_message_at DESC);

DROP TRIGGER IF EXISTS trg_ai_threads_updated_at ON public.ai_threads;
CREATE TRIGGER trg_ai_threads_updated_at
BEFORE UPDATE ON public.ai_threads
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) ai_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_messages (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id        uuid        NOT NULL REFERENCES public.ai_threads(id) ON DELETE CASCADE,
    bureau_id        uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    role             text        NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content          text        NOT NULL CHECK (char_length(trim(content)) > 0),
    response_type    text            CHECK (response_type IN ('legal_grounded', 'social_ungrounded')),
    model_used       text,
    source_count     integer     NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_messages IS
    'Step 17 memory: normalized message rows for each AI thread.';

COMMENT ON COLUMN public.ai_messages.response_type IS
    'assistant answers: legal_grounded | social_ungrounded.';

CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_created_at
    ON public.ai_messages (thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_messages_bureau_created_at
    ON public.ai_messages (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_messages_role_created_at
    ON public.ai_messages (role, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_ai_message_bureau_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    thread_bureau_id uuid;
BEGIN
    SELECT t.bureau_id
      INTO thread_bureau_id
      FROM public.ai_threads t
     WHERE t.id = NEW.thread_id
     LIMIT 1;

    IF thread_bureau_id IS NULL THEN
        RAISE EXCEPTION 'ai_messages.thread_id (%) has no matching thread', NEW.thread_id;
    END IF;

    IF NEW.bureau_id IS NULL THEN
        NEW.bureau_id := thread_bureau_id;
    ELSIF NEW.bureau_id <> thread_bureau_id THEN
        RAISE EXCEPTION
            'ai_messages.bureau_id (%) does not match ai_threads.bureau_id (%) for thread_id (%)',
            NEW.bureau_id, thread_bureau_id, NEW.thread_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_messages_sync_bureau_id ON public.ai_messages;
CREATE TRIGGER trg_ai_messages_sync_bureau_id
BEFORE INSERT OR UPDATE ON public.ai_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_ai_message_bureau_id();

CREATE OR REPLACE FUNCTION public.bump_ai_thread_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.ai_threads
       SET last_message_at = NEW.created_at,
           updated_at = now()
     WHERE id = NEW.thread_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_messages_bump_thread_last_message_at ON public.ai_messages;
CREATE TRIGGER trg_ai_messages_bump_thread_last_message_at
AFTER INSERT ON public.ai_messages
FOR EACH ROW
EXECUTE FUNCTION public.bump_ai_thread_last_message_at();

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- service_role bypass
DROP POLICY IF EXISTS ai_threads_service_role_all ON public.ai_threads;
CREATE POLICY ai_threads_service_role_all
    ON public.ai_threads FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ai_messages_service_role_all ON public.ai_messages;
CREATE POLICY ai_messages_service_role_all
    ON public.ai_messages FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- End-user access: own thread + same bureau
DROP POLICY IF EXISTS ai_threads_member_select ON public.ai_threads;
CREATE POLICY ai_threads_member_select
    ON public.ai_threads FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_threads_member_insert ON public.ai_threads;
CREATE POLICY ai_threads_member_insert
    ON public.ai_threads FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_threads_member_update ON public.ai_threads;
CREATE POLICY ai_threads_member_update
    ON public.ai_threads FOR UPDATE TO authenticated
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

DROP POLICY IF EXISTS ai_threads_member_delete ON public.ai_threads;
CREATE POLICY ai_threads_member_delete
    ON public.ai_threads FOR DELETE TO authenticated
    USING (
        user_id = auth.uid()
        AND bureau_id IS NOT DISTINCT FROM (
            SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS ai_messages_member_select ON public.ai_messages;
CREATE POLICY ai_messages_member_select
    ON public.ai_messages FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.ai_threads t
            WHERE t.id = ai_messages.thread_id
              AND t.user_id = auth.uid()
              AND t.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

-- End users can insert their own USER messages; assistant/tool writes stay on service_role.
DROP POLICY IF EXISTS ai_messages_member_insert_user_only ON public.ai_messages;
CREATE POLICY ai_messages_member_insert_user_only
    ON public.ai_messages FOR INSERT TO authenticated
    WITH CHECK (
        role = 'user'
        AND EXISTS (
            SELECT 1
            FROM public.ai_threads t
            WHERE t.id = ai_messages.thread_id
              AND t.user_id = auth.uid()
              AND t.bureau_id = ai_messages.bureau_id
              AND t.bureau_id IS NOT DISTINCT FROM (
                    SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
              )
        )
    );

-- ---------------------------------------------------------------------------
-- 4) Grants
-- ---------------------------------------------------------------------------
GRANT ALL ON TABLE public.ai_threads  TO service_role;
GRANT ALL ON TABLE public.ai_messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_threads  TO authenticated;
GRANT SELECT, INSERT                 ON TABLE public.ai_messages TO authenticated;

COMMIT;
