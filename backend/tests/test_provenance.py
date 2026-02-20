"""
Tests — Adım 2: Kaynak Envanteri ve Doğruluk Yönetimi
======================================================
Test grupları:
  A. has_verifiable_provenance property  (5 test)
  B. PROVENANCE_WARN tetikleme           (3 test)
  C. Source Registry — kaynak matrisi    (4 test)

Toplam: 12 test
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytest

from domain.entities.legal_document import LegalDocument


# ============================================================================
# A. LegalDocument.has_verifiable_provenance
# ============================================================================

class TestHasVerifiableProvenance:
    """
    A. LegalDocument.has_verifiable_provenance — 5 test.

    Kabul kriteri (Step 2):
        True YALNIZca source_url VE collected_at ikisi birden non-None olduğunda.
    """

    def test_both_present_returns_true(self):
        """A.1 — source_url + collected_at ikisi de set: True döner."""
        doc = LegalDocument(
            id="doc-a01",
            content="test içerik",
            source_url="https://www.mevzuat.gov.tr/kanun/4857",
            collected_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        assert doc.has_verifiable_provenance is True

    def test_only_source_url_returns_false(self):
        """A.2 — collected_at None iken False döner (kaynak tarihi bilinmiyor)."""
        doc = LegalDocument(
            id="doc-a02",
            content="test içerik",
            source_url="https://karararama.yargitay.gov.tr/karar/12345",
            collected_at=None,
        )
        assert doc.has_verifiable_provenance is False

    def test_only_collected_at_returns_false(self):
        """A.3 — source_url None iken False döner (kaynak URL'i bilinmiyor)."""
        doc = LegalDocument(
            id="doc-a03",
            content="test içerik",
            source_url=None,
            collected_at=datetime(2025, 6, 15, tzinfo=timezone.utc),
        )
        assert doc.has_verifiable_provenance is False

    def test_both_none_returns_false(self):
        """A.4 — Her iki alan da None: False döner."""
        doc = LegalDocument(
            id="doc-a04",
            content="test içerik",
            source_url=None,
            collected_at=None,
        )
        assert doc.has_verifiable_provenance is False

    def test_empty_string_source_url_is_not_none(self):
        """A.5 — Boş string source_url, None değildir; collected_at varsa True döner."""
        doc = LegalDocument(
            id="doc-a05",
            content="test içerik",
            source_url="",   # Empty string — not None, so provenance logic passes
            collected_at=datetime(2025, 9, 1, tzinfo=timezone.utc),
        )
        # has_verifiable_provenance checks `is not None`, not truthiness
        assert doc.has_verifiable_provenance is True


# ============================================================================
# B. RAGResponse PROVENANCE_WARN
# ============================================================================

class TestProvenanceWarnTrigger:
    """
    B. PROVENANCE_WARN log kaydı — 3 test.

    RAGResponse model_validator'ı, collected_at=None olan kaynakları
    'PROVENANCE_WARN' seviyesinde logger.warning() ile kaydeder.
    """

    def _make_source(self, doc_id: str, collected_at=None):
        """Minimum geçerli SourceDocumentSchema örneği oluşturur."""
        from api.schemas import SourceDocumentSchema
        return SourceDocumentSchema(
            id=doc_id,
            content="Deneme içerik metni.",
            source_url="https://www.mevzuat.gov.tr" if collected_at else None,
            collected_at=collected_at,
            final_score=0.75,
        )

    def _make_response(self, sources):
        """Minimum geçerli RAGResponse oluşturur."""
        from api.schemas import RAGResponse
        return RAGResponse(
            answer="Test yanıtı.",
            sources=sources,
            query="test sorgusu",
            model_used="gpt-4o-mini",
            retrieval_count=len(sources),
            latency_ms=100,
        )

    def test_missing_collected_at_triggers_provenance_warn(self, caplog):
        """B.1 — collected_at=None olan kaynak PROVENANCE_WARN log'unu tetikler."""
        src = self._make_source("doc-b01", collected_at=None)
        with caplog.at_level(logging.WARNING, logger="babylexit.api.schemas"):
            self._make_response([src])
        assert any("PROVENANCE_WARN" in r.message for r in caplog.records)

    def test_all_sources_have_collected_at_no_warn(self, caplog):
        """B.2 — Tüm kaynaklarda collected_at mevcutsa PROVENANCE_WARN yok."""
        now = datetime.now(timezone.utc)
        src = self._make_source("doc-b02", collected_at=now)
        with caplog.at_level(logging.WARNING, logger="babylexit.api.schemas"):
            self._make_response([src])
        assert not any("PROVENANCE_WARN" in r.message for r in caplog.records)

    def test_partial_missing_collected_at_warn_includes_count(self, caplog):
        """B.3 — 2/3 kaynakta collected_at eksik; log mesajı sayımı içerir."""
        now = datetime.now(timezone.utc)
        sources = [
            self._make_source("doc-b03a", collected_at=now),
            self._make_source("doc-b03b", collected_at=None),
            self._make_source("doc-b03c", collected_at=None),
        ]
        with caplog.at_level(logging.WARNING, logger="babylexit.api.schemas"):
            self._make_response(sources)
        warn_msgs = [r.message for r in caplog.records if "PROVENANCE_WARN" in r.message]
        assert len(warn_msgs) == 1
        # Log mesajı "2/3" formatında sayım içermeli
        assert "2" in warn_msgs[0]


# ============================================================================
# C. Source Registry — Kaynak Matrisi
# ============================================================================

class TestSourceRegistry:
    """
    C. infrastructure.legal.source_registry — 4 test.

    KAYNAK_MATRISI'nin doğruluğunu, lisans notlarını ve yardımcı
    fonksiyonlarını doğrular.
    """

    def test_kaynak_matrisi_covers_required_sources(self):
        """C.1 — KAYNAK_MATRISI temel mevzuat ve içtihat kaynaklarını içerir."""
        from infrastructure.legal.source_registry import KAYNAK_MATRISI
        required = {
            "resmi_gazete",
            "mevzuat_gov_tr",
            "yargitay",
            "danistay",
            "anayasa_mahkemesi",
        }
        assert required.issubset(set(KAYNAK_MATRISI.keys()))

    def test_official_sources_are_public_domain(self):
        """C.2 — Resmi MEVZUAT/İÇTİHAT kaynakları kamu malı lisansına sahip.

        Not: İKİNCİL kaynaklar (UYAP gibi kısıtlı sistemler) bu kuralın dışındadır.
        """
        from infrastructure.legal.source_registry import KAYNAK_MATRISI
        public_official = [
            e for e in KAYNAK_MATRISI.values()
            if e.is_official and e.doc_type in ("MEVZUAT", "ICTIHAT")
        ]
        assert len(public_official) > 0
        for entry in public_official:
            assert "Kamu Malı" in entry.license, (
                f"{entry.source_id} için kamu malı lisansı bekleniyor, "
                f"bulundu: {entry.license!r}"
            )

    def test_binding_sources_have_correct_authority_levels(self):
        """C.3 — get_binding_sources() yalnızca bağlayıcı otorite düzeylerini döndürür."""
        from infrastructure.legal.source_registry import get_binding_sources
        _BINDING = {"AYM", "YARGITAY_IBK", "YARGITAY_HGK", "YARGITAY_CGK", "DANISTAY_IDDK"}
        binding = get_binding_sources()
        assert len(binding) >= 4   # AYM + IBK + HGK + CGK en az 4 kayıt
        for entry in binding:
            assert entry.authority_level in _BINDING, (
                f"{entry.source_id}: authority_level={entry.authority_level!r} "
                f"bağlayıcı değil"
            )

    def test_infer_source_id_from_url(self):
        """C.4 — infer_source_id() URL'den doğru kaynak ID'sini çıkarır."""
        from infrastructure.legal.source_registry import infer_source_id
        cases = [
            ("https://www.resmigazete.gov.tr/eskiler/2024/01/20240101.htm", "resmi_gazete"),
            ("https://karararama.yargitay.gov.tr/karar/12345",              "yargitay"),
            ("https://karararama.danistay.gov.tr/karar/67890",              "danistay"),
            ("https://www.anayasa.gov.tr/tr/kararlar-bilgi-bankasi/12345",  "anayasa_mahkemesi"),
            ("https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=4857",          "mevzuat_gov_tr"),
            ("https://www.bilinmeyen-site.com/karar/999",                  None),
        ]
        for url, expected in cases:
            result = infer_source_id(url)
            assert result == expected, f"URL={url!r}: beklenen={expected!r}, sonuç={result!r}"
