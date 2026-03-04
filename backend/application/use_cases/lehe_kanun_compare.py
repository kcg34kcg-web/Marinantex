"""
LeheKanunCompareUseCase — Application Use Case
===============================================
Orchestrates a "lehe kanun" (favor rei) document comparison query.

TCK Madde 7/2 zorunluluğu: Olay tarihinde ve karar tarihinde yürürlükte olan
her iki yasa sürümü de getirilmeli; failin lehine olan hüküm uygulanmalıdır.

Bu use case:
    1. LeheKanunEngine ile lehe kanun ilkesinin uygulanıp uygulanamayacağını
       belirler (pure domain logic, zero latency).
    2. Uygulanabilirse: IDocumentRepository.hybrid_search() iki kez çağrılır
       (event_date ve decision_date için), sonuçlar version_type etiketiyle
       döndürülür.
    3. Uygulanamassa: Yalnızca event_date versiyonu getirilir.

Dependency injection:
    LeheKanunCompareUseCase(
        document_repository = SupabaseDocumentRepository(),
        embedder            = query_embedder,
    )
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

from domain.entities.lehe_kanun import LawDomain, LeheKanunResult
from domain.repositories.document_repository import IDocumentRepository

logger = logging.getLogger("babylexit.use_cases.lehe_kanun_compare")


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------

@dataclass
class LeheKanunCompareRequest:
    """Input DTO for a lehe kanun comparison query."""
    query:          str
    event_date:     date
    decision_date:  date
    bureau_id:      Optional[UUID] = None
    case_id:        Optional[UUID] = None
    max_sources:    int            = 6
    # Override embedding if already computed (avoids double embedder call)
    query_embedding: Optional[List[float]] = None


@dataclass
class VersionedSource:
    """A single source document tagged with its law version type."""
    doc_id:         str
    citation:       Optional[str]
    content:        str
    version:        Optional[str]
    authority_score: float
    version_type:   str   # "OLAY_TARIHI" | "KARAR_TARIHI" | "TEKIL"
    version_date:   date


@dataclass
class LeheKanunCompareResponse:
    """Output DTO for a lehe kanun comparison."""
    lehe_applicable:       bool
    law_domain:            str
    reason:                str
    legal_basis:           str
    event_date_sources:    List[VersionedSource] = field(default_factory=list)
    decision_date_sources: List[VersionedSource] = field(default_factory=list)
    # Convenience merged list (event first, decision second) for LLM context
    all_sources:           List[VersionedSource] = field(default_factory=list)
    # Human-readable prompt hint for the LLM
    comparison_prompt:     str = ""


# ---------------------------------------------------------------------------
# Use Case
# ---------------------------------------------------------------------------

class LeheKanunCompareUseCase:
    """
    Application-layer orchestrator for lehe kanun (favor rei) document retrieval.

    Responsibilities:
        1. Domain decision  — LeheKanunEngine.check() (pure, zero-cost)
        2. Embedding        — generate query vector (lazy; skipped if pre-computed)
        3. Dual retrieval   — hybrid_search() × 2 when both_versions_needed
        4. Version tagging  — each source labelled OLAY_TARIHI / KARAR_TARIHI
        5. Prompt hint      — structured guidance for the LLM comparison
    """

    def __init__(self, document_repository: IDocumentRepository) -> None:
        self._repo = document_repository

    async def execute(
        self, request: LeheKanunCompareRequest
    ) -> LeheKanunCompareResponse:
        """
        Run the lehe kanun document comparison pipeline.

        Returns:
            LeheKanunCompareResponse with source lists and comparison prompt.

        Raises:
            ValueError: if query is empty or dates are missing.
        """
        if not request.query.strip():
            raise ValueError("query cannot be empty.")

        # ------------------------------------------------------------------
        # 1. Domain decision (pure, <0.1 ms)
        # ------------------------------------------------------------------
        from infrastructure.legal.lehe_kanun_engine import lehe_kanun_engine

        result: LeheKanunResult = lehe_kanun_engine.check(
            query_text=request.query,
            event_date=request.event_date,
            decision_date=request.decision_date,
        )

        logger.info(
            "LEHE_COMPARE | domain=%s | applicable=%s | event=%s | decision=%s",
            result.law_domain.value,
            result.lehe_applicable,
            request.event_date,
            request.decision_date,
        )

        # ------------------------------------------------------------------
        # 2. Embedding (lazy import; skip if caller pre-computed)
        # ------------------------------------------------------------------
        embedding: List[float] = request.query_embedding or []
        if not embedding:
            from infrastructure.embeddings.embedder import query_embedder
            embedding = await query_embedder.embed_query(request.query)

        # ------------------------------------------------------------------
        # 3. Retrieval
        # ------------------------------------------------------------------
        event_sources: List[VersionedSource] = []
        decision_sources: List[VersionedSource] = []

        # Always retrieve event_date version
        raw_event = await self._repo.hybrid_search(
            embedding=embedding,
            query_text=request.query,
            case_id=request.case_id,
            match_count=request.max_sources,
            event_date=request.event_date,
            bureau_id=request.bureau_id,
        )
        event_sources = [
            _to_versioned(doc, "OLAY_TARIHI", request.event_date)
            for doc in raw_event
        ]

        # If lehe kanun applies, ALSO retrieve decision_date version
        if result.both_versions_needed:
            raw_decision = await self._repo.hybrid_search(
                embedding=embedding,
                query_text=request.query,
                case_id=request.case_id,
                match_count=request.max_sources,
                event_date=request.decision_date,   # ← decision date as anchor
                bureau_id=request.bureau_id,
            )
            decision_sources = [
                _to_versioned(doc, "KARAR_TARIHI", request.decision_date)
                for doc in raw_decision
            ]
        else:
            # Relabel single-version sources
            event_sources = [
                VersionedSource(**{**vars(s), "version_type": "TEKIL"})
                for s in event_sources
            ]

        # ------------------------------------------------------------------
        # 4. Merge + build comparison prompt
        # ------------------------------------------------------------------
        all_sources = event_sources + decision_sources
        comparison_prompt = _build_comparison_prompt(
            result=result,
            event_sources=event_sources,
            decision_sources=decision_sources,
        )

        return LeheKanunCompareResponse(
            lehe_applicable=result.lehe_applicable,
            law_domain=result.law_domain.value,
            reason=result.reason,
            legal_basis=result.legal_basis,
            event_date_sources=event_sources,
            decision_date_sources=decision_sources,
            all_sources=all_sources,
            comparison_prompt=comparison_prompt,
        )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _to_versioned(doc: Any, version_type: str, as_of: date) -> VersionedSource:
    """Converts a LegalDocument entity to a VersionedSource DTO."""
    return VersionedSource(
        doc_id=str(doc.id),
        citation=getattr(doc, "citation", None),
        content=getattr(doc, "content", ""),
        version=getattr(doc, "version", None),
        authority_score=float(getattr(doc, "authority_score", 0.0)),
        version_type=version_type,
        version_date=as_of,
    )


def _build_comparison_prompt(
    result: LeheKanunResult,
    event_sources: List[VersionedSource],
    decision_sources: List[VersionedSource],
) -> str:
    """
    Builds a structured Turkish-language prompt hint for the LLM.

    Instructs the model to surface BOTH law versions and select
    the provision more favourable to the defendant.
    """
    if not result.lehe_applicable:
        top = event_sources[0].citation if event_sources else "kaynak"
        return (
            f"Bu sorguda lehe kanun ilkesi uygulanmaz ({result.reason}). "
            f"Yalnızca {result.event_date} tarihinde yürürlükte olan hüküm "
            f"({top}) esas alınarak yanıt verilmeli."
        )

    event_cites  = ", ".join(s.citation or s.doc_id for s in event_sources[:3])
    dec_cites    = ", ".join(s.citation or s.doc_id for s in decision_sources[:3])
    domain_label = result.law_domain.value

    return (
        f"TCK Madde 7/2 gereği '{domain_label}' hukuku alanında lehe kanun "
        f"ilkesi uygulanır.\n\n"
        f"**Olay tarihi ({result.event_date}) versiyonu:** {event_cites}\n"
        f"**Karar tarihi ({result.decision_date}) versiyonu:** {dec_cites}\n\n"
        "Her iki versiyonu karşılaştırın ve failin açıkça lehine olan hükmü "
        "uygulayarak yanıtı oluşturun. Hangi versiyonun neden daha lehe "
        "olduğunu somut madde numarasıyla açıklayın."
    )
