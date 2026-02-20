"""
Tests — Step 12: Hiyerarşi, Otorite ve Çatışma Duyarlı Re-Ranking
==================================================================
Gruplar:
    A — detect_query_domain()            (5 test)
    B — is_specialized_for_domain()      (5 test)
    C — _NORM_BOOST değerleri            (5 test)
    D — RerankScore dataclass            (5 test)
    E — lex_specialis_boost()            (7 test)
    F — lex_posterior_boost()            (7 test)
    G — LegalReranker.rerank()           (9 test)
    H — RAGService entegrasyonu          (3 test)
    I — Gap 1/2/3 tamamlayıcı testler    (5 test)

Toplam: 52 yeni test  →  874 + 5 = 879 hedef
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from domain.entities.legal_document import LegalDocument
from infrastructure.llm.tiered_router import QueryTier
from infrastructure.reranking.legal_reranker import (
    LegalReranker,
    RerankResult,
    RerankScore,
    _NORM_BOOST,
    detect_query_domain,
    is_specialized_for_domain,
    legal_reranker,
    lex_posterior_boost,
    lex_specialis_boost,
)
from infrastructure.search.rrf_retriever import RRFSearchResult


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı fabrika
# ─────────────────────────────────────────────────────────────────────────────

def _doc(
    doc_id: str,
    *,
    final_score: float = 0.80,
    court_level: Optional[str] = None,
    norm_hierarchy: Optional[str] = None,
    majority_type: Optional[str] = None,
    dissent_present: bool = False,
    effective_date: Optional[date] = None,
    ruling_date: Optional[date] = None,
    chamber: Optional[str] = None,
) -> LegalDocument:
    return LegalDocument(
        id=doc_id,
        content=f"hukuki içerik — {doc_id}",
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=final_score,
        court_level=court_level,
        norm_hierarchy=norm_hierarchy,
        majority_type=majority_type,
        dissent_present=dissent_present,
        effective_date=effective_date,
        ruling_date=ruling_date,
        chamber=chamber,
    )


# ============================================================================
# A — detect_query_domain()
# ============================================================================

class TestDetectQueryDomain:
    """A: Sorgu metninden birincil hukuk alanı tespiti."""

    def test_is_hukuku_detected(self) -> None:
        assert detect_query_domain("kıdem tazminatı ihbar öneli hesabı") == "is_hukuku"

    def test_ceza_detected(self) -> None:
        assert detect_query_domain("sanığa verilen hapis cezası indirim şartları") == "ceza"

    def test_medeni_detected(self) -> None:
        assert detect_query_domain("boşanma davası nafaka velayet kararı") == "medeni"

    def test_vergi_detected(self) -> None:
        assert detect_query_domain("KDV vergi ziyaı cezası VUK") == "vergi"

    def test_unknown_returns_none(self) -> None:
        assert detect_query_domain("tamamen bilinmez ve alakasız kelimeler xyz") is None

    def test_empty_string_returns_none(self) -> None:
        assert detect_query_domain("") is None


# ============================================================================
# B — is_specialized_for_domain()
# ============================================================================

class TestIsSpecializedForDomain:
    """B: Daire domain uzmanlığı kontrolü."""

    def test_is_hukuku_9th_chamber_specialized(self) -> None:
        doc = _doc("d1", chamber="Yargıtay 9. Hukuk Dairesi")
        assert is_specialized_for_domain(doc, "is_hukuku") is True

    def test_ceza_chamber_specialized(self) -> None:
        doc = _doc("d2", chamber="Yargıtay Ceza Genel Kurulu (CGK)")
        assert is_specialized_for_domain(doc, "ceza") is True

    def test_general_chamber_not_specialized(self) -> None:
        doc = _doc("d3", chamber="Yargıtay 1. Hukuk Dairesi")
        assert is_specialized_for_domain(doc, "is_hukuku") is False

    def test_none_chamber_returns_false(self) -> None:
        doc = _doc("d4", chamber=None)
        assert is_specialized_for_domain(doc, "is_hukuku") is False

    def test_none_domain_returns_false(self) -> None:
        doc = _doc("d5", chamber="9. Hukuk Dairesi")
        assert is_specialized_for_domain(doc, None) is False


# ============================================================================
# C — _NORM_BOOST değerleri
# ============================================================================

class TestNormBoostValues:
    """C: Norm hiyerarşisi boost tablosu doğruluğu."""

    def test_anayasa_highest(self) -> None:
        assert _NORM_BOOST["ANAYASA"] > _NORM_BOOST["KANUN"]

    def test_kanun_above_cbk(self) -> None:
        assert _NORM_BOOST["KANUN"] > _NORM_BOOST["CBK"]

    def test_cbk_above_yonetmelik(self) -> None:
        assert _NORM_BOOST["CBK"] > _NORM_BOOST["YONETMELIK"]

    def test_diger_is_zero(self) -> None:
        assert _NORM_BOOST["DIGER"] == 0.0

    def test_all_nonnegative(self) -> None:
        assert all(v >= 0.0 for v in _NORM_BOOST.values())


# ============================================================================
# D — RerankScore dataclass
# ============================================================================

class TestRerankScore:
    """D: RerankScore dataclass ve total property."""

    def test_total_sums_all_components(self) -> None:
        s = RerankScore(
            base_score=0.80,
            authority_boost=0.05,
            hierarchy_boost=0.12,
            binding_boost=0.10,
            lex_specialis_boost=0.10,
            lex_posterior_boost=0.06,
        )
        expected = 0.80 + 0.05 + 0.12 + 0.10 + 0.10 + 0.06
        assert abs(s.total - expected) < 1e-10

    def test_defaults_all_zero(self) -> None:
        s = RerankScore()
        assert s.total == 0.0

    def test_to_dict_keys(self) -> None:
        s = RerankScore(base_score=0.5)
        d = s.to_dict()
        assert "base_score" in d
        assert "total" in d
        assert d["base_score"] == 0.5

    def test_to_dict_total_matches_property(self) -> None:
        s = RerankScore(base_score=0.7, authority_boost=0.1)
        assert s.to_dict()["total"] == s.total

    def test_rerank_result_repr(self) -> None:
        doc = _doc("test-id", final_score=0.9)
        r = RerankResult(document=doc, score=RerankScore(base_score=0.9))
        assert "test-id" in repr(r)


# ============================================================================
# E — lex_specialis_boost()
# ============================================================================

class TestLexSpecialisBoost:
    """E: Lex Specialis kural motoru."""

    def test_specialized_doc_gets_boost_over_general(self) -> None:
        """Aynı norm seviyesinde: uzman daire > genel daire."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN",
                         chamber="Yargıtay 9. Hukuk Dairesi")
        doc_gen  = _doc("gen",  norm_hierarchy="KANUN",
                         chamber="Yargıtay 1. Hukuk Dairesi")
        boost, notes = lex_specialis_boost(
            doc_spec, [doc_spec, doc_gen], "is_hukuku", 0.10
        )
        assert boost == 0.10
        assert len(notes) == 1
        assert "LEX_SPECIALIS" in notes[0]

    def test_general_doc_gets_no_boost(self) -> None:
        """Genel daire, uzman daire varken boost alamaz."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN",
                         chamber="9. Hukuk Dairesi")
        doc_gen  = _doc("gen",  norm_hierarchy="KANUN",
                         chamber="1. Hukuk Dairesi")
        boost, _ = lex_specialis_boost(
            doc_gen, [doc_spec, doc_gen], "is_hukuku", 0.10
        )
        assert boost == 0.0

    def test_no_competitor_no_boost(self) -> None:
        """Tek belge — rakip yok — boost yok."""
        doc = _doc("only", norm_hierarchy="KANUN",
                    chamber="9. Hukuk Dairesi")
        boost, notes = lex_specialis_boost(doc, [doc], "is_hukuku", 0.10)
        assert boost == 0.0
        assert notes == []

    def test_different_norm_levels_no_boost(self) -> None:
        """Farklı norm seviyeleri — lex specialis uygulanmaz."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN",
                         chamber="9. Hukuk Dairesi")
        doc_other = _doc("other", norm_hierarchy="CBK",
                          chamber="1. Hukuk Dairesi")
        boost, _ = lex_specialis_boost(
            doc_spec, [doc_spec, doc_other], "is_hukuku", 0.10
        )
        assert boost == 0.0

    def test_none_domain_no_boost(self) -> None:
        """Domain tespit edilemezse boost yok."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN",
                         chamber="9. Hukuk Dairesi")
        doc_gen  = _doc("gen",  norm_hierarchy="KANUN",
                         chamber="1. Hukuk Dairesi")
        boost, _ = lex_specialis_boost(
            doc_spec, [doc_spec, doc_gen], None, 0.10
        )
        assert boost == 0.0

    def test_boost_value_respected(self) -> None:
        """Farklı boost değerleri doğru uygulanır."""
        doc_spec = _doc("s", norm_hierarchy="KANUN", chamber="9. Hukuk Dairesi")
        doc_gen  = _doc("g", norm_hierarchy="KANUN", chamber="1. Hukuk Dairesi")
        for bv in [0.05, 0.10, 0.20]:
            boost, _ = lex_specialis_boost(
                doc_spec, [doc_spec, doc_gen], "is_hukuku", bv
            )
            assert boost == bv

    def test_note_contains_doc_ids(self) -> None:
        """Çatışma notu belge ID'lerini içerir."""
        doc_spec = _doc("spec-001", norm_hierarchy="KANUN", chamber="9. Hukuk Dairesi")
        doc_gen  = _doc("gen-002",  norm_hierarchy="KANUN", chamber="1. Hukuk Dairesi")
        _, notes = lex_specialis_boost(
            doc_spec, [doc_spec, doc_gen], "is_hukuku", 0.10
        )
        assert "spec-001" in notes[0]
        assert "gen-002" in notes[0]


# ============================================================================
# F — lex_posterior_boost()
# ============================================================================

class TestLexPosteriorBoost:
    """F: Lex Posterior kural motoru."""

    def test_newer_effective_date_gets_boost(self) -> None:
        doc_new = _doc("new", norm_hierarchy="KANUN",
                        effective_date=date(2024, 1, 1))
        doc_old = _doc("old", norm_hierarchy="KANUN",
                        effective_date=date(2018, 1, 1))
        boost, notes = lex_posterior_boost(doc_new, [doc_new, doc_old], 0.06)
        assert boost == 0.06
        assert len(notes) == 1
        assert "LEX_POSTERIOR" in notes[0]

    def test_older_doc_gets_no_boost(self) -> None:
        doc_new = _doc("new", norm_hierarchy="KANUN",
                        effective_date=date(2024, 1, 1))
        doc_old = _doc("old", norm_hierarchy="KANUN",
                        effective_date=date(2018, 1, 1))
        boost, _ = lex_posterior_boost(doc_old, [doc_new, doc_old], 0.06)
        assert boost == 0.0

    def test_ruling_date_used_for_court_decisions(self) -> None:
        """ruling_date, effective_date olmadığında kullanılır."""
        doc_new = _doc("new", norm_hierarchy="KANUN",
                        ruling_date=date(2025, 5, 1))
        doc_old = _doc("old", norm_hierarchy="KANUN",
                        ruling_date=date(2020, 3, 1))
        boost, _ = lex_posterior_boost(doc_new, [doc_new, doc_old], 0.06)
        assert boost == 0.06

    def test_no_date_no_boost(self) -> None:
        """Tarih bilgisi yoksa boost yok."""
        doc_nodate = _doc("nd", norm_hierarchy="KANUN")
        doc_old    = _doc("old", norm_hierarchy="KANUN",
                           effective_date=date(2018, 1, 1))
        boost, _ = lex_posterior_boost(doc_nodate, [doc_nodate, doc_old], 0.06)
        assert boost == 0.0

    def test_different_norm_levels_no_boost(self) -> None:
        """Farklı norm seviyeleri — lex posterior uygulanmaz."""
        doc_new = _doc("new", norm_hierarchy="KANUN",
                        effective_date=date(2024, 1, 1))
        doc_old = _doc("old", norm_hierarchy="CBK",
                        effective_date=date(2018, 1, 1))
        boost, _ = lex_posterior_boost(doc_new, [doc_new, doc_old], 0.06)
        assert boost == 0.0

    def test_single_doc_no_boost(self) -> None:
        doc = _doc("only", norm_hierarchy="KANUN",
                    effective_date=date(2024, 1, 1))
        boost, _ = lex_posterior_boost(doc, [doc], 0.06)
        assert boost == 0.0

    def test_note_contains_dates(self) -> None:
        doc_new = _doc("n", norm_hierarchy="KANUN",
                        effective_date=date(2024, 1, 1))
        doc_old = _doc("o", norm_hierarchy="KANUN",
                        effective_date=date(2018, 1, 1))
        _, notes = lex_posterior_boost(doc_new, [doc_new, doc_old], 0.06)
        assert "2024-01-01" in notes[0]
        assert "2018-01-01" in notes[0]


# ============================================================================
# G — LegalReranker.rerank()
# ============================================================================

class TestLegalReranker:
    """G: LegalReranker tam pipeline."""

    def test_empty_list_returns_empty(self) -> None:
        assert legal_reranker.rerank([], "test sorgu") == []

    def test_disabled_returns_passthrough(self) -> None:
        """reranking_enabled=False → RRF sırası korunur."""
        docs = [_doc("a", final_score=0.9), _doc("b", final_score=0.7)]
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = False
            results = legal_reranker.rerank(docs, "test")
        assert [r.document.id for r in results] == ["a", "b"]
        assert all(r.score.lex_specialis_boost == 0 for r in results)

    def test_binding_doc_gets_binding_boost(self) -> None:
        """İBK/HGK belgesi binding_boost alır."""
        binding = _doc("ibk", final_score=0.6, court_level="YARGITAY_IBK")
        regular = _doc("reg", final_score=0.8, court_level="YARGITAY_DAIRE")
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 0.0
            ms.reranking_binding_boost = 0.10
            ms.lex_specialis_weight = 0.0
            ms.lex_posterior_weight = 0.0
            results = legal_reranker.rerank([binding, regular], "kıdem tazminatı")
        ibk_result = next(r for r in results if r.document.id == "ibk")
        assert ibk_result.score.binding_boost == 0.10

    def test_anayasa_doc_gets_highest_hierarchy_boost(self) -> None:
        anayasa = _doc("ana", norm_hierarchy="ANAYASA", final_score=0.5)
        kanun   = _doc("kan", norm_hierarchy="KANUN",   final_score=0.5)
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 1.0
            ms.reranking_binding_boost = 0.0
            ms.lex_specialis_weight = 0.0
            ms.lex_posterior_weight = 0.0
            results = legal_reranker.rerank([kanun, anayasa], "iptal davası")
        anayasa_result = next(r for r in results if r.document.id == "ana")
        kanun_result   = next(r for r in results if r.document.id == "kan")
        assert anayasa_result.score.hierarchy_boost > kanun_result.score.hierarchy_boost

    def test_result_count_equals_input_count(self) -> None:
        docs = [_doc(f"d{i}") for i in range(5)]
        results = legal_reranker.rerank(docs, "iş hukuku sorgu")
        assert len(results) == 5

    def test_results_sorted_descending_by_total(self) -> None:
        docs = [_doc(f"d{i}", final_score=float(i) / 10) for i in range(5)]
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 0.0
            ms.reranking_binding_boost = 0.0
            ms.lex_specialis_weight = 0.0
            ms.lex_posterior_weight = 0.0
            results = legal_reranker.rerank(docs, "test")
        totals = [r.score.total for r in results]
        assert totals == sorted(totals, reverse=True)

    def test_lex_specialis_fires_for_specialized_chamber(self) -> None:
        """İş hukuku sorgusunda 9. HD belgesi lex specialis bostu alır."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN", final_score=0.5,
                         chamber="Yargıtay 9. Hukuk Dairesi")
        doc_gen  = _doc("gen",  norm_hierarchy="KANUN", final_score=0.6,
                         chamber="Yargıtay 1. Hukuk Dairesi")
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 0.0
            ms.reranking_binding_boost = 0.0
            ms.lex_specialis_weight = 0.10
            ms.lex_posterior_weight = 0.0
            results = legal_reranker.rerank(
                [doc_spec, doc_gen], "kıdem tazminatı iş hukuku"
            )
        spec_result = next(r for r in results if r.document.id == "spec")
        assert spec_result.score.lex_specialis_boost == 0.10

    def test_lex_posterior_fires_for_newer_norm(self) -> None:
        """Daha yeni tarihli norm lex posterior bostu alır."""
        doc_new = _doc("new", norm_hierarchy="KANUN", final_score=0.5,
                        effective_date=date(2024, 1, 1))
        doc_old = _doc("old", norm_hierarchy="KANUN", final_score=0.7,
                        effective_date=date(2015, 1, 1))
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 0.0
            ms.reranking_binding_boost = 0.0
            ms.lex_specialis_weight = 0.0
            ms.lex_posterior_weight = 0.06
            results = legal_reranker.rerank([doc_new, doc_old], "kanun uygulaması")
        new_result = next(r for r in results if r.document.id == "new")
        assert new_result.score.lex_posterior_boost == 0.06

    def test_conflict_notes_present_when_lex_rule_fires(self) -> None:
        """Lex kural uygulandığında conflict_notes dolu olmalı."""
        doc_spec = _doc("spec", norm_hierarchy="KANUN", final_score=0.5,
                         chamber="9. Hukuk Dairesi")
        doc_gen  = _doc("gen",  norm_hierarchy="KANUN", final_score=0.6,
                         chamber="1. Hukuk Dairesi")
        with patch("infrastructure.reranking.legal_reranker.settings") as ms:
            ms.reranking_enabled = True
            ms.reranking_authority_weight = 0.0
            ms.reranking_hierarchy_weight = 0.0
            ms.reranking_binding_boost = 0.0
            ms.lex_specialis_weight = 0.10
            ms.lex_posterior_weight = 0.0
            results = legal_reranker.rerank(
                [doc_spec, doc_gen], "işçi ihbar tazminatı"
            )
        spec_result = next(r for r in results if r.document.id == "spec")
        assert len(spec_result.conflict_notes) >= 1


# ============================================================================
# H — RAGService entegrasyonu
# ============================================================================

class TestRAGServiceRerankerIntegration:
    """H: RAGService._reranker entegrasyonu."""

    pytestmark = pytest.mark.asyncio

    def _make_service(self, docs: List[LegalDocument]):
        from application.services.rag_service import RAGService
        from infrastructure.context.context_builder import ContextBuilder
        from infrastructure.reranking.legal_reranker import LegalReranker, RerankResult, RerankScore

        mock_router = MagicMock()
        mock_router.decide.return_value = MagicMock(tier=QueryTier.TIER2)
        mock_router.generate = AsyncMock(return_value=("Cevap.", "openai/gpt-4o-mini"))
        mock_guard = MagicMock()
        mock_guard.check_query.return_value = None
        mock_guard.check_context.return_value = None
        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 8)
        mock_rrf = MagicMock()
        mock_rrf.search = AsyncMock(return_value=RRFSearchResult(
            documents=docs,
            rrf_scores={d.id: d.final_score for d in docs},
            semantic_count=len(docs), keyword_count=0,
            expanded_query="", fusion_applied=False,
        ))
        # Reranker'ı spy olarak wrap ediyoruz
        mock_reranker = MagicMock(spec=LegalReranker)
        mock_reranker.rerank = MagicMock(
            return_value=[
                RerankResult(document=d, score=RerankScore(base_score=d.final_score))
                for d in docs
            ]
        )
        # ContextBuilder stub
        real_builder = ContextBuilder.__new__(ContextBuilder)
        real_builder._system_reserve = 0
        real_builder._query_reserve = 0
        real_builder._response_reserve = 0
        real_builder._safety_margin = 0.0
        real_builder._min_snippet_chars = 80

        svc = RAGService(
            router=mock_router,
            guard=mock_guard,
            embedder=mock_embedder,
            rrf=mock_rrf,
            reranker=mock_reranker,
            ctx_builder=real_builder,
        )
        svc._tier_max_tokens = lambda tier: 5000
        return svc, mock_reranker

    async def test_reranker_called_with_retrieved_docs(self) -> None:
        """reranker.rerank() RRF sonrası çağrılmalı."""
        from api.schemas import RAGQueryRequest
        docs = [_doc(str(i), final_score=0.8) for i in range(3)]
        svc, mock_reranker = self._make_service(docs)
        req = RAGQueryRequest(query="ihbar tazminatı nedir?")
        await svc.query(req)
        mock_reranker.rerank.assert_called_once()

    async def test_reranker_receives_query_text(self) -> None:
        """reranker.rerank() query_text parametresini almalı."""
        from api.schemas import RAGQueryRequest
        docs = [_doc("d1", final_score=0.8)]
        svc, mock_reranker = self._make_service(docs)
        query = "kıdem tazminatı hesaplama"
        req = RAGQueryRequest(query=query)
        await svc.query(req)
        call_args = mock_reranker.rerank.call_args
        assert query in call_args[0] or call_args[1].get("query_text") == query

    async def test_response_sources_match_reranked_docs(self) -> None:
        """RAGResponse.sources reranker çıktısıyla eşleşmelidir."""
        from api.schemas import RAGQueryRequest
        docs = [_doc("doc-A", final_score=0.9), _doc("doc-B", final_score=0.7)]
        svc, _ = self._make_service(docs)
        req = RAGQueryRequest(query="kıdem tazminatı nedir?")
        resp = await svc.query(req)
        assert len(resp.sources) == 2


# ============================================================================
# I — Gap 1/2/3 tamamlayıcı testler
# ============================================================================

class TestGap123Integration:
    """
    I: _write_rerank_audit, law_domain passthrough, conflict_notes response.
    """

    # ── Gap 1 testleri ────────────────────────────────────────────────────────

    def test_write_rerank_audit_calls_supabase_insert(self) -> None:
        """_write_rerank_audit reranking_audit tablosuna insert çağırmalı."""
        reranker = LegalReranker()
        docs = [_doc("d1", final_score=0.9), _doc("d2", final_score=0.7)]
        results = [
            RerankResult(document=docs[0], score=RerankScore(base_score=0.9)),
            RerankResult(document=docs[1], score=RerankScore(base_score=0.7)),
        ]
        mock_sb = MagicMock()
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            reranker._write_rerank_audit(
                original_docs=docs,
                results=results,
                query_text="test sorgusu",
                query_domain="is_hukuku",
                bureau_id="bureau-1",
                case_id="case-1",
            )
        mock_sb.table.assert_called_once_with("reranking_audit")
        mock_sb.table.return_value.insert.assert_called_once()
        rows = mock_sb.table.return_value.insert.call_args[0][0]
        assert len(rows) == 2

    def test_write_rerank_audit_nonfatal_on_db_error(self) -> None:
        """Veritabanı hatası ana akışı çökertmemeli."""
        reranker = LegalReranker()
        docs = [_doc("d1")]
        results = [RerankResult(document=docs[0], score=RerankScore(base_score=0.9))]
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            side_effect=RuntimeError("DB unavailable"),
        ):
            # Herhangi bir istisna fırlatmamalı
            reranker._write_rerank_audit(
                original_docs=docs,
                results=results,
                query_text="sorgu",
                query_domain=None,
            )

    def test_write_rerank_audit_original_rank_preserved(self) -> None:
        """Rerank sonrası sıra değişen belgede original_rank doğru olmalı."""
        reranker = LegalReranker()
        docs = [_doc("d1", final_score=0.9), _doc("d2", final_score=0.7)]
        # Rerank sonucu: d2 öne geçti
        results = [
            RerankResult(document=docs[1], score=RerankScore(base_score=0.95)),
            RerankResult(document=docs[0], score=RerankScore(base_score=0.80)),
        ]
        captured: list = []
        mock_sb = MagicMock()
        mock_sb.table.return_value.insert.side_effect = (
            lambda rows: captured.extend(rows) or MagicMock()
        )
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            reranker._write_rerank_audit(
                original_docs=docs,
                results=results,
                query_text="test",
                query_domain=None,
            )
        d2_row = next(r for r in captured if r["document_id"] == "d2")
        assert d2_row["original_rank"] == 2   # RRF'de 2. sıradaydı
        assert d2_row["reranked_rank"] == 1   # rerank sonrası 1. sıraya çıktı

    # ── Gap 2 testi ────────────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_law_domain_passed_to_rrf_search(self) -> None:
        """RAGService, tespit edilen law_domain'i rrf.search'e iletmeli."""
        from api.schemas import RAGQueryRequest
        from application.services.rag_service import RAGService
        from infrastructure.context.context_builder import ContextBuilder

        docs = [_doc("d1", final_score=0.8)]
        mock_router = MagicMock()
        mock_router.decide.return_value = MagicMock(tier=QueryTier.TIER2)
        mock_router.generate = AsyncMock(return_value=("Cevap.", "openai/gpt-4o-mini"))
        mock_guard = MagicMock()
        mock_guard.check_query.return_value = None
        mock_guard.check_context.return_value = None
        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 8)
        mock_rrf = MagicMock()
        mock_rrf.search = AsyncMock(return_value=RRFSearchResult(
            documents=docs,
            rrf_scores={d.id: d.final_score for d in docs},
            semantic_count=1, keyword_count=0,
            expanded_query="", fusion_applied=False,
        ))
        mock_reranker = MagicMock(spec=LegalReranker)
        mock_reranker.rerank = MagicMock(return_value=[
            RerankResult(document=docs[0], score=RerankScore(base_score=0.8))
        ])
        real_builder = ContextBuilder.__new__(ContextBuilder)
        real_builder._system_reserve = 0
        real_builder._query_reserve = 0
        real_builder._response_reserve = 0
        real_builder._safety_margin = 0.0
        real_builder._min_snippet_chars = 80
        svc = RAGService(
            router=mock_router, guard=mock_guard, embedder=mock_embedder,
            rrf=mock_rrf, reranker=mock_reranker, ctx_builder=real_builder,
        )
        svc._tier_max_tokens = lambda tier: 5000

        # "kıdem + ihbar" -> is_hukuku domainı tespit edilmeli
        req = RAGQueryRequest(query="kıdem tazminatı ihbar öneli hesabı")
        await svc.query(req)

        call_kwargs = mock_rrf.search.call_args[1]
        assert call_kwargs.get("law_domain") == "is_hukuku"

    # ── Gap 3 testi ────────────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_conflict_notes_surfaced_in_response_sources(self) -> None:
        """Lex kural notları RAGResponse.sources[].conflict_notes'ta görünmeli."""
        from api.schemas import RAGQueryRequest
        from application.services.rag_service import RAGService
        from infrastructure.context.context_builder import ContextBuilder

        docs = [_doc("doc-A", final_score=0.9)]
        expected_note = "LEX_SPECIALIS: 'doc-A' önceli almaktır"
        mock_router = MagicMock()
        mock_router.decide.return_value = MagicMock(tier=QueryTier.TIER2)
        mock_router.generate = AsyncMock(return_value=("Cevap.", "openai/gpt-4o-mini"))
        mock_guard = MagicMock()
        mock_guard.check_query.return_value = None
        mock_guard.check_context.return_value = None
        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 8)
        mock_rrf = MagicMock()
        mock_rrf.search = AsyncMock(return_value=RRFSearchResult(
            documents=docs,
            rrf_scores={d.id: d.final_score for d in docs},
            semantic_count=1, keyword_count=0,
            expanded_query="", fusion_applied=False,
        ))
        mock_reranker = MagicMock(spec=LegalReranker)
        mock_reranker.rerank = MagicMock(return_value=[
            RerankResult(
                document=docs[0],
                score=RerankScore(base_score=0.9),
                conflict_notes=[expected_note],
            )
        ])
        real_builder = ContextBuilder.__new__(ContextBuilder)
        real_builder._system_reserve = 0
        real_builder._query_reserve = 0
        real_builder._response_reserve = 0
        real_builder._safety_margin = 0.0
        real_builder._min_snippet_chars = 80
        svc = RAGService(
            router=mock_router, guard=mock_guard, embedder=mock_embedder,
            rrf=mock_rrf, reranker=mock_reranker, ctx_builder=real_builder,
        )
        svc._tier_max_tokens = lambda tier: 5000

        req = RAGQueryRequest(query="kıdem tazminatı nedir?")
        resp = await svc.query(req)

        assert resp.sources[0].conflict_notes == [expected_note]
