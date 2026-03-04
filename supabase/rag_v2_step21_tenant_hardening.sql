-- =============================================================================
-- RAG V2.1 - Step 21: Tenant Isolation Hardening (KVKK / Multi-Bureau)
-- =============================================================================
-- Migration: rag_v2_step21_tenant_hardening.sql
--
-- Purpose:
--   1) Harden tenant consistency for conversation/save tables via triggers.
--   2) Enforce saved_outputs access mode:
--        - case_id IS NOT NULL -> case-authorized access
--        - case_id IS NULL     -> personal (owner-only) access
--   3) Keep personal_documents owner-only.
--   4) Add explicit tenant_context field into audit_log payload.
--
-- Dependencies:
--   - rag_v2_step6_tenant.sql
--   - rag_v2_step15_audit.sql
--   - rag_v2_step17_memory.sql
--   - rag_v2_step18_save_targets.sql
--   - rag_v2_step20_citation_snapshot.sql
--
-- Safe to re-run: uses CREATE OR REPLACE / DROP POLICY IF EXISTS patterns.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Shared helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_bureau_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT p.bureau_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_user_bureau_id() IS
    'Returns auth.uid() bureau_id for RLS checks (NULL when user/profile has no bureau).';

-- ---------------------------------------------------------------------------
-- 1) Enforce bureau_id NOT NULL on tenant-owned tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_threads
    ALTER COLUMN bureau_id SET NOT NULL;

ALTER TABLE public.ai_messages
    ALTER COLUMN bureau_id SET NOT NULL;

ALTER TABLE public.saved_outputs
    ALTER COLUMN bureau_id SET NOT NULL;

ALTER TABLE public.personal_documents
    ALTER COLUMN bureau_id SET NOT NULL;

ALTER TABLE public.saved_output_citations
    ALTER COLUMN bureau_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Tenant consistency triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_ai_threads_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    profile_bureau_id uuid;
    case_bureau_id uuid;
BEGIN
    SELECT p.bureau_id
      INTO profile_bureau_id
      FROM public.profiles p
     WHERE p.id = NEW.user_id
     LIMIT 1;

    IF profile_bureau_id IS NULL THEN
        RAISE EXCEPTION 'ai_threads.user_id (%) has no bureau_id in profiles', NEW.user_id;
    END IF;

    IF NEW.bureau_id IS DISTINCT FROM profile_bureau_id THEN
        RAISE EXCEPTION
            'ai_threads.bureau_id (%) must match profiles.bureau_id (%) for user_id (%)',
            NEW.bureau_id, profile_bureau_id, NEW.user_id;
    END IF;

    IF NEW.case_id IS NOT NULL THEN
        SELECT c.bureau_id
          INTO case_bureau_id
          FROM public.cases c
         WHERE c.id = NEW.case_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ai_threads.case_id (%) not found', NEW.case_id;
        END IF;

        IF case_bureau_id IS NULL THEN
            RAISE EXCEPTION 'ai_threads.case_id (%) has NULL bureau_id', NEW.case_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM case_bureau_id THEN
            RAISE EXCEPTION
                'ai_threads.bureau_id (%) must match case bureau_id (%) for case_id (%)',
                NEW.bureau_id, case_bureau_id, NEW.case_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_threads_validate_tenant ON public.ai_threads;
CREATE TRIGGER trg_ai_threads_validate_tenant
BEFORE INSERT OR UPDATE ON public.ai_threads
FOR EACH ROW
EXECUTE FUNCTION public.validate_ai_threads_tenant();

CREATE OR REPLACE FUNCTION public.validate_personal_documents_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    profile_bureau_id uuid;
    case_bureau_id uuid;
BEGIN
    SELECT p.bureau_id
      INTO profile_bureau_id
      FROM public.profiles p
     WHERE p.id = NEW.owner_user_id
     LIMIT 1;

    IF profile_bureau_id IS NULL THEN
        RAISE EXCEPTION
            'personal_documents.owner_user_id (%) has no bureau_id in profiles',
            NEW.owner_user_id;
    END IF;

    IF NEW.bureau_id IS DISTINCT FROM profile_bureau_id THEN
        RAISE EXCEPTION
            'personal_documents.bureau_id (%) must match owner profile bureau_id (%)',
            NEW.bureau_id, profile_bureau_id;
    END IF;

    IF NEW.case_id IS NOT NULL THEN
        SELECT c.bureau_id
          INTO case_bureau_id
          FROM public.cases c
         WHERE c.id = NEW.case_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'personal_documents.case_id (%) not found', NEW.case_id;
        END IF;

        IF case_bureau_id IS NULL THEN
            RAISE EXCEPTION 'personal_documents.case_id (%) has NULL bureau_id', NEW.case_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM case_bureau_id THEN
            RAISE EXCEPTION
                'personal_documents.bureau_id (%) must match case bureau_id (%)',
                NEW.bureau_id, case_bureau_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_documents_validate_tenant ON public.personal_documents;
CREATE TRIGGER trg_personal_documents_validate_tenant
BEFORE INSERT OR UPDATE ON public.personal_documents
FOR EACH ROW
EXECUTE FUNCTION public.validate_personal_documents_tenant();

CREATE OR REPLACE FUNCTION public.validate_saved_outputs_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    profile_bureau_id uuid;
    case_bureau_id uuid;
    thread_bureau_id uuid;
    thread_case_id uuid;
    source_msg_bureau_id uuid;
    source_msg_thread_id uuid;
    saved_from_bureau_id uuid;
    saved_from_thread_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'saved_outputs.user_id is immutable';
    END IF;

    SELECT p.bureau_id
      INTO profile_bureau_id
      FROM public.profiles p
     WHERE p.id = NEW.user_id
     LIMIT 1;

    IF profile_bureau_id IS NULL THEN
        RAISE EXCEPTION 'saved_outputs.user_id (%) has no bureau_id in profiles', NEW.user_id;
    END IF;

    IF NEW.bureau_id IS DISTINCT FROM profile_bureau_id THEN
        RAISE EXCEPTION
            'saved_outputs.bureau_id (%) must match user profile bureau_id (%)',
            NEW.bureau_id, profile_bureau_id;
    END IF;

    IF NEW.case_id IS NOT NULL THEN
        SELECT c.bureau_id
          INTO case_bureau_id
          FROM public.cases c
         WHERE c.id = NEW.case_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'saved_outputs.case_id (%) not found', NEW.case_id;
        END IF;

        IF case_bureau_id IS NULL THEN
            RAISE EXCEPTION 'saved_outputs.case_id (%) has NULL bureau_id', NEW.case_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM case_bureau_id THEN
            RAISE EXCEPTION
                'saved_outputs.bureau_id (%) must match case bureau_id (%) for case_id (%)',
                NEW.bureau_id, case_bureau_id, NEW.case_id;
        END IF;
    END IF;

    IF NEW.thread_id IS NOT NULL THEN
        SELECT t.bureau_id, t.case_id
          INTO thread_bureau_id, thread_case_id
          FROM public.ai_threads t
         WHERE t.id = NEW.thread_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'saved_outputs.thread_id (%) not found', NEW.thread_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM thread_bureau_id THEN
            RAISE EXCEPTION
                'saved_outputs.bureau_id (%) must match ai_threads.bureau_id (%) for thread_id (%)',
                NEW.bureau_id, thread_bureau_id, NEW.thread_id;
        END IF;

        IF NEW.case_id IS NOT NULL AND thread_case_id IS NOT NULL AND NEW.case_id <> thread_case_id THEN
            RAISE EXCEPTION
                'saved_outputs.case_id (%) must match ai_threads.case_id (%) for thread_id (%)',
                NEW.case_id, thread_case_id, NEW.thread_id;
        END IF;
    END IF;

    IF NEW.source_message_id IS NOT NULL THEN
        SELECT m.bureau_id, m.thread_id
          INTO source_msg_bureau_id, source_msg_thread_id
          FROM public.ai_messages m
         WHERE m.id = NEW.source_message_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'saved_outputs.source_message_id (%) not found', NEW.source_message_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM source_msg_bureau_id THEN
            RAISE EXCEPTION
                'saved_outputs.source_message_id (%) bureau mismatch',
                NEW.source_message_id;
        END IF;

        IF NEW.thread_id IS NOT NULL AND NEW.thread_id <> source_msg_thread_id THEN
            RAISE EXCEPTION
                'saved_outputs.source_message_id (%) must belong to thread_id (%)',
                NEW.source_message_id, NEW.thread_id;
        END IF;
    END IF;

    IF NEW.saved_from_message_id IS NOT NULL THEN
        SELECT m.bureau_id, m.thread_id
          INTO saved_from_bureau_id, saved_from_thread_id
          FROM public.ai_messages m
         WHERE m.id = NEW.saved_from_message_id
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'saved_outputs.saved_from_message_id (%) not found', NEW.saved_from_message_id;
        END IF;

        IF NEW.bureau_id IS DISTINCT FROM saved_from_bureau_id THEN
            RAISE EXCEPTION
                'saved_outputs.saved_from_message_id (%) bureau mismatch',
                NEW.saved_from_message_id;
        END IF;

        IF NEW.thread_id IS NOT NULL AND NEW.thread_id <> saved_from_thread_id THEN
            RAISE EXCEPTION
                'saved_outputs.saved_from_message_id (%) must belong to thread_id (%)',
                NEW.saved_from_message_id, NEW.thread_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_outputs_validate_tenant ON public.saved_outputs;
CREATE TRIGGER trg_saved_outputs_validate_tenant
BEFORE INSERT OR UPDATE ON public.saved_outputs
FOR EACH ROW
EXECUTE FUNCTION public.validate_saved_outputs_tenant();

-- ---------------------------------------------------------------------------
-- 3) RLS hardening - saved_outputs + personal_documents + citations
-- ---------------------------------------------------------------------------

-- saved_outputs: case-bound rows follow case access, personal rows owner-only.
DROP POLICY IF EXISTS saved_outputs_member_select ON public.saved_outputs;
CREATE POLICY saved_outputs_member_select
    ON public.saved_outputs FOR SELECT TO authenticated
    USING (
        saved_outputs.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND (
            (
                saved_outputs.case_id IS NULL
                AND saved_outputs.user_id = auth.uid()
            )
            OR
            (
                saved_outputs.case_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.cases c
                    WHERE c.id = saved_outputs.case_id
                      AND c.bureau_id IS NOT DISTINCT FROM saved_outputs.bureau_id
                )
            )
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_insert ON public.saved_outputs;
CREATE POLICY saved_outputs_member_insert
    ON public.saved_outputs FOR INSERT TO authenticated
    WITH CHECK (
        saved_outputs.user_id = auth.uid()
        AND saved_outputs.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND (
            saved_outputs.case_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.cases c
                WHERE c.id = saved_outputs.case_id
                  AND c.bureau_id IS NOT DISTINCT FROM saved_outputs.bureau_id
            )
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_update ON public.saved_outputs;
CREATE POLICY saved_outputs_member_update
    ON public.saved_outputs FOR UPDATE TO authenticated
    USING (
        saved_outputs.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND (
            (
                saved_outputs.case_id IS NULL
                AND saved_outputs.user_id = auth.uid()
            )
            OR
            (
                saved_outputs.case_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.cases c
                    WHERE c.id = saved_outputs.case_id
                      AND c.bureau_id IS NOT DISTINCT FROM saved_outputs.bureau_id
                )
            )
        )
    )
    WITH CHECK (
        saved_outputs.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND (
            (
                saved_outputs.case_id IS NULL
                AND saved_outputs.user_id = auth.uid()
            )
            OR
            (
                saved_outputs.case_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.cases c
                    WHERE c.id = saved_outputs.case_id
                      AND c.bureau_id IS NOT DISTINCT FROM saved_outputs.bureau_id
                )
            )
        )
    );

DROP POLICY IF EXISTS saved_outputs_member_delete ON public.saved_outputs;
CREATE POLICY saved_outputs_member_delete
    ON public.saved_outputs FOR DELETE TO authenticated
    USING (
        saved_outputs.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND (
            (
                saved_outputs.case_id IS NULL
                AND saved_outputs.user_id = auth.uid()
            )
            OR
            (
                saved_outputs.case_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.cases c
                    WHERE c.id = saved_outputs.case_id
                      AND c.bureau_id IS NOT DISTINCT FROM saved_outputs.bureau_id
                )
            )
        )
    );

-- personal_documents: strictly owner-only (unchanged behaviour, explicit hardening).
DROP POLICY IF EXISTS personal_documents_owner_select ON public.personal_documents;
CREATE POLICY personal_documents_owner_select
    ON public.personal_documents FOR SELECT TO authenticated
    USING (
        personal_documents.owner_user_id = auth.uid()
        AND personal_documents.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS personal_documents_owner_insert ON public.personal_documents;
CREATE POLICY personal_documents_owner_insert
    ON public.personal_documents FOR INSERT TO authenticated
    WITH CHECK (
        personal_documents.owner_user_id = auth.uid()
        AND personal_documents.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS personal_documents_owner_update ON public.personal_documents;
CREATE POLICY personal_documents_owner_update
    ON public.personal_documents FOR UPDATE TO authenticated
    USING (
        personal_documents.owner_user_id = auth.uid()
        AND personal_documents.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    )
    WITH CHECK (
        personal_documents.owner_user_id = auth.uid()
        AND personal_documents.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS personal_documents_owner_delete ON public.personal_documents;
CREATE POLICY personal_documents_owner_delete
    ON public.personal_documents FOR DELETE TO authenticated
    USING (
        personal_documents.owner_user_id = auth.uid()
        AND personal_documents.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

-- saved_output_citations: inherit access semantics from parent saved_output.
DROP POLICY IF EXISTS saved_output_citations_member_select ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_select
    ON public.saved_output_citations FOR SELECT TO authenticated
    USING (
        saved_output_citations.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND (
                    (
                        s.case_id IS NULL
                        AND s.user_id = auth.uid()
                    )
                    OR
                    (
                        s.case_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.cases c
                            WHERE c.id = s.case_id
                              AND c.bureau_id IS NOT DISTINCT FROM s.bureau_id
                        )
                    )
                  )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_insert ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_insert
    ON public.saved_output_citations FOR INSERT TO authenticated
    WITH CHECK (
        saved_output_citations.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND (
                    (
                        s.case_id IS NULL
                        AND s.user_id = auth.uid()
                    )
                    OR
                    (
                        s.case_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.cases c
                            WHERE c.id = s.case_id
                              AND c.bureau_id IS NOT DISTINCT FROM s.bureau_id
                        )
                    )
                  )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_update ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_update
    ON public.saved_output_citations FOR UPDATE TO authenticated
    USING (
        saved_output_citations.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND (
                    (
                        s.case_id IS NULL
                        AND s.user_id = auth.uid()
                    )
                    OR
                    (
                        s.case_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.cases c
                            WHERE c.id = s.case_id
                              AND c.bureau_id IS NOT DISTINCT FROM s.bureau_id
                        )
                    )
                  )
        )
    )
    WITH CHECK (
        saved_output_citations.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND (
                    (
                        s.case_id IS NULL
                        AND s.user_id = auth.uid()
                    )
                    OR
                    (
                        s.case_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.cases c
                            WHERE c.id = s.case_id
                              AND c.bureau_id IS NOT DISTINCT FROM s.bureau_id
                        )
                    )
                  )
        )
    );

DROP POLICY IF EXISTS saved_output_citations_member_delete ON public.saved_output_citations;
CREATE POLICY saved_output_citations_member_delete
    ON public.saved_output_citations FOR DELETE TO authenticated
    USING (
        saved_output_citations.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
        AND EXISTS (
            SELECT 1
            FROM public.saved_outputs s
            WHERE s.id = saved_output_citations.saved_output_id
              AND s.bureau_id = saved_output_citations.bureau_id
              AND s.user_id = saved_output_citations.user_id
              AND (
                    (
                        s.case_id IS NULL
                        AND s.user_id = auth.uid()
                    )
                    OR
                    (
                        s.case_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM public.cases c
                            WHERE c.id = s.case_id
                              AND c.bureau_id IS NOT DISTINCT FROM s.bureau_id
                        )
                    )
                  )
        )
    );

-- ---------------------------------------------------------------------------
-- 4) Audit tenant context
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log
    ADD COLUMN IF NOT EXISTS tenant_context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.audit_log.tenant_context IS
    'Resolved tenant context for this request (bureau_id, user_id, isolation flags).';

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_context
    ON public.audit_log USING gin (tenant_context);

COMMIT;
