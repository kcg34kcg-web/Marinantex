"""
Tests — Step 14: Agentic Tool Calling (Matematik/Süre Hesabı)
=============================================================
Gruplar:
    A — is_business_day()                          (6 test)
    B — add_calendar_days()                        (5 test)
    C — add_months()                               (5 test)
    D — business_days_between()                    (5 test)
    E — LegalDeadlineEngine.detect_tools()         (6 test)
    F — LegalDeadlineEngine.calculate()            (6 test)
    G — calculate_ihbar() tier seçimi             (4 test)
    H — ToolDispatcher.dispatch()                  (7 test)
    I — RAGService entegrasyon                     (3 test)

Toplam: 47 yeni test  →  480 + 47 = 527 hedef
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from infrastructure.agents.tool_dispatcher import DispatchResult, ToolDispatcher
from infrastructure.legal.tools.date_calculator import (
    add_calendar_days,
    add_months,
    add_years,
    business_days_between,
    is_business_day,
    next_business_day,
)
from infrastructure.legal.tools.deadline_engine import (
    DeadlineTool,
    LegalDeadlineEngine,
    legal_deadline_engine,
)
from infrastructure.llm.tiered_router import QueryTier


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı sabitler ve fabrikalar
# ─────────────────────────────────────────────────────────────────────────────

# Çarşamba — standart başlangıç tarihi (ihbar süreleri +14/+28/+42/+56 gün
# ile Çarşamba'ya denk gelir → hafta sonu düzeltmesi olmaz; testler deterministik kalır).
_START = date(2025, 1, 15)


def _empty_dispatch() -> DispatchResult:
    """Boş DispatchResult yardımcısı."""
    return DispatchResult(
        tool_results=[],
        context_block="",
        tools_invoked=[],
        tools_errored=[],
        was_triggered=False,
    )


def _doc(doc_id: str, *, final_score: float = 0.80):
    """Test belgesi fabrikası."""
    from datetime import datetime

    from domain.entities.legal_document import LegalDocument

    return LegalDocument(
        id=doc_id,
        content=f"İş Kanunu md. 17 — {doc_id}",
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=final_score,
    )


# ============================================================================
# A — is_business_day()
# ============================================================================


class TestIsBusinessDay:
    """A: Takvim günü sınıflandırması (Pzt-Cum iş günü, Cmt-Paz değil)."""

    def test_monday_is_business_day(self) -> None:
        """Pazartesi → iş günü."""
        assert is_business_day(date(2025, 1, 6)) is True  # Mon

    def test_tuesday_is_business_day(self) -> None:
        """Salı → iş günü."""
        assert is_business_day(date(2025, 1, 7)) is True  # Tue

    def test_wednesday_is_business_day(self) -> None:
        """Çarşamba → iş günü."""
        assert is_business_day(date(2025, 1, 8)) is True  # Wed

    def test_friday_is_business_day(self) -> None:
        """Cuma → iş günü."""
        assert is_business_day(date(2025, 1, 10)) is True  # Fri

    def test_saturday_is_not_business_day(self) -> None:
        """Cumartesi → iş günü değil."""
        assert is_business_day(date(2025, 1, 11)) is False  # Sat

    def test_sunday_is_not_business_day(self) -> None:
        """Pazar → iş günü değil."""
        assert is_business_day(date(2025, 1, 12)) is False  # Sun


# ============================================================================
# B — add_calendar_days()
# ============================================================================


class TestAddCalendarDays:
    """B: Takvim günü ekleme — İş K. md. 17 ihbar süreleri için."""

    def test_add_14_days(self) -> None:
        """+14 takvim günü (kıdem < 6 ay ihbar süresi)."""
        r = add_calendar_days(_START, 14)
        assert r.result_date == date(2025, 1, 29)
        assert r.days_from_start == 14
        assert r.input_date == _START

    def test_add_28_days(self) -> None:
        """+28 takvim günü (6-18 ay arası ihbar süresi)."""
        r = add_calendar_days(_START, 28)
        assert r.result_date == date(2025, 2, 12)
        assert r.days_from_start == 28

    def test_add_42_days(self) -> None:
        """+42 takvim günü (18 ay-3 yıl arası ihbar süresi)."""
        r = add_calendar_days(_START, 42)
        assert r.result_date == date(2025, 2, 26)
        assert r.days_from_start == 42

    def test_add_56_days(self) -> None:
        """+56 takvim günü (kıdem ≥ 3 yıl ihbar süresi)."""
        r = add_calendar_days(_START, 56)
        assert r.result_date == date(2025, 3, 12)
        assert r.days_from_start == 56

    def test_subtract_days_goes_back(self) -> None:
        """Negatif gün → geriye gider."""
        r = add_calendar_days(_START, -7)
        assert r.result_date == date(2025, 1, 8)
        assert r.days_from_start == -7


# ============================================================================
# C — add_months()
# ============================================================================


class TestAddMonths:
    """C: Ay ekleme — ay sonu kırpma ve artık yıl edge-case'leri."""

    def test_jan31_plus_1month_clamps_to_feb28(self) -> None:
        """Ocak 31 + 1 ay = Şubat 28 (2025 artık yıl değil → kırpma)."""
        r = add_months(date(2025, 1, 31), 1)
        assert r.result_date == date(2025, 2, 28)

    def test_feb28_plus_1month_normal(self) -> None:
        """Şubat 28 + 1 ay = Mart 28 (normal, kırpma yok)."""
        r = add_months(date(2025, 2, 28), 1)
        assert r.result_date == date(2025, 3, 28)

    def test_plus_12_months_same_day_next_year(self) -> None:
        """+12 ay → aynı gün bir sonraki yıl."""
        r = add_months(date(2025, 3, 15), 12)
        assert r.result_date == date(2026, 3, 15)

    def test_jan31_plus_1month_leap_year_gives_feb29(self) -> None:
        """Ocak 31 2024 + 1 ay = Şubat 29 2024 (2024 artık yıl → kırpma yok)."""
        r = add_months(date(2024, 1, 31), 1)
        assert r.result_date == date(2024, 2, 29)

    def test_nov30_plus_3months_clamps_to_feb28(self) -> None:
        """Kasım 30 + 3 ay = Şubat 28 2026 (artık yıl değil → kırpma)."""
        r = add_months(date(2025, 11, 30), 3)
        assert r.result_date == date(2026, 2, 28)


# ============================================================================
# D — business_days_between()
# ============================================================================


class TestBusinessDaysBetween:
    """D: İş günü sayımı (dahil her iki uç)."""

    def test_same_monday_returns_one(self) -> None:
        """Aynı Pazartesi → 1 iş günü."""
        d = date(2025, 1, 6)
        assert business_days_between(d, d) == 1

    def test_same_saturday_returns_zero(self) -> None:
        """Aynı Cumartesi → 0 iş günü."""
        d = date(2025, 1, 11)
        assert business_days_between(d, d) == 0

    def test_monday_to_friday_is_five(self) -> None:
        """Pzt → Cum (aynı hafta) = 5 iş günü."""
        assert business_days_between(date(2025, 1, 6), date(2025, 1, 10)) == 5

    def test_monday_to_next_monday_is_six(self) -> None:
        """Pzt → sonraki Pzt (7 takvim günü) = 6 iş günü (Cmt+Paz atlanır)."""
        assert business_days_between(date(2025, 1, 6), date(2025, 1, 13)) == 6

    def test_reversed_range_returns_negative(self) -> None:
        """Bitiş < başlangıç → negatif sonuç."""
        result = business_days_between(date(2025, 1, 10), date(2025, 1, 6))
        assert result == -5


# ============================================================================
# E — LegalDeadlineEngine.detect_tools()
# ============================================================================


class TestDetectTools:
    """E: Niyet tespiti — Türkçe anahtar kelime eşleştirme."""

    def test_ihbar_suresi_keyword_detects_ihbar_tool(self) -> None:
        """'ihbar süresi' → IS_AKDI_IHBAR_6AY tespit edilmeli."""
        tools = legal_deadline_engine.detect_tools(
            "iş sözleşmesi ihbar süresi hesaplanması"
        )
        assert DeadlineTool.IS_AKDI_IHBAR_6AY in tools

    def test_idari_dava_keyword_detected(self) -> None:
        """'idari dava' → IDARI_DAVA tespit edilmeli."""
        tools = legal_deadline_engine.detect_tools(
            "idari dava açma süresi nedir?"
        )
        assert DeadlineTool.IDARI_DAVA in tools

    def test_hukuk_temyiz_keyword_detected(self) -> None:
        """'hukuk temyiz' → HUKUK_TEMYIZ tespit edilmeli."""
        tools = legal_deadline_engine.detect_tools(
            "hukuk temyiz süresi hesaplama HMK"
        )
        assert DeadlineTool.HUKUK_TEMYIZ in tools

    def test_ceza_temyiz_keyword_detected(self) -> None:
        """'ceza temyiz' → CEZA_TEMYIZ tespit edilmeli."""
        tools = legal_deadline_engine.detect_tools(
            "ceza temyiz dilekçesi kaç gün içinde verilmeli"
        )
        assert DeadlineTool.CEZA_TEMYIZ in tools

    def test_empty_query_returns_empty_list(self) -> None:
        """Boş sorgu → boş liste."""
        tools = legal_deadline_engine.detect_tools("")
        assert tools == []

    def test_unrelated_query_returns_empty_list(self) -> None:
        """İlgisiz sorgu → boş liste."""
        tools = legal_deadline_engine.detect_tools(
            "taşınmaz satış sözleşmesi tapu devri mülkiyet"
        )
        assert tools == []


# ============================================================================
# F — LegalDeadlineEngine.calculate()
# ============================================================================


class TestCalculateDeadline:
    """F: Deterministik süre hesabı — hak düşürücü süreler."""

    def test_ihbar_1yil_14_days_no_weekend_adjustment(self) -> None:
        """Kıdem < 6 ay: 14 takvim günü, hafta sonu yok."""
        # 2025-01-15 (Wed) + 14 days = 2025-01-29 (Wed) — no adjustment
        r = legal_deadline_engine.calculate(DeadlineTool.IS_AKDI_IHBAR_1YIL, _START)
        assert r.deadline_date == date(2025, 1, 29)
        assert r.tool == DeadlineTool.IS_AKDI_IHBAR_1YIL
        assert r.adjusted_for_weekend is False

    def test_ihbar_6ay_28_days_no_weekend_adjustment(self) -> None:
        """Kıdem 6-18 ay: 28 takvim günü, hafta sonu yok."""
        # 2025-01-15 + 28 days = 2025-02-12 (Wed)
        r = legal_deadline_engine.calculate(DeadlineTool.IS_AKDI_IHBAR_6AY, _START)
        assert r.deadline_date == date(2025, 2, 12)
        assert r.adjusted_for_weekend is False

    def test_ihbar_18ay_42_days_no_weekend_adjustment(self) -> None:
        """Kıdem 18 ay-3 yıl: 42 takvim günü, hafta sonu yok."""
        # 2025-01-15 + 42 days = 2025-02-26 (Wed)
        r = legal_deadline_engine.calculate(DeadlineTool.IS_AKDI_IHBAR_18AY, _START)
        assert r.deadline_date == date(2025, 2, 26)
        assert r.adjusted_for_weekend is False

    def test_ihbar_3yil_56_days_no_weekend_adjustment(self) -> None:
        """Kıdem ≥ 3 yıl: 56 takvim günü, hafta sonu yok."""
        # 2025-01-15 + 56 days = 2025-03-12 (Wed)
        r = legal_deadline_engine.calculate(DeadlineTool.IS_AKDI_IHBAR_3YIL, _START)
        assert r.deadline_date == date(2025, 3, 12)
        assert r.adjusted_for_weekend is False

    def test_idari_dava_60_days_weekend_adjusted(self) -> None:
        """İdari dava: 60 gün → Pazar'a denk gelir → Pazartesi'ye kaydırılır."""
        # 2025-01-15 + 60 days = 2025-03-16 (Sun) → adjusted to 2025-03-17 (Mon)
        r = legal_deadline_engine.calculate(DeadlineTool.IDARI_DAVA, _START)
        assert r.deadline_date == date(2025, 3, 17)
        assert r.adjusted_for_weekend is True

    def test_ihbar_weekend_start_gets_adjusted(self) -> None:
        """Son gün hafta sonuna denk gelirse bir sonraki iş gününe kaydırılır."""
        # 2025-01-18 (Sat) + 14 days = 2025-02-01 (Sat) → Mon 2025-02-03
        start = date(2025, 1, 18)  # Saturday
        r = legal_deadline_engine.calculate(DeadlineTool.IS_AKDI_IHBAR_1YIL, start)
        assert r.deadline_date == date(2025, 2, 3)
        assert r.adjusted_for_weekend is True


# ============================================================================
# G — calculate_ihbar() tier seçimi
# ============================================================================


class TestCalculateIhbar:
    """G: calculate_ihbar() — kıdem yılına göre doğru tier ve gün sayısı."""

    def test_seniority_03yr_selects_14_days(self) -> None:
        """Kıdem 0.3 yıl → kıdem < 6 ay → 14 gün (IS_AKDI_IHBAR_1YIL)."""
        r = legal_deadline_engine.calculate_ihbar(_START, seniority_years=0.3)
        assert r.tool == DeadlineTool.IS_AKDI_IHBAR_1YIL
        assert r.deadline_date == date(2025, 1, 29)

    def test_seniority_10yr_selects_28_days(self) -> None:
        """Kıdem 1.0 yıl → 6 ay ≤ kıdem < 18 ay → 28 gün (IS_AKDI_IHBAR_6AY)."""
        r = legal_deadline_engine.calculate_ihbar(_START, seniority_years=1.0)
        assert r.tool == DeadlineTool.IS_AKDI_IHBAR_6AY
        assert r.deadline_date == date(2025, 2, 12)

    def test_seniority_20yr_selects_42_days(self) -> None:
        """Kıdem 2.0 yıl → 18 ay ≤ kıdem < 3 yıl → 42 gün (IS_AKDI_IHBAR_18AY)."""
        r = legal_deadline_engine.calculate_ihbar(_START, seniority_years=2.0)
        assert r.tool == DeadlineTool.IS_AKDI_IHBAR_18AY
        assert r.deadline_date == date(2025, 2, 26)

    def test_seniority_40yr_selects_56_days(self) -> None:
        """Kıdem 4.0 yıl → kıdem ≥ 3 yıl → 56 gün (IS_AKDI_IHBAR_3YIL)."""
        r = legal_deadline_engine.calculate_ihbar(_START, seniority_years=4.0)
        assert r.tool == DeadlineTool.IS_AKDI_IHBAR_3YIL
        assert r.deadline_date == date(2025, 3, 12)


# ============================================================================
# H — ToolDispatcher.dispatch()
# ============================================================================


class TestToolDispatcher:
    """H: ToolDispatcher.dispatch() — tier geçidi ve araç tetikleyici."""

    def _dispatcher(self) -> ToolDispatcher:
        return ToolDispatcher(engine=legal_deadline_engine)

    def test_tier1_skips_dispatch(self) -> None:
        """Tier 1 → tier < min_tier=3 → araç çalıştırılmaz."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER1, start_date=_START
            )
        assert result.was_triggered is False
        assert result.tools_invoked == []
        assert result.context_block == ""

    def test_tier2_skips_dispatch(self) -> None:
        """Tier 2 → tier < min_tier=3 → araç çalıştırılmaz."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER2, start_date=_START
            )
        assert result.was_triggered is False

    def test_tier3_with_ihbar_keyword_triggers(self) -> None:
        """Tier 3 + ihbar anahtar kelimesi → araç tetiklenir."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER3, start_date=_START
            )
        assert result.was_triggered is True
        assert len(result.tools_invoked) >= 1

    def test_tier4_with_ihbar_keyword_triggers(self) -> None:
        """Tier 4 + ihbar anahtar kelimesi → araç tetiklenir."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER4, start_date=_START
            )
        assert result.was_triggered is True

    def test_tier3_no_keywords_not_triggered(self) -> None:
        """Tier 3 ama eşleşen anahtar kelime yok → tetiklenmez."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "taşınmaz satış sözleşmesi tapu devri", QueryTier.TIER3, start_date=_START
            )
        assert result.was_triggered is False
        assert result.context_block == ""

    def test_context_block_contains_tool_header_when_triggered(self) -> None:
        """Araç tetiklendiğinde context_block Türkçe başlık içermeli."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "agentic_tools_min_tier", 3):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER3, start_date=_START
            )
        assert "ARAÇ SONUÇLARI" in result.context_block

    def test_agentic_tools_disabled_skips_dispatch(self) -> None:
        """agentic_tools_enabled=False → araç çalıştırılmaz (global devre dışı)."""
        from infrastructure.config import settings as app_settings

        d = self._dispatcher()
        with patch.object(app_settings, "agentic_tools_enabled", False):
            result = d.dispatch(
                "ihbar süresi hesaplanması", QueryTier.TIER3, start_date=_START
            )
        assert result.was_triggered is False
        assert result.tools_invoked == []


# ============================================================================
# I — RAGService entegrasyon testleri
# ============================================================================


class TestRAGServiceAgenticToolsIntegration:
    """I: RAGService — agentic tool calling pipeline entegrasyonu."""

    def _make_service(
        self,
        docs,
        tier: QueryTier = QueryTier.TIER3,
        mock_dispatcher: Optional[MagicMock] = None,
    ):
        from application.services.rag_service import RAGService
        from infrastructure.agents.tool_dispatcher import ToolDispatcher
        from infrastructure.graph.citation_graph import (
            CitationGraphExpander,
            CitationGraphResult,
        )
        from infrastructure.reranking.legal_reranker import (
            LegalReranker,
            RerankResult,
            RerankScore,
        )
        from infrastructure.search.rrf_retriever import RRFSearchResult

        # ── Router mock ─────────────────────────────────────────────────────
        mock_router = MagicMock()
        mock_router.decide.return_value = MagicMock(tier=tier)
        mock_router.generate = AsyncMock(return_value=("Cevap.", "openai/gpt-4o"))

        # ── Prompt guard mock ────────────────────────────────────────────────
        mock_guard = MagicMock()
        mock_guard.check_query.return_value = None
        mock_guard.check_context.return_value = None

        # ── Embedder mock ────────────────────────────────────────────────────
        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 8)

        # ── RRF retriever mock ───────────────────────────────────────────────
        mock_rrf = MagicMock()
        mock_rrf.search = AsyncMock(
            return_value=RRFSearchResult(
                documents=docs,
                rrf_scores={d.id: d.final_score for d in docs},
                semantic_count=len(docs),
                keyword_count=0,
                expanded_query="",
                fusion_applied=False,
            )
        )

        # ── Reranker mock ────────────────────────────────────────────────────
        mock_reranker = MagicMock(spec=LegalReranker)
        mock_reranker.rerank = MagicMock(
            return_value=[
                RerankResult(document=d, score=RerankScore(base_score=d.final_score))
                for d in docs
            ]
        )

        # ── GraphRAG expander mock ───────────────────────────────────────────
        mock_graph_expander = MagicMock(spec=CitationGraphExpander)
        mock_graph_expander.expand = AsyncMock(
            return_value=CitationGraphResult(
                root_docs=docs,
                expanded_docs=[],
                all_docs=docs,
                nodes={},
                edges=[],
                total_depth_reached=0,
                expansion_count=0,
                cycle_detected=False,
            )
        )

        # ── Context builder mock ─────────────────────────────────────────────
        mock_ctx_result = MagicMock()
        mock_ctx_result.context_str = "Bağlam metni."
        mock_ctx_result.used_docs = docs
        mock_ctx_result.truncated = False
        mock_ctx_result.dropped_count = 0
        mock_ctx_result.total_tokens = 100

        mock_ctx_builder = MagicMock()
        mock_ctx_builder.build.return_value = mock_ctx_result

        # ── Tool dispatcher mock ─────────────────────────────────────────────
        if mock_dispatcher is None:
            mock_dispatcher = MagicMock(spec=ToolDispatcher)
            mock_dispatcher.dispatch.return_value = _empty_dispatch()

        svc = RAGService(
            router=mock_router,
            guard=mock_guard,
            embedder=mock_embedder,
            rrf=mock_rrf,
            reranker=mock_reranker,
            ctx_builder=mock_ctx_builder,
            graph_expander=mock_graph_expander,
            dispatcher=mock_dispatcher,
        )
        svc._tier_max_tokens = lambda tier_: 5000
        return svc, mock_dispatcher

    async def test_dispatcher_called_for_tier3(self) -> None:
        """Tier 3 sorgusunda dispatcher.dispatch() çağrılmalı ve tier parametresi doğru."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        svc, mock_disp = self._make_service(docs, tier=QueryTier.TIER3)
        req = RAGQueryRequest(query="ihbar süresi hesabı")

        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_disp.dispatch.assert_called_once()
        call_kwargs = mock_disp.dispatch.call_args
        # tier parametresi TIER3 olmalı (positional veya keyword)
        passed_tier = (
            call_kwargs.kwargs.get("tier")
            if call_kwargs.kwargs.get("tier") is not None
            else call_kwargs.args[1]
        )
        assert passed_tier == QueryTier.TIER3

    async def test_dispatcher_also_called_for_tier1(self) -> None:
        """Tier 1'de de dispatch() çağrılır — tier geçidi dispatcher içindedir."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        svc, mock_disp = self._make_service(docs, tier=QueryTier.TIER1)
        req = RAGQueryRequest(query="basit hukuki soru")

        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_disp.dispatch.assert_called_once()

    async def test_tool_result_prepended_to_llm_context(self) -> None:
        """was_triggered=True → araç bloğu LLM bağlamının başına eklenir."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        tool_block = "=== ARAÇ SONUÇLARI (Deterministik Hesap) ===\n[ARAÇ: IS_AKDI_IHBAR_6AY]"

        mock_disp = MagicMock()
        mock_disp.dispatch.return_value = DispatchResult(
            tool_results=[],
            context_block=tool_block,
            tools_invoked=["IS_AKDI_IHBAR_6AY"],
            tools_errored=[],
            was_triggered=True,
        )

        svc, _ = self._make_service(docs, tier=QueryTier.TIER3, mock_dispatcher=mock_disp)
        req = RAGQueryRequest(query="ihbar süresi hesabı")

        with patch.object(app_settings, "agentic_tools_enabled", True), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        # router.generate → 2. pozisyon argümanı LLM context'idir
        generate_call = svc._router.generate.call_args
        context_passed = (
            generate_call.args[1]
            if len(generate_call.args) > 1
            else generate_call.kwargs.get("context", "")
        )
        assert tool_block in context_passed
