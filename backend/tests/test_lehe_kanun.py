"""
Tests — Step 10: Time-Travel Search ve "Lehe Kanun" Motoru
===========================================================
Groups:
    A — LawDomain enum                         (5 tests)
    B — LeheKanunResult domain object           (7 tests)
    C — classify_domain() keyword detection    (10 tests)
    D — LeheKanunEngine.check() logic           (8 tests)
    E — LeheKanunNoticeSchema / RAGQueryRequest (6 tests)
    F — RAGResponse lehe_kanun_notice field     (4 tests)

Total: 40 new tests  →  291 + 40 = 331 passing target
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime
from typing import List

import pytest

from api.schemas import (
    LeheKanunNoticeSchema,
    RAGQueryRequest,
    RAGResponse,
    SourceDocumentSchema,
)
from domain.entities.lehe_kanun import LawDomain, LeheKanunResult
from infrastructure.legal.lehe_kanun_engine import (
    LeheKanunEngine,
    classify_domain,
)

# ---------------------------------------------------------------------------
# Shared date constants
# ---------------------------------------------------------------------------

_EVENT   = date(2020, 6, 1)    # Suç/olay tarihi
_KARAR   = date(2026, 2, 1)    # Karar/hüküm tarihi
_SAME    = date(2023, 1, 1)    # Same date (no diff)


# ============================================================================
# A — LawDomain enum
# ============================================================================

class TestLawDomain:
    """Group A: LawDomain enum properties and values."""

    def test_ceza_lehe_applicable(self) -> None:
        assert LawDomain.CEZA.lehe_applicable is True

    def test_idari_ceza_lehe_applicable(self) -> None:
        assert LawDomain.IDARI_CEZA.lehe_applicable is True

    def test_vergi_ceza_lehe_applicable(self) -> None:
        assert LawDomain.VERGI_CEZA.lehe_applicable is True

    def test_diger_not_lehe_applicable(self) -> None:
        assert LawDomain.DIGER.lehe_applicable is False

    def test_unknown_not_lehe_applicable(self) -> None:
        assert LawDomain.UNKNOWN.lehe_applicable is False


# ============================================================================
# B — LeheKanunResult domain object
# ============================================================================

class TestLeheKanunResult:
    """Group B: LeheKanunResult frozen dataclass factories and invariants."""

    def test_not_applicable_factory(self) -> None:
        r = LeheKanunResult.not_applicable(
            law_domain=LawDomain.DIGER,
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="Özel hukuk",
        )
        assert r.lehe_applicable is False
        assert r.both_versions_needed is False

    def test_applicable_factory(self) -> None:
        r = LeheKanunResult.applicable(
            law_domain=LawDomain.CEZA,
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="TCK md. 7/2 uygulanır",
        )
        assert r.lehe_applicable is True
        assert r.both_versions_needed is True

    def test_applicable_carries_dates(self) -> None:
        r = LeheKanunResult.applicable(
            law_domain=LawDomain.CEZA,
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        assert r.event_date == _EVENT
        assert r.decision_date == _KARAR

    def test_legal_basis_default(self) -> None:
        r = LeheKanunResult.applicable(
            law_domain=LawDomain.CEZA,
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        assert "TCK Madde 7/2" in r.legal_basis

    def test_result_is_frozen(self) -> None:
        r = LeheKanunResult.not_applicable(
            law_domain=LawDomain.DIGER,
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        with pytest.raises((dataclasses.FrozenInstanceError, AttributeError)):
            r.lehe_applicable = True  # type: ignore[misc]

    def test_both_versions_needed_requires_lehe_applicable(self) -> None:
        """Invariant: both_versions_needed=True without lehe_applicable=True → ValueError."""
        with pytest.raises(ValueError):
            LeheKanunResult(
                law_domain=LawDomain.DIGER,
                event_date=_EVENT,
                decision_date=_KARAR,
                lehe_applicable=False,
                both_versions_needed=True,   # violates invariant
                reason="test",
            )

    def test_not_applicable_for_same_date(self) -> None:
        r = LeheKanunResult.not_applicable(
            law_domain=LawDomain.CEZA,
            event_date=_SAME,
            decision_date=_SAME,
            reason="Aynı tarih",
        )
        assert r.both_versions_needed is False


# ============================================================================
# C — classify_domain() keyword detection
# ============================================================================

class TestClassifyDomain:
    """Group C: classify_domain() with Turkish legal keywords."""

    def test_tck_keyword_returns_ceza(self) -> None:
        assert classify_domain("TCK kapsamında hırsızlık suçu için ceza ne?") == LawDomain.CEZA

    def test_hapis_cezasi_keyword_returns_ceza(self) -> None:
        assert classify_domain("Sanığa verilen hapis cezası ertelendi mi?") == LawDomain.CEZA

    def test_beraat_keyword_returns_ceza(self) -> None:
        assert classify_domain("Beraat kararı temyizde bozulur mu?") == LawDomain.CEZA

    def test_mahkumiyet_keyword_returns_ceza(self) -> None:
        assert classify_domain("Mahkumiyet kararı kesinleşti mi?") == LawDomain.CEZA

    def test_lehe_kanun_keyword_returns_ceza(self) -> None:
        assert classify_domain("Failin lehine olan kanun hangisi?") == LawDomain.CEZA

    def test_idari_para_cezasi_returns_idari_ceza(self) -> None:
        assert classify_domain("Kabahat kapsamında idari para cezası ne kadar?") == LawDomain.IDARI_CEZA

    def test_vergi_ziyai_returns_vergi_ceza(self) -> None:
        assert classify_domain("VUK kapsamında vergi ziyaı cezası hesabı") == LawDomain.VERGI_CEZA

    def test_ihbar_tazminati_returns_diger(self) -> None:
        assert classify_domain("İhbar tazminatı nasıl hesaplanır?") == LawDomain.DIGER

    def test_kira_sozlesmesi_returns_diger(self) -> None:
        assert classify_domain("Kira sözleşmesinde kiracı tahliye edilebilir mi?") == LawDomain.DIGER

    def test_unrelated_query_returns_unknown(self) -> None:
        # A query with no matching keywords from any category
        result = classify_domain("Merhaba, hava nasıl bugün?")
        assert result == LawDomain.UNKNOWN


# ============================================================================
# D — LeheKanunEngine.check() logic
# ============================================================================

class TestLeheKanunEngineCheck:
    """Group D: LeheKanunEngine.check() — decision logic."""

    @pytest.fixture()
    def engine(self) -> LeheKanunEngine:
        return LeheKanunEngine()

    def test_ceza_domain_different_dates_returns_applicable(
        self, engine: LeheKanunEngine
    ) -> None:
        result = engine.check(
            query_text="Sanığın hırsızlık suçuna hangi ceza kanunu uygulanır?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert result.lehe_applicable is True
        assert result.both_versions_needed is True
        assert result.law_domain == LawDomain.CEZA

    def test_same_dates_not_applicable(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Sanığın hırsızlık suçuna hangi ceza kanunu uygulanır?",
            event_date=_SAME,
            decision_date=_SAME,
        )
        assert result.lehe_applicable is False
        assert result.both_versions_needed is False

    def test_diger_domain_not_applicable(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Kira sözleşmesinde kiracı haklarım nelerdir?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert result.lehe_applicable is False
        assert result.law_domain == LawDomain.DIGER

    def test_unknown_domain_not_applicable(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Merhaba dünya",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert result.lehe_applicable is False
        assert result.law_domain == LawDomain.UNKNOWN

    def test_idari_ceza_applicable(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Kabahat kapsamında idari para cezası lehe kanun mu?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert result.lehe_applicable is True
        assert result.law_domain == LawDomain.IDARI_CEZA

    def test_vergi_ceza_applicable(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="VUK vergi ziyaı cezası için hangi sürüm geçerli?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert result.lehe_applicable is True
        assert result.law_domain == LawDomain.VERGI_CEZA

    def test_reason_contains_domain_value(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Hırsızlık suçu için lehe kanun hangisi?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert "CEZA" in result.reason

    def test_reason_contains_dates(self, engine: LeheKanunEngine) -> None:
        result = engine.check(
            query_text="Sanığın suçu için lehe kanun?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert str(_EVENT) in result.reason
        assert str(_KARAR) in result.reason


# ============================================================================
# E — LeheKanunNoticeSchema + RAGQueryRequest.decision_date
# ============================================================================

class TestLeheKanunSchema:
    """Group E: Pydantic schema validation."""

    def test_decision_date_defaults_to_none(self) -> None:
        req = RAGQueryRequest(query="İhbar tazminatı nasıl hesaplanır?")
        assert req.decision_date is None

    def test_decision_date_accepts_valid_date(self) -> None:
        req = RAGQueryRequest(
            query="Sanık için hangi ceza kanunu uygulanır?",
            event_date=_EVENT,
            decision_date=_KARAR,
        )
        assert req.decision_date == _KARAR

    def test_decision_date_in_model_dump(self) -> None:
        req = RAGQueryRequest(
            query="test sorgu",
            decision_date=_KARAR,
        )
        data = req.model_dump()
        assert "decision_date" in data
        assert data["decision_date"] == _KARAR

    def test_lehe_notice_schema_valid(self) -> None:
        notice = LeheKanunNoticeSchema(
            law_domain="CEZA",
            event_date=_EVENT,
            decision_date=_KARAR,
            event_doc_count=5,
            decision_doc_count=4,
            reason="TCK md. 7/2 uygulanır",
        )
        assert notice.law_domain == "CEZA"
        assert "LEHE KANUN" in notice.disclaimer

    def test_lehe_notice_legal_basis_default(self) -> None:
        notice = LeheKanunNoticeSchema(
            law_domain="CEZA",
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        assert "TCK Madde 7/2" in notice.legal_basis

    def test_lehe_notice_serialises_dates(self) -> None:
        notice = LeheKanunNoticeSchema(
            law_domain="IDARI_CEZA",
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        data = notice.model_dump()
        assert data["event_date"] == _EVENT
        assert data["decision_date"] == _KARAR


# ============================================================================
# F — RAGResponse.lehe_kanun_notice field
# ============================================================================

def _minimal_source() -> SourceDocumentSchema:
    return SourceDocumentSchema(
        id="src-1",
        content="içerik",
        final_score=0.8,
        collected_at=datetime(2025, 1, 1, 12, 0),
    )


class TestRAGResponseLeheNotice:
    """Group F: RAGResponse carries lehe_kanun_notice correctly."""

    def test_lehe_kanun_notice_defaults_to_none(self) -> None:
        resp = RAGResponse(
            answer="Test cevap",
            sources=[_minimal_source()],
            query="test",
            model_used="test-model",
            retrieval_count=1,
            latency_ms=100,
        )
        assert resp.lehe_kanun_notice is None

    def test_lehe_kanun_notice_accepts_notice_schema(self) -> None:
        notice = LeheKanunNoticeSchema(
            law_domain="CEZA",
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="TCK md. 7/2",
        )
        resp = RAGResponse(
            answer="Lehe kanun analizi",
            sources=[_minimal_source()],
            query="Hangi kanun uygulanır?",
            model_used="test-model",
            retrieval_count=1,
            latency_ms=200,
            lehe_kanun_notice=notice,
        )
        assert resp.lehe_kanun_notice is not None
        assert resp.lehe_kanun_notice.law_domain == "CEZA"

    def test_lehe_kanun_notice_in_model_dump(self) -> None:
        notice = LeheKanunNoticeSchema(
            law_domain="CEZA",
            event_date=_EVENT,
            decision_date=_KARAR,
            reason="test",
        )
        resp = RAGResponse(
            answer="test",
            sources=[_minimal_source()],
            query="test",
            model_used="m",
            retrieval_count=1,
            latency_ms=10,
            lehe_kanun_notice=notice,
        )
        data = resp.model_dump()
        assert "lehe_kanun_notice" in data
        assert data["lehe_kanun_notice"]["law_domain"] == "CEZA"

    def test_response_without_notice_serialises_none(self) -> None:
        resp = RAGResponse(
            answer="test",
            sources=[_minimal_source()],
            query="test",
            model_used="m",
            retrieval_count=1,
            latency_ms=10,
        )
        data = resp.model_dump()
        assert data["lehe_kanun_notice"] is None
