-- ============================================================================
-- Step 12: Hiyerarşi, Otorite ve Çatışma Duyarlı Re-Ranking
-- Migration: rag_v2_step12_reranking.sql
-- ============================================================================
-- Bu migration şunları ekler:
--   1. reranking_audit  — her re-ranking kararının denetim izi
--   2. reranking_domain_stats() — domain bazında istatistik fonksiyonu
--   3. norm_conflict_log — aynı sorgu için çakışan normların kaydı
-- ============================================================================

-- ── 1. Re-ranking Denetim İzi Tablosu ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS reranking_audit (
    id                   BIGSERIAL    PRIMARY KEY,
    session_id           UUID         NOT NULL DEFAULT gen_random_uuid(),
    query_text           TEXT         NOT NULL,
    query_domain         TEXT,                          -- detect_query_domain() çıktısı
    document_id          TEXT         NOT NULL,         -- LegalDocument.id
    document_citation    TEXT,                          -- kısa atıf
    norm_hierarchy       TEXT,                          -- ANAYASA/KANUN/CBK/...
    court_level          TEXT,                          -- mahkeme seviyesi
    original_rank        INT          NOT NULL,         -- RRF sonrası sıra (1-tabanlı)
    reranked_rank        INT          NOT NULL,         -- re-rank sonrası sıra (1-tabanlı)
    base_score           FLOAT        NOT NULL DEFAULT 0.0,
    authority_boost      FLOAT        NOT NULL DEFAULT 0.0,
    hierarchy_boost      FLOAT        NOT NULL DEFAULT 0.0,
    binding_boost        FLOAT        NOT NULL DEFAULT 0.0,
    lex_specialis_boost  FLOAT        NOT NULL DEFAULT 0.0,
    lex_posterior_boost  FLOAT        NOT NULL DEFAULT 0.0,
    total_score          FLOAT        NOT NULL DEFAULT 0.0,
    conflict_notes       TEXT[]       NOT NULL DEFAULT '{}',
    bureau_id            UUID,
    case_id              TEXT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Zaman bazlı sorgu performansı için index
CREATE INDEX IF NOT EXISTS idx_reranking_audit_created
    ON reranking_audit(created_at DESC);

-- Büro izolasyonu + zaman için bileşik index
CREATE INDEX IF NOT EXISTS idx_reranking_audit_bureau_created
    ON reranking_audit(bureau_id, created_at DESC)
    WHERE bureau_id IS NOT NULL;

-- Belge bazında yeniden sıralama geçmişi
CREATE INDEX IF NOT EXISTS idx_reranking_audit_document
    ON reranking_audit(document_id, created_at DESC);

-- ── 2. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE reranking_audit ENABLE ROW LEVEL SECURITY;

-- Sadece service_role yazabilir ve okuyabilir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'reranking_audit'
          AND policyname = 'service_role_reranking_audit'
    ) THEN
        CREATE POLICY "service_role_reranking_audit"
            ON reranking_audit
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- ── 3. Norm Çatışma Kaydı ────────────────────────────────────────────────────
-- Aynı sorguda aynı norm seviyesinde çakışan belgeler kaydedilir.

CREATE TABLE IF NOT EXISTS norm_conflict_log (
    id                   BIGSERIAL    PRIMARY KEY,
    session_id           UUID         NOT NULL,
    query_text           TEXT         NOT NULL,
    conflict_type        TEXT         NOT NULL  CHECK (conflict_type IN (
                                           'LEX_SPECIALIS',
                                           'LEX_POSTERIOR',
                                           'HIERARCHY',
                                           'BINDING_PRECEDENT'
                                       )),
    winner_doc_id        TEXT         NOT NULL,
    loser_doc_id         TEXT         NOT NULL,
    winner_norm          TEXT,
    loser_norm           TEXT,
    winner_date          DATE,
    loser_date           DATE,
    conflict_note        TEXT,
    bureau_id            UUID,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_norm_conflict_log_session
    ON norm_conflict_log(session_id);

ALTER TABLE norm_conflict_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'norm_conflict_log'
          AND policyname = 'service_role_norm_conflict_log'
    ) THEN
        CREATE POLICY "service_role_norm_conflict_log"
            ON norm_conflict_log
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- ── 4. İstatistik Fonksiyonu ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reranking_domain_stats(
    p_hours      INT DEFAULT 24,
    p_bureau_id  UUID DEFAULT NULL
)
RETURNS TABLE (
    domain                    TEXT,
    total_rerankings          BIGINT,
    avg_rank_change           FLOAT,
    lex_specialis_applications BIGINT,
    lex_posterior_applications BIGINT,
    binding_boost_applications BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ra.query_domain                                              AS domain,
        COUNT(*)                                                     AS total_rerankings,
        AVG(ABS(ra.reranked_rank - ra.original_rank))::FLOAT        AS avg_rank_change,
        COUNT(CASE WHEN ra.lex_specialis_boost > 0 THEN 1 END)      AS lex_specialis_applications,
        COUNT(CASE WHEN ra.lex_posterior_boost  > 0 THEN 1 END)     AS lex_posterior_applications,
        COUNT(CASE WHEN ra.binding_boost        > 0 THEN 1 END)     AS binding_boost_applications
    FROM reranking_audit ra
    WHERE ra.created_at > (now() - (p_hours || ' hours')::INTERVAL)
      AND (p_bureau_id IS NULL OR ra.bureau_id = p_bureau_id)
    GROUP BY ra.query_domain
    ORDER BY total_rerankings DESC;
END;
$$;

COMMENT ON TABLE  reranking_audit   IS 'Step 12: Re-ranking kararlarının denetim izi — her belge için skor dökümü.';
COMMENT ON TABLE  norm_conflict_log IS 'Step 12: Lex Specialis / Lex Posterior çatışma kayıtları.';
COMMENT ON COLUMN reranking_audit.original_rank  IS 'RRF sonrası sıra (1 = en iyi)';
COMMENT ON COLUMN reranking_audit.reranked_rank  IS 'LegalReranker sonrası sıra (1 = en iyi)';
COMMENT ON COLUMN reranking_audit.conflict_notes IS 'Lex kural uygulamalarının Türkçe açıklaması';
