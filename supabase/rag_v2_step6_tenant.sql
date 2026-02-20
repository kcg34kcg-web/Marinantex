-- =============================================================================
-- RAG V2.1 — Step 6: KVKK Güvenliği ve Multi-Tenancy (Büro İzolasyonu)
-- =============================================================================
-- Purpose:
--   Introduces bureau (law-firm/büro) level tenant isolation so that each
--   bureau's documents are never visible to users of another bureau.
--
--   Core design decision:
--     • Public legal content (mevzuat, içtihat) has  bureau_id = NULL
--       → accessible to every bureau
--     • Private case documents have bureau_id = <bureau uuid>
--       → accessible only to members of that bureau
--
-- Changes:
--   1. bureaus table — law firm entity
--   2. bureau_id on profiles  — every user belongs to one bureau
--   3. bureau_id on cases     — every case belongs to one bureau
--   4. bureau_id on documents — efficient document-level isolation without
--                               a join through cases at query time
--   5. RLS policies           — enforce bureau isolation at DB row level
--   6. hybrid_legal_search()  — new p_bureau_id parameter
--   7. get_must_cite_documents() — bureau-scoped
--
-- Rollback section at the bottom (commented out).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. bureaus table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bureaus (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    slug        text        NOT NULL UNIQUE,       -- URL-safe identifier
    plan_tier   text        NOT NULL DEFAULT 'FREE', -- FREE | PRO | ENTERPRISE
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bureaus_slug ON public.bureaus (slug);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bureaus_plan_tier_check'
    ) THEN
        ALTER TABLE public.bureaus
            ADD CONSTRAINT bureaus_plan_tier_check
            CHECK (plan_tier IN ('FREE', 'PRO', 'ENTERPRISE'));
    END IF;
END;
$$;

COMMENT ON TABLE public.bureaus IS
    'Step 6: Law firm / büro tenant entity. The unit of isolation for multi-tenancy.';

ALTER TABLE public.bureaus ENABLE ROW LEVEL SECURITY;

-- Policies are created in Section 5, after bureau_id columns on profiles,
-- cases and documents have all been added — the USING clauses reference
-- those columns and PostgreSQL validates them at CREATE POLICY time.

-- ---------------------------------------------------------------------------
-- 2. bureau_id on profiles
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bureau_id uuid REFERENCES public.bureaus(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_bureau_id
    ON public.profiles (bureau_id)
    WHERE bureau_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.bureau_id IS
    'Step 6: The bureau this user belongs to. NULL = no bureau (admin / super-user).';

-- ---------------------------------------------------------------------------
-- 3. bureau_id on cases
-- ---------------------------------------------------------------------------

ALTER TABLE public.cases
    ADD COLUMN IF NOT EXISTS bureau_id uuid REFERENCES public.bureaus(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_bureau_id
    ON public.cases (bureau_id)
    WHERE bureau_id IS NOT NULL;

COMMENT ON COLUMN public.cases.bureau_id IS
    'Step 6: Bureau that owns this case. Drives RLS isolation.';

-- ---------------------------------------------------------------------------
-- 4. bureau_id on documents
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS bureau_id uuid REFERENCES public.bureaus(id) ON DELETE SET NULL;

-- Partial index: only private docs need fast bureau lookup
CREATE INDEX IF NOT EXISTS idx_documents_bureau_id
    ON public.documents (bureau_id)
    WHERE bureau_id IS NOT NULL;

COMMENT ON COLUMN public.documents.bureau_id IS
    'Step 6: Bureau that owns this document. NULL = public legal content (mevzuat/içtihat).
     Public documents are visible to all bureaus.
     Private documents are visible only to the owning bureau.';

-- ---------------------------------------------------------------------------
-- 5. RLS policies — bureau-level isolation
--    All policies are created here, AFTER every bureau_id column has been
--    added to profiles / cases / documents.  PostgreSQL validates column
--    references inside USING / WITH CHECK at CREATE POLICY time, so putting
--    any policy that touches profiles.bureau_id before that column exists
--    will raise ERROR 42703 "column does not exist".
--    Every statement uses DROP … IF EXISTS so the script is safe to re-run.
-- ---------------------------------------------------------------------------

-- BUREAUS: service-role full access; authenticated users see only their bureau
DROP POLICY IF EXISTS "bureaus_service_role_all" ON public.bureaus;
CREATE POLICY "bureaus_service_role_all"
    ON public.bureaus FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bureaus_member_read" ON public.bureaus;
CREATE POLICY "bureaus_member_read"
    ON public.bureaus FOR SELECT TO authenticated
    USING (
        id = (
            SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
        )
    );

-- CASES: visible only to bureau members
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cases_bureau_isolation" ON public.cases;
CREATE POLICY "cases_bureau_isolation"
    ON public.cases FOR ALL TO authenticated
    USING (
        bureau_id IS NULL                                -- public case (unlikely but safe)
        OR bureau_id = (
            SELECT bureau_id FROM public.profiles
            WHERE id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS "cases_service_role_all" ON public.cases;
CREATE POLICY "cases_service_role_all"
    ON public.cases FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DOCUMENTS: public content (bureau_id IS NULL) visible to all;
--            private content visible only to owning bureau
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_bureau_isolation" ON public.documents;
CREATE POLICY "documents_bureau_isolation"
    ON public.documents FOR ALL TO authenticated
    USING (
        bureau_id IS NULL                               -- public document: always visible
        OR bureau_id = (
            SELECT bureau_id FROM public.profiles
            WHERE id = auth.uid() LIMIT 1
        )
    );

DROP POLICY IF EXISTS "documents_service_role_all" ON public.documents;
CREATE POLICY "documents_service_role_all"
    ON public.documents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6. Updated hybrid_legal_search — bureau-scoped
-- ---------------------------------------------------------------------------

-- Drop the previous 5-arg signature (Step 5); parameter list changes require
-- DROP + CREATE rather than CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.hybrid_legal_search(vector, text, uuid, integer, date);

CREATE OR REPLACE FUNCTION public.hybrid_legal_search(
    query_embedding  vector(1536),
    query_text       text,
    case_scope       uuid    DEFAULT NULL,
    match_count      int     DEFAULT 12,
    p_event_date     date    DEFAULT NULL,
    p_bureau_id      uuid    DEFAULT NULL    -- Step 6: tenant isolation
)
RETURNS TABLE (
    -- Identity
    id                      uuid,
    case_id                 uuid,
    content                 text,
    file_path               text,
    created_at              timestamptz,
    -- Step 2: Provenance
    source_url              text,
    version                 text,
    collected_at            timestamptz,
    -- Classification
    court_level             text,
    ruling_date             date,
    citation                text,
    norm_hierarchy          text,
    -- Step 3: Authority
    chamber                 text,
    majority_type           text,
    dissent_present         boolean,
    -- Step 4: Versioning + AYM
    effective_date          date,
    expiry_date             date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no            text,
    aym_karar_tarihi        date,
    -- Step 5: Ingest / Parsing
    segment_type            text,
    madde_no                text,
    fikra_no                integer,
    bent_no                 text,
    citation_refs           text[],
    -- Scores
    semantic_score          float,
    keyword_score           float,
    recency_score           float,
    hierarchy_score         float,
    final_score             float
)
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner, not caller, to bypass RLS for service_role
AS $$
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT
            d.id,
            d.case_id,
            d.content,
            d.file_path,
            d.created_at,
            d.source_url,
            d.version,
            d.collected_at,
            d.court_level,
            d.ruling_date,
            d.citation,
            d.norm_hierarchy,
            d.chamber,
            d.majority_type,
            COALESCE(d.dissent_present, false)  AS dissent_present,
            d.effective_date,
            d.expiry_date,
            d.aym_iptal_durumu,
            d.iptal_yururluk_tarihi,
            d.aym_karar_no,
            d.aym_karar_tarihi,
            d.segment_type,
            d.madde_no,
            d.fikra_no,
            d.bent_no,
            d.citation_refs,
            1 - (d.embedding <=> query_embedding)                         AS semantic_score,
            ts_rank_cd(d.search_vector, plainto_tsquery('turkish', query_text))
                                                                           AS keyword_score,
            CASE
                WHEN d.ruling_date IS NULL THEN 0.0
                ELSE GREATEST(0.0, 1.0 - (CURRENT_DATE - d.ruling_date)::float / 3650.0)
            END                                                            AS recency_score,
            compute_authority_score(
                d.court_level, d.majority_type,
                COALESCE(d.dissent_present, false)
            )                                                              AS hierarchy_score
        FROM public.documents d
        WHERE
            -- Case-scope filter (Step 1 / Step 7)
            (case_scope IS NULL OR d.case_id = case_scope)
            -- Bureau isolation filter (Step 6):
            --   Public documents (bureau_id IS NULL) are always included.
            --   Private documents are only included for their owning bureau.
            --   NULL p_bureau_id = service account = sees everything.
            AND (
                p_bureau_id IS NULL
                OR d.bureau_id IS NULL
                OR d.bureau_id = p_bureau_id
            )
            -- Time-travel filter (Step 4)
            AND (
                p_event_date IS NULL
                OR public.is_provision_effective_on(
                    d.effective_date,
                    d.expiry_date,
                    d.aym_iptal_durumu,
                    d.iptal_yururluk_tarihi,
                    p_event_date
                )
            )
        ORDER BY d.embedding <=> query_embedding
        LIMIT match_count * 3
    )
    SELECT
        r.id, r.case_id, r.content, r.file_path, r.created_at,
        r.source_url, r.version, r.collected_at,
        r.court_level, r.ruling_date, r.citation, r.norm_hierarchy,
        r.chamber, r.majority_type, r.dissent_present,
        r.effective_date, r.expiry_date, r.aym_iptal_durumu,
        r.iptal_yururluk_tarihi, r.aym_karar_no, r.aym_karar_tarihi,
        r.segment_type, r.madde_no, r.fikra_no, r.bent_no, r.citation_refs,
        r.semantic_score,
        r.keyword_score,
        r.recency_score,
        r.hierarchy_score,
        0.45 * r.semantic_score
        + 0.30 * LEAST(r.keyword_score, 1.0)
        + 0.10 * r.recency_score
        + 0.15 * r.hierarchy_score AS final_score
    FROM ranked r
    ORDER BY final_score DESC
    LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Updated get_must_cite_documents — bureau-scoped
-- ---------------------------------------------------------------------------

-- Drop the previous 1-arg signature (Step 5); adding p_bureau_id changes
-- the parameter list, which requires DROP + CREATE.
DROP FUNCTION IF EXISTS public.get_must_cite_documents(uuid);

CREATE OR REPLACE FUNCTION public.get_must_cite_documents(
    p_case_id   uuid,
    p_bureau_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id              uuid,
    case_id         uuid,
    content         text,
    file_path       text,
    created_at      timestamptz,
    source_url      text,
    version         text,
    collected_at    timestamptz,
    court_level     text,
    ruling_date     date,
    citation        text,
    norm_hierarchy  text,
    chamber         text,
    majority_type   text,
    dissent_present boolean,
    effective_date  date,
    expiry_date     date,
    aym_iptal_durumu        text,
    iptal_yururluk_tarihi   date,
    aym_karar_no    text,
    aym_karar_tarihi        date,
    segment_type    text,
    madde_no        text,
    fikra_no        integer,
    bent_no         text,
    citation_refs   text[],
    semantic_score  float,
    keyword_score   float,
    recency_score   float,
    hierarchy_score float,
    final_score     float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id, d.case_id, d.content, d.file_path, d.created_at,
        d.source_url, d.version, d.collected_at,
        d.court_level, d.ruling_date, d.citation, d.norm_hierarchy,
        d.chamber, d.majority_type, COALESCE(d.dissent_present, false),
        d.effective_date, d.expiry_date, d.aym_iptal_durumu,
        d.iptal_yururluk_tarihi, d.aym_karar_no, d.aym_karar_tarihi,
        d.segment_type, d.madde_no, d.fikra_no, d.bent_no, d.citation_refs,
        0.0::float AS semantic_score,
        0.0::float AS keyword_score,
        0.0::float AS recency_score,
        compute_authority_score(
            d.court_level, d.majority_type, COALESCE(d.dissent_present, false)
        )          AS hierarchy_score,
        0.9::float AS final_score   -- must-cites always score high (boosted upstream)
    FROM public.case_must_cites mc
    JOIN public.documents d ON d.id = mc.document_id
    WHERE mc.case_id = p_case_id
      AND (p_bureau_id IS NULL OR d.bureau_id IS NULL OR d.bureau_id = p_bureau_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

GRANT ALL ON TABLE public.bureaus TO service_role;
GRANT SELECT ON TABLE public.bureaus TO authenticated;

GRANT EXECUTE ON FUNCTION public.hybrid_legal_search(vector, text, uuid, int, date, uuid)
    TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_must_cite_documents(uuid, uuid)
    TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Bureau audit trigger (updated_at)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bureaus_updated_at ON public.bureaus;
CREATE TRIGGER bureaus_updated_at
    BEFORE UPDATE ON public.bureaus
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- ROLLBACK (run to undo — keep commented in production):
-- =============================================================================
-- DROP TABLE IF EXISTS public.bureaus CASCADE;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS bureau_id;
-- ALTER TABLE public.cases DROP COLUMN IF EXISTS bureau_id;
-- ALTER TABLE public.documents DROP COLUMN IF EXISTS bureau_id;
