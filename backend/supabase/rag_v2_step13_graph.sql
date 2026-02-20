-- ============================================================================
-- Step 13: GraphRAG — Atıf Zinciri ve Derinlik Sınırı
-- Migration: rag_v2_step13_graph.sql
-- ============================================================================
--
-- Bu migrasyon, kanun-madde-karar atıf grafını saklamak için gerekli
-- altyapıyı oluşturur. Python tarafındaki CitationGraphExpander,
-- BFS ile çıkardığı atıfları bu tabloya yazar; citation_traversal()
-- fonksiyonu ise maksimum 2 derece derinliğe kadar izlenebilecek
-- komşu belgeleri döndürür.
--
-- Tablolar:
--   citation_edges  — yönlü atıf ilişkisi (kaynak_doc → hedef_doc)
--
-- Fonksiyon:
--   citation_traversal(start_doc_id, max_depth, p_bureau_id)
--     Recursive CTE: verilen belgeden başlayarak max_depth adım
--     derinliğe kadar ulaşılabilen tüm belgeleri döndürür.
--
-- View:
--   document_citations — citation_edges üzerine kolaylaştırıcı görünüm
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. citation_edges tablosu
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.citation_edges (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Kaynak belge (atıf yapan)
    source_doc_id    UUID        NOT NULL
                                 REFERENCES public.documents(id) ON DELETE CASCADE,

    -- Hedef belge (atıf yapılan) — null = henüz çözümlenmedi
    target_doc_id    UUID        REFERENCES public.documents(id) ON DELETE SET NULL,

    -- Çözümlenmemiş atıfın ham metni ("4857 sayılı Kanun md. 17" vb.)
    raw_citation     TEXT        NOT NULL,

    -- CitationType değeri: KANUN_NO | MADDE_REF | YARGITAY | AYM | DANISTAY | …
    citation_type    TEXT        NOT NULL DEFAULT 'UNKNOWN',

    -- Tenant yalıtımı (Step 6)
    bureau_id        UUID        REFERENCES public.bureaus(id) ON DELETE CASCADE,

    -- Zaman damgaları
    extracted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ,          -- target_doc_id dolduğunda güncellenir

    CONSTRAINT chk_citation_type CHECK (
        citation_type IN (
            'KANUN_NO', 'MADDE_REF', 'YARGITAY', 'DANISTAY',
            'AYM', 'RESMI_GAZETE', 'UNKNOWN'
        )
    )
);

-- Idempotent ingest için ünik kısıtlama (upsert on_conflict hedefi)
ALTER TABLE public.citation_edges
    DROP CONSTRAINT IF EXISTS uq_citation_edges_source_raw;
ALTER TABLE public.citation_edges
    ADD CONSTRAINT uq_citation_edges_source_raw
    UNIQUE (source_doc_id, raw_citation);

-- İndeksler
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

-- ----------------------------------------------------------------------------
-- 2. citation_traversal() — recursive CTE, max 2 derece derinlik
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION citation_traversal(
    p_start_doc_id  UUID,
    p_max_depth     INT  DEFAULT 2,
    p_bureau_id     UUID DEFAULT NULL
)
RETURNS TABLE (
    doc_id          UUID,
    depth           INT,
    path            UUID[],     -- belge kimliklerinin iz dizisi
    cycle           BOOLEAN     -- döngü tespit edildi mi?
)
LANGUAGE SQL
STABLE
AS $$
WITH RECURSIVE traversal AS (
    -- Başlangıç: derinlik 0
    SELECT
        p_start_doc_id              AS doc_id,
        0                           AS depth,
        ARRAY[p_start_doc_id]       AS path,
        FALSE                       AS cycle

    UNION ALL

    -- Özyinelemeli adım: bir sonraki derece
    SELECT
        ce.target_doc_id            AS doc_id,
        t.depth + 1                 AS depth,
        t.path || ce.target_doc_id  AS path,
        ce.target_doc_id = ANY(t.path) AS cycle
    FROM   public.citation_edges ce
    JOIN   traversal t ON ce.source_doc_id = t.doc_id
    WHERE
        -- Hedef belge çözümlü olmalı
        ce.target_doc_id IS NOT NULL
        -- Derinlik sınırı
        AND t.depth < p_max_depth
        -- Döngüye girme
        AND NOT t.cycle
        -- Tenant yalıtımı (isteğe bağlı)
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

COMMENT ON FUNCTION citation_traversal IS
'Recursive CTE: verilen belgeden başlayarak p_max_depth (varsayılan=2) adım
derinliğe kadar ulaşılabilen tüm atıf zincirini döndürür. Döngü algılandığında
cycle=TRUE işaretlenir; bu yol izlenmez (sonsuz döngü önlemi).';

-- ----------------------------------------------------------------------------
-- 3. document_citations view — basitleştirilmiş atıf sorgusu
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.document_citations AS
SELECT
    ce.id,
    ce.source_doc_id,
    src.citation   AS source_citation,
    ce.target_doc_id,
    tgt.citation   AS target_citation,
    ce.raw_citation,
    ce.citation_type,
    ce.bureau_id,
    ce.extracted_at,
    ce.resolved_at
FROM public.citation_edges ce
LEFT JOIN public.documents src ON src.id = ce.source_doc_id
LEFT JOIN public.documents tgt ON tgt.id = ce.target_doc_id;

COMMENT ON VIEW document_citations IS
'citation_edges + kaynak/hedef belge atıf etiketleriyle birleştirilmiş görünüm.';

-- ----------------------------------------------------------------------------
-- 4. RLS politikaları (Row-Level Security — Step 6 tenant isolation)
-- ----------------------------------------------------------------------------

ALTER TABLE public.citation_edges ENABLE ROW LEVEL SECURITY;

-- Büro sahibi okuyabilir
DROP POLICY IF EXISTS citation_edges_bureau_select ON public.citation_edges;
CREATE POLICY citation_edges_bureau_select
    ON public.citation_edges
    FOR SELECT
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- Büro sahibi yazabilir
DROP POLICY IF EXISTS citation_edges_bureau_insert ON public.citation_edges;
CREATE POLICY citation_edges_bureau_insert
    ON public.citation_edges
    FOR INSERT
    WITH CHECK (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- Büro sahibi silebilir
DROP POLICY IF EXISTS citation_edges_bureau_delete ON public.citation_edges;
CREATE POLICY citation_edges_bureau_delete
    ON public.citation_edges
    FOR DELETE
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- Servis rolü her şeyi yapabilir
DROP POLICY IF EXISTS citation_edges_service_role_all ON public.citation_edges;
CREATE POLICY citation_edges_service_role_all
    ON public.citation_edges FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Grants
GRANT ALL ON TABLE public.citation_edges TO service_role;
GRANT SELECT, INSERT ON TABLE public.citation_edges TO authenticated;
GRANT EXECUTE ON FUNCTION public.citation_traversal(uuid, int, uuid) TO authenticated, service_role;
