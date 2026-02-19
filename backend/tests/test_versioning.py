"""
Tests — Step 4: Granüler Sürümleme + AYM İptal Yönetimi
=========================================================
Covers:
    A. AymIptalDurumu enum  (3 tests)
    B. is_cancelled property (5 tests)
    C. is_currently_effective property (6 tests)
    D. requires_aym_warning property (4 tests)
    E. aym_warning_text content (5 tests)
    F. AymWarningSchema serialisation (3 tests)
    G. RAGResponse AYM integration (4 tests)
    H. RAGQueryRequest event_date field (2 tests)
    I. SourceDocumentSchema Step 4 fields (3 tests)

Total: 35 tests
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List

import pytest
from pydantic import ValidationError

from domain.entities.legal_document import AymIptalDurumu, LegalDocument
from api.schemas import (
    AymWarningSchema,
    RAGQueryRequest,
    RAGResponse,
    SourceDocumentSchema,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PAST   = date(2024, 1, 1)   # Definitely in the past
_FUTURE = date(2030, 1, 1)   # Definitely in the future


def _doc(**kwargs) -> LegalDocument:
    """Factory for LegalDocument with minimal required fields."""
    defaults = dict(id="doc-1", content="Test içerik")
    defaults.update(kwargs)
    return LegalDocument(**defaults)


def _minimal_source() -> SourceDocumentSchema:
    return SourceDocumentSchema(
        id="src-1",
        content="içerik",
        final_score=0.8,
        collected_at=datetime(2025, 1, 1, 12, 0),
    )


def _minimal_response(
    aym_warnings: List[AymWarningSchema] | None = None,
) -> RAGResponse:
    """Build a minimal valid RAGResponse, optionally with AYM warnings."""
    return RAGResponse(
        answer="Cevap",
        sources=[_minimal_source()],
        query="Soru",
        model_used="test/model",
        retrieval_count=1,
        latency_ms=42,
        aym_warnings=aym_warnings or [],
    )


# ============================================================================
# Group A — AymIptalDurumu enum
# ============================================================================

class TestAymIptalDurumuEnum:
    """A. Enum has exactly the four expected values."""

    def test_has_four_values(self):
        values = {e.value for e in AymIptalDurumu}
        assert values == {
            "YURURLUKTE",
            "IPTAL_EDILDI",
            "IPTAL_EDILDI_ERTELENDI",
            "KISMI_IPTAL",
        }

    def test_is_str_enum(self):
        """AymIptalDurumu members compare equal to their raw string values."""
        assert AymIptalDurumu.IPTAL_EDILDI == "IPTAL_EDILDI"
        assert AymIptalDurumu.KISMI_IPTAL == "KISMI_IPTAL"

    def test_invalid_value_raises(self):
        with pytest.raises(ValueError):
            AymIptalDurumu("GECERSIZ_DURUM")


# ============================================================================
# Group B — is_cancelled property
# ============================================================================

class TestIsCancelled:
    """B. is_cancelled is True only for the three cancellation statuses."""

    def test_iptal_edildi_is_cancelled(self):
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI")
        assert doc.is_cancelled is True

    def test_iptal_edildi_ertelendi_is_cancelled(self):
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI_ERTELENDI")
        assert doc.is_cancelled is True

    def test_kismi_iptal_is_cancelled(self):
        doc = _doc(aym_iptal_durumu="KISMI_IPTAL")
        assert doc.is_cancelled is True

    def test_yururlukte_is_not_cancelled(self):
        doc = _doc(aym_iptal_durumu="YURURLUKTE")
        assert doc.is_cancelled is False

    def test_none_is_not_cancelled(self):
        doc = _doc()  # aym_iptal_durumu=None by default
        assert doc.is_cancelled is False


# ============================================================================
# Group C — is_currently_effective property
# ============================================================================

class TestIsCurrentlyEffective:
    """C. is_currently_effective reflects date + cancellation logic."""

    def test_no_dates_no_cancellation_is_effective(self):
        """Document with no versioning dates and no cancellation → effective."""
        doc = _doc()
        assert doc.is_currently_effective is True

    def test_future_effective_date_not_yet_effective(self):
        """effective_date in the future → provision not yet in force."""
        doc = _doc(effective_date=_FUTURE)
        assert doc.is_currently_effective is False

    def test_past_expiry_date_no_longer_effective(self):
        """expiry_date in the past → provision superseded."""
        doc = _doc(expiry_date=_PAST)
        assert doc.is_currently_effective is False

    def test_iptal_edildi_past_yururluk_not_effective(self):
        """IPTAL_EDILDI with iptal_yururluk_tarihi in the past → not effective."""
        doc = _doc(
            aym_iptal_durumu="IPTAL_EDILDI",
            iptal_yururluk_tarihi=_PAST,
        )
        assert doc.is_currently_effective is False

    def test_iptal_edildi_future_yururluk_still_effective(self):
        """IPTAL_EDILDI with iptal_yururluk_tarihi in the future → erteleme ongoing → still effective."""
        doc = _doc(
            aym_iptal_durumu="IPTAL_EDILDI",
            iptal_yururluk_tarihi=_FUTURE,
        )
        assert doc.is_currently_effective is True

    def test_iptal_edildi_no_yururluk_not_effective(self):
        """IPTAL_EDILDI with no iptal_yururluk_tarihi → immediate cancellation → not effective."""
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI")
        assert doc.is_currently_effective is False

    def test_kismi_iptal_still_partially_effective(self):
        """KISMI_IPTAL → remaining parts still in force → is_currently_effective is True."""
        doc = _doc(aym_iptal_durumu="KISMI_IPTAL")
        assert doc.is_currently_effective is True


# ============================================================================
# Group D — requires_aym_warning property
# ============================================================================

class TestRequiresAymWarning:
    """D. requires_aym_warning is True for all cancellation statuses."""

    def test_none_no_warning_required(self):
        doc = _doc()
        assert doc.requires_aym_warning is False

    def test_yururlukte_no_warning_required(self):
        doc = _doc(aym_iptal_durumu="YURURLUKTE")
        assert doc.requires_aym_warning is False

    def test_iptal_edildi_warning_required(self):
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI")
        assert doc.requires_aym_warning is True

    def test_iptal_edildi_ertelendi_warning_required(self):
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI_ERTELENDI")
        assert doc.requires_aym_warning is True

    def test_kismi_iptal_warning_required(self):
        doc = _doc(aym_iptal_durumu="KISMI_IPTAL")
        assert doc.requires_aym_warning is True


# ============================================================================
# Group E — aym_warning_text content
# ============================================================================

class TestAymWarningText:
    """E. Warning text is Turkish, non-empty, and contains expected key phrases."""

    def test_empty_when_no_cancellation(self):
        doc = _doc()
        assert doc.aym_warning_text == ""

    def test_empty_when_yururlukte(self):
        doc = _doc(aym_iptal_durumu="YURURLUKTE")
        assert doc.aym_warning_text == ""

    def test_iptal_edildi_contains_karar_no(self):
        doc = _doc(
            aym_iptal_durumu="IPTAL_EDILDI",
            aym_karar_no="2023/45 E., 2024/78 K.",
        )
        text = doc.aym_warning_text
        assert "2023/45 E., 2024/78 K." in text
        assert "⚠️" in text

    def test_ertelendi_future_date_mentions_upcoming_date(self):
        """When cancellation is future, warning should mention it will become effective."""
        doc = _doc(
            aym_iptal_durumu="IPTAL_EDILDI_ERTELENDI",
            iptal_yururluk_tarihi=_FUTURE,
            aym_karar_no="2024/100 E., 2025/200 K.",
        )
        text = doc.aym_warning_text
        assert "⚠️" in text
        assert "2030" in text  # Future year _FUTURE = 2030-01-01

    def test_past_cancellation_mentions_expired(self):
        """When cancellation is already in effect, warning should say so."""
        doc = _doc(
            aym_iptal_durumu="IPTAL_EDILDI",
            iptal_yururluk_tarihi=_PAST,
        )
        text = doc.aym_warning_text
        assert "⚠️" in text
        # Should indicate the provision is no longer in force
        assert "yürürlükten" in text.lower() or "tarihsel" in text.lower()

    def test_kismi_iptal_mentions_partial(self):
        """KISMI_IPTAL warning must mention kısmi (partial) cancellation."""
        doc = _doc(aym_iptal_durumu="KISMI_IPTAL")
        text = doc.aym_warning_text
        assert "⚠️" in text
        assert "KISMI" in text.upper() or "kısmen" in text.lower() or "kısm" in text.lower()

    def test_warning_text_without_karar_no_still_generates(self):
        """Even without aym_karar_no, a warning must still be produced."""
        doc = _doc(aym_iptal_durumu="IPTAL_EDILDI")
        text = doc.aym_warning_text
        assert len(text) > 30
        assert "bilinmiyor" in text.lower() or "⚠️" in text


# ============================================================================
# Group F — AymWarningSchema serialisation
# ============================================================================

class TestAymWarningSchema:
    """F. AymWarningSchema correctly serialises domain entity data."""

    def _make_warning(self, **kwargs) -> AymWarningSchema:
        defaults = dict(
            document_id="doc-99",
            aym_iptal_durumu="IPTAL_EDILDI",
            warning_text="⚠️ Test uyarısı",
            is_currently_effective=False,
        )
        defaults.update(kwargs)
        return AymWarningSchema(**defaults)

    def test_schema_serialises_all_fields(self):
        w = self._make_warning(
            citation="AYM 2023/1 E.",
            aym_karar_no="2023/1 E., 2024/2 K.",
            aym_karar_tarihi=date(2024, 6, 1),
            iptal_yururluk_tarihi=date(2025, 1, 1),
        )
        d = w.model_dump()
        assert d["document_id"] == "doc-99"
        assert d["aym_karar_no"] == "2023/1 E., 2024/2 K."
        assert d["aym_karar_tarihi"] == date(2024, 6, 1)
        assert d["is_currently_effective"] is False

    def test_warning_text_non_empty(self):
        w = self._make_warning(warning_text="⚠️ Zorunlu uyarı.")
        assert len(w.warning_text) > 0

    def test_schema_missing_required_field_raises(self):
        """document_id, aym_iptal_durumu, warning_text, is_currently_effective are required."""
        with pytest.raises(ValidationError):
            AymWarningSchema(
                # missing document_id, aym_iptal_durumu, warning_text, is_currently_effective
                citation="test",
            )


# ============================================================================
# Group G — RAGResponse AYM integration
# ============================================================================

class TestRAGResponseAymIntegration:
    """G. RAGResponse correctly carries AYM warnings and has_cancelled_sources."""

    def test_empty_aym_warnings_by_default(self):
        resp = _minimal_response()
        assert resp.aym_warnings == []

    def test_has_cancelled_sources_false_when_no_warnings(self):
        resp = _minimal_response()
        assert resp.has_cancelled_sources is False

    def test_has_cancelled_sources_true_when_warnings_present(self):
        warning = AymWarningSchema(
            document_id="doc-2",
            aym_iptal_durumu="IPTAL_EDILDI",
            warning_text="⚠️ İptal edildi.",
            is_currently_effective=False,
        )
        resp = _minimal_response(aym_warnings=[warning])
        assert resp.has_cancelled_sources is True

    def test_aym_warnings_populated_for_cancelled_source(self):
        warning = AymWarningSchema(
            document_id="doc-3",
            citation="Test mad. 5",
            aym_iptal_durumu="KISMI_IPTAL",
            aym_karar_no="2024/1 E., 2025/2 K.",
            aym_karar_tarihi=date(2025, 3, 1),
            warning_text="⚠️ Kısmi iptal.",
            is_currently_effective=True,
        )
        resp = _minimal_response(aym_warnings=[warning])
        assert len(resp.aym_warnings) == 1
        assert resp.aym_warnings[0].document_id == "doc-3"
        assert resp.aym_warnings[0].aym_karar_no == "2024/1 E., 2025/2 K."


# ============================================================================
# Group H — RAGQueryRequest event_date field
# ============================================================================

class TestRAGQueryRequestEventDate:
    """H. event_date is optional in RAGQueryRequest."""

    def test_event_date_none_by_default(self):
        req = RAGQueryRequest(query="ihbar tazminatı nasıl hesaplanır")
        assert req.event_date is None

    def test_event_date_accepts_valid_date(self):
        req = RAGQueryRequest(
            query="2020 yılında yürürlükteki iş kanunu nedir",
            event_date=date(2020, 6, 15),
        )
        assert req.event_date == date(2020, 6, 15)


# ============================================================================
# Group I — SourceDocumentSchema Step 4 fields
# ============================================================================

class TestSourceDocumentSchemaStep4:
    """I. SourceDocumentSchema exposes all Step 4 versioning fields."""

    def test_step4_fields_default_to_none_or_empty(self):
        src = SourceDocumentSchema(
            id="s1", content="içerik", final_score=0.5,
            collected_at=datetime(2025, 1, 1),
        )
        assert src.effective_date is None
        assert src.expiry_date is None
        assert src.aym_iptal_durumu is None
        assert src.iptal_yururluk_tarihi is None
        assert src.aym_karar_no is None
        assert src.aym_karar_tarihi is None
        assert src.aym_warning == ""

    def test_step4_fields_accept_full_data(self):
        src = SourceDocumentSchema(
            id="s2",
            content="içerik",
            final_score=0.75,
            collected_at=datetime(2025, 1, 1),
            effective_date=date(2018, 7, 1),
            expiry_date=date(2023, 12, 31),
            aym_iptal_durumu="IPTAL_EDILDI",
            iptal_yururluk_tarihi=date(2024, 3, 1),
            aym_karar_no="2023/99 E., 2024/11 K.",
            aym_karar_tarihi=date(2024, 1, 15),
            aym_warning="⚠️ İptal edildi.",
        )
        assert src.effective_date == date(2018, 7, 1)
        assert src.aym_karar_no == "2023/99 E., 2024/11 K."
        assert src.aym_warning.startswith("⚠️")

    def test_aym_warning_default_empty_string(self):
        """Confirm aym_warning defaults to '' not None — safe for string ops."""
        src = SourceDocumentSchema(
            id="s3", content="x", final_score=0.3,
            collected_at=datetime(2025, 1, 1),
        )
        assert isinstance(src.aym_warning, str)
        assert len(src.aym_warning) == 0
