-- =============================================================================
-- RAG V2.1 - Step 19: Work Product Versioning
-- =============================================================================
-- Migration: rag_v2_step19_work_product_versioning.sql
--
-- Purpose:
--   Adds legal work-product versioning fields to public.saved_outputs.
--
-- Fields added:
--   - version_no
--   - parent_output_id
--   - is_final
--   - saved_from_message_id
--   - output_kind
--
-- Dependencies:
--   - rag_v2_step18_save_targets.sql
--   - rag_v2_step17_memory.sql
--
-- Safe to re-run: all DDL is idempotent.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) New versioning columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_outputs
    ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS parent_output_id uuid,
    ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS saved_from_message_id uuid,
    ADD COLUMN IF NOT EXISTS output_kind text;

-- Backfill output_kind from legacy output_type for existing rows.
UPDATE public.saved_outputs
   SET output_kind = COALESCE(output_kind, output_type, 'analysis_note')
 WHERE output_kind IS NULL;

ALTER TABLE public.saved_outputs
    ALTER COLUMN output_kind SET DEFAULT 'analysis_note',
    ALTER COLUMN output_kind SET NOT NULL;

-- Backfill saved_from_message_id from legacy source_message_id when available.
UPDATE public.saved_outputs
   SET saved_from_message_id = source_message_id
 WHERE saved_from_message_id IS NULL
   AND source_message_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'saved_outputs_version_no_check'
    ) THEN
        ALTER TABLE public.saved_outputs
            ADD CONSTRAINT saved_outputs_version_no_check
            CHECK (version_no >= 1);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'saved_outputs_parent_output_id_fkey'
    ) THEN
        ALTER TABLE public.saved_outputs
            ADD CONSTRAINT saved_outputs_parent_output_id_fkey
            FOREIGN KEY (parent_output_id)
            REFERENCES public.saved_outputs(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'saved_outputs_saved_from_message_id_fkey'
    ) THEN
        ALTER TABLE public.saved_outputs
            ADD CONSTRAINT saved_outputs_saved_from_message_id_fkey
            FOREIGN KEY (saved_from_message_id)
            REFERENCES public.ai_messages(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

-- Keep validation broad to avoid breaking existing/custom output categories.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'saved_outputs_output_kind_check'
    ) THEN
        ALTER TABLE public.saved_outputs
            ADD CONSTRAINT saved_outputs_output_kind_check
            CHECK (
                char_length(trim(output_kind)) > 0
            );
    END IF;
END;
$$;

COMMENT ON COLUMN public.saved_outputs.version_no IS
    'Version number in a linear parent-child chain. First save starts at 1.';

COMMENT ON COLUMN public.saved_outputs.parent_output_id IS
    'Self-reference to prior draft version (NULL for v1 root).';

COMMENT ON COLUMN public.saved_outputs.is_final IS
    'Marks this version as final output for downstream workflows.';

COMMENT ON COLUMN public.saved_outputs.saved_from_message_id IS
    'Source assistant message from which this output version was created.';

COMMENT ON COLUMN public.saved_outputs.output_kind IS
    'Legal work-product kind (memo, dilekce, ihtarname, etc.).';

CREATE INDEX IF NOT EXISTS idx_saved_outputs_parent_output_id
    ON public.saved_outputs (parent_output_id)
    WHERE parent_output_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_version_no
    ON public.saved_outputs (version_no);

CREATE INDEX IF NOT EXISTS idx_saved_outputs_output_kind
    ON public.saved_outputs (output_kind);

CREATE INDEX IF NOT EXISTS idx_saved_outputs_saved_from_message_id
    ON public.saved_outputs (saved_from_message_id)
    WHERE saved_from_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Linear versioning guardrails
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saved_outputs_set_version_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_row public.saved_outputs%ROWTYPE;
BEGIN
    IF NEW.parent_output_id IS NULL THEN
        IF NEW.version_no IS NULL OR NEW.version_no < 1 THEN
            NEW.version_no := 1;
        END IF;
        RETURN NEW;
    END IF;

    SELECT *
      INTO parent_row
      FROM public.saved_outputs
     WHERE id = NEW.parent_output_id
     LIMIT 1;

    IF parent_row.id IS NULL THEN
        RAISE EXCEPTION 'parent_output_id (%) not found', NEW.parent_output_id;
    END IF;

    IF NEW.bureau_id IS DISTINCT FROM parent_row.bureau_id THEN
        RAISE EXCEPTION
            'child bureau_id (%) must match parent bureau_id (%)',
            NEW.bureau_id, parent_row.bureau_id;
    END IF;

    IF NEW.user_id IS DISTINCT FROM parent_row.user_id THEN
        RAISE EXCEPTION
            'child user_id (%) must match parent user_id (%)',
            NEW.user_id, parent_row.user_id;
    END IF;

    IF NEW.version_no IS NULL OR NEW.version_no <= parent_row.version_no THEN
        NEW.version_no := parent_row.version_no + 1;
    END IF;

    IF NEW.case_id IS NULL THEN
        NEW.case_id := parent_row.case_id;
    END IF;

    IF NEW.thread_id IS NULL THEN
        NEW.thread_id := parent_row.thread_id;
    END IF;

    IF NEW.output_kind IS NULL THEN
        NEW.output_kind := parent_row.output_kind;
    END IF;

    IF NEW.saved_from_message_id IS NULL THEN
        NEW.saved_from_message_id := parent_row.saved_from_message_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_outputs_set_version_defaults ON public.saved_outputs;
CREATE TRIGGER trg_saved_outputs_set_version_defaults
BEFORE INSERT ON public.saved_outputs
FOR EACH ROW
EXECUTE FUNCTION public.saved_outputs_set_version_defaults();

-- Linear chain: a version can have at most one direct child.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_outputs_linear_parent
    ON public.saved_outputs (parent_output_id)
    WHERE parent_output_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Helper function for "same draft, create next version"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_saved_output_version(
    p_parent_output_id uuid,
    p_user_id uuid,
    p_content text,
    p_title text DEFAULT NULL,
    p_output_kind text DEFAULT NULL,
    p_saved_from_message_id uuid DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_is_final boolean DEFAULT false
)
RETURNS public.saved_outputs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    parent_row public.saved_outputs%ROWTYPE;
    next_row public.saved_outputs%ROWTYPE;
BEGIN
    SELECT *
      INTO parent_row
      FROM public.saved_outputs
     WHERE id = p_parent_output_id
     LIMIT 1;

    IF parent_row.id IS NULL THEN
        RAISE EXCEPTION 'parent saved_output (%) not found', p_parent_output_id;
    END IF;

    -- Enforce caller ownership for user-context calls; allow service-role path.
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'auth.uid() does not match p_user_id';
    END IF;

    IF parent_row.user_id <> p_user_id THEN
        RAISE EXCEPTION
            'parent output belongs to user (%), not p_user_id (%)',
            parent_row.user_id, p_user_id;
    END IF;

    INSERT INTO public.saved_outputs (
        bureau_id,
        user_id,
        case_id,
        thread_id,
        source_message_id,
        saved_from_message_id,
        title,
        output_type,
        output_kind,
        content,
        metadata,
        parent_output_id,
        version_no,
        is_final
    )
    VALUES (
        parent_row.bureau_id,
        parent_row.user_id,
        parent_row.case_id,
        parent_row.thread_id,
        COALESCE(p_saved_from_message_id, parent_row.source_message_id),
        COALESCE(p_saved_from_message_id, parent_row.saved_from_message_id),
        COALESCE(p_title, parent_row.title),
        parent_row.output_type,
        COALESCE(p_output_kind, parent_row.output_kind, parent_row.output_type, 'analysis_note'),
        p_content,
        COALESCE(p_metadata, '{}'::jsonb),
        parent_row.id,
        parent_row.version_no + 1,
        p_is_final
    )
    RETURNING * INTO next_row;

    RETURN next_row;
END;
$$;

COMMENT ON FUNCTION public.create_saved_output_version(
    uuid, uuid, text, text, text, uuid, jsonb, boolean
) IS
    'Creates next linear version for a saved output (vN -> vN+1) without deleting previous versions.';

GRANT EXECUTE ON FUNCTION public.create_saved_output_version(
    uuid, uuid, text, text, text, uuid, jsonb, boolean
) TO authenticated, service_role;

COMMIT;
