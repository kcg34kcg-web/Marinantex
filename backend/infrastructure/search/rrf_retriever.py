"""
RRF Retriever — Step 11: Hibrit Arama (Vektör + BM25 + RRF Füzyon)
====================================================================
Reciprocal Rank Fusion (RRF) algoritmasıyla vektör araması ve
anahtar kelime aramasını birleştiren hibrit retrieval istemcisi.

Mimari:
    1. SORGU GENİŞLEME: SynonymStore aracılığıyla BM25 sorgusu, Türkçe
       eşanlamlı terimlerle zenginleştirilir.
    2. PARALEL ARAMA: Vektör araması (semantik) ve BM25 araması
       (anahtar kelime) asyncio.gather() ile eş zamanlı çalıştırılır.
    3. RRF FÜZYON: Her iki liste Reciprocal Rank Fusion ile birleştirilir.
       rrf_score(d) = Σ 1/(k + rank_i(d))
       k=60 (Cormack & al., 2009) — sıralama hassasiyetini dengeler.
    4. SON SIRALAMA: RRF skoru üzerinden desc sıralama, min_score filtresi.

RRF Neden Etkilidir?
    - Vektör araması: anlamsal benzerliği yakalar ama nadir terimleri kaçırır.
    - BM25 (keyword): tam eşleşmeyi yakalar ama anlamsal ilişkileri kaçırır.
    - RRF: ikisini de dikkate alır, ağırlıklandırma yerine sıralama pozisyonu
      kullanır — dolayısıyla normalize edilmiş skorlara gerek yoktur.

Supabase Bağlantısı:
    Bu sınıf mevcut RetrieverClient.search()'ü yeniden kullanır:
    - Vektör araması için: embedding + query_text birlikte gönderilir.
    - BM25 araması için: zero-vector embedding + genişletilmiş query_text.
    Bu tasarım, mevcut SQL fonksiyonuna (hybrid_legal_search) dokunmadan
    Step 11'i uygular.

Notlar:
    - RRFRetriever, RetrieverClient'ı SARMALAR (wrapper), onun yerine GEÇMEZ.
    - settings.rrf_enabled=False olduğunda doğrudan RetrieverClient.search()'e düşer.
    - Zero-Downtime: eski RetrieverClient.search() çağrısı değişmez.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Tuple

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings
from infrastructure.retrieval.retrieval_client import RetrieverClient, retriever_client
from infrastructure.search.synonym_store import SynonymStore, synonym_store

logger = logging.getLogger("babylexit.search.rrf")


# ============================================================================
# RRF Algoritması — saf fonksiyonlar, yan etkisiz
# ============================================================================

def rrf_score(rank: int, k: int = 60) -> float:
    """
    Tekil bir sıralama pozisyonunun RRF katkısını hesaplar.

    Formül: 1 / (k + rank)
    Rank 1-tabanlıdır (en iyi belge → rank=1).

    Args:
        rank: Belgenenin listede 1-tabanlı pozisyonu.
        k:    Düzeltme sabiti (varsayılan 60 — Cormack et al., 2009).

    Returns:
        Float [0, 1/k] aralığında RRF katkı skoru.
    """
    if rank < 1:
        raise ValueError(f"rank must be ≥ 1, got {rank}")
    return 1.0 / (k + rank)


def reciprocal_rank_fusion(
    ranked_lists: List[List[LegalDocument]],
    k: int = 60,
    max_results: Optional[int] = None,
) -> List[Tuple[LegalDocument, float]]:
    """
    Birden fazla sıralı belge listesini RRF ile birleştirir.

    Bir belge birden fazla listede görünebilir; her listedeki sıralamasının
    RRF katkıları toplanır.  Sonuç desc sıralanmış (belge, rrf_score) çiftidir.

    Kimlik (id) eşleşmesi temel alınır — aynı ID'li belgeler çakışır.
    Çakışan belgelerde en yüksek final_score taşıyan nesne korunur.

    Args:
        ranked_lists: Her biri desc sıralı LegalDocument listesi.
        k:            RRF düzeltme sabiti.
        max_results:  Döndürülecek maksimum belge sayısı (None = hepsi).

    Returns:
        List[(LegalDocument, rrf_score)] azalan rrf_score sırasında.
    """
    # id → (doc, kümülatif_rrf_skoru)
    scores: Dict[str, Tuple[LegalDocument, float]] = {}

    for ranked in ranked_lists:
        for rank_idx, doc in enumerate(ranked, start=1):
            contribution = rrf_score(rank_idx, k)
            if doc.id in scores:
                existing_doc, existing_score = scores[doc.id]
                # Birden fazla listede varsa: skorları topla, en iyi doc'u koru
                best_doc = (
                    doc if doc.final_score >= existing_doc.final_score
                    else existing_doc
                )
                scores[doc.id] = (best_doc, existing_score + contribution)
            else:
                scores[doc.id] = (doc, contribution)

    # Azalan RRF skoru ile sırala
    sorted_docs = sorted(scores.values(), key=lambda x: x[1], reverse=True)

    if max_results is not None:
        sorted_docs = sorted_docs[:max_results]

    logger.debug(
        "RRF_FUSION | lists=%d | total_unique_docs=%d | returned=%d | k=%d",
        len(ranked_lists),
        len(scores),
        len(sorted_docs),
        k,
    )
    return sorted_docs


def build_expanded_query(query: str, store: SynonymStore) -> str:
    """
    SynonymStore ile sorguyu eşanlamlı terimlerle genişletir.

    Orijinal sorguyu korur ve ek eşanlamları boşlukla birleştirir.
    BM25 araması bu zenginleştirilmiş metni kullanır.

    Args:
        query: Orijinal ham sorgu.
        store: SynonymStore singleton.

    Returns:
        Genişletilmiş sorgu metni (orijinal + eşanlamlar).
    """
    expanded_terms = store.expand_query(query)
    # Orijinal sorgu her zaman başta gelir
    extra = " ".join(t for t in sorted(expanded_terms) if t not in query.lower())
    expanded = f"{query} {extra}".strip() if extra else query

    if extra:
        logger.debug(
            "QUERY_EXPANDED | original=%r | extra_terms=%d | expanded_len=%d",
            query[:60], len(expanded_terms), len(expanded),
        )
    return expanded


# ============================================================================
# RRFRetriever
# ============================================================================

@dataclass
class RRFSearchResult:
    """
    RRF füzyon aramasının sonucu.

    Attributes:
        documents:        RRF skoru ile sıralanmış belgeler.
        rrf_scores:       Her belge için RRF skoru (doc.id → score).
        semantic_count:   Vektör aramasından gelen belge sayısı.
        keyword_count:    BM25 aramasından gelen belge sayısı.
        expanded_query:   BM25 için kullanılan genişletilmiş sorgu.
        fusion_applied:   True = RRF çalıştı, False = tek kaynak fallback.
    """
    documents: List[LegalDocument] = field(default_factory=list)
    rrf_scores: Dict[str, float] = field(default_factory=dict)
    semantic_count: int = 0
    keyword_count: int = 0
    expanded_query: str = ""
    fusion_applied: bool = False


class RRFRetriever:
    """
    Hibrit RRF arama istemcisi.

    Mevcut ``RetrieverClient.search()``'ü iki kez çağırır:
      1. Tam embedding + orijinal sorgu → semantik sonuçlar
      2. Sıfır vektör + genişletilmiş sorgu → BM25 ağırlıklı sonuçlar
    Sonuçları RRF ile birleştirir.

    settings.rrf_enabled=False iken yalnızca semantik aramayı kullanır
    (RetrieverClient.search() ile eşdeğer davranış — sıfır bozulma).

    Kullanım:
        rrf = RRFRetriever()
        result = await rrf.search(
            embedding=vec,
            query_text="ihbar tazminatı nasıl hesaplanır?",
            case_id="uuid...",
            max_sources=10,
            min_score=0.20,
        )
        docs = result.documents
    """

    def __init__(
        self,
        retriever: Optional[RetrieverClient] = None,
        store: Optional[SynonymStore] = None,
    ) -> None:
        self._retriever: RetrieverClient = retriever or retriever_client
        self._store: SynonymStore = store or synonym_store
        self._k: int = settings.rrf_k
        logger.info(
            "RRFRetriever initialised | rrf_enabled=%s | k=%d | synonym_expansion=%s",
            settings.rrf_enabled,
            self._k,
            settings.synonym_expansion_enabled,
        )

    @staticmethod
    def _lane_weight(value: object, default: float = 1.0) -> float:
        try:
            casted = float(value)
        except Exception:
            casted = default
        return casted if casted > 0.0 else default

    async def search(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        min_score: float,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,
        law_domain: Optional[str] = None,
        global_legal_only: bool = False,
    ) -> RRFSearchResult:
        """
        Hibrit RRF araması.

        rrf_enabled=False ise sadece semantik arama yapar (eski davranış).
        synonym_expansion_enabled=False ise BM25 sorgu genişlemesi atlanır.

        Args:
            embedding:   Query vektörü (1536-dim).
            query_text:  Ham sorgu metni.
            case_id:     Dava kapsamı (opsiyonel).
            max_sources: Her aramadan istenecek maksimum belge sayısı.
            min_score:   Minimum final_score filtresi.
            event_date:  Lehe kanun / time-travel için olay tarihi (Step 10).
            bureau_id:   Büro izolasyonu (Step 6).
            law_domain:  Hukuk alanı kodu (Gap 2: CEZA/IDARI_CEZA/VERGI_CEZA için
                         domain-specific k=rrf_k_ceza kullanılır).
            global_legal_only:
                         Step 13 global corpus enforcement flag.
                         True -> retriever.global_legal_search()
                         False -> retriever.search()

        Returns:
            RRFSearchResult
        """
        _search_fn = (
            self._retriever.global_legal_search
            if global_legal_only
            else self._retriever.search
        )

        # ── Fallback: RRF devre dışıysa sadece semantik ──────────────────
        if not settings.rrf_enabled:
            docs = await _search_fn(
                embedding=embedding,
                query_text=query_text,
                case_id=case_id,
                max_sources=max_sources,
                min_score=min_score,
                event_date=event_date,
                bureau_id=bureau_id,
            )
            return RRFSearchResult(
                documents=docs,
                rrf_scores={d.id: d.final_score for d in docs},
                semantic_count=len(docs),
                keyword_count=0,
                expanded_query=query_text,
                fusion_applied=False,
            )

        # ── Sorgu genişletme ──────────────────────────────────────────────
        expanded_query = (
            build_expanded_query(query_text, self._store)
            if settings.synonym_expansion_enabled
            else query_text
        )
        semantic_weight = self._lane_weight(
            getattr(settings, "rrf_semantic_weight", 1.0),
            default=1.0,
        )
        keyword_weight = self._lane_weight(
            getattr(settings, "rrf_keyword_weight", 1.0),
            default=1.0,
        )

        # Preferred path: DB-side weighted RRF fusion (single RPC).
        if isinstance(self._retriever, RetrieverClient):
            try:
                rpc_query_text = expanded_query
                rpc_docs = await self._retriever.search_rrf(
                    embedding=embedding,
                    query_text=rpc_query_text,
                    case_id=case_id,
                    max_sources=max_sources,
                    min_score=min_score,
                    event_date=event_date,
                    bureau_id=bureau_id,
                    law_domain=law_domain,
                    semantic_weight=semantic_weight,
                    keyword_weight=keyword_weight,
                    global_legal_only=global_legal_only,
                )
                # Guardrail: synonym-expanded plain text can over-constrain
                # plainto_tsquery() in some corpora. If expanded query yields
                # no hits, retry once with the original query text.
                if not rpc_docs and expanded_query != query_text:
                    logger.warning(
                        "RRF_RPC_EXPANDED_EMPTY_RETRY_ORIGINAL | query_len=%d | expanded_len=%d",
                        len(query_text),
                        len(expanded_query),
                    )
                    rpc_query_text = query_text
                    rpc_docs = await self._retriever.search_rrf(
                        embedding=embedding,
                        query_text=rpc_query_text,
                        case_id=case_id,
                        max_sources=max_sources,
                        min_score=min_score,
                        event_date=event_date,
                        bureau_id=bureau_id,
                        law_domain=law_domain,
                        semantic_weight=semantic_weight,
                        keyword_weight=keyword_weight,
                        global_legal_only=global_legal_only,
                    )
                return RRFSearchResult(
                    documents=rpc_docs,
                    rrf_scores={d.id: d.final_score for d in rpc_docs},
                    semantic_count=len(rpc_docs),
                    keyword_count=len(rpc_docs),
                    expanded_query=rpc_query_text,
                    fusion_applied=True,
                )
            except Exception as exc:
                logger.warning(
                    "RRF_RPC_FALLBACK_TO_DUAL_SEARCH | reason=%s",
                    exc,
                )

        # ── Paralel arama ─────────────────────────────────────────────────
        # İstek 1: semantik vektör araması (tam embedding, orijinal sorgu)
        # İstek 2: anahtar kelime ağırlıklı arama (sıfır vektör, genişletilmiş sorgu)
        zero_vector = [0.0] * len(embedding)

        try:
            semantic_task = _search_fn(
                embedding=embedding,
                query_text=query_text,
                case_id=case_id,
                max_sources=max_sources,
                min_score=min_score,
                event_date=event_date,
                bureau_id=bureau_id,
            )
            keyword_task = _search_fn(
                embedding=zero_vector,
                query_text=expanded_query,
                case_id=case_id,
                max_sources=max_sources,
                min_score=min_score,
                event_date=event_date,
                bureau_id=bureau_id,
            )
            semantic_docs, keyword_docs = await asyncio.gather(
                semantic_task, keyword_task
            )
        except Exception as exc:
            # RRF araması başarısız olursa sadece semantik aramayı döndür
            logger.error(
                "RRF dual-search failed, falling back to semantic-only: %s",
                exc,
                exc_info=True,
            )
            docs = await _search_fn(
                embedding=embedding,
                query_text=query_text,
                case_id=case_id,
                max_sources=max_sources,
                min_score=min_score,
                event_date=event_date,
                bureau_id=bureau_id,
            )
            return RRFSearchResult(
                documents=docs,
                rrf_scores={d.id: d.final_score for d in docs},
                semantic_count=len(docs),
                keyword_count=0,
                expanded_query=expanded_query,
                fusion_applied=False,
            )

        # ── RRF Füzyon ────────────────────────────────────────────────────
        # Gap 2: domain'e göre k sabiti — CEZA/IDARI_CEZA/VERGI_CEZA için
        # rrf_k_ceza (varsayılan 40) kullanılır; diğer domain'ler settings.rrf_k
        # (varsayılan 60) kullanır.  Düşük k → sıralama farkı daha belirgin.
        result_docs, rrf_score_map = self.fuse_ranked_lists(
            ranked_lists=[semantic_docs, keyword_docs],
            max_sources=max_sources,
            min_score=min_score,
            law_domain=law_domain,
            lane_weights=[semantic_weight, keyword_weight],
        )

        logger.info(
            "RRF_SEARCH_COMPLETE | semantic=%d | keyword=%d | fused=%d | "
            "query_len=%d | case_id=%s | global_only=%s",
            len(semantic_docs),
            len(keyword_docs),
            len(result_docs),
            len(query_text),
            case_id,
            global_legal_only,
        )

        return RRFSearchResult(
            documents=result_docs,
            rrf_scores=rrf_score_map,
            semantic_count=len(semantic_docs),
            keyword_count=len(keyword_docs),
            expanded_query=expanded_query,
            fusion_applied=True,
        )

    def fuse_ranked_lists(
        self,
        ranked_lists: List[List[LegalDocument]],
        max_sources: int,
        min_score: float = 0.0,
        law_domain: Optional[str] = None,
        lane_weights: Optional[List[float]] = None,
    ) -> Tuple[List[LegalDocument], Dict[str, float]]:
        """
        Step 14 helper: fuse multiple ranked pools into a single ranked output.
        """
        weighted_lists: List[Tuple[List[LegalDocument], float]] = []
        for idx, ranked in enumerate(ranked_lists):
            if not ranked:
                continue
            weight = 1.0
            if lane_weights and idx < len(lane_weights):
                weight = self._lane_weight(lane_weights[idx], default=1.0)
            weighted_lists.append((ranked, weight))

        if not weighted_lists:
            return [], {}

        k = (
            settings.rrf_k_ceza
            if law_domain in ("CEZA", "IDARI_CEZA", "VERGI_CEZA")
            else self._k
        )
        score_map: Dict[str, float] = {}
        best_doc_map: Dict[str, LegalDocument] = {}
        for ranked, lane_weight in weighted_lists:
            for rank_idx, doc in enumerate(ranked, start=1):
                contribution = lane_weight * rrf_score(rank_idx, k)
                score_map[doc.id] = score_map.get(doc.id, 0.0) + contribution
                existing = best_doc_map.get(doc.id)
                if existing is None or doc.final_score >= existing.final_score:
                    best_doc_map[doc.id] = doc

        fused = sorted(
            ((best_doc_map[doc_id], score) for doc_id, score in score_map.items()),
            key=lambda x: x[1],
            reverse=True,
        )[:max_sources]

        if min_score > 0.0:
            fused = [(doc, rrf) for doc, rrf in fused if doc.final_score >= min_score]

        max_rrf = max((rrf for _, rrf in fused), default=1.0)
        if max_rrf > 0 and fused:
            fused = [(doc, rrf / max_rrf) for doc, rrf in fused]

        result_docs: List[LegalDocument] = []
        rrf_score_map: Dict[str, float] = {}
        for doc, rrf in fused:
            doc.final_score = rrf
            result_docs.append(doc)
            rrf_score_map[doc.id] = rrf

        return result_docs, rrf_score_map


# ============================================================================
# Module-level singleton
# ============================================================================

rrf_retriever = RRFRetriever()


