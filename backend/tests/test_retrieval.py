"""
Tests for Step 7 — Retrieval Client
=====================================
All tests are pure (no Supabase connection required):
  - Pure helper functions tested directly (no mocking needed)
  - RetrieverClient tested via mocked _call_search_rpc / _call_must_cite_rpc

Coverage:
    - normalise_keyword_score: cap, below cap, zero cap guard
    - recompute_final_score: standard weights, zero weights, weight normalisation,
                              BM25 over-cap, result clamped [0,1]
    - row_to_legal_document: all fields mapped correctly
    - merge_must_cites: boost applied, dedup from base, sort preserved,
                        empty must-cites, must-cite below threshold injected
    - RetrieverClient.search: happy path, min_score filter, empty result,
                               must-cite injection, RPC failure (503)
"""

from __future__ import annotations

import pytest
from datetime import datetime, date
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException

from infrastructure.retrieval.retrieval_client import (
    RetrieverClient,
    merge_must_cites,
    normalise_keyword_score,
    recompute_final_score,
    row_to_legal_document,
)
from domain.entities.legal_document import LegalDocument


# ============================================================================
# Fixtures / Helpers
# ============================================================================

def _make_doc(
    doc_id: str = "doc-1",
    final_score: float = 0.8,
    semantic_score: float = 0.8,
    keyword_score: float = 0.5,
    recency_score: float = 0.9,
    hierarchy_score: float = 0.8,
) -> LegalDocument:
    return LegalDocument(
        id=doc_id,
        case_id="case-1",
        content="Yargıtay kararı içeriği",
        file_path="docs/doc.pdf",
        created_at=datetime(2024, 1, 1),
        final_score=final_score,
        semantic_score=semantic_score,
        keyword_score=keyword_score,
        recency_score=recency_score,
        hierarchy_score=hierarchy_score,
    )


def _make_row(
    doc_id: str = "doc-1",
    semantic_score: float = 0.8,
    keyword_score: float = 0.5,
    recency_score: float = 0.9,
    hierarchy_score: float = 0.8,
    final_score: float = 0.72,
    **kwargs,
) -> dict:
    return {
        "id": doc_id,
        "case_id": "case-1",
        "content": "Yargıtay kararı içeriği",
        "file_path": "docs/doc.pdf",
        "citation": "Yargıtay 9 HD, E.2022/1",
        "court_level": "YARGITAY_DAIRE",
        "ruling_date": date(2022, 6, 1),
        "source_url": "https://example.com/doc",
        "version": "2022",
        "collected_at": datetime(2023, 1, 1),
        "semantic_score": semantic_score,
        "keyword_score": keyword_score,
        "recency_score": recency_score,
        "hierarchy_score": hierarchy_score,
        "final_score": final_score,
        **kwargs,
    }


def _make_retriever(
    w_sem: float = 0.45,
    w_kw: float = 0.30,
    w_rec: float = 0.10,
    w_hier: float = 0.15,
    kw_cap: float = 1.0,
    must_cite_boost: float = 0.05,
) -> RetrieverClient:
    with patch("infrastructure.retrieval.retrieval_client.settings") as s:
        s.retrieval_semantic_weight = w_sem
        s.retrieval_keyword_weight = w_kw
        s.retrieval_recency_weight = w_rec
        s.retrieval_hierarchy_weight = w_hier
        s.retrieval_keyword_score_cap = kw_cap
        s.retrieval_must_cite_boost = must_cite_boost
        return RetrieverClient()


EMBEDDING_512 = [0.1] * 1536


# ============================================================================
# normalise_keyword_score
# ============================================================================

class TestNormaliseKeywordScore:
    def test_value_below_cap_normalised(self) -> None:
        # 0.5 / 1.0 = 0.5
        assert normalise_keyword_score(0.5, cap=1.0) == pytest.approx(0.5)

    def test_value_at_cap_returns_one(self) -> None:
        assert normalise_keyword_score(1.0, cap=1.0) == pytest.approx(1.0)

    def test_value_above_cap_clamped_to_one(self) -> None:
        # BM25 returned 2.5, cap=1.0 → clamped to 1.0 / 1.0 = 1.0
        assert normalise_keyword_score(2.5, cap=1.0) == pytest.approx(1.0)

    def test_custom_cap(self) -> None:
        # score=0.5, cap=2.0 → 0.5/2.0 = 0.25
        assert normalise_keyword_score(0.5, cap=2.0) == pytest.approx(0.25)

    def test_zero_cap_returns_zero(self) -> None:
        # Guard against division by zero
        assert normalise_keyword_score(1.0, cap=0.0) == pytest.approx(0.0)

    def test_zero_score_returns_zero(self) -> None:
        assert normalise_keyword_score(0.0, cap=1.0) == pytest.approx(0.0)


# ============================================================================
# recompute_final_score
# ============================================================================

class TestRecomputeFinalScore:
    def test_default_weights_match_sql(self) -> None:
        # SQL formula: 0.45*sem + 0.30*kw + 0.10*rec + 0.15*hier
        score = recompute_final_score(
            semantic_score=0.8,
            keyword_score=0.5,
            recency_score=0.9,
            hierarchy_score=0.8,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
        )
        expected = 0.45 * 0.8 + 0.30 * 0.5 + 0.10 * 0.9 + 0.15 * 0.8
        assert score == pytest.approx(expected, abs=1e-6)

    def test_weights_are_normalised_to_sum_to_one(self) -> None:
        # Weights 9/6/2/3 = sum 20 → normalised 0.45/0.30/0.10/0.15
        score_raw = recompute_final_score(
            semantic_score=0.8, keyword_score=0.5,
            recency_score=0.9, hierarchy_score=0.8,
            w_sem=9, w_kw=6, w_rec=2, w_hier=3,
        )
        score_norm = recompute_final_score(
            semantic_score=0.8, keyword_score=0.5,
            recency_score=0.9, hierarchy_score=0.8,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
        )
        assert score_raw == pytest.approx(score_norm, abs=1e-6)

    def test_zero_weights_returns_zero(self) -> None:
        assert recompute_final_score(1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0) == 0.0

    def test_bm25_above_cap_is_normalised(self) -> None:
        # keyword_score=3.0 with cap=1.0 → clamped to 1.0 → normalised 1.0
        with_high = recompute_final_score(
            semantic_score=0.5, keyword_score=3.0,
            recency_score=0.5, hierarchy_score=0.5,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
            keyword_cap=1.0,
        )
        with_capped = recompute_final_score(
            semantic_score=0.5, keyword_score=1.0,  # already at cap
            recency_score=0.5, hierarchy_score=0.5,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
            keyword_cap=1.0,
        )
        assert with_high == pytest.approx(with_capped, abs=1e-6)

    def test_result_clamped_to_zero_minimum(self) -> None:
        # All zeros → 0.0
        score = recompute_final_score(0.0, 0.0, 0.0, 0.0, 0.45, 0.30, 0.10, 0.15)
        assert score == pytest.approx(0.0)

    def test_result_clamped_to_one_maximum(self) -> None:
        # All ones → 1.0
        score = recompute_final_score(1.0, 1.0, 1.0, 1.0, 0.45, 0.30, 0.10, 0.15)
        assert score == pytest.approx(1.0)


# ============================================================================
# row_to_legal_document
# ============================================================================

class TestRowToLegalDocument:
    def test_all_fields_mapped(self) -> None:
        row = _make_row()
        doc = row_to_legal_document(row, final_score=0.75)
        assert doc.id == "doc-1"
        assert doc.case_id == "case-1"
        assert doc.content == "Yargıtay kararı içeriği"
        assert doc.source_url == "https://example.com/doc"
        assert doc.version == "2022"
        assert doc.collected_at == datetime(2023, 1, 1)
        assert doc.court_level == "YARGITAY_DAIRE"
        assert doc.citation == "Yargıtay 9 HD, E.2022/1"
        assert doc.semantic_score == pytest.approx(0.8)
        assert doc.keyword_score == pytest.approx(0.5)
        assert doc.final_score == pytest.approx(0.75)  # uses passed value, not row

    def test_missing_optional_fields_default_to_none(self) -> None:
        row = {
            "id": "x", "case_id": "c", "content": "txt",
            "semantic_score": 0.5, "keyword_score": 0.0,
            "recency_score": 0.5, "hierarchy_score": 0.4,
            "final_score": 0.5,
        }
        doc = row_to_legal_document(row, final_score=0.5)
        assert doc.source_url is None
        assert doc.version is None
        assert doc.collected_at is None
        assert doc.citation is None

    def test_final_score_uses_passed_value_not_row(self) -> None:
        row = _make_row(final_score=0.99)
        doc = row_to_legal_document(row, final_score=0.42)
        assert doc.final_score == pytest.approx(0.42)


# ============================================================================
# merge_must_cites
# ============================================================================

class TestMergeMustCites:
    def test_must_cite_score_boosted(self) -> None:
        base = [_make_doc("doc-1", final_score=0.8)]
        must = [_make_doc("doc-mc", final_score=0.5)]
        merged = merge_must_cites(base, must, boost=0.05)
        mc = next(d for d in merged if d.id == "doc-mc")
        assert mc.final_score == pytest.approx(0.55)

    def test_must_cite_at_top_after_boost(self) -> None:
        base = [_make_doc("doc-1", final_score=0.8)]
        must = [_make_doc("doc-mc", final_score=0.79)]
        merged = merge_must_cites(base, must, boost=0.05)  # 0.79+0.05=0.84 > 0.8
        assert merged[0].id == "doc-mc"

    def test_must_cite_deduplicates_from_base(self) -> None:
        doc_shared = _make_doc("shared", final_score=0.6)
        base = [_make_doc("doc-1", 0.9), doc_shared]
        must = [_make_doc("shared", final_score=0.6)]
        merged = merge_must_cites(base, must, boost=0.05)
        ids = [d.id for d in merged]
        assert ids.count("shared") == 1

    def test_empty_must_cites_returns_base_unchanged(self) -> None:
        base = [_make_doc("doc-1", 0.9), _make_doc("doc-2", 0.7)]
        merged = merge_must_cites(base, [], boost=0.05)
        assert [d.id for d in merged] == ["doc-1", "doc-2"]

    def test_must_cite_boost_capped_at_one(self) -> None:
        must = [_make_doc("mc", final_score=0.99)]
        merged = merge_must_cites([], must, boost=0.05)
        assert merged[0].final_score == pytest.approx(1.0)

    def test_sorted_descending_after_merge(self) -> None:
        base = [_make_doc("b1", 0.7), _make_doc("b2", 0.5)]
        must = [_make_doc("mc", 0.4)]  # 0.4+0.05=0.45 < 0.5 → third
        merged = merge_must_cites(base, must, boost=0.05)
        scores = [d.final_score for d in merged]
        assert scores == sorted(scores, reverse=True)

    def test_below_threshold_must_cite_still_injected(self) -> None:
        # Must-cite with very low score — should still appear in merged list
        must = [_make_doc("mc", final_score=0.10)]
        merged = merge_must_cites([], must, boost=0.05)
        assert len(merged) == 1
        assert merged[0].id == "mc"


# ============================================================================
# RetrieverClient.search — happy path
# ============================================================================

class TestRetrieverClientSearch:
    @pytest.mark.asyncio
    async def test_returns_docs_above_min_score(self) -> None:
        retriever = _make_retriever()
        rows = [
            _make_row("doc-1", semantic_score=0.9, keyword_score=0.8, recency_score=0.9, hierarchy_score=0.8),
            _make_row("doc-2", semantic_score=0.1, keyword_score=0.0, recency_score=0.1, hierarchy_score=0.4),
        ]
        retriever._call_search_rpc = MagicMock(return_value=rows)
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search(
            embedding=EMBEDDING_512,
            query_text="tazminat",
            case_id=None,
            max_sources=5,
            min_score=0.5,
        )
        # Only doc-1 should pass the min_score filter
        assert len(result) == 1
        assert result[0].id == "doc-1"

    @pytest.mark.asyncio
    async def test_empty_rpc_returns_empty_list(self) -> None:
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search(EMBEDDING_512, "q", None, 5, 0.25)
        assert result == []

    @pytest.mark.asyncio
    async def test_results_sorted_descending(self) -> None:
        retriever = _make_retriever()
        rows = [
            _make_row("doc-low",  semantic_score=0.3, keyword_score=0.3, recency_score=0.3, hierarchy_score=0.4),
            _make_row("doc-high", semantic_score=0.9, keyword_score=0.8, recency_score=0.9, hierarchy_score=0.8),
        ]
        retriever._call_search_rpc = MagicMock(return_value=rows)
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search(EMBEDDING_512, "q", None, 5, 0.0)
        assert result[0].id == "doc-high"
        assert result[1].id == "doc-low"

    @pytest.mark.asyncio
    async def test_must_cite_injected_when_case_scoped(self) -> None:
        retriever = _make_retriever()
        base_row = _make_row("doc-base", semantic_score=0.7, keyword_score=0.5, recency_score=0.7, hierarchy_score=0.7)
        mc_row = _make_row("doc-mc", semantic_score=0.3, keyword_score=0.1, recency_score=0.9, hierarchy_score=1.0)
        retriever._call_search_rpc = MagicMock(return_value=[base_row])
        retriever._call_must_cite_rpc = MagicMock(return_value=[mc_row])

        result = await retriever.search(EMBEDDING_512, "q", case_id="case-uuid", max_sources=5, min_score=0.0)
        ids = [d.id for d in result]
        assert "doc-mc" in ids

    @pytest.mark.asyncio
    async def test_must_cite_not_called_when_no_case_id(self) -> None:
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[_make_row()])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        await retriever.search(EMBEDDING_512, "q", case_id=None, max_sources=5, min_score=0.0)
        retriever._call_must_cite_rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_rpc_failure_raises_http_503(self) -> None:
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(
            side_effect=HTTPException(status_code=503, detail={"error": "RETRIEVAL_FAILED"})
        )

        with pytest.raises(HTTPException) as exc_info:
            await retriever.search(EMBEDDING_512, "q", None, 5, 0.25)
        assert exc_info.value.status_code == 503
