"""
Tests — Step 11: Hibrit Arama ve Asenkron Güncelleme Mimarisi
=============================================================
Gruplar:
    A — RRF matematik fonksiyonları                         (6 test)
    B — reciprocal_rank_fusion() füzyon mantığı             (8 test)
    C — SynonymStore: expand, expand_query, has_synonyms    (9 test)
    D — build_expanded_query()                              (4 test)
    E — RRFRetriever: tam yol, fallback, Gap1/2 düzeltme    (9 test)
    F — IndexTaskResult ve IndexTaskStatus                  (4 test)
    G — _do_index_document / retry wrapper (Gap 3)          (7 test)

Toplam: 47 test
"""

from __future__ import annotations

from datetime import datetime
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from domain.entities.legal_document import LegalDocument
from infrastructure.search.rrf_retriever import (
    RRFRetriever,
    RRFSearchResult,
    build_expanded_query,
    reciprocal_rank_fusion,
    rrf_score,
)
from infrastructure.search.synonym_store import (
    MAX_EXPANSIONS,
    SynonymStore,
    synonym_store,
    _n,
)
from infrastructure.async_indexing.indexing_tasks import (
    IndexTaskResult,
    IndexTaskStatus,
    _do_delete_document,
    _do_index_document,
    _do_index_document_with_retry,
)

# ─────────────────────────────────────────────────────────────────────────────
# Yardımcılar
# ─────────────────────────────────────────────────────────────────────────────

def _doc(doc_id: str, score: float = 0.80) -> LegalDocument:
    return LegalDocument(
        id=doc_id,
        content=f"içerik — {doc_id}",
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=score,
    )


def _make_rrf_retriever(
    semantic_docs: List[LegalDocument] | None = None,
    keyword_docs:  List[LegalDocument] | None = None,
) -> RRFRetriever:
    """Mock RetrieverClient ile RRFRetriever oluşturur."""
    semantic_docs = semantic_docs or [_doc("sem-1", 0.9), _doc("sem-2", 0.8)]
    keyword_docs  = keyword_docs  or [_doc("kw-1",  0.7), _doc("kw-2",  0.6)]

    mock_retriever = MagicMock()
    # İlk çağrı semantik, ikinci çağrı keyword döndürür
    mock_retriever.search = AsyncMock(side_effect=[semantic_docs, keyword_docs])
    mock_retriever.global_legal_search = AsyncMock(side_effect=[semantic_docs, keyword_docs])

    mock_store = MagicMock()
    mock_store.expand_query = MagicMock(return_value=frozenset({"test", "sorgu"}))

    return RRFRetriever(retriever=mock_retriever, store=mock_store)


# ============================================================================
# A — rrf_score() matematik fonksiyonu
# ============================================================================

class TestRrfScore:
    """A: rrf_score(rank, k) doğruluğu."""

    def test_rank1_k60_is_one_over_61(self) -> None:
        assert abs(rrf_score(1, 60) - 1 / 61) < 1e-10

    def test_rank2_k60_less_than_rank1(self) -> None:
        assert rrf_score(2, 60) < rrf_score(1, 60)

    def test_k_0_rank1_is_1(self) -> None:
        assert abs(rrf_score(1, k=0) - 1.0) < 1e-10

    def test_larger_rank_smaller_score(self) -> None:
        scores = [rrf_score(r, 60) for r in range(1, 11)]
        assert scores == sorted(scores, reverse=True)

    def test_score_is_positive(self) -> None:
        assert rrf_score(100, 60) > 0

    def test_invalid_rank_raises(self) -> None:
        with pytest.raises(ValueError):
            rrf_score(0, 60)


# ============================================================================
# B — reciprocal_rank_fusion()
# ============================================================================

class TestReciprocalRankFusion:
    """B: RRF füzyon algoritması doğruluğu."""

    def test_single_list_returns_same_order(self) -> None:
        docs = [_doc("a", 0.9), _doc("b", 0.8), _doc("c", 0.7)]
        result = reciprocal_rank_fusion([docs])
        ids = [d.id for d, _ in result]
        assert ids == ["a", "b", "c"]

    def test_two_lists_shared_doc_gets_higher_score(self) -> None:
        shared = _doc("shared", 0.8)
        list1 = [shared, _doc("only-1")]
        list2 = [shared, _doc("only-2")]
        result = reciprocal_rank_fusion([list1, list2])
        # shared rank=1 in both → highest combined score
        assert result[0][0].id == "shared"

    def test_all_unique_docs_both_lists_preserved(self) -> None:
        l1 = [_doc("a"), _doc("b")]
        l2 = [_doc("c"), _doc("d")]
        result = reciprocal_rank_fusion([l1, l2])
        ids = {d.id for d, _ in result}
        assert {"a", "b", "c", "d"} == ids

    def test_max_results_truncates(self) -> None:
        docs = [_doc(f"d{i}") for i in range(10)]
        result = reciprocal_rank_fusion([docs], max_results=3)
        assert len(result) == 3

    def test_empty_list_returns_empty(self) -> None:
        assert reciprocal_rank_fusion([[]]) == []

    def test_scores_are_descending(self) -> None:
        l1 = [_doc(f"a{i}") for i in range(5)]
        l2 = [_doc(f"b{i}") for i in range(5)]
        result = reciprocal_rank_fusion([l1, l2])
        scores = [s for _, s in result]
        assert scores == sorted(scores, reverse=True)

    def test_overlapping_doc_higher_final_score_kept(self) -> None:
        """Aynı ID iki listede farklı final_score → yüksek olanı korunmalı."""
        low_score  = _doc("dup", 0.5)
        high_score = _doc("dup", 0.9)
        result = reciprocal_rank_fusion([[low_score], [high_score]])
        assert result[0][0].final_score == 0.9

    def test_three_empty_lists(self) -> None:
        assert reciprocal_rank_fusion([[], [], []]) == []


# ============================================================================
# C — SynonymStore
# ============================================================================

class TestSynonymStore:
    """C: SynonymStore expand, expand_query, has_synonyms."""

    def test_expand_known_term_returns_multiple(self) -> None:
        result = synonym_store.expand("ihbar tazminatı")
        assert len(result) >= 2
        assert _n("ihbar tazminatı") in result

    def test_expand_unknown_term_returns_singleton(self) -> None:
        result = synonym_store.expand("biqcuniquerandomterm")
        assert result == frozenset({"biqcuniquerandomterm"})

    def test_expand_case_insensitive(self) -> None:
        lower = synonym_store.expand("ihbar tazminatı")
        upper = synonym_store.expand("İhbar Tazminatı")
        assert lower == upper

    def test_expand_cap_respected(self) -> None:
        for term in synonym_store.all_terms:
            result = synonym_store.expand(term)
            assert len(result) <= MAX_EXPANSIONS

    def test_has_synonyms_true_for_known(self) -> None:
        assert synonym_store.has_synonyms("kıdem tazminatı") is True

    def test_has_synonyms_false_for_unknown(self) -> None:
        assert synonym_store.has_synonyms("blablabiruniquexyz") is False

    def test_expand_query_includes_original(self) -> None:
        result = synonym_store.expand_query("sanık hapis cezası")
        # normalised original should be in result
        assert _n("sanık hapis cezası") in result

    def test_expand_query_max_terms(self) -> None:
        result = synonym_store.expand_query("sanık beraat", max_terms=3)
        assert len(result) <= 3

    def test_all_terms_nonempty(self) -> None:
        assert len(synonym_store.all_terms) > 50  # en az 50 terim beklenir


# ============================================================================
# D — build_expanded_query()
# ============================================================================

class TestBuildExpandedQuery:
    """D: Sorgu genişletme yardımcı fonksiyonu."""

    def test_known_term_appends_synonyms(self) -> None:
        result = build_expanded_query("ihbar tazminatı", synonym_store)
        assert len(result) > len("ihbar tazminatı")

    def test_unknown_term_returns_original(self) -> None:
        query = "tamamen bilinmeyen bir terim"
        result = build_expanded_query(query, synonym_store)
        assert result.startswith(query)

    def test_result_starts_with_original(self) -> None:
        query = "kıdem tazminatı hesaplama"
        result = build_expanded_query(query, synonym_store)
        assert result.startswith(query)

    def test_empty_query_returns_empty(self) -> None:
        result = build_expanded_query("", synonym_store)
        assert result == ""


# ============================================================================
# E — RRFRetriever
# ============================================================================

class TestRRFRetriever:
    """E: RRFRetriever tam yol, fallback ve hata durumu."""

    pytestmark = pytest.mark.asyncio

    async def test_rrf_enabled_calls_search_twice(self) -> None:
        rrf = _make_rrf_retriever()
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = True
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="ihbar tazminatı",
                case_id=None,
                max_sources=5,
                min_score=0.0,
            )
        assert rrf._retriever.search.await_count == 2
        assert result.fusion_applied is True

    async def test_global_legal_only_uses_global_search_fn(self) -> None:
        """Step 13: global_legal_only=True iken RetrieverClient.global_legal_search kullanilmali."""
        rrf = _make_rrf_retriever()
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            await rrf.search(
                embedding=[0.1] * 8,
                query_text="isci alacagi faizi",
                case_id=None,
                max_sources=5,
                min_score=0.0,
                global_legal_only=True,
            )
        assert rrf._retriever.global_legal_search.await_count == 2
        assert rrf._retriever.search.await_count == 0

    async def test_rrf_disabled_calls_search_once(self) -> None:
        rrf = _make_rrf_retriever()
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test sorgu",
                case_id=None,
                max_sources=5,
                min_score=0.0,
            )
        assert rrf._retriever.search.await_count == 1
        assert result.fusion_applied is False

    async def test_result_contains_documents_from_both_lists(self) -> None:
        sem = [_doc("sem-only", 0.9)]
        kw  = [_doc("kw-only",  0.7)]
        rrf = _make_rrf_retriever(semantic_docs=sem, keyword_docs=kw)
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=10,
                min_score=0.0,
            )
        ids = {d.id for d in result.documents}
        assert "sem-only" in ids
        assert "kw-only"  in ids

    async def test_min_score_filters_low_score_docs(self) -> None:
        sem = [_doc("high", 0.9)]
        kw  = [_doc("low",  0.1)]
        rrf = _make_rrf_retriever(semantic_docs=sem, keyword_docs=kw)
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=10,
                min_score=0.5,    # low'ı eleyecek
            )
        ids = {d.id for d in result.documents}
        assert "high" in ids
        assert "low"  not in ids

    async def test_semantic_count_keyword_count_reported(self) -> None:
        sem = [_doc("s1"), _doc("s2"), _doc("s3")]
        kw  = [_doc("k1"), _doc("k2")]
        rrf = _make_rrf_retriever(semantic_docs=sem, keyword_docs=kw)
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=10,
                min_score=0.0,
            )
        assert result.semantic_count == 3
        assert result.keyword_count  == 2

    async def test_fallback_on_exception(self) -> None:
        """Paralel arama hata fırlatırsa sadece semantik fallback çalışmalı."""
        mock_retriever = MagicMock()
        fallback_docs  = [_doc("fallback")]
        # İlk iki çağrı başarısız, üçüncü (fallback) başarılı
        mock_retriever.search = AsyncMock(
            side_effect=[Exception("RPC error"), Exception("RPC error"), fallback_docs]
        )
        mock_store = MagicMock()
        mock_store.expand_query = MagicMock(return_value=frozenset({"t"}))
        rrf = RRFRetriever(retriever=mock_retriever, store=mock_store)

        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = True
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=5,
                min_score=0.0,
            )
        assert result.fusion_applied is False
        assert result.documents == fallback_docs

    async def test_rrf_scores_map_populated(self) -> None:
        sem = [_doc("x", 0.8)]
        kw  = [_doc("y", 0.7)]
        rrf = _make_rrf_retriever(semantic_docs=sem, keyword_docs=kw)
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=10,
                min_score=0.0,
            )
        assert "x" in result.rrf_scores
        assert "y" in result.rrf_scores
        assert all(v > 0 for v in result.rrf_scores.values())

    async def test_rrf_scores_normalized_to_unit_interval(self) -> None:
        """Gap 1: RRF füzyon sonrası normalize edilmiş skorlar ≤ 1.0 olmalı."""
        rrf = _make_rrf_retriever()
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="test",
                case_id=None,
                max_sources=10,
                min_score=0.0,
            )
        assert result.fusion_applied is True
        # Max-normalizasyon sonrası en yüksek skor tam 1.0 olmalı
        assert max(result.rrf_scores.values()) == pytest.approx(1.0, abs=1e-9)
        # Tüm skorlar [0, 1] aralığında
        assert all(0.0 <= v <= 1.0 for v in result.rrf_scores.values())

    async def test_ceza_domain_uses_rrf_k_ceza(self) -> None:
        """Gap 2: law_domain='CEZA' için rrf_k_ceza (40) kullanılmalı."""
        sem = [_doc("c1", 0.9), _doc("c2", 0.8)]
        kw  = [_doc("c1", 0.9), _doc("c2", 0.8)]  # shared → yüksek kombine skor
        rrf = _make_rrf_retriever(semantic_docs=sem, keyword_docs=kw)
        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = False
            mock_settings.rrf_k = 60
            mock_settings.rrf_k_ceza = 40
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="hapis cezası",
                case_id=None,
                max_sources=10,
                min_score=0.0,
                law_domain="CEZA",
            )
        # Fusion çalışmalı, belgeler dönmeli
        assert result.fusion_applied is True
        assert len(result.documents) > 0
        # Normalize edilmiş maks skor 1.0
        assert max(result.rrf_scores.values()) == pytest.approx(1.0, abs=1e-9)


# ============================================================================
# F — IndexTaskResult ve IndexTaskStatus
# ============================================================================

class TestIndexTaskResult:
    """F: IndexTaskResult domain nesnesi."""

    def test_success_status_value(self) -> None:
        assert IndexTaskStatus.SUCCESS.value == "SUCCESS"

    def test_failed_status_value(self) -> None:
        assert IndexTaskStatus.FAILED.value == "FAILED"

    def test_result_fields(self) -> None:
        r = IndexTaskResult(
            task_name="index_document_task",
            document_id="doc-123",
            status=IndexTaskStatus.SUCCESS,
            duration_ms=42,
            message="Tamam",
        )
        assert r.document_id == "doc-123"
        assert r.duration_ms == 42

    def test_default_metadata_is_empty(self) -> None:
        r = IndexTaskResult(
            task_name="t",
            document_id="d",
            status=IndexTaskStatus.SKIPPED,
            duration_ms=0,
        )
        assert r.metadata == {}


# ============================================================================
# G — _do_index_document / _do_delete_document (stub bağımlılıklar)
# ============================================================================

class TestIndexingTaskStubs:
    """G: Dış bağımlılıklar (openai, supabase) stub edilmiş görev fonksiyonları."""

    def test_do_index_document_returns_failed_on_openai_error(self) -> None:
        """openai.OpenAI() hatası → FAILED durumu döner."""
        with patch("openai.OpenAI", side_effect=Exception("openai erişim hatası")):
            result = _do_index_document(
                document_id="doc-1",
                content="test içerik",
            )
        assert result.status == IndexTaskStatus.FAILED
        assert result.document_id == "doc-1"

    def test_do_delete_document_returns_failed_when_supabase_unavailable(self) -> None:
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            side_effect=Exception("DB bağlantısı yok"),
        ):
            result = _do_delete_document(document_id="doc-2")
        assert result.status == IndexTaskStatus.FAILED

    def test_do_index_document_reports_duration(self) -> None:
        """Başarısız görev bile duration_ms >= 0 rapor etmeli."""
        with patch("openai.OpenAI", side_effect=Exception("no key")):
            result = _do_index_document("doc-3", "içerik")
        assert result.duration_ms >= 0

    def test_do_delete_document_task_name(self) -> None:
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            side_effect=Exception("down"),
        ):
            result = _do_delete_document("doc-4")
        assert result.task_name == "delete_document_task"

    # ── Gap 3: _do_index_document_with_retry ─────────────────────────────

    def test_retry_wrapper_recovers_on_second_attempt(self) -> None:
        """Gap 3: geçici hata sonrası ikinci denemede başarılı → SUCCESS."""
        fail = IndexTaskResult(
            "index_document_task", "doc-r1", IndexTaskStatus.FAILED, 5, "geçici hata"
        )
        ok = IndexTaskResult(
            "index_document_task", "doc-r1", IndexTaskStatus.SUCCESS, 10, "ok"
        )
        with patch(
            "infrastructure.async_indexing.indexing_tasks._do_index_document",
            side_effect=[fail, ok],
        ):
            with patch("time.sleep"):  # gecikmeyi atla
                result = _do_index_document_with_retry(
                    "doc-r1", "içerik", max_retries=1, retry_delay_base_s=0.0,
                )
        assert result.status == IndexTaskStatus.SUCCESS

    def test_retry_wrapper_dead_letter_after_max_retries(self) -> None:
        """Gap 3: tüm denemeler başarısızsa dead-letter metadata ile FAILED döner."""
        fail = IndexTaskResult(
            "index_document_task", "doc-r2", IndexTaskStatus.FAILED, 5, "kalıcı hata"
        )
        with patch(
            "infrastructure.async_indexing.indexing_tasks._do_index_document",
            return_value=fail,
        ):
            with patch("time.sleep"):
                result = _do_index_document_with_retry(
                    "doc-r2", "içerik", max_retries=2, retry_delay_base_s=0.0,
                )
        assert result.status == IndexTaskStatus.FAILED
        assert result.retries == 2
        assert result.metadata.get("dead_letter") is True

    def test_retry_wrapper_zero_retries_returns_immediately(self) -> None:
        """Gap 3: max_retries=0 → hemen FAILED döner, time.sleep çağrılmaz."""
        fail = IndexTaskResult(
            "index_document_task", "doc-r3", IndexTaskStatus.FAILED, 5, "hata"
        )
        with patch(
            "infrastructure.async_indexing.indexing_tasks._do_index_document",
            return_value=fail,
        ) as mock_idx:
            result = _do_index_document_with_retry(
                "doc-r3", "içerik", max_retries=0, retry_delay_base_s=0.0,
            )
        assert result.status == IndexTaskStatus.FAILED
        assert mock_idx.call_count == 1  # yalnızca bir kez çağrıldı


class TestRrfRpcExpandedRetry:
    pytestmark = pytest.mark.asyncio

    async def test_rpc_expanded_query_empty_retries_with_original_query(self) -> None:
        from infrastructure.retrieval.retrieval_client import RetrieverClient

        retriever = RetrieverClient()
        retriever.search_rrf = AsyncMock(
            side_effect=[
                [],
                [_doc("fallback-hit", 0.91)],
            ]
        )
        store = MagicMock()
        store.expand_query = MagicMock(return_value=frozenset({"is", "kanunu", "fesih"}))
        rrf = RRFRetriever(retriever=retriever, store=store)

        with patch("infrastructure.search.rrf_retriever.settings") as mock_settings:
            mock_settings.rrf_enabled = True
            mock_settings.synonym_expansion_enabled = True
            mock_settings.rrf_k = 60
            mock_settings.rrf_semantic_weight = 1.0
            mock_settings.rrf_keyword_weight = 1.0
            result = await rrf.search(
                embedding=[0.1] * 8,
                query_text="is kanunu",
                case_id=None,
                max_sources=5,
                min_score=0.0,
            )

        assert retriever.search_rrf.await_count == 2
        first_q = retriever.search_rrf.await_args_list[0].kwargs["query_text"]
        second_q = retriever.search_rrf.await_args_list[1].kwargs["query_text"]
        assert first_q != "is kanunu"
        assert second_q == "is kanunu"
        assert [d.id for d in result.documents] == ["fallback-hit"]
