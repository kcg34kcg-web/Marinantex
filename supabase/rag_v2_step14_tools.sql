-- ============================================================================
-- Step 14: Agentic Tool Calling — Matematik/Süre Hesabı
-- Migration: rag_v2_step14_tools.sql
-- ============================================================================
--
-- Bu migrasyon; deterministik Python araçlarının (tarih/süre hesabı)
-- her çağrısını kayıt altına alır. Hukuki denetim izi (audit trail)
-- için zorunludur: hangi araç, hangi başlangıç tarihi, hangi sonuç,
-- hangi büro, hangi kullanıcı sorgusu — şifreli olarak saklanır.
--
-- Tablo:
--   tool_call_log  — her araç çağrısı için bir kayıt
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tool_call_log tablosu
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tool_call_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Araç tanımlaması
    tool_name       TEXT        NOT NULL,    -- DeadlineTool değeri
    tool_version    TEXT        NOT NULL DEFAULT '1.0',

    -- Girdi / Çıktı
    start_date      DATE,                   -- hesap başlangıç tarihi
    deadline_date   DATE,                   -- hesaplanan bitiş tarihi
    input_params    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    result_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Hukuki dayanak
    legal_basis     TEXT,                   -- örn. "İş K. md. 17/I"
    description_tr  TEXT,                   -- Türkçe açıklama

    -- İlgili RAG sorgusu (opsiyonel — bağlantı için)
    query_text      TEXT,
    case_id         TEXT,

    -- Tenant yalıtımı (Step 6)
    bureau_id       UUID        REFERENCES bureaus(id) ON DELETE SET NULL,

    -- Hata kaydı (araç hata verirse)
    error_message   TEXT,
    success         BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Zaman damgası
    called_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_tool_call_log_tool_name
    ON tool_call_log (tool_name);

CREATE INDEX IF NOT EXISTS idx_tool_call_log_bureau
    ON tool_call_log (bureau_id)
    WHERE bureau_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_call_log_called_at
    ON tool_call_log (called_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_log_case_id
    ON tool_call_log (case_id)
    WHERE case_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Hata kayıtları için view — izleme / uyarı sistemi için
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW tool_call_errors AS
SELECT
    id,
    tool_name,
    tool_version,
    input_params,
    error_message,
    query_text,
    bureau_id,
    called_at
FROM tool_call_log
WHERE success = FALSE
ORDER BY called_at DESC;

COMMENT ON VIEW tool_call_errors IS
'Başarısız araç çağrılarının izlenmesi için filtrelenmiş görünüm.
Üretim ortamında uyarı sistemiyle bağlanabilir.';

-- ----------------------------------------------------------------------------
-- 3. Araç kullanım özeti — maliyet/denetim dashboard için
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW tool_call_summary AS
SELECT
    tool_name,
    COUNT(*)                                        AS total_calls,
    COUNT(*) FILTER (WHERE success = TRUE)          AS successful,
    COUNT(*) FILTER (WHERE success = FALSE)         AS failed,
    DATE_TRUNC('day', called_at)                    AS call_date
FROM tool_call_log
GROUP BY tool_name, DATE_TRUNC('day', called_at)
ORDER BY call_date DESC, total_calls DESC;

COMMENT ON VIEW tool_call_summary IS
'Araç çağrıları günlük özet istatistikleri. Cost Dashboard (Step 17) için kullanılır.';

-- ----------------------------------------------------------------------------
-- 4. RLS politikaları (Row-Level Security — Step 6 tenant isolation)
-- ----------------------------------------------------------------------------

ALTER TABLE tool_call_log ENABLE ROW LEVEL SECURITY;

-- Büro sahibi okuyabilir
CREATE POLICY tool_call_log_bureau_select
    ON tool_call_log
    FOR SELECT
    USING (
        bureau_id IS NULL
        OR bureau_id = current_setting('app.current_bureau_id', TRUE)::UUID
    );

-- Büro sahibi yazabilir
CREATE POLICY tool_call_log_bureau_insert
    ON tool_call_log
    FOR INSERT
    WITH CHECK (
        bureau_id IS NULL
        OR bureau_id = current_setting('app.current_bureau_id', TRUE)::UUID
    );
