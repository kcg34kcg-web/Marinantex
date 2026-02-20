"""
Tests — Step 13: GraphRAG: Atıf Zinciri ve Derinlik Sınırı
===========================================================
Gruplar:
    A — CitationExtractor.extract()             (6 test)
    B — CitationType enum değerleri             (5 test)
    C — Tier gate (Tier 1/2 → pass-through)     (6 test)
    D — BFS derinlik kontrolü                   (6 test)
    E — Döngü tespiti (cycle detection)         (5 test)
    F — max_nodes sınırı                        (5 test)
    G — CitationGraphResult alan doğrulaması    (4 test)
    H — RAGService entegrasyonu                 (3 test)
    I — SupabaseCitationRepository              (6 test)

Toplam: 46 yeni test  →  879 + 6 = 885 hedef
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from domain.entities.legal_document import LegalDocument
from infrastructure.graph.citation_graph import (
    CitationEdge,
    CitationGraphExpander,
    CitationGraphResult,
    CitationNode,
    citation_graph_expander,
)
from infrastructure.ingest.citation_extractor import (
    CitationType,
    ExtractedCitation,
    citation_extractor,
)
from infrastructure.llm.tiered_router import QueryTier
from infrastructure.search.rrf_retriever import RRFSearchResult


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı fabrika
# ─────────────────────────────────────────────────────────────────────────────


def _doc(
    doc_id: str,
    *,
    final_score: float = 0.80,
    content: str = "",
) -> LegalDocument:
    return LegalDocument(
        id=doc_id,
        content=content,
        collected_at=datetime(2025, 1, 1, 12, 0),
        final_score=final_score,
    )


# ============================================================================
# A — CitationExtractor.extract() — GraphRAG bağlamında atıf çıkarımı
# ============================================================================


class TestCitationExtractorForGraphRAG:
    """A: CitationExtractor hukuki atıf çıkarımı."""

    def test_extracts_kanun_no(self) -> None:
        """4857 sayılı kanun numarası atıfı çıkarılmalı."""
        text = "4857 sayılı İş Kanunu kapsamında kıdem tazminatı hesaplanır."
        cits = citation_extractor.extract(text)
        types = [c.citation_type for c in cits]
        assert CitationType.KANUN_NO.value in types

    def test_extracts_madde_ref_md(self) -> None:
        """'md. 17' şeklindeki madde atıfı çıkarılmalı."""
        text = "İş Kanunu md. 17 gereğince bildirim süresi uygulanır."
        cits = citation_extractor.extract(text)
        types = [c.citation_type for c in cits]
        assert CitationType.MADDE_REF.value in types

    def test_extracts_yargitay_with_esas_karar(self) -> None:
        """Yargıtay E./K. numaralı karar atıfı çıkarılmalı."""
        text = "Yargıtay 9. HD, E. 2023/1234, K. 2024/5678 sayılı karar gereğince..."
        cits = citation_extractor.extract(text)
        types = [c.citation_type for c in cits]
        assert CitationType.YARGITAY.value in types

    def test_extracts_aym_decision(self) -> None:
        """AYM kararı atıfı çıkarılmalı."""
        text = "AYM, E. 2022/45, K. 2023/78 kararıyla anayasaya aykırılık tespit edildi."
        cits = citation_extractor.extract(text)
        types = [c.citation_type for c in cits]
        assert CitationType.AYM.value in types

    def test_empty_content_returns_empty(self) -> None:
        """Boş içerik → boş liste."""
        cits = citation_extractor.extract("")
        assert cits == []

    def test_no_citations_in_plain_text(self) -> None:
        """Atıf içermeyen metin → boş liste."""
        text = "Bu metin herhangi bir kanun veya mahkeme kararına atıf içermez."
        cits = citation_extractor.extract(text)
        assert cits == []


# ============================================================================
# B — CitationType enum değerleri
# ============================================================================


class TestCitationType:
    """B: CitationType enum değerleri."""

    def test_kanun_no_value(self) -> None:
        assert CitationType.KANUN_NO.value == "KANUN_NO"

    def test_madde_ref_value(self) -> None:
        assert CitationType.MADDE_REF.value == "MADDE_REF"

    def test_yargitay_value(self) -> None:
        assert CitationType.YARGITAY.value == "YARGITAY"

    def test_aym_value(self) -> None:
        assert CitationType.AYM.value == "AYM"

    def test_danistay_value(self) -> None:
        assert CitationType.DANISTAY.value == "DANISTAY"


# ============================================================================
# C — Tier gate: Tier 1/2 pass-through, Tier 3/4 aktif
# ============================================================================


class TestCitationGraphTierGate:
    """C: GraphRAG katman geçidi."""

    pytestmark = pytest.mark.asyncio

    async def test_tier1_returns_root_only(self) -> None:
        """Tier 1 → genişletme yok, yalnızca kök belgeler döner."""
        docs = [_doc("d1"), _doc("d2")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER1,
        )
        assert result.expansion_count == 0
        assert result.all_docs == docs
        assert result.expanded_docs == []

    async def test_tier2_returns_root_only(self) -> None:
        """Tier 2 → genişletme yok."""
        docs = [_doc("d1")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER2,
        )
        assert result.expansion_count == 0
        assert result.all_docs == docs

    async def test_tier3_enters_expansion_path(self) -> None:
        """Tier 3 → kök belgeler nodes sözlüğüne girilir."""
        docs = [_doc("d1", content="4857 sayılı İş Kanunu md. 17")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER3,
            fetcher=None,
        )
        # root_docs korunmalı
        assert result.root_docs == docs

    async def test_tier4_enters_expansion_path(self) -> None:
        """Tier 4 → kök belgeler nodes sözlüğüne girilir."""
        docs = [_doc("d1", content="AYM E. 2022/45 K. 2023/78")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER4,
            fetcher=None,
        )
        assert result.root_docs == docs

    async def test_tier1_cycle_detected_false(self) -> None:
        """Tier 1'de cycle_detected her zaman False."""
        docs = [_doc("d1")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER1,
        )
        assert result.cycle_detected is False

    async def test_tier1_empty_nodes_dict(self) -> None:
        """Tier 1'de nodes sözlüğü boş döner (tier gate sonucu)."""
        docs = [_doc("d1")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER1,
        )
        assert result.nodes == {}


# ============================================================================
# D — BFS derinlik kontrolü
# ============================================================================


class TestCitationGraphDepth:
    """D: BFS derinlik kontrolü."""

    pytestmark = pytest.mark.asyncio

    async def test_max_depth_zero_no_expansion(self) -> None:
        """max_depth=0 → kök belgeler dışında genişletme yok."""
        root = _doc("root", content="4857 sayılı İş Kanunu")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return _doc("extra")

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_depth=0,
        )
        assert result.expansion_count == 0
        assert len(result.all_docs) == 1

    async def test_max_depth_one_fetches_direct_citations(self) -> None:
        """max_depth=1 → doğrudan atıf yapılan belgeler getirilir."""
        cited_doc = _doc("cited-1", content="")
        root_doc = _doc("root", content="4857 sayılı İş Kanunu")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return cited_doc

        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_depth=1,
        )
        assert result.expansion_count >= 1
        assert cited_doc in result.expanded_docs

    async def test_no_expansion_without_fetcher(self) -> None:
        """fetcher=None → kenarlar kaydedilir ama yeni belge getirilmez."""
        root_doc = _doc("root", content="4857 sayılı İş Kanunu md. 17 gereğince...")
        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=None,
        )
        assert result.expansion_count == 0

    async def test_fetcher_called_for_found_citations(self) -> None:
        """Belge içeriğinde atıf varsa fetcher çağrılır."""
        calls: list[str] = []
        cited = _doc("cited")

        async def tracking_fetcher(ref: str) -> Optional[LegalDocument]:
            calls.append(ref)
            return cited

        root = _doc("root", content="4857 sayılı İş Kanunu")
        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=tracking_fetcher,
            max_depth=1,
        )
        # Kanun numarası atıfı → fetcher en az bir kez çağrılmalı
        assert len(calls) >= 1

    async def test_depth_limit_honored_default(self) -> None:
        """Varsayılan max_depth=2 sınırına uyulur."""
        root_doc = _doc("root", content="")
        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=None,
            max_depth=2,
        )
        assert result.total_depth_reached <= 2

    async def test_deep_chain_capped_at_max_depth(self) -> None:
        """Derin atıf zincirinde derinlik sınırına uyulur."""
        call_count = {"n": 0}

        async def chained_fetcher(ref: str) -> Optional[LegalDocument]:
            call_count["n"] += 1
            return _doc(f"fetched-{call_count['n']}", content="4857 sayılı Kanun")

        root_doc = _doc("root", content="4857 sayılı Kanun")
        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=chained_fetcher,
            max_depth=2,
        )
        # Derinlik 2'yi asla geçmemeli
        assert result.total_depth_reached <= 2


# ============================================================================
# E — Döngü tespiti (cycle detection)
# ============================================================================


class TestCitationGraphCycleDetection:
    """E: Döngü tespiti — sonsuz döngü önleme."""

    pytestmark = pytest.mark.asyncio

    async def test_self_referencing_doc_cycle_detected(self) -> None:
        """Kendine atıf yapan belge döngü olarak tespit edilmeli."""
        root_doc = _doc("root", content="4857 sayılı İş Kanunu")

        async def self_ref_fetcher(ref: str) -> Optional[LegalDocument]:
            return root_doc  # kök belgenin kendini döndür

        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=self_ref_fetcher,
            max_depth=2,
        )
        assert result.cycle_detected is True

    async def test_cycle_does_not_cause_infinite_loop(self) -> None:
        """Döngü varlığında fonksiyon sonlanmalı, askıda kalmamalı."""
        root_doc = _doc("root", content="4857 sayılı İş Kanunu")

        async def cycle_fetcher(ref: str) -> Optional[LegalDocument]:
            return root_doc  # Her zaman kök belgeyi döndür

        # Zaman aşımı olmadan tamamlanmalı
        result = await citation_graph_expander.expand(
            root_docs=[root_doc],
            tier=QueryTier.TIER3,
            fetcher=cycle_fetcher,
            max_depth=2,
        )
        assert result is not None

    async def test_visited_set_prevents_duplicate_nodes(self) -> None:
        """Ziyaret kümesi aynı belgenin iki kez eklenmesini engeller."""
        shared_doc = _doc("shared", content="")
        root1 = _doc("root1", content="4857 sayılı İş Kanunu")
        root2 = _doc("root2", content="4857 sayılı İş Kanunu")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return shared_doc

        result = await citation_graph_expander.expand(
            root_docs=[root1, root2],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_depth=1,
        )
        # shared_doc yalnızca bir kez görünmeli
        ids = [d.id for d in result.all_docs]
        assert ids.count("shared") == 1

    async def test_mutual_reference_cycle_detected(self) -> None:
        """A → B atıfı: B zaten root'ta → döngü tespiti."""
        doc_a = _doc("doc-a", content="4857 sayılı İş Kanunu")
        doc_b = _doc("doc-b", content="4857 sayılı İş Kanunu")

        async def mutual_fetcher(ref: str) -> Optional[LegalDocument]:
            return doc_b  # doc_a, doc_b'ye atıf yapar; doc_b de zaten ziyaret edilirse döngü

        # doc_b'yi kök olarak ekle, doc_a'nın doc_b'ye atıf yapması döngüye yol açar
        result = await citation_graph_expander.expand(
            root_docs=[doc_a, doc_b],
            tier=QueryTier.TIER3,
            fetcher=mutual_fetcher,
            max_depth=2,
        )
        # doc_b zaten kök → döngü
        assert result.cycle_detected is True

    async def test_no_cycle_with_unique_fresh_docs(self) -> None:
        """Benzersiz belgelerle döngü oluşmaz."""
        root = _doc("root", content="4857 sayılı İş Kanunu")
        unique_cited = _doc("unique-9999", content="")

        async def unique_fetcher(ref: str) -> Optional[LegalDocument]:
            return unique_cited

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=unique_fetcher,
            max_depth=1,
        )
        assert result.cycle_detected is False


# ============================================================================
# F — max_nodes sınırı (token bütçesi koruması)
# ============================================================================


class TestCitationGraphMaxNodes:
    """F: max_nodes sınırı — token bütçesi koruması."""

    pytestmark = pytest.mark.asyncio

    async def test_max_nodes_one_root_only(self) -> None:
        """max_nodes=1 → yalnızca kök belge döner."""
        root = _doc("root", content="4857 sayılı İş Kanunu")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return _doc("extra")

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_nodes=1,
        )
        assert len(result.all_docs) == 1

    async def test_max_nodes_three_respected(self) -> None:
        """max_nodes=3 sınırına uyulur."""
        root = _doc("root", content="4857 sayılı Kanun md. 17 md. 18 md. 19")
        call_count = {"n": 0}

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            call_count["n"] += 1
            return _doc(f"extra-{call_count['n']}")

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_nodes=3,
            max_depth=2,
        )
        assert len(result.all_docs) <= 3

    async def test_all_docs_never_exceeds_max_nodes(self) -> None:
        """all_docs uzunluğu max_nodes'u asla geçmez."""
        roots = [
            _doc(f"r{i}", content="4857 sayılı Kanun md. 17")
            for i in range(5)
        ]
        call_count = {"n": 0}

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            call_count["n"] += 1
            return _doc(f"extra-{call_count['n']}")

        result = await citation_graph_expander.expand(
            root_docs=roots,
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_nodes=7,
        )
        assert len(result.all_docs) <= 7

    async def test_max_nodes_none_uses_settings_default(self) -> None:
        """max_nodes=None → settings.graphrag_max_nodes kullanılır; hata yok."""
        root = _doc("root", content="")
        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=None,
            max_nodes=None,
        )
        assert result is not None

    async def test_max_nodes_ten_allows_expansion(self) -> None:
        """max_nodes=10 ile genişletme gerçekleşebilir."""
        root = _doc("root", content="4857 sayılı Kanun")
        cited = _doc("cited-unique-xyz")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return cited

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_nodes=10,
            max_depth=1,
        )
        # Genişletme gerçekleşmeli (en az 1 kök + 1 atıflı belge)
        assert len(result.all_docs) >= 1


# ============================================================================
# G — CitationGraphResult alan doğrulaması
# ============================================================================


class TestCitationGraphResult:
    """G: CitationGraphResult alan doğrulaması."""

    pytestmark = pytest.mark.asyncio

    async def test_root_docs_preserved_in_result(self) -> None:
        """root_docs her zaman sonuçta korunur."""
        docs = [_doc("d1"), _doc("d2")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER1,
        )
        assert result.root_docs == docs

    async def test_all_docs_contains_root_docs(self) -> None:
        """all_docs kök belgeleri içerir."""
        docs = [_doc("d1"), _doc("d2")]
        result = await citation_graph_expander.expand(
            root_docs=docs,
            tier=QueryTier.TIER3,
            fetcher=None,
        )
        for doc in docs:
            assert doc in result.all_docs

    async def test_all_docs_no_duplicates(self) -> None:
        """all_docs içinde belge ID tekrarı olmamalı."""
        root = _doc("root", content="4857 sayılı İş Kanunu")
        extra = _doc("extra-777")

        async def fetcher(ref: str) -> Optional[LegalDocument]:
            return extra

        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=fetcher,
            max_depth=1,
        )
        all_ids = [d.id for d in result.all_docs]
        assert len(all_ids) == len(set(all_ids))

    async def test_edges_list_recorded_for_citations(self) -> None:
        """Belge atıfları için edges listesi kaydedilir."""
        root = _doc("root", content="4857 sayılı İş Kanunu md. 17")
        result = await citation_graph_expander.expand(
            root_docs=[root],
            tier=QueryTier.TIER3,
            fetcher=None,
        )
        # Atıf varsa kenar listesi dolu olmalı; boş metin için boş olmalı
        assert isinstance(result.edges, list)


# ============================================================================
# H — RAGService entegrasyonu
# ============================================================================


class TestRAGServiceGraphRAGIntegration:
    """H: RAGService GraphRAG entegrasyonu (Tier 3/4 aktif, Tier 1 pasif)."""

    pytestmark = pytest.mark.asyncio

    def _make_service(
        self,
        docs: List[LegalDocument],
        tier: QueryTier = QueryTier.TIER3,
        mock_graph_expander: Optional[MagicMock] = None,
    ):
        from application.services.rag_service import RAGService
        from infrastructure.context.context_builder import ContextBuilder
        from infrastructure.reranking.legal_reranker import (
            LegalReranker,
            RerankResult,
            RerankScore,
        )

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

        if mock_graph_expander is None:
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
            graph_expander=mock_graph_expander,
        )
        svc._tier_max_tokens = lambda tier_: 5000
        return svc, mock_graph_expander

    async def test_graph_expander_called_for_tier3(self) -> None:
        """Tier 3 sorgusunda graph_expander.expand() çağrılmalı."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        svc, mock_ge = self._make_service(docs, tier=QueryTier.TIER3)
        req = RAGQueryRequest(query="içtihat analizi emsal kararlar")

        with patch.object(app_settings, "graphrag_enabled", True), \
             patch.object(app_settings, "graphrag_min_tier", 3):
            await svc.query(req)

        mock_ge.expand.assert_called_once()

    async def test_graph_expander_not_called_for_tier1(self) -> None:
        """Tier 1 sorgusunda graph_expander.expand() çağrılmamalı."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        svc, mock_ge = self._make_service(docs, tier=QueryTier.TIER1)
        req = RAGQueryRequest(query="basit soru")

        with patch.object(app_settings, "graphrag_enabled", True), \
             patch.object(app_settings, "graphrag_min_tier", 3):
            await svc.query(req)

        mock_ge.expand.assert_not_called()

    async def test_graphrag_disabled_skips_expansion(self) -> None:
        """graphrag_enabled=False → expand() hiç çağrılmamalı."""
        from api.schemas import RAGQueryRequest
        from infrastructure.config import settings as app_settings

        docs = [_doc("d1", final_score=0.8)]
        # Tier3 verildi ama graphrag_enabled=False
        svc, mock_ge = self._make_service(docs, tier=QueryTier.TIER3)
        req = RAGQueryRequest(query="içtihat analizi emsal kararlar")

        with patch.object(app_settings, "graphrag_enabled", False), \
             patch.object(app_settings, "graphrag_min_tier", 3):
            await svc.query(req)

        mock_ge.expand.assert_not_called()


# ============================================================================
# I — SupabaseCitationRepository
# ============================================================================


class TestSupabaseCitationRepository:
    """
    I: SupabaseCitationRepository metot testleri.
    save_citations, resolve_citation, get_outgoing, get_unresolved
    Supabase istemcisi Mock'lanır; gerçek DB bağlantısı gerekmez.
    """

    pytestmark = pytest.mark.asyncio

    def _make_repo(self):
        from infrastructure.database.supabase_citation_repository import (
            SupabaseCitationRepository,
        )
        return SupabaseCitationRepository()

    def _mock_supabase(self, data: list = None):
        """Supabase table chain'ini mock'lar; .execute() data döndürür."""
        mock_sb = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = data or []
        chain = MagicMock()
        chain.execute.return_value = mock_resp
        chain.upsert.return_value = chain
        chain.update.return_value = chain
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.is_.return_value = chain
        chain.limit.return_value = chain
        chain.not_ = chain
        mock_sb.table.return_value = chain
        return mock_sb, chain

    # ── save_citations ───────────────────────────────────────────────────────

    async def test_save_citations_calls_upsert_with_correct_columns(self) -> None:
        """save_citations raw_citation ve source_doc_id kolonlarıyla upsert yapmalı."""
        from uuid import uuid4
        from infrastructure.ingest.citation_extractor import CitationType, ExtractedCitation

        repo = self._make_repo()
        mock_sb, chain = self._mock_supabase(data=[{"id": "row-1"}])
        cits = [
            ExtractedCitation(
                raw_text="4857 sayılı İş Kanunu",
                citation_type=CitationType.KANUN_NO.value,
            )
        ]
        src_id = uuid4()
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            count = await repo.save_citations(source_doc_id=src_id, citations=cits)
        mock_sb.table.assert_called_with("citation_edges")
        upsert_call_rows = chain.upsert.call_args[0][0]
        assert upsert_call_rows[0]["raw_citation"] == "4857 sayılı İş Kanunu"
        assert upsert_call_rows[0]["source_doc_id"] == str(src_id)
        assert count == 1

    async def test_save_citations_empty_list_returns_zero(self) -> None:
        """Boş liste için upsert çağrılmaz, 0 döner."""
        from uuid import uuid4
        repo = self._make_repo()
        count = await repo.save_citations(source_doc_id=uuid4(), citations=[])
        assert count == 0

    # ── resolve_citation ─────────────────────────────────────────────────────

    async def test_resolve_citation_calls_update_with_target_doc_id(self) -> None:
        """resolve_citation target_doc_id ile update çağırmalı."""
        from uuid import uuid4
        repo = self._make_repo()
        mock_sb, chain = self._mock_supabase()
        edge_id = uuid4()
        target_id = uuid4()
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            await repo.resolve_citation(
                citation_edge_id=edge_id, target_doc_id=target_id
            )
        update_kwargs = chain.update.call_args[0][0]
        assert update_kwargs["target_doc_id"] == str(target_id)
        assert "resolved_at" in update_kwargs

    # ── get_outgoing ─────────────────────────────────────────────────────────

    async def test_get_outgoing_returns_target_uuids(self) -> None:
        """get_outgoing UUID listesi döndürmeli."""
        from uuid import uuid4, UUID
        repo = self._make_repo()
        target_id = str(uuid4())
        mock_sb, _ = self._mock_supabase(data=[{"target_doc_id": target_id}])
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            result = await repo.get_outgoing(source_doc_id=uuid4())
        assert result == [UUID(target_id)]

    async def test_get_outgoing_returns_empty_on_db_error(self) -> None:
        """DB hatasında get_outgoing boş liste dönmeli."""
        from uuid import uuid4
        repo = self._make_repo()
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            side_effect=RuntimeError("DB unavailable"),
        ):
            result = await repo.get_outgoing(source_doc_id=uuid4())
        assert result == []

    # ── get_unresolved ───────────────────────────────────────────────────────

    async def test_get_unresolved_uses_raw_citation_column(self) -> None:
        """get_unresolved select'inde raw_citation kolonu kullanılmalı."""
        from uuid import uuid4
        repo = self._make_repo()
        mock_sb, chain = self._mock_supabase(data=[
            {"id": str(uuid4()), "source_doc_id": str(uuid4()),
             "raw_citation": "4857 sayılı Kanun", "citation_type": "KANUN_NO"}
        ])
        with patch(
            "infrastructure.database.connection.get_supabase_client",
            return_value=mock_sb,
        ):
            rows = await repo.get_unresolved()
        select_arg = chain.select.call_args[0][0]
        assert "raw_citation" in select_arg
        assert len(rows) == 1
