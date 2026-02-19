"""
Tests — Step 10: RAGService Lehe Kanun Entegrasyon Testleri
============================================================
RAGService.query() pipeline'ını uçtan uca test eder; tüm dış bağımlılıklar
(embedder, retriever, LLM router, context builder) mock'lanır, yalnızca
``lehe_kanun_engine`` gerçek nesne olarak kullanılır.

Gruplar:
    A — Standart yol (lehe kanun yok)             (4 test)
    B — Lehe kanun CEZA yolu                       (5 test)
    C — Lehe kanun IDARI_CEZA yolu                 (2 test)
    D — Aynı tarihler (event == decision)           (2 test)
    E — DIGER alan (tarihlere rağmen lehe yok)      (2 test)
    F — Hard-Fail kapısı (belge yok → HTTP 422)    (2 test)
    G — version_type etiketleme                     (3 test)

Toplam: 20 yeni test  →  331 + 20 = 351 hedef
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from api.schemas import RAGQueryRequest, RAGResponse
from application.services.rag_service import RAGService
from domain.entities.legal_document import LegalDocument
from infrastructure.context.context_builder import ContextBuildResult
from infrastructure.legal.lehe_kanun_engine import lehe_kanun_engine
from infrastructure.llm.tiered_router import QueryTier, TierDecision
from infrastructure.search.rrf_retriever import RRFRetriever, RRFSearchResult

# ─────────────────────────────────────────────────────────────────────────────
# Sabit test değerleri
# ─────────────────────────────────────────────────────────────────────────────

_EVENT      = date(2020, 6, 1)
_DECISION   = date(2026, 2, 1)
_SAME       = date(2023, 1, 1)
_EMBEDDING  = [0.1] * 8   # küçük vektör (test için yeterli)

_CEZA_QUERY      = "Sanığın hırsızlık suçuna hangi ceza kanunu uygulanır?"
_IDARI_QUERY     = "Kabahat kapsamında idari para cezası miktarı ne kadar?"
_DIGER_QUERY     = "Kira sözleşmesinde kiracı haklarım nelerdir?"
_STANDARD_QUERY  = "İş kanunu madde 25 kapsamı nedir?"


# ─────────────────────────────────────────────────────────────────────────────
# Test yardımcıları
# ─────────────────────────────────────────────────────────────────────────────

def _doc(doc_id: str, score: float = 0.85) -> LegalDocument:
    """Minimal geçerli LegalDocument."""
    return LegalDocument(
        id=doc_id,
        content=f"Hukuki içerik — {doc_id}",
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=score,
    )


def _tier_decision() -> TierDecision:
    return TierDecision(
        tier=QueryTier.TIER1,
        model_id="test-model",
        provider="groq",
        reason="Test ortamı — Tier 1",
    )


def _make_service(
    *,
    event_docs: List[LegalDocument] | None = None,
    decision_docs: List[LegalDocument] | None = None,
    search_docs: List[LegalDocument] | None = None,
) -> RAGService:
    """
    Tüm dış bağımlılıkları mock'lanmış RAGService örneği döndürür.

    ``lehe_kanun_engine`` kasıtlı olarak gerçek nesne — alan sınıflandırması
    gerçek anahtar kelimelerle test edilmesi gerekir.

    ContextBuilder.build() gelen belgeleri olduğu gibi kullanır:
    böylece RAGService'in belge setini nasıl oluşturduğunu izleyebiliriz.
    """
    event_docs    = [_doc("ev-1"), _doc("ev-2")]   if event_docs    is None else event_docs
    decision_docs = [_doc("dc-1"), _doc("dc-2")]   if decision_docs is None else decision_docs
    search_docs   = [_doc("std-1"), _doc("std-2")] if search_docs   is None else search_docs

    # Embedder
    mock_embedder        = MagicMock()
    mock_embedder._model = "mock-embedding"
    mock_embedder.embed_query = AsyncMock(return_value=_EMBEDDING)

    # Prompt guard — her iki taramada da geçer
    mock_guard              = MagicMock()
    mock_guard.check_query  = MagicMock(return_value=None)
    mock_guard.check_context = MagicMock(return_value=None)

    # Retriever
    mock_retriever = MagicMock()
    mock_retriever.search = AsyncMock(return_value=search_docs)
    mock_retriever.lehe_kanun_search = AsyncMock(
        return_value=(event_docs, decision_docs)
    )

    # LLM router
    mock_router = MagicMock()
    mock_router.decide   = MagicMock(return_value=_tier_decision())
    mock_router.generate = AsyncMock(return_value=("Hukuki cevap.", "test/model"))

    # Context builder — gelen dokümanların ilk 2'sini kullan
    def _build_fn(docs: List[LegalDocument], max_tokens: int, apply_litm_reorder: bool = False) -> ContextBuildResult:
        used = docs[:2]
        return ContextBuildResult(
            context_str=" | ".join(d.content for d in used),
            used_docs=used,
            total_tokens=len(used) * 25,
            dropped_count=max(0, len(docs) - 2),
            truncated=False,
        )

    mock_ctx       = MagicMock()
    mock_ctx.build = MagicMock(side_effect=_build_fn)

    return RAGService(
        cache=None,           # önbellek devre dışı
        router=mock_router,
        guard=mock_guard,
        embedder=mock_embedder,
        retriever=mock_retriever,
        rrf=MagicMock(
            search=AsyncMock(return_value=RRFSearchResult(
                documents=search_docs,
                rrf_scores={d.id: d.final_score for d in search_docs},
                semantic_count=len(search_docs),
                keyword_count=0,
                expanded_query="",
                fusion_applied=False,
            ))
        ),
        ctx_builder=mock_ctx,
        lehe_engine=lehe_kanun_engine,  # GERÇEK motor
    )


# ─────────────────────────────────────────────────────────────────────────────
# A — Standart yol (lehe kanun tetiklenmiyor)
# ─────────────────────────────────────────────────────────────────────────────

class TestStandardPath:
    """A: event_date veya decision_date eksik → tek versiyon arama."""

    async def test_no_dates_uses_standard_search(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(query=_STANDARD_QUERY)
        resp = await svc.query(req)

        assert isinstance(resp, RAGResponse)
        svc._rrf.search.assert_awaited_once()
        svc._retriever.lehe_kanun_search.assert_not_awaited()

    async def test_only_event_date_no_decision_date_uses_standard(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(query=_CEZA_QUERY, event_date=_EVENT)
        # decision_date eksik → lehe kanun tetiklenmiyor
        resp = await svc.query(req)

        svc._rrf.search.assert_awaited_once()
        svc._retriever.lehe_kanun_search.assert_not_awaited()

    async def test_standard_response_has_no_lehe_notice(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(query=_STANDARD_QUERY)
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is None

    async def test_standard_sources_have_no_version_type(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(query=_STANDARD_QUERY)
        resp = await svc.query(req)

        for src in resp.sources:
            assert src.version_type is None


# ─────────────────────────────────────────────────────────────────────────────
# B — Lehe kanun CEZA yolu
# ─────────────────────────────────────────────────────────────────────────────

class TestLeheCezaPath:
    """B: CEZA sorgusu + event_date + decision_date → iki versiyon arama."""

    async def test_ceza_both_dates_calls_lehe_search(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        await svc.query(req)

        svc._retriever.lehe_kanun_search.assert_awaited_once()
        svc._retriever.search.assert_not_awaited()

    async def test_ceza_response_has_lehe_notice(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is not None

    async def test_ceza_notice_law_domain_is_ceza(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is not None
        assert resp.lehe_kanun_notice.law_domain == "CEZA"

    async def test_ceza_notice_dates_match_request(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        notice = resp.lehe_kanun_notice
        assert notice is not None
        assert notice.event_date == _EVENT
        assert notice.decision_date == _DECISION

    async def test_ceza_notice_doc_counts_are_positive(self) -> None:
        svc = _make_service(
            event_docs=[_doc("ev-1"), _doc("ev-2")],
            decision_docs=[_doc("dc-1")],
        )
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        notice = resp.lehe_kanun_notice
        assert notice is not None
        assert notice.event_doc_count == 2
        assert notice.decision_doc_count == 1


# ─────────────────────────────────────────────────────────────────────────────
# C — Lehe kanun IDARI_CEZA yolu
# ─────────────────────────────────────────────────────────────────────────────

class TestLeheIdariCezaPath:
    """C: IDARI_CEZA sorgusu + her iki tarih → lehe kanun uygulanır."""

    async def test_idari_ceza_calls_lehe_search(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_IDARI_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        await svc.query(req)

        svc._retriever.lehe_kanun_search.assert_awaited_once()

    async def test_idari_ceza_notice_law_domain(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_IDARI_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is not None
        assert resp.lehe_kanun_notice.law_domain == "IDARI_CEZA"


# ─────────────────────────────────────────────────────────────────────────────
# D — Aynı tarihler (karşılaştırılacak farklı sürüm yok)
# ─────────────────────────────────────────────────────────────────────────────

class TestSameDates:
    """D: event_date == decision_date → lehe_applicable=False → standart arama."""

    async def test_same_dates_uses_standard_search(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_SAME,
            decision_date=_SAME,
        )
        await svc.query(req)

        svc._rrf.search.assert_awaited_once()
        svc._retriever.lehe_kanun_search.assert_not_awaited()

    async def test_same_dates_no_lehe_notice(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_SAME,
            decision_date=_SAME,
        )
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is None


# ─────────────────────────────────────────────────────────────────────────────
# E — DIGER alan (ceza hukuku dışı)
# ─────────────────────────────────────────────────────────────────────────────

class TestDigerDomain:
    """E: DIGER alan sorgusu her iki tarihle → lehe kanun uygulanmaz."""

    async def test_diger_domain_uses_standard_search(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_DIGER_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        await svc.query(req)

        svc._rrf.search.assert_awaited_once()
        svc._retriever.lehe_kanun_search.assert_not_awaited()

    async def test_diger_domain_no_lehe_notice(self) -> None:
        svc = _make_service()
        req = RAGQueryRequest(
            query=_DIGER_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        resp = await svc.query(req)

        assert resp.lehe_kanun_notice is None


# ─────────────────────────────────────────────────────────────────────────────
# F — Hard-Fail kapısı
# ─────────────────────────────────────────────────────────────────────────────

class TestHardFail:
    """F: Hiç belge dönmezse HTTP 422 fırlatılmalı, LLM çağrılmaz."""

    async def test_no_docs_standard_raises_422(self) -> None:
        svc = _make_service(search_docs=[])
        # search_docs=[] → standart yol boş döner
        req = RAGQueryRequest(query=_STANDARD_QUERY)

        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)

        assert exc_info.value.status_code == 422

    async def test_no_docs_lehe_path_raises_422(self) -> None:
        # Her iki versiyon da boş dönerse Hard-Fail tetiklenmelidir.
        svc = _make_service(event_docs=[], decision_docs=[])
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )

        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)

        assert exc_info.value.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# G — version_type etiketleme
# ─────────────────────────────────────────────────────────────────────────────

class TestVersionTypeTagging:
    """G: Lehe yolunda event dokümanlar EVENT_DATE, decision dokümanlar DECISION_DATE etiketlenir."""

    async def _run_lehe(
        self,
        event_docs: List[LegalDocument],
        decision_docs: List[LegalDocument],
    ) -> RAGResponse:
        svc = _make_service(event_docs=event_docs, decision_docs=decision_docs)
        req = RAGQueryRequest(
            query=_CEZA_QUERY,
            event_date=_EVENT,
            decision_date=_DECISION,
        )
        return await svc.query(req)

    async def test_event_doc_tagged_event_date(self) -> None:
        ev = [_doc("ev-unique")]
        dc = [_doc("dc-unique")]
        resp = await self._run_lehe(ev, dc)

        ev_sources = [s for s in resp.sources if s.id == "ev-unique"]
        assert len(ev_sources) == 1
        assert ev_sources[0].version_type == "EVENT_DATE"

    async def test_decision_doc_tagged_decision_date(self) -> None:
        ev = [_doc("ev-x")]
        dc = [_doc("dc-y")]
        resp = await self._run_lehe(ev, dc)

        dc_sources = [s for s in resp.sources if s.id == "dc-y"]
        assert len(dc_sources) == 1
        assert dc_sources[0].version_type == "DECISION_DATE"

    async def test_deduplicated_doc_keeps_event_date_tag(self) -> None:
        """Aynı doküman her iki sette varsa: EVENT_DATE kazanır, DECISION_DATE versiyonu düşer."""
        shared = _doc("shared-doc")
        ev = [shared, _doc("ev-extra")]
        # decision setinde aynı id → deduplication ile düşürülmeli
        dc = [shared, _doc("dc-extra")]
        resp = await self._run_lehe(ev, dc)

        # "shared-doc" sadece bir kez ve EVENT_DATE ile görünmeli
        shared_sources = [s for s in resp.sources if s.id == "shared-doc"]
        assert len(shared_sources) == 1
        assert shared_sources[0].version_type == "EVENT_DATE"
