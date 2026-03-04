-- ============================================================================
-- Step 13: GraphRAG — Atıf Zinciri ve Derinlik Sınırı
-- Migration: rag_v2_step13_graph.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.citation_edges (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_doc_id    UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    target_doc_id    UUID        REFERENCES public.documents(id) ON DELETE SET NULL,
    raw_citation     TEXT        NOT NULL,
    citation_type    TEXT        NOT NULL DEFAULT 'UNKNOWN',
    bureau_id        UUID        REFERENCES public.bureaus(id) ON DELETE CASCADE,
    extracted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ,
    CONSTRAINT chk_citation_type CHECK (
        citation_type IN (
            'KANUN_NO', 'MADDE_REF', 'YARGITAY', 'DANISTAY',
            'AYM', 'RESMI_GAZETE', 'UNKNOWN'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_citation_edges_source
    ON public.citation_edges (source_doc_id);

CREATE INDEX IF NOT EXISTS idx_citation_edges_target
    ON public.citation_edges (target_doc_id)
    WHERE target_doc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citation_edges_bureau
    ON public.citation_edges (bureau_id)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_citation_edges_type
    ON public.citation_edges (citation_type);


CREATE OR REPLACE FUNCTION public.citation_traversal(
    p_start_doc_id  UUID,
    p_max_depth     INT  DEFAULT 2,
    p_bureau_id     UUID DEFAULT NULL
)
RETURNS TABLE (
    doc_id          UUID,
    depth           INT,
    path            UUID[],
    cycle           BOOLEAN
)
LANGUAGE SQL
STABLE
AS $$
WITH RECURSIVE traversal AS (
    SELECT
        p_start_doc_id        AS doc_id,
        0                     AS depth,
        ARRAY[p_start_doc_id] AS path,
        FALSE                 AS cycle

    UNION ALL

    SELECT
        ce.target_doc_id               AS doc_id,
        t.depth + 1                    AS depth,
        t.path || ce.target_doc_id     AS path,
        ce.target_doc_id = ANY(t.path) AS cycle
    FROM public.citation_edges ce
    JOIN traversal t ON ce.source_doc_id = t.doc_id
    WHERE
        ce.target_doc_id IS NOT NULL
        AND t.depth < p_max_depth
        AND NOT t.cycle
        AND (p_bureau_id IS NULL OR ce.bureau_id = p_bureau_id)
)
SELECT DISTINCT ON (doc_id)
    doc_id,
    depth,
    path,
    cycle
FROM traversal
ORDER BY doc_id, depth;
$$;

COMMENT ON FUNCTION public.citation_traversal(UUID, INT, UUID) IS
'Recursive CTE: verilen belgeden başlayarak p_max_depth (varsayılan=2) adım derinliğe kadar ulaşılabilen tüm atıf zincirini döndürür. Döngü algılandığında cycle=TRUE işaretlenir; bu yol izlenmez.';


-- NOTE:
-- public.document_citations adı Step 5'te TABLE olarak kullanıldığı için
-- burada view adı çakışmaması adına farklı isim kullanıyoruz.
CREATE OR REPLACE VIEW public.document_citations_view AS
SELECT
    ce.id,
    ce.source_doc_id,
    src.citation AS source_citation,
    ce.target_doc_id,
    tgt.citation AS target_citation,
    ce.raw_citation,
    ce.citation_type,
    ce.bureau_id,
    ce.extracted_at,
    ce.resolved_at
FROM public.citation_edges ce
LEFT JOIN public.documents src ON src.id = ce.source_doc_id
LEFT JOIN public.documents tgt ON tgt.id = ce.target_doc_id;

COMMENT ON VIEW public.document_citations_view IS
'citation_edges + kaynak/hedef belge atıf etiketleriyle birleştirilmiş görünüm.';


ALTER TABLE public.citation_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS citation_edges_bureau_select ON public.citation_edges;
CREATE POLICY citation_edges_bureau_select
    ON public.citation_edges
    FOR SELECT
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

DROP POLICY IF EXISTS citation_edges_bureau_insert ON public.citation_edges;
CREATE POLICY citation_edges_bureau_insert
    ON public.citation_edges
    FOR INSERT
    WITH CHECK (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

DROP POLICY IF EXISTS citation_edges_bureau_delete ON public.citation_edges;
CREATE POLICY citation_edges_bureau_delete
    ON public.citation_edges
    FOR DELETE
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

DROP POLICY IF EXISTS citation_edges_service_role_all ON public.citation_edges;
CREATE POLICY citation_edges_service_role_all
    ON public.citation_edges
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

GRANT ALL ON TABLE public.citation_edges TO service_role;
GRANT SELECT, INSERT ON TABLE public.citation_edges TO authenticated;
GRANT SELECT ON TABLE public.document_citations_view TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.citation_traversal(uuid, int, uuid) TO authenticated, service_role;