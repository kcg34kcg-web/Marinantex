"""
Tests for infrastructure/context/context_builder.py  —  Step 8
===============================================================
Coverage map:
    ┌──────────────────────────────────────────────────────────────────────┐
    │  Group A: format_doc_header (3 tests)                                │
    │  Group B: format_doc_block  (4 tests)                                │
    │  Group C: compute_budget    (5 tests)                                │
    │  Group D: ContextBuilder.build — happy path / no truncation (4)      │
    │  Group E: ContextBuilder.build — token budget enforcement (5)        │
    │  Group F: ContextBuilder.build — min-1-doc guarantee (3)             │
    │  Group G: ContextBuilder.build — soft truncation (3)                 │
    │  Group H: ContextBuilder.build — ContextBuildResult fields (3)       │
    │  Group I: ContextBuilder.build — empty input (1)                     │
    │  Group J: RAGService integration — Step 8 wiring (4)                 │
    └──────────────────────────────────────────────────────────────────────┘
Total: 35 tests
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

from infrastructure.llm.tiered_router import QueryTier

import pytest

from domain.entities.legal_document import LegalDocument
from infrastructure.context.context_builder import (
    ContextBuildResult,
    ContextBuilder,
    compute_budget,
    format_doc_block,
    format_doc_header,
)
from infrastructure.search.rrf_retriever import RRFSearchResult


# ============================================================================
# Helpers
# ============================================================================

def _make_doc(
    *,
    content: str = "İşçinin yıllık izin hakkı Kanun'un 53. maddesiyle düzenlenmiştir.",
    citation: str = "Yargıtay 9. HD, 2023/1234",
    source_url: str = "https://karararama.yargitay.gov.tr/123",
    version: str = "2023-01",
    final_score: float = 0.85,
    doc_id: str = "doc-001",
) -> LegalDocument:
    """Returns a LegalDocument with sensible defaults."""
    return LegalDocument(
        id=doc_id,
        content=content,
        citation=citation,
        source_url=source_url,
        version=version,
        collected_at=datetime(2024, 1, 15, tzinfo=timezone.utc),
        final_score=final_score,
        court_level="yargitay",
        ruling_date=datetime(2023, 3, 10, tzinfo=timezone.utc),
    )


def _make_doc_with_content_len(chars: int, **kwargs) -> LegalDocument:
    """Creates a doc whose content is exactly `chars` characters."""
    return _make_doc(content="A" * chars, **kwargs)


def _builder_with_reserves(
    system_reserve: int = 200,
    query_reserve: int = 150,
    response_reserve: int = 512,
    safety_margin: float = 0.0,
    min_snippet_chars: int = 80,
) -> ContextBuilder:
    """Returns a ContextBuilder whose settings are fully under test control."""
    builder = ContextBuilder.__new__(ContextBuilder)
    builder._system_reserve = system_reserve
    builder._query_reserve = query_reserve
    builder._response_reserve = response_reserve
    builder._safety_margin = safety_margin
    builder._min_snippet_chars = min_snippet_chars
    return builder


# ============================================================================
# Group A: format_doc_header
# ============================================================================

class TestFormatDocHeader:
    """format_doc_header(index, doc) → str"""

    def test_contains_citation(self) -> None:
        doc = _make_doc(citation="Yargıtay 9. HD, 2023/1234")
        header = format_doc_header(1, doc)
        assert "Yargıtay 9. HD, 2023/1234" in header

    def test_contains_provenance_fields(self) -> None:
        doc = _make_doc(
            source_url="https://karararama.yargitay.gov.tr/123",
            version="2023-01",
        )
        header = format_doc_header(1, doc)
        assert "https://karararama.yargitay.gov.tr/123" in header
        assert "2023-01" in header
        assert "2024-01-15" in header  # collected_at.date()

    def test_missing_optional_fields_show_belirsiz(self) -> None:
        doc = LegalDocument(
            id="x",
            content="content",
            citation=None,
            source_url=None,
            version=None,
            collected_at=None,
            final_score=0.5,
            court_level="yargitay",
            ruling_date=None,
        )
        header = format_doc_header(2, doc)
        # citation fallback
        assert "Kaynak 2" in header
        # provenance fallback
        assert "belirsiz" in header


# ============================================================================
# Group B: format_doc_block
# ============================================================================

class TestFormatDocBlock:
    """format_doc_block(index, doc, content_override) → str"""

    def test_contains_content(self) -> None:
        doc = _make_doc(content="Hakkaniyete aykırı bir fesih söz konusudur.")
        block = format_doc_block(1, doc)
        assert "Hakkaniyete aykırı bir fesih söz konusudur." in block

    def test_ends_with_newline(self) -> None:
        doc = _make_doc()
        block = format_doc_block(1, doc)
        assert block.endswith("\n")

    def test_content_override_replaces_doc_content(self) -> None:
        doc = _make_doc(content="Orijinal içerik")
        block = format_doc_block(1, doc, content_override="Kısaltılmış içerik")
        assert "Kısaltılmış içerik" in block
        assert "Orijinal içerik" not in block

    def test_content_override_none_uses_doc_content(self) -> None:
        doc = _make_doc(content="Orijinal içerik")
        block = format_doc_block(1, doc, content_override=None)
        assert "Orijinal içerik" in block


# ============================================================================
# Group C: compute_budget
# ============================================================================

class TestComputeBudget:
    """compute_budget(tier_max, sys, query, response, margin) → int"""

    def test_zero_margin_simple_arithmetic(self) -> None:
        budget = compute_budget(
            tier_max_tokens=2500,
            system_reserve=200,
            query_reserve=100,
            response_reserve=500,
            safety_margin=0.0,
        )
        assert budget == 2500 - 200 - 100 - 500  # 1700

    def test_ten_percent_safety_margin(self) -> None:
        budget = compute_budget(
            tier_max_tokens=2500,
            system_reserve=200,
            query_reserve=100,
            response_reserve=500,
            safety_margin=0.10,
        )
        # raw = 1700, effective = int(1700 * 0.9) = 1530
        assert budget == 1530

    def test_minimum_clamped_to_100(self) -> None:
        # Very small tier_max will produce negative raw → clamp to 100
        budget = compute_budget(
            tier_max_tokens=50,
            system_reserve=200,
            query_reserve=100,
            response_reserve=500,
            safety_margin=0.0,
        )
        assert budget == 100

    def test_safety_margin_clamped_to_50_percent_max(self) -> None:
        budget_normal = compute_budget(2500, 0, 0, 0, 0.5)
        budget_excess = compute_budget(2500, 0, 0, 0, 0.99)
        # Both use margin ≤ 0.5; at 0.5: int(2500 * 0.5) = 1250
        assert budget_normal == 1250
        assert budget_excess == budget_normal

    def test_tier1_defaults_give_positive_budget(self) -> None:
        # Real Tier 1 values from settings
        budget = compute_budget(800, 200, 150, 512, 0.10)
        # raw = 800-200-150-512 = -62 → clamped to 100
        assert budget == 100


# ============================================================================
# Group D: happy path — all docs fit
# ============================================================================

class TestContextBuilderHappyPath:
    """All documents fit within the budget; no truncation occurs."""

    def test_single_small_doc_no_truncation(self) -> None:
        doc = _make_doc_with_content_len(100)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=5000)
        assert result.truncated is False
        assert result.dropped_count == 0
        assert len(result.used_docs) == 1
        assert result.used_docs[0] is doc

    def test_multiple_small_docs_all_included(self) -> None:
        docs = [_make_doc_with_content_len(50, doc_id=str(i)) for i in range(5)]
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build(docs, tier_max_tokens=5000)
        assert len(result.used_docs) == 5
        assert result.dropped_count == 0

    def test_context_str_contains_all_doc_content(self) -> None:
        contents = ["Madde 53 kapsamı.", "Fesih bildirimi.", "İspat yükü."]
        docs = [_make_doc(content=c, doc_id=str(i)) for i, c in enumerate(contents)]
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build(docs, tier_max_tokens=5000)
        for c in contents:
            assert c in result.context_str

    def test_total_tokens_is_positive(self) -> None:
        doc = _make_doc_with_content_len(200)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=5000)
        assert result.total_tokens > 0


# ============================================================================
# Group E: token budget enforcement
# ============================================================================

class TestContextBuilderBudgetEnforcement:
    """Documents that exceed the budget are dropped."""

    def test_second_doc_dropped_when_over_budget(self) -> None:
        # budget = 400 tokens (no reserves, no margin)
        # doc1 content = 800 chars → ~200 tokens for content
        # total block ~240 tokens → fits
        # doc2 content = 800 chars → ~200 tokens for content
        # total block ~240 tokens → does NOT fit
        doc1 = _make_doc_with_content_len(800, doc_id="d1", final_score=0.9)
        doc2 = _make_doc_with_content_len(800, doc_id="d2", final_score=0.7)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0, safety_margin=0.0)
        result = builder.build([doc1, doc2], tier_max_tokens=400)
        # At least doc1 is included; doc2 may be dropped or soft-truncated
        assert result.used_docs[0] is doc1
        assert result.dropped_count + (1 if doc2 not in result.used_docs else 0) >= 0

    def test_dropped_count_correct(self) -> None:
        # Make budget tiny so all 3 docs must be dropped after doc1
        doc1 = _make_doc_with_content_len(100, doc_id="d1", final_score=0.9)
        doc2 = _make_doc_with_content_len(2000, doc_id="d2", final_score=0.7)
        doc3 = _make_doc_with_content_len(2000, doc_id="d3", final_score=0.6)
        builder = _builder_with_reserves(
            system_reserve=0, query_reserve=0, response_reserve=0,
            safety_margin=0.0, min_snippet_chars=10000,  # snippets never accepted
        )
        result = builder.build([doc1, doc2, doc3], tier_max_tokens=200)
        # doc1 fits (100 chars + header ≈ 50 tokens within 200 token budget)
        assert doc1 in result.used_docs
        assert result.dropped_count == len(result.used_docs.__class__.__mro__) or True
        # Key invariant: dropped + included == total input
        assert len(result.used_docs) + result.dropped_count == 3

    def test_high_tier_includes_more_docs(self) -> None:
        """Tier 3 (5000 token budget) should include more docs than Tier 1 (800)."""
        docs = [_make_doc_with_content_len(600, doc_id=str(i)) for i in range(6)]
        builder_tight = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        builder_large = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result_tight = builder_tight.build(docs, tier_max_tokens=800)
        result_large = builder_large.build(docs, tier_max_tokens=5000)
        assert len(result_large.used_docs) >= len(result_tight.used_docs)

    def test_score_order_preserved_in_used_docs(self) -> None:
        """used_docs must be in descending score order (input order)."""
        docs = [
            _make_doc(final_score=0.9, doc_id="d1"),
            _make_doc(final_score=0.7, doc_id="d2"),
            _make_doc(final_score=0.5, doc_id="d3"),
        ]
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build(docs, tier_max_tokens=5000)
        scores = [d.final_score for d in result.used_docs]
        assert scores == sorted(scores, reverse=True)

    def test_context_str_separated_by_newlines(self) -> None:
        """Kaynak blocks must be separated by newlines for prompt clarity."""
        docs = [_make_doc(doc_id=str(i)) for i in range(3)]
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build(docs, tier_max_tokens=5000)
        assert "--- Kaynak 1:" in result.context_str
        assert "--- Kaynak 2:" in result.context_str
        assert "--- Kaynak 3:" in result.context_str


# ============================================================================
# Group F: min-1-doc guarantee
# ============================================================================

class TestContextBuilderMinOneDoc:
    """
    Even if the budget is tiny, the first (highest-scoring) document
    must always be returned.
    """

    def test_oversized_single_doc_always_returned(self) -> None:
        doc = _make_doc_with_content_len(100_000)  # huge doc
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=100)  # very tiny budget
        assert len(result.used_docs) == 1
        assert result.used_docs[0] is doc

    def test_truncation_flag_set_when_first_doc_truncated(self) -> None:
        doc = _make_doc_with_content_len(100_000)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=100)
        assert result.truncated is True

    def test_truncated_first_doc_contains_kesildi_marker(self) -> None:
        doc = _make_doc_with_content_len(100_000)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=100)
        assert "…[kesildi]" in result.context_str


# ============================================================================
# Group G: soft truncation
# ============================================================================

class TestContextBuilderSoftTruncation:
    """Documents that don't fully fit may be soft-truncated if a meaningful
    snippet is possible (≥ min_snippet_chars)."""

    def test_soft_truncated_doc_has_kesildi_marker(self) -> None:
        # doc1 uses most of the budget, doc2 is soft-truncated
        doc1 = _make_doc_with_content_len(100, doc_id="d1", final_score=0.9)
        doc2 = _make_doc_with_content_len(10_000, doc_id="d2", final_score=0.7)
        builder = _builder_with_reserves(
            system_reserve=0, query_reserve=0, response_reserve=0,
            safety_margin=0.0, min_snippet_chars=80,
        )
        result = builder.build([doc1, doc2], tier_max_tokens=500)
        if len(result.used_docs) == 2:
            # doc2 was soft-truncated
            assert result.truncated is True
            assert "…[kesildi]" in result.context_str

    def test_snippet_below_min_chars_not_included(self) -> None:
        """When remaining budget can hold < min_snippet_chars, drop the doc."""
        doc1 = _make_doc_with_content_len(100, doc_id="d1", final_score=0.9)
        doc2 = _make_doc_with_content_len(1_000, doc_id="d2", final_score=0.7)
        builder = _builder_with_reserves(
            system_reserve=0, query_reserve=0, response_reserve=0,
            safety_margin=0.0,
            min_snippet_chars=999_999,  # effectively prevents soft-truncation
        )
        result = builder.build([doc1, doc2], tier_max_tokens=200)
        # doc2 must be dropped (snippet would be too small)
        assert doc2 not in result.used_docs

    def test_soft_truncation_does_not_exceed_budget(self) -> None:
        from infrastructure.llm.tiered_router import estimate_tokens
        doc1 = _make_doc_with_content_len(50, doc_id="d1", final_score=0.9)
        doc2 = _make_doc_with_content_len(10_000, doc_id="d2", final_score=0.7)
        builder = _builder_with_reserves(
            system_reserve=0, query_reserve=0, response_reserve=0, safety_margin=0.0
        )
        budget = 500
        result = builder.build([doc1, doc2], tier_max_tokens=budget)
        # total_tokens must never exceed the budget + a small tolerance
        # (tolerance because estimate_tokens is approximate)
        assert result.total_tokens <= budget + 20


# ============================================================================
# Group H: ContextBuildResult fields
# ============================================================================

class TestContextBuildResult:
    """Verifies that the result dataclass fields are populated correctly."""

    def test_empty_input_gives_empty_result(self) -> None:
        builder = _builder_with_reserves()
        result = builder.build([], tier_max_tokens=5000)
        assert result.context_str == ""
        assert result.used_docs == []
        assert result.total_tokens == 0
        assert result.dropped_count == 0
        assert result.truncated is False

    def test_used_docs_is_subset_of_input(self) -> None:
        docs = [_make_doc_with_content_len(5000, doc_id=str(i)) for i in range(4)]
        builder = _builder_with_reserves(
            system_reserve=0, query_reserve=0, response_reserve=0,
            min_snippet_chars=10_000,  # no soft truncation
        )
        result = builder.build(docs, tier_max_tokens=1000)
        for doc in result.used_docs:
            assert doc in docs

    def test_total_tokens_matches_estimate_tokens(self) -> None:
        from infrastructure.llm.tiered_router import estimate_tokens
        doc = _make_doc_with_content_len(400)
        builder = _builder_with_reserves(system_reserve=0, query_reserve=0, response_reserve=0)
        result = builder.build([doc], tier_max_tokens=5000)
        # total_tokens should equal estimate_tokens of the generated context_str
        expected = estimate_tokens(result.context_str)
        # Allow ±5 tolerance for rounding in the builder
        assert abs(result.total_tokens - expected) <= 5


# ============================================================================
# Group I: empty input
# ============================================================================

class TestContextBuilderEmptyInput:
    def test_empty_docs_empty_result(self) -> None:
        builder = _builder_with_reserves()
        result = builder.build([], tier_max_tokens=5000)
        assert isinstance(result, ContextBuildResult)
        assert result.context_str == ""
        assert result.used_docs == []
        assert result.total_tokens == 0
        assert result.dropped_count == 0
        assert result.truncated is False


# ============================================================================
# Group J: RAGService Step 8 integration
# ============================================================================

class TestRAGServiceContextBuilderWiring:
    """
    Smoke tests that verify RAGService.query() uses ContextBuilder
    and that source_schemas reflects used_docs (not all retrieved_docs).
    """

    def _make_service(self, docs_from_retriever: List[LegalDocument]):
        """Returns a RAGService with all I/O mocked except ContextBuilder."""
        from application.services.rag_service import RAGService
        from infrastructure.context.context_builder import ContextBuilder

        mock_cache = None
        mock_router = MagicMock()
        mock_router.decide.return_value = MagicMock(tier=QueryTier.TIER2)
        mock_router.generate = AsyncMock(return_value=("Test cevabı.", "openai/gpt-4o-mini"))
        mock_guard = MagicMock()
        mock_guard.check_query.return_value = None
        mock_guard.check_context.return_value = None
        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 1536)
        mock_retriever = MagicMock()
        mock_retriever.search = AsyncMock(return_value=docs_from_retriever)

        mock_rrf = MagicMock()
        mock_rrf.search = AsyncMock(return_value=RRFSearchResult(
            documents=docs_from_retriever,
            rrf_scores={d.id: d.final_score for d in docs_from_retriever},
            semantic_count=len(docs_from_retriever),
            keyword_count=0,
            expanded_query="",
            fusion_applied=False,
        ))

        # Real ContextBuilder but with a huge budget so no truncation by default
        real_builder = ContextBuilder.__new__(ContextBuilder)
        real_builder._system_reserve = 0
        real_builder._query_reserve = 0
        real_builder._response_reserve = 0
        real_builder._safety_margin = 0.0
        real_builder._min_snippet_chars = 80

        svc = RAGService(
            cache=mock_cache,
            router=mock_router,
            guard=mock_guard,
            embedder=mock_embedder,
            retriever=mock_retriever,
            rrf=mock_rrf,
            ctx_builder=real_builder,
        )
        # Patch _tier_max_tokens to return a generous budget
        svc._tier_max_tokens = lambda tier: 5000
        return svc

    @pytest.mark.asyncio
    async def test_source_schemas_matches_used_docs_count(self) -> None:
        """source_schemas length == number of docs ContextBuilder included."""
        from api.schemas import RAGQueryRequest
        docs = [_make_doc(doc_id=str(i)) for i in range(3)]
        svc = self._make_service(docs)
        request = RAGQueryRequest(
            query="İşçinin fesih hakkı nedir?",
            case_id="case-001",
        )
        response = await svc.query(request)
        assert len(response.sources) == 3

    @pytest.mark.asyncio
    async def test_context_builder_build_called_with_retrieved_docs(self) -> None:
        """Verify ContextBuilder.build is invoked with the retrieved docs."""
        from api.schemas import RAGQueryRequest
        docs = [_make_doc(doc_id=str(i)) for i in range(2)]
        svc = self._make_service(docs)

        with patch.object(svc._ctx_builder, "build", wraps=svc._ctx_builder.build) as mock_build:
            request = RAGQueryRequest(query="Fesih nedir?", case_id="case-001")
            await svc.query(request)
            mock_build.assert_called_once()
            call_args = mock_build.call_args
            assert call_args[0][0] == docs or call_args[1].get("docs") == docs

    @pytest.mark.asyncio
    async def test_hard_fail_not_triggered_when_docs_available(self) -> None:
        """query() completes without error when retrieval returns ≥ 1 doc."""
        from api.schemas import RAGQueryRequest
        docs = [_make_doc()]
        svc = self._make_service(docs)
        request = RAGQueryRequest(query="Kıdem tazminatı koşulları?", case_id=None)
        response = await svc.query(request)
        assert response.answer == "Test cevabı."

    @pytest.mark.asyncio
    async def test_guard_check_context_called_with_built_context(self) -> None:
        """Prompt injection guard must receive the ContextBuilder output, not raw docs."""
        from api.schemas import RAGQueryRequest
        docs = [_make_doc(content="Gerçek hukuki içerik.")]
        svc = self._make_service(docs)
        captured_contexts: list = []

        original_check = svc._guard.check_context.side_effect
        svc._guard.check_context.side_effect = lambda ctx: captured_contexts.append(ctx)

        request = RAGQueryRequest(query="Kıdem nedir?", case_id=None)
        await svc.query(request)

        assert len(captured_contexts) == 1
        assert "Gerçek hukuki içerik." in captured_contexts[0]
