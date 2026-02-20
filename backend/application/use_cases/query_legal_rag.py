"""
QueryLegalRAGUseCase — Application Use Case
============================================
Orchestrates a single RAG query from input to structured response.

This use case is the thin application-layer wrapper around RAGService.
Its purpose is to:
    1. Accept a plain-Python request DTO (no FastAPI / HTTP coupling).
    2. Coordinate the RAGService pipeline.
    3. Return a plain-Python response DTO.
    4. Persist the audit trail via IAuditRepository.

Dependency injection contract:
    QueryLegalRAGUseCase(
        rag_service      = rag_service,        # infrastructure singleton
        audit_repository = supabase_audit_repo # concrete implementation
    )

    # Test:
    QueryLegalRAGUseCase(
        rag_service      = mock_rag_service,
        audit_repository = MockAuditRepository()
    )

Why a separate use case?
    RAGService (800 lines) is already large.  Extracting the top-level
    orchestration here keeps it slimmer and makes the entry point testable
    without spinning up FastAPI.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

from domain.entities.tenant import TenantContext
from domain.repositories.audit_repository import (
    CostRecord,
    IAuditRepository,
    RAGASRecord,
)

logger = logging.getLogger("babylexit.use_cases.query_legal_rag")


# ---------------------------------------------------------------------------
# DTOs (plain-Python — no Pydantic, no FastAPI)
# ---------------------------------------------------------------------------

@dataclass
class QueryLegalRAGRequest:
    """Input DTO for a RAG query."""
    query:           str
    tenant:          Optional[TenantContext] = None
    case_id:         Optional[UUID]         = None
    event_date:      Optional[date]         = None
    decision_date:   Optional[date]         = None
    max_sources:     int                    = 8


@dataclass
class QueryLegalRAGResponse:
    """
    Output DTO for a RAG query.

    Mirrors the structure of api.schemas.RAGResponse but without Pydantic
    so the use case is usable outside FastAPI (e.g. scripts, tests).
    """
    answer:             str
    sources:            List[Dict[str, Any]]   = field(default_factory=list)
    lehe_kanun_notice:  Optional[str]          = None
    disclaimer:         str                    = ""
    disclaimer_severity: str                   = "INFO"
    grounding_ratio:    float                  = 0.0
    ragas_overall:      float                  = 0.0
    tier_used:          int                    = 1
    model_used:         str                    = ""
    cost_usd:           float                  = 0.0
    latency_ms:         int                    = 0
    request_id:         str                    = ""


# ---------------------------------------------------------------------------
# Use Case
# ---------------------------------------------------------------------------

class QueryLegalRAGUseCase:
    """
    Application-layer orchestrator for a single RAG query.

    Responsibilities:
        1. Delegate to RAGService for the full pipeline.
        2. Persist the audit trail to the database (fire-and-forget).
        3. Return a framework-agnostic response DTO.
    """

    def __init__(
        self,
        rag_service: Any,                            # RAGService singleton
        audit_repository: Optional[IAuditRepository] = None,
    ) -> None:
        self._rag = rag_service
        self._audit_repo = audit_repository

    async def execute(self, request: QueryLegalRAGRequest) -> QueryLegalRAGResponse:
        """
        Run the full RAG pipeline and return a structured response.

        Args:
            request: QueryLegalRAGRequest DTO.

        Returns:
            QueryLegalRAGResponse DTO.

        Raises:
            NoSourceError   : Hard-fail — no sources found (HTTP 422 upstream).
            HTTPException   : Prompt injection detected (HTTP 400 upstream).
        """
        start = time.perf_counter()

        # Lazy import to avoid circular dependency at module load time
        from api.schemas import RAGQueryRequest
        from application.services.rag_service import rag_service as _rag_svc

        _service = self._rag or _rag_svc

        # Build the Pydantic schema expected by RAGService
        schema_req = RAGQueryRequest(
            query=request.query,
            case_id=str(request.case_id) if request.case_id else None,
            event_date=request.event_date,
            decision_date=request.decision_date,
            max_sources=request.max_sources,
        )

        rag_response = await _service.query(
            request=schema_req,
            tenant_context=request.tenant,
        )

        latency_ms = int((time.perf_counter() - start) * 1000)

        # Build lightweight response DTO
        resp = QueryLegalRAGResponse(
            answer=rag_response.answer,
            sources=[s.model_dump() for s in rag_response.sources],
            lehe_kanun_notice=(
                rag_response.lehe_kanun_notice.notice_text
                if rag_response.lehe_kanun_notice else None
            ),
            disclaimer=rag_response.disclaimer.full_text,
            disclaimer_severity=rag_response.disclaimer.severity,
            grounding_ratio=rag_response.grounding_report.grounding_ratio,
            ragas_overall=rag_response.ragas_metrics.overall_quality,
            tier_used=rag_response.audit_trail.tier,
            model_used=rag_response.audit_trail.model_used,
            cost_usd=float(rag_response.cost_estimate.total_cost_usd),
            latency_ms=latency_ms,
            request_id=rag_response.audit_trail.request_id,
        )

        # Fire-and-forget: persist audit + cost + RAGAS to DB
        if self._audit_repo:
            await self._persist_async(rag_response, resp)

        return resp

    async def _persist_async(self, rag_response: Any, resp: QueryLegalRAGResponse) -> None:
        """
        Persist audit_log, cost_log, and ragas_metrics_log rows.

        Failures are logged but never propagate — the answer was already
        returned to the user.
        """
        try:
            from infrastructure.audit.audit_trail import LegalAuditEntry
            # audit_log  (audit_trail IS the LegalAuditEntry returned by audit_recorder.record())
            entry: LegalAuditEntry = rag_response.audit_trail
            await self._audit_repo.save_audit_entry(entry)

            # cost_log
            cost = rag_response.cost_estimate
            await self._audit_repo.save_cost_record(CostRecord(
                request_id=resp.request_id,
                model_id=resp.model_used,
                tier=resp.tier_used,
                input_tokens=getattr(cost, "input_tokens", 0),
                output_tokens=getattr(cost, "output_tokens", 0),
                input_cost_usd=float(getattr(cost, "input_cost_usd", 0)),
                output_cost_usd=float(getattr(cost, "output_cost_usd", 0)),
                total_cost_usd=resp.cost_usd,
                cache_hit=getattr(cost, "cached", False),
                bureau_id=(
                    str(rag_response.audit_trail.bureau_id)
                    if rag_response.audit_trail.bureau_id else None
                ),
            ))

            # ragas_metrics_log
            ragas = rag_response.ragas_metrics
            await self._audit_repo.save_ragas_metrics(RAGASRecord(
                request_id=resp.request_id,
                faithfulness=ragas.faithfulness,
                answer_relevancy=ragas.answer_relevancy,
                context_precision=ragas.context_precision,
                context_recall=ragas.context_recall,
                overall_quality=ragas.overall_quality,
                tier=resp.tier_used,
                source_count=len(resp.sources),
                bureau_id=(
                    str(rag_response.audit_trail.bureau_id)
                    if rag_response.audit_trail.bureau_id else None
                ),
            ))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Audit persistence failed (non-fatal): %s — request_id=%s",
                exc, resp.request_id,
            )

    # ------------------------------------------------------------------
    # API-facing entrypoint (returns full RAGResponse for FastAPI routes)
    # ------------------------------------------------------------------

    async def execute_for_api(self, request: "QueryLegalRAGRequest") -> Any:
        """
        Identical pipeline to execute(), but returns the original RAGResponse
        (Pydantic) so the FastAPI route can honour its ``response_model``.

        Audit persistence still fires as a side effect.

        Args:
            request: QueryLegalRAGRequest DTO.

        Returns:
            api.schemas.RAGResponse  (full Pydantic model, not the flat DTO).

        Raises:
            Same exceptions as execute().
        """
        start = time.perf_counter()

        from api.schemas import RAGQueryRequest  # lazy import (no circular dep)
        from application.services.rag_service import rag_service as _rag_svc

        _service = self._rag or _rag_svc

        schema_req = RAGQueryRequest(
            query=request.query,
            case_id=str(request.case_id) if request.case_id else None,
            event_date=request.event_date,
            decision_date=request.decision_date,
            max_sources=request.max_sources,
        )

        rag_response = await _service.query(
            request=schema_req,
            tenant_context=request.tenant,
        )

        latency_ms = int((time.perf_counter() - start) * 1000)

        # Build flat resp for _persist_async (no wasted allocation — tiny obj)
        resp = QueryLegalRAGResponse(
            answer=rag_response.answer,
            sources=[s.model_dump() for s in rag_response.sources],
            lehe_kanun_notice=(
                rag_response.lehe_kanun_notice.notice_text
                if rag_response.lehe_kanun_notice else None
            ),
            disclaimer=rag_response.disclaimer.full_text,
            disclaimer_severity=rag_response.disclaimer.severity,
            grounding_ratio=rag_response.grounding_report.grounding_ratio,
            ragas_overall=rag_response.ragas_metrics.overall_quality,
            tier_used=rag_response.audit_trail.tier,
            model_used=rag_response.audit_trail.model_used,
            cost_usd=float(rag_response.cost_estimate.total_cost_usd),
            latency_ms=latency_ms,
            request_id=rag_response.audit_trail.request_id,
        )

        if self._audit_repo:
            await self._persist_async(rag_response, resp)

        return rag_response
