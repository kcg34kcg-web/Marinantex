"""
Tests — Step 15: Context Budget + "Lost in the Middle" Kontrolü
================================================================
Coverage map:
    A — reorder_lost_in_middle() pure function          (6 test)
    B — _extractive_summary() helper                   (4 test)
    C — SummaryResult field validation                 (3 test)
    D — ContextSummarizer.summarize() — single doc     (6 test)
    E — ContextSummarizer.summarize_batch() — batch    (5 test)
    F — ContextBuilder.build() with apply_litm_reorder (6 test)
    G — RAGService Step 15 pipeline integration        (6 test)
    H — Config Step 15 default settings                (3 test)

Toplam: 39 yeni test  →  527 + 39 = 566 hedef
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from domain.entities.legal_document import LegalDocument
from infrastructure.context.context_builder import (
    ContextBuildResult,
    ContextBuilder,
    reorder_lost_in_middle,
)
from infrastructure.context.context_summarizer import (
    ContextSummarizer,
    SummaryResult,
    _extractive_summary,
    context_summarizer,
)
from infrastructure.llm.tiered_router import QueryTier


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı fabrikalar
# ─────────────────────────────────────────────────────────────────────────────

def _doc(doc_id: str, *, final_score: float = 0.80, content: str = "") -> LegalDocument:
    """Test belgesi fabrikası."""
    return LegalDocument(
        id=doc_id,
        content=content or f"İçerik_{doc_id}",
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=final_score,
    )


def _long_doc(doc_id: str, *, final_score: float = 0.80, chars: int = 4000) -> LegalDocument:
    """Uzun içerikli test belgesi (summariser testleri için)."""
    content = f"İş Kanunu md. 17 hükümleri gereğince {doc_id}: " + "A" * chars
    return LegalDocument(
        id=doc_id,
        content=content,
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=final_score,
    )


def _make_rag_service(
    docs: List[LegalDocument],
    tier: QueryTier = QueryTier.TIER4,
    mock_summarizer: Optional[MagicMock] = None,
):
    """RAGService fabrikası — Step 15 entegrasyon testleri için."""
    from application.services.rag_service import RAGService
    from infrastructure.context.context_builder import ContextBuilder
    from infrastructure.context.context_summarizer import ContextSummarizer
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

    mock_router = MagicMock()
    mock_router.decide.return_value = MagicMock(tier=tier)
    mock_router.generate = AsyncMock(return_value=("Cevap.", "openai/gpt-4o"))

    mock_guard = MagicMock()
    mock_guard.check_query.return_value = None
    mock_guard.check_context.return_value = None

    mock_embedder = MagicMock()
    mock_embedder._model = "text-embedding-3-small"
    mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 8)

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

    mock_reranker = MagicMock(spec=LegalReranker)
    mock_reranker.rerank = MagicMock(
        return_value=[
            RerankResult(document=d, score=RerankScore(base_score=d.final_score))
            for d in docs
        ]
    )

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

    mock_ctx_result = MagicMock()
    mock_ctx_result.context_str = "Bağlam metni."
    mock_ctx_result.used_docs = docs
    mock_ctx_result.truncated = False
    mock_ctx_result.dropped_count = 0
    mock_ctx_result.total_tokens = 100
    mock_ctx_result.litm_applied = False

    mock_ctx_builder = MagicMock(spec=ContextBuilder)
    mock_ctx_builder.build.return_value = mock_ctx_result

    if mock_summarizer is None:
        mock_summarizer = MagicMock(spec=ContextSummarizer)
        mock_summarizer.summarize_batch = AsyncMock(
            return_value=[
                SummaryResult(
                    document=d,
                    original_tokens=50,
                    summary_tokens=50,
                    was_summarized=False,
                )
                for d in docs[3:]  # only secondary docs
            ]
        )

    mock_tool_dispatcher = MagicMock()
    mock_tool_dispatcher.dispatch.return_value = MagicMock(
        was_triggered=False, tools_invoked=[], context_block=""
    )

    svc = RAGService(
        router=mock_router,
        guard=mock_guard,
        embedder=mock_embedder,
        rrf=mock_rrf,
        reranker=mock_reranker,
        ctx_builder=mock_ctx_builder,
        graph_expander=mock_graph_expander,
        dispatcher=mock_tool_dispatcher,
        summarizer=mock_summarizer,
    )
    svc._tier_max_tokens = lambda tier_: 5000
    return svc, mock_summarizer, mock_ctx_builder


# ============================================================================
# A — reorder_lost_in_middle()
# ============================================================================


class TestReorderLostInMiddle:
    """A: Lost-in-the-Middle yeniden sıralama algoritması."""

    def test_empty_list_returns_empty(self) -> None:
        """Boş liste → boş liste."""
        assert reorder_lost_in_middle([]) == []

    def test_single_doc_returns_unchanged(self) -> None:
        """Tek belge → aynen döner."""
        doc = _doc("d1")
        result = reorder_lost_in_middle([doc])
        assert result == [doc]

    def test_two_docs_returns_same_order(self) -> None:
        """İki belge → orijinal sıra korunur."""
        docs = [_doc("d1"), _doc("d2")]
        result = reorder_lost_in_middle(docs)
        assert result == docs

    def test_five_docs_highest_at_position_0(self) -> None:
        """Beş belgede en yüksek skorlu belge 1. konumda olmalı."""
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        result = reorder_lost_in_middle(docs)
        assert result[0].id == "d0"  # Highest score at front

    def test_five_docs_second_highest_at_last_position(self) -> None:
        """Beş belgede 2. en yüksek skorlu belge son konumda olmalı."""
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        result = reorder_lost_in_middle(docs)
        assert result[-1].id == "d1"  # Second highest at end

    def test_five_docs_lowest_in_middle(self) -> None:
        """Beş belgede en düşük skorlu belge orta konumda olmalı."""
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        result = reorder_lost_in_middle(docs)
        # Middle position (index 2) should be doc with score 0.6 (d4 = lowest)
        assert result[2].id == "d4"  # Lowest score in middle

    def test_original_list_not_mutated(self) -> None:
        """Orijinal liste değiştirilmemeli."""
        docs = [_doc(f"d{i}") for i in range(5)]
        original_ids = [d.id for d in docs]
        reorder_lost_in_middle(docs)
        assert [d.id for d in docs] == original_ids


# ============================================================================
# B — _extractive_summary()
# ============================================================================


class TestExtractiveSummary:
    """B: Çıkarıcı özetleme yardımcı fonksiyonu."""

    def test_short_content_returned_unchanged(self) -> None:
        """Kısa içerik → değişmeden döner."""
        text = "Kısa metin."
        result = _extractive_summary(text, target_tokens=100)
        assert result == text

    def test_long_content_truncated_to_target(self) -> None:
        """Uzun içerik → hedef uzunluğa kırpılır."""
        text = "A" * 2000
        result = _extractive_summary(text, target_tokens=100)
        assert len(result) <= 100 * 4 + len(" …[özet]")

    def test_truncated_suffix_added(self) -> None:
        """Kırpma yapılırsa '…[özet]' son eki eklenir."""
        text = "A" * 2000
        result = _extractive_summary(text, target_tokens=100)
        assert result.endswith(" …[özet]")

    def test_exact_boundary_no_truncation(self) -> None:
        """İçerik tam hedef uzunluğunda → kırpma yapılmaz."""
        target_tokens = 10
        target_chars = target_tokens * 4
        text = "B" * target_chars
        result = _extractive_summary(text, target_tokens=target_tokens)
        assert result == text
        assert not result.endswith(" …[özet]")


# ============================================================================
# C — SummaryResult fields
# ============================================================================


class TestSummaryResultFields:
    """C: SummaryResult alan doğrulaması."""

    async def test_not_summarized_when_short(self) -> None:
        """Kısa belge → was_summarized=False."""
        summarizer = ContextSummarizer()
        doc = _doc("d1", content="Kısa içerik.")
        result = await summarizer.summarize(doc, target_tokens=500)
        assert result.was_summarized is False

    async def test_summarized_when_long(self) -> None:
        """Uzun belge → was_summarized=True."""
        summarizer = ContextSummarizer()
        doc = _long_doc("d1", chars=2000)
        result = await summarizer.summarize(doc, target_tokens=50)
        assert result.was_summarized is True

    async def test_error_field_none_on_success(self) -> None:
        """Başarılı özetlemede error alanı None olmalı."""
        summarizer = ContextSummarizer()
        doc = _long_doc("d1", chars=2000)
        result = await summarizer.summarize(doc, target_tokens=50)
        assert result.error is None


# ============================================================================
# D — ContextSummarizer.summarize() — tekli belge
# ============================================================================


class TestContextSummarizerSingle:
    """D: ContextSummarizer.summarize() — tekli belge davranışı."""

    async def test_short_doc_not_summarized(self) -> None:
        """Token hedefinden kısa belge → özetlenmez, original döner."""
        summarizer = ContextSummarizer()
        doc = _doc("d1", content="Kısa hukuki içerik.")
        result = await summarizer.summarize(doc, target_tokens=1000)
        assert result.was_summarized is False
        assert result.document is doc  # same object

    async def test_long_doc_extractive_fallback(self) -> None:
        """LLM fn yok → uzun belge çıkarıcı özetle kısaltılır."""
        summarizer = ContextSummarizer()  # no summarize_fn
        doc = _long_doc("d1", chars=3000)
        result = await summarizer.summarize(doc, target_tokens=100)
        assert result.was_summarized is True
        assert result.summary_tokens < result.original_tokens

    async def test_long_doc_llm_fn_used(self) -> None:
        """LLM fn verildiğinde → fn çağrılır ve sonuç kullanılır."""
        expected_summary = "Özetlenmiş hukuki metin."
        fn_called = {"n": 0}

        async def mock_fn(content, query, target_tokens):
            fn_called["n"] += 1
            return expected_summary

        summarizer = ContextSummarizer(summarize_fn=mock_fn)
        doc = _long_doc("d1", chars=3000)
        result = await summarizer.summarize(doc, target_tokens=100)
        assert fn_called["n"] == 1
        assert result.document.content == expected_summary
        assert result.was_summarized is True

    async def test_llm_error_falls_back_to_extractive(self) -> None:
        """LLM fn hata verirse → çıkarıcı özetleme fallback olarak kullanılır."""

        async def failing_fn(content, query, target_tokens):
            raise ValueError("LLM API hatası")

        summarizer = ContextSummarizer(summarize_fn=failing_fn)
        doc = _long_doc("d1", chars=3000)
        result = await summarizer.summarize(doc, target_tokens=100)
        assert result.was_summarized is True
        assert result.error is not None
        assert "LLM API hatası" in result.error

    async def test_summary_tokens_less_than_original(self) -> None:
        """Özetlenen belgede özet token sayısı orijinalden az olmalı."""
        summarizer = ContextSummarizer()
        doc = _long_doc("d1", chars=4000)
        result = await summarizer.summarize(doc, target_tokens=50)
        assert result.summary_tokens < result.original_tokens

    async def test_new_doc_instance_returned(self) -> None:
        """Özetlenmiş belge yeni bir LegalDocument örneği olmalı."""
        summarizer = ContextSummarizer()
        doc = _long_doc("d1", chars=3000)
        result = await summarizer.summarize(doc, target_tokens=50)
        assert result.was_summarized is True
        assert result.document is not doc  # new instance
        assert result.document.id == doc.id  # same id


# ============================================================================
# E — ContextSummarizer.summarize_batch()
# ============================================================================


class TestContextSummarizerBatch:
    """E: ContextSummarizer.summarize_batch() — toplu işlem."""

    async def test_empty_list_returns_empty(self) -> None:
        """Boş liste → boş sonuç."""
        summarizer = ContextSummarizer()
        results = await summarizer.summarize_batch([])
        assert results == []

    async def test_single_doc_batch(self) -> None:
        """Tek belgeli batch → tek sonuç."""
        summarizer = ContextSummarizer()
        doc = _long_doc("d1", chars=3000)
        results = await summarizer.summarize_batch([doc], target_tokens=50)
        assert len(results) == 1

    async def test_batch_order_preserved(self) -> None:
        """Batch sonuçları girişle aynı sırada döner."""
        summarizer = ContextSummarizer()
        docs = [_long_doc(f"d{i}", chars=2000) for i in range(3)]
        results = await summarizer.summarize_batch(docs, target_tokens=50)
        assert len(results) == 3
        for i, result in enumerate(results):
            assert result.document.id == f"d{i}"

    async def test_error_in_one_does_not_fail_others(self) -> None:
        """Bir belgede hata → diğerleri başarıyla tamamlanır."""
        call_count = {"n": 0}

        async def sometimes_failing_fn(content, query, target_tokens):
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise RuntimeError("Geçici LLM hatası")
            return "Özet."

        summarizer = ContextSummarizer(summarize_fn=sometimes_failing_fn)
        docs = [_long_doc(f"d{i}", chars=2000) for i in range(3)]
        results = await summarizer.summarize_batch(docs, target_tokens=50)
        # All 3 should complete (errored one uses fallback)
        assert len(results) == 3
        # The errored one should have error field set
        assert results[1].error is not None

    async def test_all_docs_return_results(self) -> None:
        """Her giriş belgesi için bir sonuç döner."""
        summarizer = ContextSummarizer()
        docs = [_long_doc(f"d{i}", chars=1000) for i in range(5)]
        results = await summarizer.summarize_batch(docs, target_tokens=50)
        assert len(results) == len(docs)


# ============================================================================
# F — ContextBuilder.build() with apply_litm_reorder
# ============================================================================


class TestContextBuilderLitM:
    """F: ContextBuilder.build() Lost-in-the-Middle entegrasyonu."""

    def _builder(self) -> ContextBuilder:
        builder = ContextBuilder.__new__(ContextBuilder)
        builder._system_reserve = 0
        builder._query_reserve = 0
        builder._response_reserve = 0
        builder._safety_margin = 0.0
        builder._min_snippet_chars = 10
        return builder

    def test_litm_false_preserves_original_order(self) -> None:
        """apply_litm_reorder=False → orijinal sıra korunur."""
        builder = self._builder()
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1, content=f"İçerik {i} " + "X" * 50) for i in range(5)]
        result = builder.build(docs, tier_max_tokens=100000, apply_litm_reorder=False)
        ids = [d.id for d in result.used_docs]
        # Order should be same as input
        assert ids[0] == "d0"

    def test_litm_true_applied_for_more_than_two_docs(self) -> None:
        """apply_litm_reorder=True + 5 belge → litm_applied=True."""
        builder = self._builder()
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1, content=f"İçerik {i} " + "X" * 50) for i in range(5)]
        result = builder.build(docs, tier_max_tokens=100000, apply_litm_reorder=True)
        assert result.litm_applied is True

    def test_litm_false_gives_litm_applied_false(self) -> None:
        """apply_litm_reorder=False → litm_applied=False."""
        builder = self._builder()
        docs = [_doc(f"d{i}", content=f"İçerik {i} " + "X" * 50) for i in range(5)]
        result = builder.build(docs, tier_max_tokens=100000, apply_litm_reorder=False)
        assert result.litm_applied is False

    def test_litm_single_doc_not_applied(self) -> None:
        """apply_litm_reorder=True + 1 belge → litm_applied=False (gereksiz)."""
        builder = self._builder()
        docs = [_doc("d1", content="Tek belge içeriği." + "X" * 50)]
        result = builder.build(docs, tier_max_tokens=100000, apply_litm_reorder=True)
        assert result.litm_applied is False

    def test_litm_true_top_doc_at_first_position(self) -> None:
        """LitM sonrası en yüksek skorlu belge context'in başında yer almalı."""
        builder = self._builder()
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1, content=f"İçerik {i} " + "X" * 80) for i in range(5)]
        result = builder.build(docs, tier_max_tokens=100000, apply_litm_reorder=True)
        # First used_doc should be d0 (highest score)
        assert result.used_docs[0].id == "d0"

    def test_empty_docs_returns_litm_applied_false(self) -> None:
        """Boş liste → litm_applied=False."""
        builder = self._builder()
        result = builder.build([], tier_max_tokens=5000, apply_litm_reorder=True)
        assert result.litm_applied is False


# ============================================================================
# G — RAGService Step 15 pipeline entegrasyonu
# ============================================================================


class TestRAGServiceStep15Integration:
    """G: RAGService Step 15 pipeline entegrasyonu."""

    async def test_summarizer_called_for_tier4_with_enough_docs(self) -> None:
        """Tier 4 + belge sayısı > primary_count → summarizer çağrılır."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        # 5 docs, primary_count default=3 → 2 secondary docs
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        svc, mock_sum, _ = _make_rag_service(docs, tier=QueryTier.TIER4)

        req = RAGQueryRequest(query="karmaşık hukuki analiz dilekçesi")

        with patch.object(app_settings, "context_summarization_enabled", True), \
             patch.object(app_settings, "context_summarization_min_tier", 4), \
             patch.object(app_settings, "context_summarization_primary_count", 3), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_sum.summarize_batch.assert_called_once()

    async def test_summarizer_not_called_for_tier1(self) -> None:
        """Tier 1 → summarizer çağrılmaz (tier < min_tier)."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        svc, mock_sum, _ = _make_rag_service(docs, tier=QueryTier.TIER1)

        req = RAGQueryRequest(query="basit soru")

        with patch.object(app_settings, "context_summarization_enabled", True), \
             patch.object(app_settings, "context_summarization_min_tier", 4), \
             patch.object(app_settings, "context_summarization_primary_count", 3), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_sum.summarize_batch.assert_not_called()

    async def test_summarizer_not_called_for_tier3(self) -> None:
        """Tier 3 → summarizer çağrılmaz (tier < min_tier=4)."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        svc, mock_sum, _ = _make_rag_service(docs, tier=QueryTier.TIER3)

        req = RAGQueryRequest(query="karmaşık ama tier3 sorgu")

        with patch.object(app_settings, "context_summarization_enabled", True), \
             patch.object(app_settings, "context_summarization_min_tier", 4), \
             patch.object(app_settings, "context_summarization_primary_count", 3), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_sum.summarize_batch.assert_not_called()

    async def test_summarizer_not_called_when_disabled(self) -> None:
        """context_summarization_enabled=False → summarizer çağrılmaz."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(5)]
        svc, mock_sum, _ = _make_rag_service(docs, tier=QueryTier.TIER4)

        req = RAGQueryRequest(query="karmaşık hukuki analiz")

        with patch.object(app_settings, "context_summarization_enabled", False), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_sum.summarize_batch.assert_not_called()

    async def test_summarizer_not_called_when_too_few_docs(self) -> None:
        """Belge sayısı ≤ primary_count → summarizer çağrılmaz."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        # Only 2 docs, primary_count=3 → no secondary docs
        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(2)]
        svc, mock_sum, _ = _make_rag_service(docs, tier=QueryTier.TIER4)

        req = RAGQueryRequest(query="karmaşık soru fakat az belge")

        with patch.object(app_settings, "context_summarization_enabled", True), \
             patch.object(app_settings, "context_summarization_min_tier", 4), \
             patch.object(app_settings, "context_summarization_primary_count", 3), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        mock_sum.summarize_batch.assert_not_called()

    async def test_litm_reorder_passed_to_ctx_builder(self) -> None:
        """settings.context_litm_reorder_enabled → ctx_builder.build() apply_litm_reorder parametresine iletilir."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc(f"d{i}", final_score=1.0 - i * 0.1) for i in range(3)]
        svc, _, mock_ctx_builder = _make_rag_service(docs, tier=QueryTier.TIER4)

        req = RAGQueryRequest(query="karmaşık hukuki analiz")

        with patch.object(app_settings, "context_litm_reorder_enabled", True), \
             patch.object(app_settings, "context_summarization_enabled", False), \
             patch.object(app_settings, "graphrag_enabled", False):
            await svc.query(req)

        call_kwargs = mock_ctx_builder.build.call_args
        apply_litm = (
            call_kwargs.kwargs.get("apply_litm_reorder")
            if call_kwargs.kwargs
            else call_kwargs.args[2]
        )
        assert apply_litm is True


# ============================================================================
# H — Config Step 15 varsayılan ayarlar
# ============================================================================


class TestStep15ConfigDefaults:
    """H: Step 15 config ayarlarının varsayılan değerleri."""

    def test_litm_reorder_enabled_by_default(self) -> None:
        """context_litm_reorder_enabled varsayılan olarak True."""
        from infrastructure.config import settings
        assert settings.context_litm_reorder_enabled is True

    def test_summarization_enabled_by_default(self) -> None:
        """context_summarization_enabled varsayılan olarak True."""
        from infrastructure.config import settings
        assert settings.context_summarization_enabled is True

    def test_summarization_min_tier_is_4(self) -> None:
        """context_summarization_min_tier varsayılan olarak 4 (Tier 4 only)."""
        from infrastructure.config import settings
        assert settings.context_summarization_min_tier == 4
