-- =============================================================================
-- RAG V2.1 — Step 15 / 16 / 17: Audit, Cost & RAGAS Persistence
-- =============================================================================
-- Migration: rag_v2_step15_audit.sql
--
-- Purpose:
--   Creates the three persistence tables required to fully satisfy the
--   Step 17 acceptance criterion:
--     "Sistem her cevabında; why-this-answer logu, kullanılan kaynak
--      sürümleri, model kararı ve tool çağrıları şifreli kaydedilir."
--
--   1. public.audit_log          — HMAC-imzalı, değiştirilemez denetim izi
--   2. public.cost_log           — İstek başına LLM maliyet kaydı (dashboard)
--   3. public.ragas_metrics_log  — RAGAS kalite metrik anlık görüntüsü
--
-- Dependencies:
--   rag_v2_step6_tenant.sql   (bureaus table / bureau_id FK)
--
-- Safe to re-run: all statements use IF NOT EXISTS / DROP … IF EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_log — HMAC-SHA256 imzalı, değiştirilemez denetim izi
--    Her RAG yanıtı için AuditTrailRecorder.record() tarafından yazılır.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
    -- Identity
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid        NOT NULL UNIQUE,          -- Python UUID4

    -- Zaman
    timestamp_utc       timestamptz NOT NULL,

    -- KVKK: Ham sorgu saklanmaz — yalnızca SHA-256 özeti
    query_hash          text        NOT NULL,

    -- Tenant
    bureau_id           uuid        REFERENCES public.bureaus(id) ON DELETE SET NULL,

    -- LLM Kararı
    tier                smallint    NOT NULL CHECK (tier BETWEEN 1 AND 4),
    model_used          text        NOT NULL,

    -- Kaynaklar (JSONB dizi — SourceVersionRecord listesi)
    source_versions     jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- Araç çağrıları
    tool_calls_made     text[]      NOT NULL DEFAULT '{}',

    -- Kalite
    grounding_ratio     real        NOT NULL CHECK (grounding_ratio BETWEEN 0 AND 1),
    disclaimer_severity text        NOT NULL DEFAULT 'INFO'
                            CHECK (disclaimer_severity IN ('INFO', 'WARNING', 'CRITICAL')),

    -- Performans & Maliyet
    latency_ms          integer     NOT NULL,
    cost_estimate_usd   numeric(12, 6) NOT NULL DEFAULT 0,

    -- Açıklama logu (KVKK-güvenli, PII içermez)
    why_this_answer     text        NOT NULL DEFAULT '',

    -- Bütünlük
    audit_signature     text        NOT NULL,   -- HMAC-SHA256 hex (64 karakter)

    -- Oluşturulma zamanı (DB saati — Python zaman damgasından bağımsız kayıt)
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Hız indeksleri
CREATE INDEX IF NOT EXISTS idx_audit_log_bureau_time
    ON public.audit_log (bureau_id, timestamp_utc DESC)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
    ON public.audit_log (timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_tier
    ON public.audit_log (tier);

CREATE INDEX IF NOT EXISTS idx_audit_log_query_hash
    ON public.audit_log (query_hash);

COMMENT ON TABLE public.audit_log IS
    'Step 17: İmzalı, değiştirilemez denetim izi. Her RAG yanıtı için bir satır. '
    'HMAC-SHA256 imzası: query_hash | timestamp_utc | tier | model_used | '
    'grounding_ratio | cost_estimate_usd alanlarını kapsar.';

COMMENT ON COLUMN public.audit_log.audit_signature IS
    'HMAC-SHA256 hex özeti. verify_entry() ile bütünlük doğrulanabilir. '
    'Bu alanı değiştirmek imzayı geçersiz kılar.';

COMMENT ON COLUMN public.audit_log.source_versions IS
    'SourceVersionRecord listesi (JSON). LLM''e gösterilen her kaynağın '
    'doc_id, citation, version, collected_at, norm_hierarchy, authority_score bilgisini içerir.';

-- ---------------------------------------------------------------------------
-- 2. cost_log — İstek başına LLM maliyet kaydı
--    CostTracker.estimate_cost() çıktısı her istek sonunda buraya yazılır.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid        NOT NULL
                            REFERENCES public.audit_log(request_id) ON DELETE CASCADE,

    -- Model bilgisi
    model_id            text        NOT NULL,
    tier                smallint    NOT NULL CHECK (tier BETWEEN 1 AND 4),

    -- Token sayıları
    input_tokens        integer     NOT NULL DEFAULT 0,
    output_tokens       integer     NOT NULL DEFAULT 0,

    -- Maliyet bileşenleri (USD)
    input_cost_usd      numeric(12, 8) NOT NULL DEFAULT 0,
    output_cost_usd     numeric(12, 8) NOT NULL DEFAULT 0,
    total_cost_usd      numeric(12, 8) NOT NULL DEFAULT 0,

    -- Cache: true ise LLM maliyeti $0
    cache_hit           boolean     NOT NULL DEFAULT false,

    -- Tenant
    bureau_id           uuid        REFERENCES public.bureaus(id) ON DELETE SET NULL,

    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_log_request_id
    ON public.cost_log (request_id);

CREATE INDEX IF NOT EXISTS idx_cost_log_bureau_time
    ON public.cost_log (bureau_id, created_at DESC)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cost_log_model
    ON public.cost_log (model_id, created_at DESC);

COMMENT ON TABLE public.cost_log IS
    'Step 17: İstek bazında LLM maliyet kaydı. Cost Dashboard için. '
    'cache_hit=true satırlar $0 maliyetli önbellek yanıtlarını temsil eder.';

-- Günlük maliyet özeti (dashboard view)
CREATE OR REPLACE VIEW public.cost_daily_summary AS
SELECT
    DATE_TRUNC('day', created_at)   AS day,
    bureau_id,
    tier,
    model_id,
    COUNT(*)                        AS request_count,
    SUM(input_tokens)               AS total_input_tokens,
    SUM(output_tokens)              AS total_output_tokens,
    SUM(total_cost_usd)             AS total_cost_usd,
    COUNT(*) FILTER (WHERE cache_hit) AS cache_hits,
    AVG(total_cost_usd)             AS avg_cost_per_request
FROM public.cost_log
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, total_cost_usd DESC;

COMMENT ON VIEW public.cost_daily_summary IS
    'Step 17: Günlük maliyet özeti. Büro + tier + model bazında gruplandırılmış.';

-- ---------------------------------------------------------------------------
-- 3. ragas_metrics_log — RAGAS kalite metrik anlık görüntüsü
--    RAGASAdapter.compute() çıktısı her yanıt sonunda buraya yazılır.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ragas_metrics_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid        NOT NULL
                            REFERENCES public.audit_log(request_id) ON DELETE CASCADE,

    -- RAGAS metrikleri (tüm alan adları RAGASAdapter ile eşleşir)
    faithfulness        real        NOT NULL CHECK (faithfulness BETWEEN 0 AND 1),
    answer_relevancy    real        NOT NULL CHECK (answer_relevancy BETWEEN 0 AND 1),
    context_precision   real        NOT NULL CHECK (context_precision BETWEEN 0 AND 1),
    context_recall      real        NOT NULL CHECK (context_recall BETWEEN 0 AND 1),
    overall_quality     real        NOT NULL CHECK (overall_quality BETWEEN 0 AND 1),

    -- Ek bağlam
    tier                smallint    NOT NULL CHECK (tier BETWEEN 1 AND 4),
    source_count        integer     NOT NULL DEFAULT 0,
    bureau_id           uuid        REFERENCES public.bureaus(id) ON DELETE SET NULL,

    computed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ragas_bureau_time
    ON public.ragas_metrics_log (bureau_id, computed_at DESC)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ragas_quality
    ON public.ragas_metrics_log (overall_quality DESC);

COMMENT ON TABLE public.ragas_metrics_log IS
    'Step 17: RAGAS kalite metriklerinin anlık görüntüsü. '
    'faithfulness, answer_relevancy, context_precision, context_recall, overall_quality.';

-- Kalite trend view
CREATE OR REPLACE VIEW public.ragas_quality_trend AS
SELECT
    DATE_TRUNC('day', computed_at)  AS day,
    bureau_id,
    tier,
    ROUND(AVG(faithfulness)::numeric,      4) AS avg_faithfulness,
    ROUND(AVG(answer_relevancy)::numeric,  4) AS avg_answer_relevancy,
    ROUND(AVG(context_precision)::numeric, 4) AS avg_context_precision,
    ROUND(AVG(context_recall)::numeric,    4) AS avg_context_recall,
    ROUND(AVG(overall_quality)::numeric,   4) AS avg_overall_quality,
    COUNT(*)                                  AS sample_count
FROM public.ragas_metrics_log
GROUP BY 1, 2, 3
ORDER BY 1 DESC, avg_overall_quality DESC;

COMMENT ON VIEW public.ragas_quality_trend IS
    'Step 17: Günlük RAGAS kalite trendi. Büro + tier bazında gruplandırılmış.';

-- ---------------------------------------------------------------------------
-- 4. RLS — Tüm tablolara büro izolasyonu
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ragas_metrics_log ENABLE ROW LEVEL SECURITY;

-- audit_log
DROP POLICY IF EXISTS audit_log_service_role_all ON public.audit_log;
CREATE POLICY audit_log_service_role_all
    ON public.audit_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS audit_log_bureau_read ON public.audit_log;
CREATE POLICY audit_log_bureau_read
    ON public.audit_log FOR SELECT TO authenticated
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- cost_log
DROP POLICY IF EXISTS cost_log_service_role_all ON public.cost_log;
CREATE POLICY cost_log_service_role_all
    ON public.cost_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cost_log_bureau_read ON public.cost_log;
CREATE POLICY cost_log_bureau_read
    ON public.cost_log FOR SELECT TO authenticated
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- ragas_metrics_log
DROP POLICY IF EXISTS ragas_metrics_service_role_all ON public.ragas_metrics_log;
CREATE POLICY ragas_metrics_service_role_all
    ON public.ragas_metrics_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ragas_metrics_bureau_read ON public.ragas_metrics_log;
CREATE POLICY ragas_metrics_bureau_read
    ON public.ragas_metrics_log FOR SELECT TO authenticated
    USING (
        bureau_id IS NULL
        OR bureau_id = (SELECT bureau_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    );

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

GRANT ALL ON TABLE public.audit_log         TO service_role;
GRANT ALL ON TABLE public.cost_log          TO service_role;
GRANT ALL ON TABLE public.ragas_metrics_log TO service_role;
GRANT SELECT ON TABLE public.audit_log         TO authenticated;
GRANT SELECT ON TABLE public.cost_log          TO authenticated;
GRANT SELECT ON TABLE public.ragas_metrics_log TO authenticated;
GRANT SELECT ON VIEW  public.cost_daily_summary    TO authenticated, service_role;
GRANT SELECT ON VIEW  public.ragas_quality_trend   TO authenticated, service_role;

-- =============================================================================
-- ROLLBACK (keep commented in production):
-- =============================================================================
-- DROP VIEW  IF EXISTS public.ragas_quality_trend;
-- DROP VIEW  IF EXISTS public.cost_daily_summary;
-- DROP TABLE IF EXISTS public.ragas_metrics_log CASCADE;
-- DROP TABLE IF EXISTS public.cost_log CASCADE;
-- DROP TABLE IF EXISTS public.audit_log CASCADE;
