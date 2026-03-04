-- =============================================================================
-- RAG V3 - Step 26: Assistant Message Feedback
-- =============================================================================
-- Migration: rag_v2_step26_message_feedback.sql
--
-- Purpose:
--   Stores per-user like/dislike feedback for assistant messages and
--   optional dislike reason codes for product analytics.
--
-- Dependencies:
--   - rag_v2_step17_memory.sql (ai_threads / ai_messages)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ai_message_feedback (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id    uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    thread_id    uuid        NOT NULL REFERENCES public.ai_threads(id) ON DELETE CASCADE,
    message_id   uuid        NOT NULL REFERENCES public.ai_messages(id) ON DELETE CASCADE,
    reaction     text        NOT NULL CHECK (reaction IN ('like', 'dislike')),
    reason_code  text,
    metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_message_feedback_reason_code_len CHECK (
      reason_code IS NULL OR char_length(trim(reason_code)) BETWEEN 1 AND 64
    ),
    CONSTRAINT ai_message_feedback_message_user_unique UNIQUE (user_id, message_id)
);

COMMENT ON TABLE public.ai_message_feedback IS
    'Step 26 user feedback rows for assistant messages (like/dislike + optional reason).';

CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_thread_created_at
    ON public.ai_message_feedback (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_bureau_created_at
    ON public.ai_message_feedback (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_message_feedback_reaction_created_at
    ON public.ai_message_feedback (reaction, created_at DESC);

DROP TRIGGER IF EXISTS trg_ai_message_feedback_updated_at ON public.ai_message_feedback;
CREATE TRIGGER trg_ai_message_feedback_updated_at
BEFORE UPDATE ON public.ai_message_feedback
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_ai_message_feedback_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_thread_user_id uuid;
    v_thread_bureau_id uuid;
    v_message_thread_id uuid;
    v_message_bureau_id uuid;
    v_message_role text;
BEGIN
    SELECT t.user_id, t.bureau_id
      INTO v_thread_user_id, v_thread_bureau_id
      FROM public.ai_threads t
     WHERE t.id = NEW.thread_id
     LIMIT 1;

    IF v_thread_user_id IS NULL THEN
      RAISE EXCEPTION 'ai_message_feedback.thread_id (%) has no matching thread', NEW.thread_id;
    END IF;

    SELECT m.thread_id, m.bureau_id, m.role
      INTO v_message_thread_id, v_message_bureau_id, v_message_role
      FROM public.ai_messages m
     WHERE m.id = NEW.message_id
     LIMIT 1;

    IF v_message_thread_id IS NULL THEN
      RAISE EXCEPTION 'ai_message_feedback.message_id (%) has no matching message', NEW.message_id;
    END IF;

    IF v_message_thread_id <> NEW.thread_id THEN
      RAISE EXCEPTION 'ai_message_feedback message/thread mismatch: message thread %, provided thread %',
        v_message_thread_id, NEW.thread_id;
    END IF;

    IF v_message_bureau_id <> NEW.bureau_id OR v_thread_bureau_id <> NEW.bureau_id THEN
      RAISE EXCEPTION 'ai_message_feedback bureau mismatch on message/thread/user feedback';
    END IF;

    IF v_thread_user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'ai_message_feedback user/thread ownership mismatch';
    END IF;

    IF v_message_role <> 'assistant' THEN
      RAISE EXCEPTION 'ai_message_feedback only supports assistant messages';
    END IF;

    IF NEW.reaction = 'like' THEN
      NEW.reason_code := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_message_feedback_validate ON public.ai_message_feedback;
CREATE TRIGGER trg_ai_message_feedback_validate
BEFORE INSERT OR UPDATE ON public.ai_message_feedback
FOR EACH ROW
EXECUTE FUNCTION public.validate_ai_message_feedback_links();

ALTER TABLE public.ai_message_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_message_feedback_service_role_all ON public.ai_message_feedback;
CREATE POLICY ai_message_feedback_service_role_all
    ON public.ai_message_feedback FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ai_message_feedback_member_select ON public.ai_message_feedback;
CREATE POLICY ai_message_feedback_member_select
    ON public.ai_message_feedback FOR SELECT TO authenticated
    USING (
      ai_message_feedback.user_id = auth.uid()
      AND ai_message_feedback.bureau_id IS NOT DISTINCT FROM (
        SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
      )
    );

DROP POLICY IF EXISTS ai_message_feedback_member_insert ON public.ai_message_feedback;
CREATE POLICY ai_message_feedback_member_insert
    ON public.ai_message_feedback FOR INSERT TO authenticated
    WITH CHECK (
      ai_message_feedback.user_id = auth.uid()
      AND ai_message_feedback.bureau_id IS NOT DISTINCT FROM (
        SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
      )
      AND EXISTS (
        SELECT 1
        FROM public.ai_threads t
        WHERE t.id = ai_message_feedback.thread_id
          AND t.user_id = auth.uid()
          AND t.bureau_id = ai_message_feedback.bureau_id
      )
      AND EXISTS (
        SELECT 1
        FROM public.ai_messages m
        WHERE m.id = ai_message_feedback.message_id
          AND m.thread_id = ai_message_feedback.thread_id
          AND m.role = 'assistant'
      )
    );

DROP POLICY IF EXISTS ai_message_feedback_member_update ON public.ai_message_feedback;
CREATE POLICY ai_message_feedback_member_update
    ON public.ai_message_feedback FOR UPDATE TO authenticated
    USING (
      ai_message_feedback.user_id = auth.uid()
      AND ai_message_feedback.bureau_id IS NOT DISTINCT FROM (
        SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
      )
    )
    WITH CHECK (
      ai_message_feedback.user_id = auth.uid()
      AND ai_message_feedback.bureau_id IS NOT DISTINCT FROM (
        SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
      )
    );

DROP POLICY IF EXISTS ai_message_feedback_member_delete ON public.ai_message_feedback;
CREATE POLICY ai_message_feedback_member_delete
    ON public.ai_message_feedback FOR DELETE TO authenticated
    USING (
      ai_message_feedback.user_id = auth.uid()
      AND ai_message_feedback.bureau_id IS NOT DISTINCT FROM (
        SELECT p.bureau_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
      )
    );

GRANT ALL ON TABLE public.ai_message_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_message_feedback TO authenticated;

COMMIT;

