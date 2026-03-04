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
    ToolCallRecord,
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
    thread_id:       Optional[UUID]         = None
    history:         List[Dict[str, str]]   = field(default_factory=list)
    case_id:         Optional[UUID]         = None
    ai_tier:         str                    = "hazir_cevap"
    response_depth:  str                    = "standard"
    as_of_date:      Optional[date]         = None
    event_date:      Optional[date]         = None
    decision_date:   Optional[date]         = None
    max_sources:     int                    = 8
    chat_mode:       str                    = "general_chat"
    strict_grounding: Optional[bool]        = None
    active_document_ids: List[str]          = field(default_factory=list)
    save_mode:       Optional[str]          = None
    client_action:   Optional[str]          = None


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

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        """Best-effort float conversion with fallback."""
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)

    def _build_flat_response(
        self,
        rag_response: Any,
        latency_ms: int,
    ) -> QueryLegalRAGResponse:
        """
        Maps V3 RAGResponse fields to the framework-agnostic use-case DTO.

        V3 changes handled here:
        - `legal_disclaimer` is canonical (legacy `disclaimer` removed).
        - `grounding_ratio` lives at top-level.
        - `estimated_cost` lives at top-level.
        - detailed cost/ragas blocks live under `audit_trail` (optional).
        """
        audit_entry = getattr(rag_response, "audit_trail", None)
        legal_disclaimer = (
            getattr(rag_response, "legal_disclaimer", None)
            or getattr(rag_response, "disclaimer", None)
        )
        ragas_metrics = getattr(audit_entry, "ragas_metrics", None) if audit_entry else None
        audit_cost = getattr(audit_entry, "cost_estimate", None) if audit_entry else None

        tier_used = int(
            getattr(rag_response, "tier_used", None)
            or (getattr(audit_entry, "tier", None) if audit_entry else None)
            or 1
        )
        model_used = str(
            getattr(rag_response, "model_used", None)
            or (getattr(audit_entry, "model_used", None) if audit_entry else None)
            or ""
        )
        request_id = str(
            getattr(rag_response, "audit_trail_id", None)
            or (getattr(audit_entry, "request_id", None) if audit_entry else None)
            or ""
        )

        estimated_cost = self._safe_float(
            getattr(rag_response, "estimated_cost", 0.0),
            0.0,
        )
        if estimated_cost <= 0.0 and audit_cost is not None:
            estimated_cost = self._safe_float(
                getattr(audit_cost, "total_cost_usd", 0.0),
                0.0,
            )

        source_rows: List[Dict[str, Any]] = []
        for src in list(getattr(rag_response, "sources", []) or []):
            if hasattr(src, "model_dump"):
                source_rows.append(src.model_dump())
            elif isinstance(src, dict):
                source_rows.append(dict(src))

        return QueryLegalRAGResponse(
            answer=getattr(rag_response, "answer", ""),
            sources=source_rows,
            lehe_kanun_notice=(
                getattr(getattr(rag_response, "lehe_kanun_notice", None), "notice_text", None)
            ),
            disclaimer=(
                getattr(legal_disclaimer, "disclaimer_text", None)
                or getattr(legal_disclaimer, "full_text", "")
                if legal_disclaimer is not None
                else ""
            ),
            disclaimer_severity=(
                str(getattr(legal_disclaimer, "severity", "INFO"))
                if legal_disclaimer is not None
                else "INFO"
            ),
            grounding_ratio=self._safe_float(getattr(rag_response, "grounding_ratio", 0.0), 0.0),
            ragas_overall=self._safe_float(
                getattr(ragas_metrics, "overall_quality", 0.0),
                0.0,
            ),
            tier_used=tier_used,
            model_used=model_used,
            cost_usd=estimated_cost,
            latency_ms=latency_ms,
            request_id=request_id,
        )

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
        from api.schemas import RAGQueryRequestV3
        from application.services.rag_service import rag_service as _rag_svc

        _service = self._rag or _rag_svc

        # Build the Pydantic schema expected by RAGService
        schema_req = RAGQueryRequestV3(
            query=request.query,
            thread_id=str(request.thread_id) if request.thread_id else None,
            history=list(request.history),
            chat_mode=request.chat_mode,
            ai_tier=request.ai_tier,
            response_depth=request.response_depth,
            case_id=str(request.case_id) if request.case_id else None,
            as_of_date=request.as_of_date,
            event_date=request.event_date,
            decision_date=request.decision_date,
            max_sources=request.max_sources,
            strict_grounding=request.strict_grounding,
            active_document_ids=list(request.active_document_ids),
            save_mode=request.save_mode,
            client_action=request.client_action,
        )

        rag_response = await _service.query(
            request=schema_req,
            tenant_context=request.tenant,
        )

        latency_ms = int((time.perf_counter() - start) * 1000)

        # Build lightweight response DTO
        resp = self._build_flat_response(rag_response, latency_ms)

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
            entry = getattr(rag_response, "audit_trail", None)
            if entry is None:
                logger.warning(
                    "Audit persistence skipped: missing audit_trail | request_id=%s",
                    resp.request_id or "?",
                )
                return

            await self._audit_repo.save_audit_entry(entry)

            request_id = resp.request_id or str(getattr(entry, "request_id", "") or "")
            tier_used = int(
                resp.tier_used
                or getattr(entry, "tier", 0)
                or 1
            )
            model_used = resp.model_used or str(getattr(entry, "model_used", "") or "")

            # cost_log (V3: cost lives under audit_trail.cost_estimate)
            cost = getattr(entry, "cost_estimate", None)
            input_tokens = int(getattr(cost, "input_tokens", 0) or 0)
            output_tokens = int(getattr(cost, "output_tokens", 0) or 0)
            input_cost_usd = self._safe_float(getattr(cost, "input_cost_usd", 0.0), 0.0)
            output_cost_usd = self._safe_float(getattr(cost, "output_cost_usd", 0.0), 0.0)
            if input_cost_usd <= 0.0 and input_tokens > 0:
                input_cost_usd = (
                    input_tokens
                    * self._safe_float(getattr(cost, "rate_per_1m_in", 0.0), 0.0)
                    / 1_000_000.0
                )
            if output_cost_usd <= 0.0 and output_tokens > 0:
                output_cost_usd = (
                    output_tokens
                    * self._safe_float(getattr(cost, "rate_per_1m_out", 0.0), 0.0)
                    / 1_000_000.0
                )
            total_cost_usd = self._safe_float(resp.cost_usd, 0.0)
            if total_cost_usd <= 0.0:
                total_cost_usd = self._safe_float(getattr(cost, "total_cost_usd", 0.0), 0.0)
            if total_cost_usd <= 0.0:
                total_cost_usd = input_cost_usd + output_cost_usd

            bureau_id_str = str(getattr(entry, "bureau_id", None)) if getattr(entry, "bureau_id", None) else None
            await self._audit_repo.save_cost_record(CostRecord(
                request_id=request_id,
                model_id=model_used,
                tier=tier_used,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_cost_usd=input_cost_usd,
                output_cost_usd=output_cost_usd,
                total_cost_usd=total_cost_usd,
                cache_hit=bool(getattr(cost, "cached", False)) if cost is not None else False,
                bureau_id=bureau_id_str,
            ))

            # ragas_metrics_log (optional in V3)
            ragas = getattr(entry, "ragas_metrics", None)
            if ragas is not None:
                await self._audit_repo.save_ragas_metrics(RAGASRecord(
                    request_id=request_id,
                    faithfulness=self._safe_float(getattr(ragas, "faithfulness", 0.0), 0.0),
                    answer_relevancy=self._safe_float(getattr(ragas, "answer_relevancy", 0.0), 0.0),
                    context_precision=self._safe_float(getattr(ragas, "context_precision", 0.0), 0.0),
                    context_recall=self._safe_float(getattr(ragas, "context_recall", 0.0), 0.0),
                    overall_quality=self._safe_float(getattr(ragas, "overall_quality", 0.0), 0.0),
                    tier=tier_used,
                    source_count=len(resp.sources),
                    bureau_id=bureau_id_str,
                ))

            tool_rows: List[ToolCallRecord] = []
            for tool_name in list(getattr(entry, "tool_calls_made", []) or []):
                tool_rows.append(
                    ToolCallRecord(
                        request_id=request_id,
                        tool_name=tool_name,
                        success=True,
                        bureau_id=bureau_id_str,
                        case_id=getattr(entry, "case_id", None),
                        thread_id=getattr(entry, "thread_id", None),
                        query_text=getattr(rag_response, "query", None),
                    )
                )
            for tool_name in list(getattr(entry, "tool_errors", []) or []):
                tool_rows.append(
                    ToolCallRecord(
                        request_id=request_id,
                        tool_name=tool_name,
                        success=False,
                        bureau_id=bureau_id_str,
                        case_id=getattr(entry, "case_id", None),
                        thread_id=getattr(entry, "thread_id", None),
                        error_message="tool execution failed",
                        query_text=getattr(rag_response, "query", None),
                    )
                )
            if tool_rows:
                await self._audit_repo.save_tool_call_records(tool_rows)
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

        from api.schemas import RAGQueryRequestV3  # lazy import (no circular dep)
        from application.services.rag_service import rag_service as _rag_svc

        _service = self._rag or _rag_svc

        schema_req = RAGQueryRequestV3(
            query=request.query,
            thread_id=str(request.thread_id) if request.thread_id else None,
            history=list(request.history),
            chat_mode=request.chat_mode,
            ai_tier=request.ai_tier,
            response_depth=request.response_depth,
            case_id=str(request.case_id) if request.case_id else None,
            as_of_date=request.as_of_date,
            event_date=request.event_date,
            decision_date=request.decision_date,
            max_sources=request.max_sources,
            strict_grounding=request.strict_grounding,
            active_document_ids=list(request.active_document_ids),
            save_mode=request.save_mode,
            client_action=request.client_action,
        )

        rag_response = await _service.query(
            request=schema_req,
            tenant_context=request.tenant,
        )

        latency_ms = int((time.perf_counter() - start) * 1000)

        # Build flat resp for _persist_async (no wasted allocation — tiny obj)
        resp = self._build_flat_response(rag_response, latency_ms)

        if self._audit_repo:
            await self._persist_async(rag_response, resp)

        return rag_response
