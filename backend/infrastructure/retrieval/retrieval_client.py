"""
Retrieval Client  —  Step 7
============================
Wraps the Supabase ``hybrid_legal_search`` RPC with three Step 7 additions:

1. CLIENT-SIDE SCORE RE-WEIGHTING
   The SQL function returns four raw component scores (semantic_score,
   keyword_score, recency_score, hierarchy_score).  Rather than trusting the
   SQL-hardcoded weights (0.45 / 0.30 / 0.10 / 0.15), we recompute
   ``final_score`` in Python using ``settings.retrieval_*_weight``.
   This lets operators tune relevance ranking without a DB migration.

2. BM25 KEYWORD SCORE NORMALISATION
   PostgreSQL's ``ts_rank_cd`` returns a float that can exceed 1.0 for
   documents with many keyword matches.  We clamp it to
   ``settings.retrieval_keyword_score_cap`` (default 1.0) before weighting.
   Weights are also normalised so they always sum to 1.0, even if the user
   sets non-standard values.

3. MUST-CITE INJECTION
   The ``case_must_cites`` table records documents that a lawyer has marked
   as mandatory for a given case (e.g. the governing statute).  These are
   fetched in a single extra query (no N+1) and injected at the TOP of the
   result list with their score boosted by ``settings.retrieval_must_cite_boost``.
   A must-cite doc that already scored above min_score is NOT duplicated;
   a below-threshold must-cite doc bypasses the score filter (it MUST appear).

SQL DEPENDENCY:
    hybrid_legal_search(query_embedding, query_text, case_scope, match_count)
        → returns semantic_score, keyword_score, recency_score, hierarchy_score,
          final_score, plus all LegalDocument columns.
    get_must_cite_documents(p_case_id)
        → added by rag_v2_step7_mustcite.sql migration.

ASYNC NOTE:
    supabase-py uses httpx under the hood and exposes a synchronous API.
    ``search()`` is declared async so callers can await it, but the Supabase
    call itself runs synchronously in the event loop.  For high-throughput
    production use, wrap with asyncio.get_event_loop().run_in_executor().
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException, status

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings
from infrastructure.database.connection import get_supabase_client

logger = logging.getLogger("babylexit.retrieval")


# ============================================================================
# Pure helper functions — no side effects, fully unit-testable
# ============================================================================

def normalise_keyword_score(score: float, cap: float = 1.0) -> float:
    """
    Clamps a BM25 ``ts_rank_cd`` score into [0, cap] then divides by cap
    to produce a value in [0, 1].

    ``ts_rank_cd`` can return values > 1 for documents with dense keyword
    matches.  Leaving them un-clamped would inflate their contribution in the
    weighted sum, biasing results toward documents that simply contain the
    query terms many times rather than semantically relevant ones.

    Args:
        score: Raw ``keyword_score`` from Supabase (≥ 0).
        cap:   Upper clamp bound (``settings.retrieval_keyword_score_cap``).

    Returns:
        Float in [0.0, 1.0].
    """
    if cap <= 0:
        return 0.0
    return min(score, cap) / cap


def recompute_final_score(
    semantic_score: float,
    keyword_score: float,
    recency_score: float,
    hierarchy_score: float,
    w_sem: float,
    w_kw: float,
    w_rec: float,
    w_hier: float,
    keyword_cap: float = 1.0,
    binding_boost: float = 0.0,
) -> float:
    """
    Recomputes the weighted final score from raw component scores.

    Normalises the input keyword_score via ``normalise_keyword_score`` and
    normalises the four weights so they always sum to 1.0 regardless of the
    configured values.

    Step 3 addition:
        ``binding_boost`` is added on top of the weighted sum for documents
        flagged as binding precedents (AYM, IBK, HGK, CGK, DANISTAY_IDDK).
        The combined score is capped at 1.0.

    Args:
        semantic_score:   Cosine-distance score from pgvector [0, 1].
        keyword_score:    Raw BM25 ts_rank_cd score (may exceed 1.0).
        recency_score:    Recency decay score [0, 1].
        hierarchy_score:  Court authority score [0, 1]  (Step 3).
        w_sem / w_kw / w_rec / w_hier: Raw weight values (unnormalised).
        keyword_cap:      Cap applied before normalising keyword_score.
        binding_boost:    Hard boost for binding-precedent docs (Step 3).

    Returns:
        Float in [0.0, 1.0].  Returns 0.0 if all weights are zero.
    """
    total_w = w_sem + w_kw + w_rec + w_hier
    if total_w <= 0:
        return 0.0

    kw_norm = normalise_keyword_score(keyword_score, keyword_cap)

    score = (
        (w_sem / total_w) * semantic_score
        + (w_kw / total_w) * kw_norm
        + (w_rec / total_w) * recency_score
        + (w_hier / total_w) * hierarchy_score
    )
    return max(0.0, min(1.0, score + binding_boost))


def row_to_legal_document(row: dict, final_score: float) -> LegalDocument:
    """
    Maps a Supabase RPC response row dict to a ``LegalDocument`` entity.

    Step 3: also maps chamber, majority_type, dissent_present, norm_hierarchy.

    Args:
        row:         Dict from hybrid_legal_search or must-cite RPC response.
        final_score: The (possibly recomputed) final relevance score.

    Returns:
        ``LegalDocument`` instance with all fields populated.
    """
    return LegalDocument(
        id=str(row["id"]),
        case_id=str(row.get("case_id", "")),
        content=str(row["content"]),
        file_path=str(row.get("file_path", "")),
        created_at=row.get("created_at"),
        source_url=row.get("source_url"),
        version=row.get("version"),
        collected_at=row.get("collected_at"),
        court_level=row.get("court_level"),
        ruling_date=row.get("ruling_date"),
        citation=row.get("citation"),
        norm_hierarchy=row.get("norm_hierarchy"),
        # Step 3: detailed authority fields
        chamber=row.get("chamber"),
        majority_type=row.get("majority_type"),
        dissent_present=bool(row.get("dissent_present", False)),
        # Step 4: granular versioning + AYM cancellation
        effective_date=row.get("effective_date"),
        expiry_date=row.get("expiry_date"),
        aym_iptal_durumu=row.get("aym_iptal_durumu"),
        iptal_yururluk_tarihi=row.get("iptal_yururluk_tarihi"),
        aym_karar_no=row.get("aym_karar_no"),
        aym_karar_tarihi=row.get("aym_karar_tarihi"),
        semantic_score=float(row.get("semantic_score", 0.0)),
        keyword_score=float(row.get("keyword_score", 0.0)),
        recency_score=float(row.get("recency_score", 0.0)),
        hierarchy_score=float(row.get("hierarchy_score", 0.0)),
        final_score=final_score,
        bureau_id=row.get("bureau_id"),  # Step 6: tenant isolation
    )


def merge_must_cites(
    base_docs: List[LegalDocument],
    must_cite_docs: List[LegalDocument],
    boost: float = 0.05,
) -> List[LegalDocument]:
    """
    Injects must-cite documents at the front of the result list.

    Rules:
        1. Each must-cite doc's score is boosted by ``boost`` (capped at 1.0).
        2. If a must-cite doc is already in ``base_docs`` (same id), it is
           removed from its original position and re-inserted at the front
           with the boosted score.
        3. The final list is sorted descending by final_score, with must-cites
           always appearing before any non-must-cite with the same score.

    Args:
        base_docs:      Scored docs from hybrid_legal_search, sorted desc.
        must_cite_docs: Docs from case_must_cites, in any order.
        boost:          Score addend for must-cite docs.

    Returns:
        Merged list: must-cites first (boosted), then remaining base_docs,
        all in descending final_score order.
    """
    must_cite_ids = {doc.id for doc in must_cite_docs}

    # Boost must-cite scores
    boosted: List[LegalDocument] = []
    for doc in must_cite_docs:
        boosted.append(
            LegalDocument(
                id=doc.id,
                case_id=doc.case_id,
                content=doc.content,
                file_path=doc.file_path,
                created_at=doc.created_at,
                source_url=doc.source_url,
                version=doc.version,
                collected_at=doc.collected_at,
                court_level=doc.court_level,
                ruling_date=doc.ruling_date,
                citation=doc.citation,
                norm_hierarchy=doc.norm_hierarchy,
                # Step 3: authority fields
                chamber=doc.chamber,
                majority_type=doc.majority_type,
                dissent_present=doc.dissent_present,
                # Step 4: versioning + AYM cancellation
                effective_date=doc.effective_date,
                expiry_date=doc.expiry_date,
                aym_iptal_durumu=doc.aym_iptal_durumu,
                iptal_yururluk_tarihi=doc.iptal_yururluk_tarihi,
                aym_karar_no=doc.aym_karar_no,
                aym_karar_tarihi=doc.aym_karar_tarihi,
                semantic_score=doc.semantic_score,
                keyword_score=doc.keyword_score,
                recency_score=doc.recency_score,
                hierarchy_score=doc.hierarchy_score,
                final_score=min(1.0, doc.final_score + boost),
                bureau_id=doc.bureau_id,  # Step 6: preserve tenant ownership
            )
        )

    # Base docs minus any that are already in must-cites (de-duplicate)
    remaining = [d for d in base_docs if d.id not in must_cite_ids]

    # Merge and sort — stable sort preserves must-cite ordering on ties
    merged = boosted + remaining
    merged.sort(key=lambda d: d.final_score, reverse=True)
    return merged


def _filter_by_bureau(
    documents: list,
    bureau_id: Optional[str],
) -> list:
    """
    Defense-in-depth: removes documents whose ``bureau_id`` doesn’t
    match the requester’s bureau.

    Documents with ``bureau_id=None`` are public (shared across tenants)
    and are always included.
    This function is a NO-OP when ``bureau_id is None`` (no tenant scope).

    Args:
        documents: LegalDocument instances returned by Supabase.
        bureau_id: The caller’s bureau UUID.  None → no filtering.

    Returns:
        Filtered list — cross-tenant documents removed.
    """
    if bureau_id is None:
        return documents
    return [
        d for d in documents
        if d.bureau_id is None or d.bureau_id == bureau_id
    ]


# ============================================================================
# RetrieverClient
# ============================================================================

class RetrieverClient:
    """
    Async retrieval client for Supabase hybrid_legal_search.

    Step 7 additions over the old inline helper:
        - Client-side weight config (no SQL migration needed to tune)
        - BM25 keyword score normalisation
        - Must-cite document injection
        - Clean dependency-injection interface for testing

    Usage:
        retriever = RetrieverClient()
        docs = await retriever.search(
            embedding=query_vector,
            query_text="ihbar tazminatı nasıl hesaplanır?",
            case_id="uuid...",
            max_sources=8,
            min_score=0.25,
        )
    """

    def __init__(self) -> None:
        self._w_sem: float = settings.retrieval_semantic_weight
        self._w_kw: float = settings.retrieval_keyword_weight
        self._w_rec: float = settings.retrieval_recency_weight
        self._w_hier: float = settings.retrieval_hierarchy_weight
        self._kw_cap: float = settings.retrieval_keyword_score_cap
        self._must_cite_boost: float = settings.retrieval_must_cite_boost

        logger.info(
            "RetrieverClient initialised | weights=sem:%.2f kw:%.2f "
            "rec:%.2f hier:%.2f | kw_cap=%.2f | must_cite_boost=%.2f",
            self._w_sem, self._w_kw, self._w_rec, self._w_hier,
            self._kw_cap, self._must_cite_boost,
        )

    async def search(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        min_score: float,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,  # Step 6: tenant isolation
    ) -> List[LegalDocument]:
        """
        Full retrieval pipeline: RPC → reweight → filter → must-cite → sort.

        Args:
            embedding:   1536-dim query vector from QueryEmbedder.
            query_text:  Original query for BM25 keyword scoring.
            case_id:     Optional UUID to scope results to one case.
            max_sources: Max rows to request from the RPC.
            min_score:   Client-side score threshold (applied after reweighting).

        Returns:
            List[LegalDocument] sorted by final_score DESC.
            Empty list → Hard-Fail will trigger upstream.

        Raises:
            HTTPException 503: Supabase RPC call failed.
        """
        # ── 1. Call hybrid_legal_search RPC ──────────────────────────────────
        raw_rows = self._call_search_rpc(
            embedding=embedding,
            query_text=query_text,
            case_id=case_id,
            max_sources=max_sources,
            event_date=event_date,
            bureau_id=bureau_id,
        )

        # ── 2. Reweight + filter + map to LegalDocument ───────────────────────
        documents: List[LegalDocument] = []
        for row in raw_rows:
            is_binding = row.get("court_level", "") in (
                "AYM", "YARGITAY_IBK", "YARGITAY_HGK", "YARGITAY_CGK", "DANISTAY_IDDK"
            )
            boost = settings.retrieval_binding_hard_boost if is_binding else 0.0
            final_score = recompute_final_score(
                semantic_score=float(row.get("semantic_score", 0.0)),
                keyword_score=float(row.get("keyword_score", 0.0)),
                recency_score=float(row.get("recency_score", 0.0)),
                hierarchy_score=float(row.get("hierarchy_score", 0.0)),
                w_sem=self._w_sem,
                w_kw=self._w_kw,
                w_rec=self._w_rec,
                w_hier=self._w_hier,
                keyword_cap=self._kw_cap,
                binding_boost=boost,
            )
            if final_score < min_score:
                continue
            documents.append(row_to_legal_document(row, final_score))

        documents.sort(key=lambda d: d.final_score, reverse=True)

        # ── Gap 5: Defense-in-depth tenant filter ───────────────────────────
        # SQL zaten p_bureau_id filtresini uyguluyor; Python katmanı bunu
        # derinlemesine doğrular — yanlış yapılandırılmış RPC yanıtlarına karşı.
        documents = _filter_by_bureau(documents, bureau_id)

        # ── 3. Must-cite injection (only when a case is scoped) ───────────────
        if case_id:
            must_cite_rows = self._call_must_cite_rpc(case_id, bureau_id=bureau_id)
            if must_cite_rows:
                must_cite_docs = [
                    row_to_legal_document(
                        row,
                        recompute_final_score(
                            semantic_score=float(row.get("semantic_score", 0.0)),
                            keyword_score=float(row.get("keyword_score", 0.0)),
                            recency_score=float(row.get("recency_score", 0.0)),
                            hierarchy_score=float(row.get("hierarchy_score", 0.0)),
                            w_sem=self._w_sem,
                            w_kw=self._w_kw,
                            w_rec=self._w_rec,
                            w_hier=self._w_hier,
                            keyword_cap=self._kw_cap,
                            binding_boost=(
                                settings.retrieval_binding_hard_boost
                                if row.get("court_level", "") in (
                                    "AYM", "YARGITAY_IBK", "YARGITAY_HGK",
                                    "YARGITAY_CGK", "DANISTAY_IDDK"
                                ) else 0.0
                            ),
                        ),
                    )
                    for row in must_cite_rows
                ]
                documents = merge_must_cites(
                    documents, must_cite_docs, self._must_cite_boost
                )
                logger.info(
                    "MUST_CITE_INJECTED | case_id=%s | count=%d",
                    case_id, len(must_cite_docs),
                )

        logger.info(
            "Retrieval complete | docs=%d | top_score=%.3f | case_id=%s",
            len(documents),
            documents[0].final_score if documents else 0.0,
            case_id,
        )
        return documents

    async def lehe_kanun_search(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        min_score: float,
        event_date: date,
        decision_date: date,
        bureau_id: Optional[str] = None,
    ) -> tuple[List[LegalDocument], List[LegalDocument]]:
        """
        Step 10: Retrieves documents at BOTH event_date AND decision_date.

        Runs two parallel-style searches (sequential, Supabase is sync) and
        returns the results separately so the caller can label each set with
        its version_type ('EVENT_DATE' | 'DECISION_DATE').

        Args:
            embedding:      Query vector.
            query_text:     Raw query text for BM25.
            case_id:        Optional case scope UUID.
            max_sources:    Max rows per version.
            min_score:      Score threshold (applied per version separately).
            event_date:     Law version at time of offence.
            decision_date:  Law version at time of verdict.
            bureau_id:      Tenant isolation filter.

        Returns:
            (event_docs, decision_docs) — two separate sorted lists.
            RAGService is responsible for merging/deduplicating them.

        Raises:
            HTTPException 503 on Supabase failure.
        """
        event_docs = await self.search(
            embedding=embedding,
            query_text=query_text,
            case_id=case_id,
            max_sources=max_sources,
            min_score=min_score,
            event_date=event_date,
            bureau_id=bureau_id,
        )
        decision_docs = await self.search(
            embedding=embedding,
            query_text=query_text,
            case_id=case_id,
            max_sources=max_sources,
            min_score=min_score,
            event_date=decision_date,  # pass decision_date as event_date param
            bureau_id=bureau_id,
        )

        logger.info(
            "LEHE_KANUN_SEARCH | event_date=%s | decision_date=%s | "
            "event_docs=%d | decision_docs=%d | case_id=%s",
            event_date, decision_date,
            len(event_docs), len(decision_docs),
            case_id,
        )
        return event_docs, decision_docs

    # ── Private: Supabase RPC calls (sync, wrapped in async def) ─────────────

    def _call_search_rpc(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,  # Step 6: tenant isolation
    ) -> List[dict]:
        """
        Calls ``hybrid_legal_search`` and returns raw row dicts.

        Step 4: when ``event_date`` is provided, passes ``p_event_date`` to the
        RPC so the SQL function can filter to the law version in force on that date.

        Gap 5: when ``multi_tenancy_enabled=True`` and ``bureau_id`` is not
        supplied outside of development mode, emits a SECURITY WARNING so ops
        can catch misconfigured callers before cross-tenant data is served.

        Raises:
            HTTPException 503 on any Supabase error.
        """
        # Gap 5: warn on missing tenant scope in production
        if (
            settings.multi_tenancy_enabled
            and bureau_id is None
            and (
                settings.environment != "development"
                or settings.tenant_enforce_in_dev
            )
        ):
            logger.warning(
                "TENANT_ISOLATION_BYPASS | multi_tenancy_enabled=True but "
                "bureau_id not provided — RPC may return cross-tenant documents."
            )
        supabase = get_supabase_client()
        params: dict = {
            "query_embedding": embedding,
            "query_text": query_text,
            "case_scope": case_id,
            "match_count": max_sources,
        }
        if event_date is not None:
            params["p_event_date"] = str(event_date)  # ISO 8601 YYYY-MM-DD
        if bureau_id is not None:
            params["p_bureau_id"] = bureau_id  # Step 6: tenant isolation
        try:
            response = supabase.rpc(
                "hybrid_legal_search",
                params,
            ).execute()
        except Exception as exc:
            logger.error(
                "hybrid_legal_search RPC failed: %s", exc, exc_info=True
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "RETRIEVAL_FAILED",
                    "message": f"Veritabanı erişimi başarısız: {exc}",
                },
            ) from exc

        return response.data or []

    def _call_must_cite_rpc(
        self,
        case_id: str,
        bureau_id: Optional[str] = None,  # Step 6: tenant isolation
    ) -> List[dict]:
        """
        Fetches must-cite documents for the given case.

        Uses ``get_must_cite_documents`` RPC (added by rag_v2_step7_mustcite.sql).
        Returns empty list if the RPC fails — must-cite is best-effort; we
        don't want a missing must-cite table to break the whole query.
        """
        supabase = get_supabase_client()
        mc_params: dict = {"p_case_id": case_id}
        if bureau_id is not None:
            mc_params["p_bureau_id"] = bureau_id  # Step 6: tenant isolation
        try:
            response = supabase.rpc(
                "get_must_cite_documents",
                mc_params,
            ).execute()
            return response.data or []
        except Exception as exc:
            # Non-fatal: log a warning but don't fail the whole retrieval
            logger.warning(
                "get_must_cite_documents RPC failed (non-fatal): %s", exc
            )
            return []


# ============================================================================
# Module-level singleton
# ============================================================================

retriever_client = RetrieverClient()
