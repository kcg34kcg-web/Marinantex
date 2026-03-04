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
    ``search()`` is declared async and runs sync RPC calls via asyncio.to_thread
    so dual-lane retrieval (RRF) can execute concurrently without blocking the
    main event loop.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings
from infrastructure.database.connection import get_supabase_client

logger = logging.getLogger("babylexit.retrieval")

SOURCE_TYPE_MEVZUAT = "MEVZUAT"
SOURCE_TYPE_ICTIHAT = "ICTIHAT"
SOURCE_TYPE_PLATFORM_BILGI = "PLATFORM_BILGI"


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


def _build_source_anchor(row: dict) -> Optional[str]:
    """
    Builds a human-readable source anchor from segment metadata.

    Priority:
        1) explicit source_anchor from row
        2) MADDE/FIKRA/BENT composite
        3) citation fallback
    """
    explicit = row.get("source_anchor")
    if explicit:
        return str(explicit)

    madde_no = row.get("madde_no")
    fikra_no = row.get("fikra_no")
    bent_no = row.get("bent_no")
    segment_type = row.get("segment_type")

    parts: List[str] = []
    if madde_no:
        parts.append(f"Madde {madde_no}")
    if fikra_no is not None:
        parts.append(f"Fikra {fikra_no}")
    if bent_no:
        parts.append(f"Bent {bent_no}")
    if not parts and segment_type:
        parts.append(str(segment_type))

    if parts:
        return " / ".join(parts)

    citation = row.get("citation")
    if citation:
        return str(citation)[:180]

    return None


def _coerce_datetime(value: object) -> Optional[datetime]:
    """
    Best-effort parser for timestamptz fields returned by Supabase/PostgREST.
    """
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # Common PostgREST form: "...Z"
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text)
        except Exception:
            return None
    return None


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
    _content = str(row["content"])
    _char_start_raw = row.get("char_start")
    _char_end_raw = row.get("char_end")
    _char_start = int(_char_start_raw) if _char_start_raw is not None else 0
    _char_end = int(_char_end_raw) if _char_end_raw is not None else len(_content)
    if _char_end < _char_start:
        _char_end = _char_start

    return LegalDocument(
        id=str(row["id"]),
        case_id=str(row.get("case_id")) if row.get("case_id") is not None else "",
        content=_content,
        file_path=str(row.get("file_path", "")),
        created_at=_coerce_datetime(row.get("created_at")),
        source_url=row.get("source_url"),
        version=row.get("version"),
        collected_at=_coerce_datetime(row.get("collected_at")),
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
        # Step 5/15: segment + anchor metadata
        segment_type=row.get("segment_type"),
        madde_no=row.get("madde_no"),
        fikra_no=row.get("fikra_no"),
        bent_no=row.get("bent_no"),
        citation_refs=list(row.get("citation_refs") or []),
        source_anchor=_build_source_anchor(row),
        page_no=row.get("page_no"),
        char_start=_char_start,
        char_end=_char_end,
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
                segment_type=doc.segment_type,
                madde_no=doc.madde_no,
                fikra_no=doc.fikra_no,
                bent_no=doc.bent_no,
                citation_refs=list(doc.citation_refs),
                source_anchor=doc.source_anchor,
                page_no=doc.page_no,
                char_start=doc.char_start,
                char_end=doc.char_end,
                injection_flag=doc.injection_flag,
                injection_notes=list(doc.injection_notes),
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


def infer_source_type(document: LegalDocument) -> str:
    """
    Classifies a document into the Step 13 source-type taxonomy.

    Priority:
        1. MEVZUAT       -> norm_hierarchy present (kanun/cbk/yonetmelik/...)
        2. ICTIHAT       -> court_level present (yargi kararlari)
        3. PLATFORM_BILGI -> fallback for public explanatory corpora
    """
    if document.norm_hierarchy:
        return SOURCE_TYPE_MEVZUAT
    if document.court_level:
        return SOURCE_TYPE_ICTIHAT
    return SOURCE_TYPE_PLATFORM_BILGI


def _filter_global_legal_corpus(documents: List[LegalDocument]) -> List[LegalDocument]:
    """
    Keeps only global/public corpus rows for belgesiz legal retrieval.

    Step 6 model defines public legal corpus as bureau_id IS NULL.
    """
    return [doc for doc in documents if doc.bureau_id is None]


def _quick_lexical_score(query_text: str, content: str) -> float:
    """
    Lightweight lexical overlap score in [0, 1] for uploaded-doc ranking.
    """
    def _fold_tr(text: str) -> str:
        table = str.maketrans({
            "ç": "c",
            "ğ": "g",
            "ı": "i",
            "ö": "o",
            "ş": "s",
            "ü": "u",
            "Ç": "c",
            "Ğ": "g",
            "İ": "i",
            "I": "i",
            "Ö": "o",
            "Ş": "s",
            "Ü": "u",
        })
        return (text or "").translate(table).lower()

    query_terms = {
        term.strip()
        for term in _fold_tr(query_text).split()
        if len(term.strip()) >= 3
    }
    if not query_terms:
        return 0.0
    haystack = _fold_tr(content)
    matches = sum(1 for term in query_terms if term in haystack)
    return max(0.0, min(1.0, matches / max(1, len(query_terms))))


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

    @staticmethod
    def _resolve_rrf_k(law_domain: Optional[str]) -> int:
        domain = (law_domain or "").strip().upper()
        if domain in {"CEZA", "IDARI_CEZA", "VERGI_CEZA"}:
            return int(getattr(settings, "rrf_k_ceza", 40) or 40)
        return int(getattr(settings, "rrf_k", 60) or 60)

    @staticmethod
    def _coerce_weight(value: Optional[float], fallback: float) -> float:
        try:
            candidate = float(value if value is not None else fallback)
        except Exception:
            candidate = fallback
        # Negative or zero weights make lanes disappear unexpectedly.
        return candidate if candidate > 0.0 else fallback

    @staticmethod
    def _looks_like_missing_column_error(exc: Exception) -> bool:
        """
        Detects Postgres undefined-column failures (SQLSTATE 42703).

        We use this to activate a compatibility fallback when legacy DB
        schemas are missing newer retrieval columns (e.g. search_vector).
        """
        raw = str(exc or "")
        lowered = raw.lower()
        code = str(getattr(exc, "code", "") or "").strip()
        if not code and "42703" in lowered:
            code = "42703"
        if code != "42703":
            return False
        return any(
            marker in lowered
            for marker in ("search_vector", "fts_vector", "is_deleted")
        )

    @staticmethod
    def _coerce_date(value: object) -> Optional[date]:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            # Accept "YYYY-MM-DD" and ISO timestamp variants.
            if len(text) >= 10:
                try:
                    return date.fromisoformat(text[:10])
                except Exception:
                    return None
        return None

    def _legacy_table_search_fallback(
        self,
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,
    ) -> List[dict]:
        """
        Compatibility fallback when SQL RPC depends on missing DB columns.

        This path intentionally keeps retrieval operational in partially
        migrated environments by scoring rows in Python using lexical signals.
        """
        supabase = get_supabase_client()
        query = supabase.table("documents").select("*")
        if case_id is not None:
            query = query.eq("case_id", case_id)

        try:
            response = query.limit(max(50, int(max_sources) * 8)).execute()
            raw_rows = list(response.data or [])
        except Exception as exc:
            logger.error(
                "LEGACY_SEARCH_FALLBACK_FAILED: %s",
                exc,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "RETRIEVAL_FAILED",
                    "message": f"Legacy fallback aramasi basarisiz: {exc}",
                },
            ) from exc

        scoped_rows: List[dict] = []
        for row in raw_rows:
            # Soft-delete aware (when column exists).
            if bool(row.get("is_deleted", False)):
                continue
            # Defense-in-depth bureau isolation.
            if bureau_id is not None:
                row_bureau = row.get("bureau_id")
                if row_bureau is not None and str(row_bureau) != str(bureau_id):
                    continue
            # Best-effort temporal filtering.
            if event_date is not None:
                effective = self._coerce_date(row.get("effective_date"))
                expiry = self._coerce_date(row.get("expiry_date"))
                if effective is not None and event_date < effective:
                    continue
                if expiry is not None and event_date >= expiry:
                    continue
            scoped_rows.append(row)

        scored_rows: List[dict] = []
        for row in scoped_rows:
            lexical = _quick_lexical_score(
                query_text,
                str(row.get("content", "")),
            )
            recency_raw = row.get("recency_score")
            if recency_raw is None:
                ruling_date = self._coerce_date(row.get("ruling_date"))
                if ruling_date is None:
                    recency = 0.0
                else:
                    age_days = max(0, (date.today() - ruling_date).days)
                    recency = max(0.0, 1.0 - (age_days / 3650.0))
            else:
                recency = float(recency_raw or 0.0)

            semantic = float(row.get("semantic_score", lexical) or lexical)
            keyword = float(row.get("keyword_score", lexical) or lexical)
            hierarchy = float(row.get("hierarchy_score", 0.0) or 0.0)

            weighted = recompute_final_score(
                semantic_score=max(0.0, min(1.0, semantic)),
                keyword_score=max(0.0, min(1.0, keyword)),
                recency_score=max(0.0, min(1.0, recency)),
                hierarchy_score=max(0.0, min(1.0, hierarchy)),
                w_sem=self._w_sem,
                w_kw=self._w_kw,
                w_rec=self._w_rec,
                w_hier=self._w_hier,
                keyword_cap=self._kw_cap,
            )

            row_copy = dict(row)
            row_copy["semantic_score"] = max(0.0, min(1.0, semantic))
            row_copy["keyword_score"] = max(0.0, min(1.0, keyword))
            row_copy["recency_score"] = max(0.0, min(1.0, recency))
            row_copy["hierarchy_score"] = max(0.0, min(1.0, hierarchy))
            row_copy["final_score"] = max(
                float(row.get("final_score", 0.0) or 0.0),
                float(weighted),
            )
            scored_rows.append(row_copy)

        scored_rows.sort(
            key=lambda r: float(r.get("final_score", 0.0) or 0.0),
            reverse=True,
        )
        selected = scored_rows[: max(1, int(max_sources) * 3)]
        logger.warning(
            "LEGACY_SEARCH_FALLBACK_ACTIVE | case_id=%s | docs=%d | query_len=%d",
            case_id,
            len(selected),
            len(query_text),
        )
        return selected

    def _rows_to_weighted_documents(
        self,
        raw_rows: List[dict],
        min_score: float,
    ) -> List[LegalDocument]:
        """
        Maps hybrid_legal_search rows to LegalDocument after client-side reweight.
        """
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
        return documents

    async def _inject_must_cites(
        self,
        documents: List[LegalDocument],
        case_id: Optional[str],
        bureau_id: Optional[str],
    ) -> List[LegalDocument]:
        """
        Preserves must-cite guarantee for case-scoped queries across retrieval modes.
        """
        if not case_id:
            return documents

        must_cite_rows = await asyncio.to_thread(
            functools.partial(
                self._call_must_cite_rpc,
                case_id=case_id,
                bureau_id=bureau_id,
            )
        )
        if not must_cite_rows:
            return documents

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
        merged = merge_must_cites(documents, must_cite_docs, self._must_cite_boost)
        logger.info(
            "MUST_CITE_INJECTED | case_id=%s | count=%d",
            case_id,
            len(must_cite_docs),
        )
        return merged

    async def search(
        self,
        embedding: Optional[List[float]] = None,
        query_text: str = "",
        case_id: Optional[str] = None,
        max_sources: int = 12,
        min_score: float = 0.0,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,  # Step 6: tenant isolation
        **legacy_kwargs: object,
    ) -> List[LegalDocument]:
        """
        Full retrieval pipeline: RPC -> reweight -> filter -> must-cite -> sort.

        Backward compatibility:
            Legacy callers may still pass ``query_embedding`` and ``match_count``.
            This method accepts both legacy and canonical names.
        """
        legacy_embedding = legacy_kwargs.pop("query_embedding", None)
        if embedding is None and isinstance(legacy_embedding, list):
            embedding = legacy_embedding

        legacy_match_count = legacy_kwargs.pop("match_count", None)
        if legacy_match_count is not None and max_sources == 12:
            try:
                max_sources = int(legacy_match_count)
            except Exception:
                logger.warning(
                    "RETRIEVAL_LEGACY_MATCH_COUNT_INVALID | value=%r",
                    legacy_match_count,
                )

        if case_id is None:
            legacy_case_id = legacy_kwargs.pop("case_scope", None)
            if legacy_case_id is not None:
                case_id = str(legacy_case_id)

        if event_date is None:
            legacy_event = (
                legacy_kwargs.pop("as_of", None)
                or legacy_kwargs.pop("as_of_date", None)
            )
            coerced_event = self._coerce_date(legacy_event)
            if coerced_event is not None:
                event_date = coerced_event

        if bureau_id is None:
            legacy_bureau_id = (
                legacy_kwargs.pop("tenant_id", None)
                or legacy_kwargs.pop("p_bureau_id", None)
            )
            if legacy_bureau_id is not None:
                bureau_id = str(legacy_bureau_id)

        if legacy_kwargs:
            logger.debug(
                "RETRIEVAL_LEGACY_ARGS_IGNORED | keys=%s",
                sorted(legacy_kwargs.keys()),
            )

        if embedding is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "RETRIEVAL_MISSING_EMBEDDING",
                    "message": "Retrieval requires embedding/query_embedding.",
                },
            )

        # 1) Run sync Supabase RPC in a worker thread (event loop stays responsive).
        raw_rows = await asyncio.to_thread(
            functools.partial(
                self._call_search_rpc,
                embedding=embedding,
                query_text=query_text,
                case_id=case_id,
                max_sources=max_sources,
                event_date=event_date,
                bureau_id=bureau_id,
            )
        )

        # 2) Reweight + filter + map to LegalDocument.
        documents = self._rows_to_weighted_documents(raw_rows, min_score=min_score)

        # Gap 5: defense-in-depth tenant filter.
        documents = _filter_by_bureau(documents, bureau_id)

        # 3) Must-cite injection (only when a case is scoped).
        documents = await self._inject_must_cites(
            documents,
            case_id=case_id,
            bureau_id=bureau_id,
        )

        logger.info(
            "Retrieval complete | docs=%d | top_score=%.3f | case_id=%s",
            len(documents),
            documents[0].final_score if documents else 0.0,
            case_id,
        )
        return documents

    async def get_must_cite_documents(
        self,
        case_id: Optional[str] = None,
        bureau_id: Optional[str] = None,
        limit: Optional[int] = None,
        **legacy_kwargs: object,
    ) -> List[LegalDocument]:
        """
        Public must-cite lookup used by repository layer.

        Accepts legacy aliases for compatibility:
            - ``p_case_id`` for case_id
            - ``tenant_id`` / ``p_bureau_id`` for bureau_id
        """
        if case_id is None:
            legacy_case_id = legacy_kwargs.pop("p_case_id", None)
            if legacy_case_id is not None:
                case_id = str(legacy_case_id)

        if bureau_id is None:
            legacy_bureau_id = (
                legacy_kwargs.pop("tenant_id", None)
                or legacy_kwargs.pop("p_bureau_id", None)
            )
            if legacy_bureau_id is not None:
                bureau_id = str(legacy_bureau_id)

        if legacy_kwargs:
            logger.debug(
                "MUST_CITE_LEGACY_ARGS_IGNORED | keys=%s",
                sorted(legacy_kwargs.keys()),
            )

        if not case_id:
            logger.warning("MUST_CITE_LOOKUP_SKIPPED | reason=missing_case_id")
            return []

        raw_rows = await asyncio.to_thread(
            functools.partial(
                self._call_must_cite_rpc,
                case_id=case_id,
                bureau_id=bureau_id,
            )
        )
        documents = self._rows_to_weighted_documents(raw_rows, min_score=0.0)
        documents = _filter_by_bureau(documents, bureau_id)

        if limit is not None and limit > 0:
            documents = documents[: int(limit)]

        logger.info(
            "MUST_CITE_LOOKUP complete | case_id=%s | docs=%d",
            case_id,
            len(documents),
        )
        return documents

    async def global_legal_search(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        min_score: float,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,
    ) -> List[LegalDocument]:
        """
        Step 13: Belgesiz legal retrieval path.

        Enforces search over the global legal corpus by:
            - forcing case_scope=None (no case restriction)
            - filtering to public corpus rows (bureau_id IS NULL)
        while preserving the existing hybrid retrieval stack (vector + BM25).
        """
        if case_id is not None:
            logger.warning(
                "GLOBAL_LEGAL_SEARCH case_id ignored | case_id=%s",
                case_id,
            )

        documents = await self.search(
            embedding=embedding,
            query_text=query_text,
            case_id=None,
            max_sources=max_sources,
            min_score=min_score,
            event_date=event_date,
            bureau_id=bureau_id,
        )
        global_docs = _filter_global_legal_corpus(documents)[:max_sources]
        source_type_dist: Dict[str, int] = {}
        for doc in global_docs:
            _source_type = infer_source_type(doc)
            source_type_dist[_source_type] = source_type_dist.get(_source_type, 0) + 1

        logger.info(
            "GLOBAL_LEGAL_SEARCH complete | docs=%d | source_type_dist=%s",
            len(global_docs),
            source_type_dist or {},
        )
        return global_docs

    async def search_rrf(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        min_score: float,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,
        law_domain: Optional[str] = None,
        semantic_weight: Optional[float] = None,
        keyword_weight: Optional[float] = None,
        global_legal_only: bool = False,
    ) -> List[LegalDocument]:
        """
        Uses DB-side `hybrid_rrf_search` (Step 11) with weighted lane fusion.

        Falls back at caller level when the RPC is unavailable.
        """
        if global_legal_only and case_id is not None:
            logger.warning(
                "RRF_RPC_GLOBAL_SEARCH case_id ignored | case_id=%s",
                case_id,
            )

        scoped_case_id = None if global_legal_only else case_id
        rrf_k = self._resolve_rrf_k(law_domain)
        sem_weight = self._coerce_weight(
            semantic_weight,
            fallback=float(getattr(settings, "rrf_semantic_weight", 1.0) or 1.0),
        )
        kw_weight = self._coerce_weight(
            keyword_weight,
            fallback=float(getattr(settings, "rrf_keyword_weight", 1.0) or 1.0),
        )

        raw_rows = await asyncio.to_thread(
            functools.partial(
                self._call_rrf_search_rpc,
                embedding=embedding,
                query_text=query_text,
                case_id=scoped_case_id,
                max_sources=max_sources,
                event_date=event_date,
                bureau_id=bureau_id,
                rrf_k=rrf_k,
                sem_weight=sem_weight,
                kw_weight=kw_weight,
            )
        )

        # RRF RPC returns raw reciprocal-rank values (~0.01 with k=60).
        # API min_score contract is [0,1], so we normalise by top raw score.
        raw_candidates: List[Tuple[dict, float]] = []
        max_raw_rrf = 0.0
        for row in raw_rows:
            raw_rrf = float(row.get("rrf_score_value", row.get("final_score", 0.0)) or 0.0)
            raw_rrf = max(0.0, raw_rrf)
            raw_candidates.append((row, raw_rrf))
            if raw_rrf > max_raw_rrf:
                max_raw_rrf = raw_rrf

        docs: List[LegalDocument] = []
        for row, raw_rrf in raw_candidates:
            if max_raw_rrf > 0.0:
                score = raw_rrf / max_raw_rrf
            else:
                score = 0.0
            if score < min_score:
                continue
            docs.append(
                row_to_legal_document(
                    row,
                    final_score=max(0.0, min(1.0, score)),
                )
            )

        docs.sort(key=lambda d: d.final_score, reverse=True)
        docs = _filter_by_bureau(docs, bureau_id)
        if global_legal_only:
            docs = _filter_global_legal_corpus(docs)[:max_sources]

        if not docs:
            logger.warning(
                "RRF_RPC_EMPTY_LEGACY_FALLBACK | case_id=%s | global_only=%s | query_len=%d",
                scoped_case_id,
                global_legal_only,
                len(query_text),
            )
            fallback_rows = await asyncio.to_thread(
                functools.partial(
                    self._legacy_table_search_fallback,
                    query_text=query_text,
                    case_id=scoped_case_id,
                    max_sources=max_sources,
                    event_date=event_date,
                    bureau_id=bureau_id,
                )
            )
            docs = self._rows_to_weighted_documents(
                fallback_rows,
                min_score=min_score,
            )
            docs = _filter_by_bureau(docs, bureau_id)
            if global_legal_only:
                docs = _filter_global_legal_corpus(docs)[:max_sources]

        docs = await self._inject_must_cites(
            docs,
            case_id=scoped_case_id,
            bureau_id=bureau_id,
        )

        logger.info(
            "RRF_RPC_RETRIEVAL complete | docs=%d | top_score=%.3f | case_id=%s | global_only=%s | k=%d | sem_w=%.2f | kw_w=%.2f | top_raw_rrf=%.6f",
            len(docs),
            docs[0].final_score if docs else 0.0,
            scoped_case_id,
            global_legal_only,
            rrf_k,
            sem_weight,
            kw_weight,
            max_raw_rrf,
        )
        return docs[:max_sources]

    async def search_uploaded_documents(
        self,
        query_text: str,
        document_ids: List[str],
        max_sources: int,
        bureau_id: Optional[str] = None,
    ) -> List[LegalDocument]:
        """
        Step 14: retrieves user-selected uploaded documents by explicit IDs.

        Intended for document_analysis mode where UI sends active_document_ids.
        """
        dedup_ids = list(dict.fromkeys(document_ids))
        if not dedup_ids:
            return []

        raw_rows = await asyncio.to_thread(self._fetch_documents_by_ids, dedup_ids)
        docs: List[LegalDocument] = []
        for row in raw_rows:
            lexical = _quick_lexical_score(query_text, str(row.get("content", "")))
            base = float(row.get("final_score", 0.0) or 0.0)
            score = max(base, lexical, 0.20)
            docs.append(row_to_legal_document(row, final_score=min(1.0, score)))

        docs = _filter_by_bureau(docs, bureau_id)
        id_order = {doc_id: idx for idx, doc_id in enumerate(dedup_ids)}
        docs.sort(
            key=lambda d: (
                -d.final_score,
                id_order.get(d.id, 10**9),
            )
        )
        selected_docs = docs[:max_sources]

        logger.info(
            "UPLOADED_DOC_SEARCH complete | requested=%d | found=%d | selected=%d",
            len(dedup_ids),
            len(docs),
            len(selected_docs),
        )
        return selected_docs

    async def fetch_parent_segments_for_children(
        self,
        docs: List[LegalDocument],
        max_parents: int,
        bureau_id: Optional[str] = None,
    ) -> List[LegalDocument]:
        """
        Step 15: parent/child retrieval support.

        Finds parent MADDE segments for retrieved FIKRA/BENT child segments.
        Best-effort: on any query failure returns [] (non-fatal).
        """
        if max_parents <= 0 or not docs:
            return []

        def _case_key(value: Optional[str]) -> Optional[str]:
            return str(value) if value else None

        child_keys: set[Tuple[Optional[str], str, str]] = set()
        child_score_by_key: Dict[Tuple[Optional[str], str, str], float] = {}
        for doc in docs:
            seg = (doc.segment_type or "").upper()
            if seg not in {"FIKRA", "BENT"}:
                continue
            if not doc.file_path or not doc.madde_no:
                continue
            key = (_case_key(doc.case_id), doc.file_path, doc.madde_no)
            child_keys.add(key)
            child_score_by_key[key] = max(
                child_score_by_key.get(key, 0.0),
                doc.final_score,
            )

        if not child_keys:
            return []

        file_paths = sorted({key[1] for key in child_keys})
        madde_nos = sorted({key[2] for key in child_keys})
        if not file_paths or not madde_nos:
            return []

        supabase = get_supabase_client()
        try:
            response = (
                supabase.table("documents")
                .select("*")
                .eq("segment_type", "MADDE")
                .in_("file_path", file_paths)
                .in_("madde_no", madde_nos)
                .limit(max(50, max_parents * 8, len(child_keys) * 2))
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "PARENT_CHILD_PARENT_FETCH_FAILED (non-fatal): %s",
                exc,
            )
            return []

        parent_ratio = float(getattr(settings, "parent_child_parent_score_ratio", 0.92))
        min_parent_score = float(getattr(settings, "parent_child_min_score", 0.20))

        parent_docs: List[LegalDocument] = []
        for row in response.data or []:
            key = (
                _case_key(row.get("case_id")),
                str(row.get("file_path", "")),
                str(row.get("madde_no", "")),
            )
            if key not in child_keys:
                continue
            child_score = child_score_by_key.get(key, 0.0)
            base = float(row.get("final_score", 0.0) or 0.0)
            score = max(base, child_score * parent_ratio, min_parent_score)
            parent_docs.append(
                row_to_legal_document(row, final_score=min(1.0, score))
            )

        parent_docs = _filter_by_bureau(parent_docs, bureau_id)
        dedup: Dict[str, LegalDocument] = {}
        for doc in parent_docs:
            prev = dedup.get(doc.id)
            if prev is None or doc.final_score > prev.final_score:
                dedup[doc.id] = doc
        selected = sorted(
            dedup.values(),
            key=lambda d: d.final_score,
            reverse=True,
        )[:max_parents]

        if selected:
            logger.info(
                "PARENT_CHILD_PARENT_FETCH complete | children=%d | parents=%d",
                len(child_keys),
                len(selected),
            )
        return selected

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
        _search_fn = self.global_legal_search if case_id is None else self.search

        event_docs = await _search_fn(
            embedding=embedding,
            query_text=query_text,
            case_id=case_id,
            max_sources=max_sources,
            min_score=min_score,
            event_date=event_date,
            bureau_id=bureau_id,
        )
        decision_docs = await _search_fn(
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
            "event_docs=%d | decision_docs=%d | case_id=%s | global_only=%s",
            event_date, decision_date,
            len(event_docs), len(decision_docs),
            case_id,
            case_id is None,
        )
        return event_docs, decision_docs

    # ── Private: Supabase RPC calls (sync, wrapped in async def) ─────────────

    def _fetch_documents_by_ids(self, document_ids: List[str]) -> List[dict]:
        """
        Fetches raw document rows directly from public.documents by UUID list.
        """
        if not document_ids:
            return []
        supabase = get_supabase_client()
        try:
            response = (
                supabase.table("documents")
                .select("*")
                .in_("id", document_ids)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("documents-by-ids lookup failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "RETRIEVAL_FAILED",
                    "message": f"Belge listesi okunamadi: {exc}",
                },
            ) from exc

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
            # Always include optional args so PostgREST can resolve the
            # intended signature even if legacy overloads are present.
            "p_event_date": str(event_date) if event_date is not None else None,
            "p_bureau_id": bureau_id,
        }
        try:
            response = supabase.rpc(
                "hybrid_legal_search",
                params,
            ).execute()
        except Exception as exc:
            if self._looks_like_missing_column_error(exc):
                logger.warning(
                    "HYBRID_SEARCH_SCHEMA_MISMATCH | switching_to_legacy_fallback | reason=%s",
                    exc,
                )
                return self._legacy_table_search_fallback(
                    query_text=query_text,
                    case_id=case_id,
                    max_sources=max_sources,
                    event_date=event_date,
                    bureau_id=bureau_id,
                )
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

    def _call_rrf_search_rpc(
        self,
        embedding: List[float],
        query_text: str,
        case_id: Optional[str],
        max_sources: int,
        event_date: Optional[date] = None,
        bureau_id: Optional[str] = None,  # Step 6: tenant isolation
        rrf_k: int = 60,
        sem_weight: float = 1.0,
        kw_weight: float = 1.0,
    ) -> List[dict]:
        """
        Calls ``hybrid_rrf_search`` and returns raw row dicts.

        This RPC performs semantic + keyword retrieval and weighted RRF in SQL.
        """
        supabase = get_supabase_client()
        params: dict = {
            "query_embedding": embedding,
            "query_text": query_text,
            "case_scope": case_id,
            "match_count": max_sources,
            "p_rrf_k": int(rrf_k),
            "p_sem_weight": float(sem_weight),
            "p_kw_weight": float(kw_weight),
        }
        if event_date is not None:
            params["p_event_date"] = str(event_date)
        if bureau_id is not None:
            params["p_bureau_id"] = bureau_id

        try:
            response = supabase.rpc(
                "hybrid_rrf_search",
                params,
            ).execute()
        except Exception as exc:
            logger.error(
                "hybrid_rrf_search RPC failed: %s", exc, exc_info=True
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "RETRIEVAL_FAILED",
                    "message": f"RRF arama basarisiz: {exc}",
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
