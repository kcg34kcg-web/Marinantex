-- =============================================================================
-- RAG V2.1 - Step 24: Unified Save Flow + Clients Draft Integration
-- =============================================================================
-- Migration: rag_v2_step24_save_and_clients.sql
--
-- Purpose:
--   1) Add client_messages table for "Muvekkile Anlat" draft workflow.
--   2) Provide a single atomic transaction function that can:
--      - optionally create a new case
--      - save output to saved_outputs
--      - persist citation snapshot rows
--      - optionally create client draft row
--
-- Dependencies:
--   - rag_v2_step17_memory.sql
--   - rag_v2_step18_save_targets.sql
--   - rag_v2_step19_work_product_versioning.sql
--   - rag_v2_step20_citation_snapshot.sql
--   - rag_v2_step21_tenant_hardening.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Clients draft table (MVP: no auto-send, draft only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_messages (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    bureau_id               uuid        NOT NULL REFERENCES public.bureaus(id) ON DELETE RESTRICT,
    user_id                 uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    case_id                 uuid            REFERENCES public.cases(id) ON DELETE SET NULL,
    client_id               uuid            REFERENCES public.profiles(id) ON DELETE SET NULL,
    source_message_id       uuid            REFERENCES public.ai_messages(id) ON DELETE SET NULL,
    source_saved_output_id  uuid            REFERENCES public.saved_outputs(id) ON DELETE SET NULL,
    action                  text        NOT NULL DEFAULT 'save_client_draft'
                                      CHECK (action IN ('translate_for_client_draft', 'save_client_draft')),
    status                  text        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'approved', 'archived')),
    title                   text,
    content                 text        NOT NULL CHECK (char_length(trim(content)) > 0),
    is_client_safe          boolean     NOT NULL DEFAULT true,
    metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_messages IS
    'Step 24: Client-facing draft messages produced from chat outputs (MVP: draft-only, no auto-send).';

COMMENT ON COLUMN public.client_messages.source_saved_output_id IS
    'Traceability link to saved_outputs row that produced this client draft.';

CREATE INDEX IF NOT EXISTS idx_client_messages_bureau_created_at
    ON public.client_messages (bureau_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_messages_user_created_at
    ON public.client_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_messages_case_id
    ON public.client_messages (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_messages_source_saved_output_id
    ON public.client_messages (source_saved_output_id)
    WHERE source_saved_output_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_client_messages_updated_at ON public.client_messages;
CREATE TRIGGER trg_client_messages_updated_at
BEFORE UPDATE ON public.client_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_messages_service_role_all ON public.client_messages;
CREATE POLICY client_messages_service_role_all
    ON public.client_messages FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS client_messages_member_select ON public.client_messages;
CREATE POLICY client_messages_member_select
    ON public.client_messages FOR SELECT TO authenticated
    USING (
        client_messages.user_id = auth.uid()
        AND client_messages.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS client_messages_member_insert ON public.client_messages;
CREATE POLICY client_messages_member_insert
    ON public.client_messages FOR INSERT TO authenticated
    WITH CHECK (
        client_messages.user_id = auth.uid()
        AND client_messages.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS client_messages_member_update ON public.client_messages;
CREATE POLICY client_messages_member_update
    ON public.client_messages FOR UPDATE TO authenticated
    USING (
        client_messages.user_id = auth.uid()
        AND client_messages.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    )
    WITH CHECK (
        client_messages.user_id = auth.uid()
        AND client_messages.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

DROP POLICY IF EXISTS client_messages_member_delete ON public.client_messages;
CREATE POLICY client_messages_member_delete
    ON public.client_messages FOR DELETE TO authenticated
    USING (
        client_messages.user_id = auth.uid()
        AND client_messages.bureau_id IS NOT DISTINCT FROM public.current_user_bureau_id()
    );

GRANT ALL ON TABLE public.client_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Atomic save function: case(optional) + output + citations + client draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_rag_output_transaction(
    p_bureau_id uuid,
    p_user_id uuid,
    p_save_mode text DEFAULT 'output_only',
    p_save_target text DEFAULT 'my_files', -- my_files | existing_case | new_case
    p_case_id uuid DEFAULT NULL,
    p_create_case boolean DEFAULT false,
    p_new_case_title text DEFAULT NULL,
    p_title text DEFAULT NULL,
    p_content text DEFAULT NULL,
    p_output_type text DEFAULT 'analysis_note',
    p_output_kind text DEFAULT 'analysis_note',
    p_thread_id uuid DEFAULT NULL,
    p_source_message_id uuid DEFAULT NULL,
    p_saved_from_message_id uuid DEFAULT NULL,
    p_parent_output_id uuid DEFAULT NULL,
    p_is_final boolean DEFAULT false,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_citations jsonb DEFAULT '[]'::jsonb,
    p_client_action text DEFAULT 'none', -- none | translate_for_client_draft | save_client_draft
    p_client_id uuid DEFAULT NULL,
    p_client_draft_text text DEFAULT NULL,
    p_client_draft_title text DEFAULT NULL,
    p_client_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_effective_case_id uuid := p_case_id;
    v_case_created boolean := false;
    v_case_title text;
    v_saved_output_id uuid;
    v_client_message_id uuid;
    v_citation_count integer := 0;
    v_item jsonb;
    v_source_type text;
BEGIN
    IF p_bureau_id IS NULL THEN
        RAISE EXCEPTION 'p_bureau_id is required';
    END IF;
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;
    IF p_content IS NULL OR char_length(trim(p_content)) = 0 THEN
        RAISE EXCEPTION 'p_content is required';
    END IF;

    IF p_save_mode NOT IN ('output_only', 'output_with_thread', 'output_with_thread_and_sources') THEN
        RAISE EXCEPTION 'invalid p_save_mode: %', p_save_mode;
    END IF;

    IF p_save_target NOT IN ('my_files', 'existing_case', 'new_case') THEN
        RAISE EXCEPTION 'invalid p_save_target: %', p_save_target;
    END IF;

    -- User must belong to bureau context.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_user_id
          AND p.bureau_id IS NOT DISTINCT FROM p_bureau_id
    ) THEN
        RAISE EXCEPTION 'p_user_id (%) is not in bureau_id (%)', p_user_id, p_bureau_id;
    END IF;

    IF p_save_target = 'new_case' THEN
        p_create_case := true;
    END IF;

    IF p_save_target = 'existing_case' AND v_effective_case_id IS NULL THEN
        RAISE EXCEPTION 'existing_case target requires p_case_id';
    END IF;

    IF p_create_case THEN
        v_case_title := COALESCE(
            NULLIF(trim(p_new_case_title), ''),
            NULLIF(trim(p_title), ''),
            'AI Kaydi ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
        );

        INSERT INTO public.cases (
            title,
            status,
            lawyer_id,
            client_id,
            bureau_id,
            client_display_name,
            updated_at
        )
        VALUES (
            v_case_title,
            'open',
            p_user_id,
            p_client_id,
            p_bureau_id,
            NULL,
            now()
        )
        RETURNING id INTO v_effective_case_id;

        v_case_created := true;
    END IF;

    IF v_effective_case_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.cases c
            WHERE c.id = v_effective_case_id
              AND c.bureau_id IS NOT DISTINCT FROM p_bureau_id
        ) THEN
            RAISE EXCEPTION 'case_id (%) is not accessible in bureau (%)', v_effective_case_id, p_bureau_id;
        END IF;
    END IF;

    INSERT INTO public.saved_outputs (
        bureau_id,
        user_id,
        case_id,
        thread_id,
        source_message_id,
        saved_from_message_id,
        parent_output_id,
        is_final,
        title,
        output_type,
        output_kind,
        content,
        metadata
    )
    VALUES (
        p_bureau_id,
        p_user_id,
        v_effective_case_id,
        CASE
            WHEN p_save_mode IN ('output_with_thread', 'output_with_thread_and_sources')
            THEN p_thread_id
            ELSE NULL
        END,
        CASE
            WHEN p_save_mode IN ('output_with_thread', 'output_with_thread_and_sources')
            THEN p_source_message_id
            ELSE NULL
        END,
        CASE
            WHEN p_save_mode IN ('output_with_thread', 'output_with_thread_and_sources')
            THEN p_saved_from_message_id
            ELSE NULL
        END,
        p_parent_output_id,
        COALESCE(p_is_final, false),
        NULLIF(trim(p_title), ''),
        COALESCE(NULLIF(trim(p_output_type), ''), 'analysis_note'),
        COALESCE(NULLIF(trim(p_output_kind), ''), 'analysis_note'),
        p_content,
        COALESCE(p_metadata, '{}'::jsonb)
            || jsonb_build_object(
                'save_mode', p_save_mode,
                'save_target', p_save_target,
                'client_action', p_client_action
            )
    )
    RETURNING id INTO v_saved_output_id;

    IF p_save_mode = 'output_with_thread_and_sources' THEN
        FOR v_item IN
            SELECT value FROM jsonb_array_elements(COALESCE(p_citations, '[]'::jsonb))
        LOOP
            v_source_type := lower(COALESCE(v_item->>'source_type', 'other'));
            IF v_source_type NOT IN ('kanun', 'ictihat', 'user_document', 'other') THEN
                v_source_type := 'other';
            END IF;

            INSERT INTO public.saved_output_citations (
                saved_output_id,
                bureau_id,
                user_id,
                source_id,
                source_type,
                source_anchor,
                page_no,
                char_start,
                char_end,
                source_hash,
                doc_version,
                citation_text,
                metadata
            )
            VALUES (
                v_saved_output_id,
                p_bureau_id,
                p_user_id,
                COALESCE(NULLIF(v_item->>'source_id', ''), gen_random_uuid()::text),
                v_source_type,
                NULLIF(v_item->>'source_anchor', ''),
                CASE WHEN NULLIF(v_item->>'page_no', '') IS NULL THEN NULL ELSE (v_item->>'page_no')::integer END,
                CASE WHEN NULLIF(v_item->>'char_start', '') IS NULL THEN NULL ELSE (v_item->>'char_start')::integer END,
                CASE WHEN NULLIF(v_item->>'char_end', '') IS NULL THEN NULL ELSE (v_item->>'char_end')::integer END,
                NULLIF(v_item->>'source_hash', ''),
                NULLIF(v_item->>'doc_version', ''),
                NULLIF(v_item->>'citation_text', ''),
                COALESCE(v_item->'metadata', '{}'::jsonb)
            );
            v_citation_count := v_citation_count + 1;
        END LOOP;
    END IF;

    IF p_client_action IN ('translate_for_client_draft', 'save_client_draft')
       AND p_client_draft_text IS NOT NULL
       AND char_length(trim(p_client_draft_text)) > 0
    THEN
        INSERT INTO public.client_messages (
            bureau_id,
            user_id,
            case_id,
            client_id,
            source_message_id,
            source_saved_output_id,
            action,
            status,
            title,
            content,
            is_client_safe,
            metadata
        )
        VALUES (
            p_bureau_id,
            p_user_id,
            v_effective_case_id,
            p_client_id,
            p_source_message_id,
            v_saved_output_id,
            p_client_action,
            'draft',
            NULLIF(trim(p_client_draft_title), ''),
            p_client_draft_text,
            true,
            COALESCE(p_client_metadata, '{}'::jsonb)
        )
        RETURNING id INTO v_client_message_id;
    END IF;

    RETURN jsonb_build_object(
        'saved_output_id', v_saved_output_id,
        'case_id', v_effective_case_id,
        'case_created', v_case_created,
        'citation_count', v_citation_count,
        'client_message_id', v_client_message_id
    );
END;
$$;

COMMENT ON FUNCTION public.save_rag_output_transaction(
    uuid, uuid, text, text, uuid, boolean, text, text, text, text, text, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, text, uuid, text, text, jsonb
) IS
    'Step 24 atomic save flow for output/case/citations/client draft.';

GRANT EXECUTE ON FUNCTION public.save_rag_output_transaction(
    uuid, uuid, text, text, uuid, boolean, text, text, text, text, text, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, text, uuid, text, text, jsonb
) TO authenticated, service_role;

COMMIT;

