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
from typing import Optional

import pytest
from datetime import datetime, date
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException

from infrastructure.retrieval.retrieval_client import (
    SOURCE_TYPE_ICTIHAT,
    SOURCE_TYPE_MEVZUAT,
    SOURCE_TYPE_PLATFORM_BILGI,
    RetrieverClient,
    _filter_by_bureau,
    infer_source_type,
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
        "chamber": "Yargıtay 9. Hukuk Dairesi",
        "majority_type": "OY_BIRLIGI",
        "dissent_present": False,
        "norm_hierarchy": "KANUN",
        "ruling_date": date(2022, 6, 1),
        "effective_date": date(2020, 1, 1),
        "expiry_date": None,
        "aym_iptal_durumu": None,
        "iptal_yururluk_tarihi": None,
        "aym_karar_no": None,
        "aym_karar_tarihi": None,
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

    def test_binding_boost_added_on_top(self) -> None:
        """Step 3: binding_boost bağlayıcı belgelere ağırlıklı toplamın üstüne eklenir."""
        base = recompute_final_score(
            semantic_score=0.8, keyword_score=0.5,
            recency_score=0.9, hierarchy_score=0.8,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
            binding_boost=0.0,
        )
        boosted = recompute_final_score(
            semantic_score=0.8, keyword_score=0.5,
            recency_score=0.9, hierarchy_score=0.8,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
            binding_boost=0.20,
        )
        assert boosted == pytest.approx(min(1.0, base + 0.20), abs=1e-6)

    def test_binding_boost_default_is_zero(self) -> None:
        """Step 3: binding_boost varsayılanı sıfır — mevcut testleri etkilemez."""
        score_default = recompute_final_score(
            semantic_score=0.6, keyword_score=0.4,
            recency_score=0.7, hierarchy_score=0.5,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
        )
        score_explicit_zero = recompute_final_score(
            semantic_score=0.6, keyword_score=0.4,
            recency_score=0.7, hierarchy_score=0.5,
            w_sem=0.45, w_kw=0.30, w_rec=0.10, w_hier=0.15,
            binding_boost=0.0,
        )
        assert score_default == pytest.approx(score_explicit_zero, abs=1e-6)


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

    def test_step3_authority_fields_mapped(self) -> None:
        """Step 3: chamber, majority_type, dissent_present, norm_hierarchy map edilmeli."""
        row = _make_row()
        doc = row_to_legal_document(row, final_score=0.75)
        assert doc.chamber == "Yargıtay 9. Hukuk Dairesi"
        assert doc.majority_type == "OY_BIRLIGI"
        assert doc.dissent_present is False
        assert doc.norm_hierarchy == "KANUN"

    def test_step4_versioning_fields_mapped(self) -> None:
        """Step 4: AYM iptal ve versioning alanları row_to_legal_document tarafından map edilmeli."""
        row = _make_row(
            aym_iptal_durumu="IPTAL_EDILDI",
            iptal_yururluk_tarihi=date(2025, 6, 1),
            aym_karar_no="2023/45 E., 2024/78 K.",
            aym_karar_tarihi=date(2024, 3, 15),
        )
        doc = row_to_legal_document(row, final_score=0.75)
        assert doc.effective_date == date(2020, 1, 1)          # _make_row default
        assert doc.aym_iptal_durumu == "IPTAL_EDILDI"
        assert doc.iptal_yururluk_tarihi == date(2025, 6, 1)
        assert doc.aym_karar_no == "2023/45 E., 2024/78 K."
        assert doc.aym_karar_tarihi == date(2024, 3, 15)
        assert doc.requires_aym_warning is True


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

    @pytest.mark.asyncio
    async def test_event_date_forwarded_to_rpc(self) -> None:
        """Step 4: search() içindeki event_date _call_search_rpc'ye iletilmeli."""
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        event = date(2020, 6, 15)
        await retriever.search(EMBEDDING_512, "q", None, 5, 0.0, event_date=event)

        call_kwargs = retriever._call_search_rpc.call_args.kwargs
        assert call_kwargs.get("event_date") == event

    @pytest.mark.asyncio
    async def test_legacy_kwargs_query_embedding_and_match_count_supported(self) -> None:
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[_make_row("legacy-doc")])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search(
            query_embedding=EMBEDDING_512,
            query_text="q",
            case_id=None,
            match_count=3,
        )

        assert [doc.id for doc in result] == ["legacy-doc"]
        call_kwargs = retriever._call_search_rpc.call_args.kwargs
        assert call_kwargs["embedding"] == EMBEDDING_512
        assert call_kwargs["max_sources"] == 3

    @pytest.mark.asyncio
    async def test_public_get_must_cite_documents_method(self) -> None:
        retriever = _make_retriever()
        retriever._call_must_cite_rpc = MagicMock(return_value=[_make_row("mc-1")])

        result = await retriever.get_must_cite_documents(
            case_id="case-uuid",
            limit=1,
        )

        assert len(result) == 1
        assert result[0].id == "mc-1"
        retriever._call_must_cite_rpc.assert_called_once_with(
            case_id="case-uuid",
            bureau_id=None,
        )


# ============================================================================
# RetrieverClient.lehe_kanun_search — Step 4/10
# ============================================================================

class TestLehekKanunSearch:
    """Step 4/10: lehe_kanun_search iki ayrı zaman noktasında arama yapar."""

    _EVENT    = date(2020, 6, 1)
    _DECISION = date(2026, 2, 1)

    @pytest.mark.asyncio
    async def test_returns_two_separate_doc_lists(self) -> None:
        """event_date ve decision_date için ayrı (event_docs, decision_docs) tuple döner."""
        retriever = _make_retriever()
        event_row    = _make_row("doc-event",    semantic_score=0.9, keyword_score=0.8,
                                  recency_score=0.9, hierarchy_score=0.8)
        decision_row = _make_row("doc-decision", semantic_score=0.8, keyword_score=0.7,
                                  recency_score=0.8, hierarchy_score=0.7)
        # İlk çağrı → event belgeleri, ikinci çağrı → decision belgeleri
        retriever._call_search_rpc = MagicMock(side_effect=[[event_row], [decision_row]])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        event_docs, decision_docs = await retriever.lehe_kanun_search(
            embedding=EMBEDDING_512,
            query_text="hırsızlık cezası",
            case_id=None,
            max_sources=5,
            min_score=0.0,
            event_date=self._EVENT,
            decision_date=self._DECISION,
        )

        assert len(event_docs) == 1
        assert event_docs[0].id == "doc-event"
        assert len(decision_docs) == 1
        assert decision_docs[0].id == "doc-decision"

    @pytest.mark.asyncio
    async def test_both_dates_forwarded_to_rpc_separately(self) -> None:
        """event_date ve decision_date _call_search_rpc'ye ayrı ayrı iletilmeli."""
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        await retriever.lehe_kanun_search(
            embedding=EMBEDDING_512,
            query_text="hırsızlık cezası",
            case_id=None,
            max_sources=5,
            min_score=0.0,
            event_date=self._EVENT,
            decision_date=self._DECISION,
        )

        assert retriever._call_search_rpc.call_count == 2
        forwarded_dates = [
            c.kwargs.get("event_date")
            for c in retriever._call_search_rpc.call_args_list
        ]
        assert self._EVENT    in forwarded_dates
        assert self._DECISION in forwarded_dates


# ============================================================================
# Gap 5 — Tenant isolation: _filter_by_bureau + client-side guard
# ============================================================================

from typing import Optional

class TestFilterByBureau:
    """Pure unit tests for the _filter_by_bureau() helper."""

    def _doc(self, bureau_id: Optional[str] = None) -> LegalDocument:
        return LegalDocument(
            id="doc-1",
            content="içerik",
            collected_at=datetime(2025, 1, 1),
            final_score=0.8,
            bureau_id=bureau_id,
        )

    def test_cross_bureau_doc_removed(self) -> None:
        """bureau_id='A' isteğinde bureau_id='B' dokümanı elenmeli."""
        docs = [self._doc("B")]
        result = _filter_by_bureau(docs, "A")
        assert result == []

    def test_matching_bureau_doc_kept(self) -> None:
        """Aynı bureau_id'li doküman korunmalı."""
        docs = [self._doc("A")]
        result = _filter_by_bureau(docs, "A")
        assert len(result) == 1

    def test_public_doc_allowed_for_any_bureau(self) -> None:
        """bureau_id=None doküman herkese açık; herhangi bir kiracıya döner."""
        docs = [self._doc(None)]
        result = _filter_by_bureau(docs, "A")
        assert len(result) == 1

    def test_none_bureau_id_no_op(self) -> None:
        """Kiracı kapsamı verilmemişse hiçbir şey filtrelenmez."""
        docs = [self._doc("A"), self._doc("B"), self._doc(None)]
        result = _filter_by_bureau(docs, None)
        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_cross_bureau_doc_filtered_in_search(self) -> None:
        """search() sonrası cross-tenant dokümanlar Python katmanında elenmeli."""
        retriever = _make_retriever()
        # RPC 2 doküman döndürüyor: biri doğru büro, biri yabancı büro
        own_row   = _make_row("own",   bureau_id="bureau-A")
        cross_row = _make_row("cross", bureau_id="bureau-B")
        retriever._call_search_rpc = MagicMock(return_value=[own_row, cross_row])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search(
            EMBEDDING_512, "q", None, 5, 0.0, bureau_id="bureau-A"
        )
        ids = {d.id for d in result}
        assert "own"   in ids
        assert "cross" not in ids

    def test_tenant_warning_logged_when_no_bureau_in_production(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """multi_tenancy_enabled=True + bureau_id=None + production → WARNING yayınlanmalı."""
        import logging
        retriever = _make_retriever()

        mock_supabase = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value.data = []

        with patch("infrastructure.retrieval.retrieval_client.settings") as s, \
             patch("infrastructure.retrieval.retrieval_client.get_supabase_client",
                   return_value=mock_supabase):
            s.multi_tenancy_enabled = True
            s.environment = "production"
            s.tenant_enforce_in_dev = False
            with caplog.at_level(logging.WARNING, logger="babylexit.retrieval"):
                retriever._call_search_rpc(
                    embedding=EMBEDDING_512,
                    query_text="q",
                    case_id=None,
                    max_sources=5,
                    bureau_id=None,
                )
        assert any("TENANT_ISOLATION_BYPASS" in r.message for r in caplog.records)

# ============================================================================
# Step 13 � Belgesiz modda global hukuk korpusu zorunlu
# ============================================================================

class TestStep13GlobalLegalCorpus:
    def test_infer_source_type_mevzuat(self) -> None:
        doc = LegalDocument(
            id="m-1",
            content="Kanun metni",
            norm_hierarchy="KANUN",
        )
        assert infer_source_type(doc) == SOURCE_TYPE_MEVZUAT

    def test_infer_source_type_ictihat(self) -> None:
        doc = LegalDocument(
            id="i-1",
            content="Yargitay karari",
            court_level="YARGITAY_DAIRE",
        )
        assert infer_source_type(doc) == SOURCE_TYPE_ICTIHAT

    def test_infer_source_type_platform_bilgi_fallback(self) -> None:
        doc = LegalDocument(
            id="p-1",
            content="Platform bilgi notu",
        )
        assert infer_source_type(doc) == SOURCE_TYPE_PLATFORM_BILGI

    @pytest.mark.asyncio
    async def test_global_legal_search_filters_private_docs(self) -> None:
        retriever = _make_retriever()
        rows = [
            _make_row(
                "pub-mevzuat",
                bureau_id=None,
                norm_hierarchy="KANUN",
                court_level=None,
            ),
            _make_row(
                "pub-ictihat",
                bureau_id=None,
                norm_hierarchy=None,
                court_level="YARGITAY_DAIRE",
            ),
            _make_row(
                "private-doc",
                bureau_id="bureau-A",
                norm_hierarchy="KANUN",
            ),
        ]
        retriever._call_search_rpc = MagicMock(return_value=rows)
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.global_legal_search(
            embedding=EMBEDDING_512,
            query_text="isci alacagi faizi",
            case_id=None,
            max_sources=10,
            min_score=0.0,
            bureau_id="bureau-A",
        )

        ids = {d.id for d in result}
        assert "pub-mevzuat" in ids
        assert "pub-ictihat" in ids
        assert "private-doc" not in ids

    @pytest.mark.asyncio
    async def test_global_legal_search_ignores_case_scope(self) -> None:
        retriever = _make_retriever()
        retriever._call_search_rpc = MagicMock(return_value=[_make_row("pub-only", bureau_id=None)])
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        await retriever.global_legal_search(
            embedding=EMBEDDING_512,
            query_text="borclar kanunu",
            case_id="case-should-be-ignored",
            max_sources=5,
            min_score=0.0,
        )

        assert retriever._call_must_cite_rpc.call_count == 0
        call_kwargs = retriever._call_search_rpc.call_args.kwargs
        assert call_kwargs["case_id"] is None

class TestSearchRpcSchemaCompatibility:
    def test_call_search_rpc_schema_mismatch_uses_legacy_fallback(self) -> None:
        retriever = _make_retriever()
        mock_supabase = MagicMock()
        mock_supabase.rpc.return_value.execute.side_effect = Exception(
            "{'code': '42703', 'message': 'column d.search_vector does not exist'}"
        )
        retriever._legacy_table_search_fallback = MagicMock(
            return_value=[_make_row("legacy-doc")]
        )

        with patch(
            "infrastructure.retrieval.retrieval_client.get_supabase_client",
            return_value=mock_supabase,
        ):
            rows = retriever._call_search_rpc(
                embedding=EMBEDDING_512,
                query_text="q",
                case_id=None,
                max_sources=5,
            )

        assert len(rows) == 1
        assert rows[0]["id"] == "legacy-doc"
        retriever._legacy_table_search_fallback.assert_called_once()

    def test_call_search_rpc_non_schema_error_raises_503(self) -> None:
        retriever = _make_retriever()
        mock_supabase = MagicMock()
        mock_supabase.rpc.return_value.execute.side_effect = Exception(
            "{'code': 'XX000', 'message': 'unexpected backend error'}"
        )

        with patch(
            "infrastructure.retrieval.retrieval_client.get_supabase_client",
            return_value=mock_supabase,
        ):
            with pytest.raises(HTTPException) as exc_info:
                retriever._call_search_rpc(
                    embedding=EMBEDDING_512,
                    query_text="q",
                    case_id=None,
                    max_sources=5,
                )

        assert exc_info.value.status_code == 503


class TestSearchRrfNormalization:
    @pytest.mark.asyncio
    async def test_search_rrf_normalizes_raw_scores_before_min_score(self) -> None:
        retriever = _make_retriever()
        rows = [
            _make_row(
                "rrf-1",
                bureau_id="bureau-A",
                rrf_score_value=0.01639,
                final_score=0.01639,
            ),
            _make_row(
                "rrf-2",
                bureau_id="bureau-A",
                rrf_score_value=0.01000,
                final_score=0.01000,
            ),
        ]
        retriever._call_rrf_search_rpc = MagicMock(return_value=rows)
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search_rrf(
            embedding=EMBEDDING_512,
            query_text="isci alacagi",
            case_id=None,
            max_sources=8,
            min_score=0.25,
            bureau_id="bureau-A",
        )

        # min_score [0,1] must be applied on normalized RRF (top hit => 1.0)
        assert len(result) == 2
        assert result[0].id == "rrf-1"
        assert result[0].final_score == pytest.approx(1.0, abs=1e-6)
        assert result[1].id == "rrf-2"
        assert 0.0 <= result[1].final_score <= 1.0

    @pytest.mark.asyncio
    async def test_search_rrf_min_score_can_filter_after_normalization(self) -> None:
        retriever = _make_retriever()
        rows = [
            _make_row(
                "rrf-top",
                bureau_id="bureau-A",
                rrf_score_value=0.01639,
                final_score=0.01639,
            ),
            _make_row(
                "rrf-low",
                bureau_id="bureau-A",
                rrf_score_value=0.00400,
                final_score=0.00400,
            ),
        ]
        retriever._call_rrf_search_rpc = MagicMock(return_value=rows)
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search_rrf(
            embedding=EMBEDDING_512,
            query_text="isci alacagi",
            case_id=None,
            max_sources=8,
            min_score=0.50,
            bureau_id="bureau-A",
        )

        assert [doc.id for doc in result] == ["rrf-top"]
        assert result[0].final_score == pytest.approx(1.0, abs=1e-6)


class TestSearchRrfFallbacks:
    @pytest.mark.asyncio
    async def test_search_rrf_empty_uses_legacy_fallback(self) -> None:
        retriever = _make_retriever()
        retriever._call_rrf_search_rpc = MagicMock(return_value=[])
        retriever._legacy_table_search_fallback = MagicMock(
            return_value=[
                _make_row(
                    "legacy-rrf-1",
                    bureau_id="bureau-A",
                    semantic_score=0.9,
                    keyword_score=0.8,
                    recency_score=0.5,
                    hierarchy_score=0.5,
                    final_score=0.9,
                )
            ]
        )
        retriever._call_must_cite_rpc = MagicMock(return_value=[])

        result = await retriever.search_rrf(
            embedding=EMBEDDING_512,
            query_text="is kanunu madde 25",
            case_id=None,
            max_sources=8,
            min_score=0.25,
            bureau_id="bureau-A",
        )

        assert [doc.id for doc in result] == ["legacy-rrf-1"]
        retriever._legacy_table_search_fallback.assert_called_once()


class TestTurkishLexicalFold:
    def test_quick_lexical_score_matches_ascii_and_diacritic_forms(self) -> None:
        from infrastructure.retrieval import retrieval_client as rc

        score = rc._quick_lexical_score(
            "is kanunu hakli fesih",
            "Is Kanunu ve isverenin hakli fesih sebepleri aciklanmistir.",
        )
        assert score > 0.0

        score_tr = rc._quick_lexical_score(
            "i? kanunu hakl? fesih",
            "?? Kanunu ve i?verenin hakl? fesih sebepleri a??klanm??t?r.",
        )
        assert score_tr > 0.0


class TestRowToLegalDocumentDateCoercion:
    def test_timestamps_as_iso_string_are_parsed(self) -> None:
        row = _make_row(
            created_at="2025-02-01T12:34:56+00:00",
            collected_at="2025-02-02T09:10:11Z",
        )
        doc = row_to_legal_document(row, final_score=0.5)

        assert isinstance(doc.created_at, datetime)
        assert isinstance(doc.collected_at, datetime)

    def test_invalid_timestamp_string_becomes_none(self) -> None:
        row = _make_row(
            created_at="not-a-date",
            collected_at="",
        )
        doc = row_to_legal_document(row, final_score=0.5)

        assert doc.created_at is None
        assert doc.collected_at is None
