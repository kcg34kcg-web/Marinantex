"""
RAG Query Route  —  Step 10: Time-Travel Search ve "Lehe Kanun" Motoru
=======================================================================
Exposes the Zero-Trust RAG pipeline as a FastAPI endpoint.

Endpoint:
    POST /api/v1/rag/query

Step 10 features exposed here:
    - ``event_date``     in RAGQueryRequest  →  time-travel retrieval
    - ``decision_date``  in RAGQueryRequest  →  triggers lehe kanun engine
    - ``lehe_kanun_notice`` in RAGResponse   →  mandatory notice to UI

Hard-Fail contract (Step 1):
    HTTP 422 is returned when retrieval finds no source documents.
    The LLM is NEVER called in that case — cost = $0.

Tenant isolation (Step 6):
    TenantMiddleware injects ``request.state.tenant_context`` from the
    ``X-Bureau-ID`` header.  RAGService receives this context to scope
    Supabase queries to the authenticated bureau only.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from api.schemas import (
    AuditTraceResponseSchema,
    RAGQueryRequestV3,
    RAGResponseV3,
    RAGSaveRequestV3,
    RAGSaveResponseV3,
)
from application.services.rag_service import rag_service
from application.services.save_output_service import save_output_service
from application.use_cases.query_legal_rag import (
    QueryLegalRAGRequest,
    QueryLegalRAGUseCase,
)
from domain.entities.tenant import AccessLevel, TenantContext
from infrastructure.config import settings
from infrastructure.database.supabase_audit_repository import supabase_audit_repository

logger = logging.getLogger("babylexit.routes.rag")

# Module-level singleton — constructed once at import time.
# Injects supabase_audit_repository so every query automatically
# persists audit_log / cost_log / ragas_metrics_log rows.
_rag_use_case = QueryLegalRAGUseCase(
    rag_service=rag_service,
    audit_repository=supabase_audit_repository,
)

router = APIRouter()


@router.post(
    "/query",
    response_model=RAGResponseV3,
    status_code=status.HTTP_200_OK,
    summary="Zero-Trust Hukuki RAG Sorgusu",
    description=(
        "Hukuki soruyu Sıfır-Halüsinasyonlu (Zero-Trust) RAG hattından geçirir.\n\n"
        "### Hard-Fail Sözleşmesi (Adım 1)\n"
        "Hiç kaynak belgesi bulunamazsa **HTTP 422** döner.  LLM **asla** "
        "çağrılmaz — bu istek için maliyet = **$0**.\n\n"
        "### Lehe Kanun — Zaman-Yolculuğu Araması (Adım 10)\n"
        "Ceza hukuku (TCK), idari ceza (Kabahatler Kanunu) veya vergi cezası "
        "(VUK) sorgularında `event_date` *ve* `decision_date` sağlanırsa:\n"
        "- Lehe kanun motoru devreye girer (TCK Madde 7/2).\n"
        "- Retrieval katmanı **her iki yasa sürümünü** (olay tarihi + karar tarihi) "
        "otomatik olarak getirir.\n"
        "- Yanıttaki `lehe_kanun_notice` alanı avukata zorunlu uyarı verir.\n\n"
        "### Büro İzolasyonu (Adım 6)\n"
        "`X-Bureau-ID` başlığı belge aramasını yalnızca o büronun belgelerine "
        "kısıtlar.  Farklı büro belgelerine erişim imkânsızdır."
    ),
    responses={
        200: {
            "description": "Kaynaklı RAG cevabı (tüm alıntılar doğrulanabilir)",
        },
        400: {
            "description": (
                "Prompt injection tespit edildi — sorgu veya alınan bağlamda "
                "kötü niyetli yönerge bulundu"
            ),
        },
        422: {
            "description": (
                "Hard-Fail: Sorgu için hiç kaynak belge bulunamadı.  "
                "LLM çağrılmadı, maliyet = $0."
            ),
        },
        503: {
            "description": "Supabase vektör altyapısı erişilemez durumda",
        },
    },
    tags=["RAG"],
)
async def rag_query(
    request_body: RAGQueryRequestV3,
    request: Request,
) -> RAGResponseV3:
    """
    Hukuki RAG sorgu endpoint'i.

    Akış:
        1.  TenantMiddleware'in ``request.state.tenant_context`` alanını oku.
        2.  RAGService.query() çağır; tüm pipeline orada işler:
              - Prompt injection guard (Adım 7)
              - KVKK PII tespiti (Adım 6)
              - Semantik önbellek (Adım 8)
              - Lehe kanun kontrolü + zaman-yolculuğu araması (Adım 10)
              - Hard-Fail kapısı (Adım 1)
              - LLM çağrısı (Adım 9)
        3.  RAGResponse (kaynaklı cevap + lehe uyarısı) döndür.

    Args:
        request_body: Pydantic-validated RAGQueryRequest.
        request:      FastAPI Request — tenant context alınır.

    Returns:
        RAGResponse with answer, grounding sources, and optional lehe notice.

    Raises:
        HTTPException 400: Prompt injection detected.
        HTTPException 422: Hard-Fail — no sources found.
        HTTPException 503: Supabase unreachable.
    """
    # Resolve bureau context injected by TenantMiddleware.
    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    effective_bureau_id: Optional[str] = (
        str(tenant_context.bureau_id)
        if tenant_context and tenant_context.bureau_id
        else None
    )

    # Optional body fallback for test fixtures/non-proxied callers.
    if effective_bureau_id is None and getattr(request_body, "bureau_id", None):
        try:
            effective_bureau_id = str(UUID(str(request_body.bureau_id)))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"bureau_id is not a valid UUID: {request_body.bureau_id}",
            ) from exc

        if tenant_context is None or not tenant_context.is_isolated:
            tenant_context = TenantContext(
                bureau_id=effective_bureau_id,
                user_id=getattr(tenant_context, "user_id", None),
                access_level=getattr(tenant_context, "access_level", AccessLevel.MEMBER),
                is_service_account=False,
            )

    if (
        settings.multi_tenancy_enabled
        and settings.tenant_hard_fail_missing_bureau
        and (settings.is_production or settings.tenant_enforce_in_dev)
        and not effective_bureau_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Tenant context missing: X-Bureau-ID header (or bureau_id body field) is required."
            ),
        )

    logger.info(
        "RAG_ROUTE_REQUEST | query_len=%d | bureau=%s | "
        "chat_mode=%s | ai_tier=%s | response_depth=%s | as_of_date=%s | event_date=%s | decision_date=%s",
        len(request_body.query),
        effective_bureau_id,
        request_body.chat_mode.value,
        request_body.ai_tier.value,
        request_body.response_depth.value,
        getattr(request_body, "as_of_date", None),
        request_body.event_date,
        getattr(request_body, "decision_date", None),
    )

    # Build the framework-agnostic DTO for the use case.
    # execute_for_api() calls rag_service internally, persists the audit
    # trail as a side effect, and returns the full RAGResponse (Pydantic).
    dto = QueryLegalRAGRequest(
        query=request_body.query,
        thread_id=UUID(request_body.thread_id) if getattr(request_body, "thread_id", None) else None,
        history=list(getattr(request_body, "history", []) or []),
        chat_mode=request_body.chat_mode,
        ai_tier=request_body.ai_tier.value,
        response_depth=request_body.response_depth.value,
        tenant=tenant_context,
        case_id=UUID(request_body.case_id) if getattr(request_body, "case_id", None) else None,
        as_of_date=getattr(request_body, "as_of_date", None),
        event_date=request_body.event_date,
        decision_date=getattr(request_body, "decision_date", None),
        max_sources=getattr(request_body, "max_sources", 8),
        strict_grounding=getattr(request_body, "strict_grounding", None),
        active_document_ids=list(getattr(request_body, "active_document_ids", []) or []),
        save_mode=request_body.save_mode.value if getattr(request_body, "save_mode", None) else None,
        client_action=request_body.client_action.value if getattr(request_body, "client_action", None) else None,
    )

    return await _rag_use_case.execute_for_api(dto)


@router.post(
    "/save",
    response_model=RAGSaveResponseV3,
    status_code=status.HTTP_200_OK,
    summary="Save chat output to My Files / Case / Clients draft",
    tags=["RAG"],
)
async def rag_save_output(
    request_body: RAGSaveRequestV3,
    request: Request,
) -> RAGSaveResponseV3:
    """
    Step 24 unified save endpoint.

    Saves one chat output atomically with optional:
      - case creation/link
      - citation snapshot rows
      - client draft row (MVP draft only)
    """
    if not settings.save_targets_v2:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Save flow is temporarily disabled by feature flag (save_targets_v2).",
        )

    if (
        request_body.client_action.value != "none"
        and not settings.client_translator_draft
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Client draft generation is disabled by feature flag "
                "(client_translator_draft)."
            ),
        )

    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    effective_bureau_id: Optional[str] = (
        str(tenant_context.bureau_id)
        if tenant_context and tenant_context.bureau_id
        else None
    )
    effective_user_id: Optional[str] = (
        str(tenant_context.user_id)
        if tenant_context and tenant_context.user_id
        else None
    )

    if (
        settings.multi_tenancy_enabled
        and settings.tenant_hard_fail_missing_bureau
        and not effective_bureau_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    if not effective_bureau_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bureau context is required for save operations.",
        )

    if not effective_user_id:
        header_user = request.headers.get("x-user-id") or request.headers.get("X-User-ID")
        effective_user_id = header_user.strip() if header_user else None

    if not effective_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User context missing: X-User-ID header is required.",
        )

    try:
        if effective_bureau_id:
            effective_bureau_id = str(UUID(effective_bureau_id))
        effective_user_id = str(UUID(effective_user_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid UUID in tenant context (bureau_id or user_id).",
        ) from exc

    logger.info(
        "RAG_SAVE_REQUEST | bureau=%s | user=%s | target=%s | mode=%s | client_action=%s",
        effective_bureau_id,
        effective_user_id,
        request_body.save_target.value,
        request_body.save_mode.value,
        request_body.client_action.value,
    )

    try:
        return await save_output_service.save(
            request_body,
            bureau_id=effective_bureau_id,
            user_id=effective_user_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("RAG_SAVE_FAILED | error=%s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Save transaction failed. Please try again.",
        ) from exc


@router.get(
    "/observability",
    status_code=status.HTTP_200_OK,
    summary="Tenant-scoped RAG observability snapshot",
    tags=["RAG"],
)
async def rag_observability_snapshot(
    request: Request,
    window_hours: int = 24,
) -> dict:
    """
    Returns a tenant-scoped observability snapshot:
      - request_count
      - avg / p95 latency
      - avg grounding ratio
      - avg estimated cost
      - stream_ttft_ms_estimate (derived)
    """
    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    effective_bureau_id: Optional[str] = (
        str(tenant_context.bureau_id)
        if tenant_context and tenant_context.bureau_id
        else None
    )

    if (
        settings.multi_tenancy_enabled
        and settings.tenant_hard_fail_missing_bureau
        and not effective_bureau_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    bureau_uuid = UUID(effective_bureau_id) if effective_bureau_id else None
    snapshot = await supabase_audit_repository.get_observability_snapshot(
        bureau_id=bureau_uuid,
        window_hours=max(1, min(int(window_hours), 24 * 30)),
    )
    if snapshot is None:
        return {
            "window_hours": int(window_hours),
            "request_count": 0,
            "avg_query_latency_ms": 0.0,
            "p95_query_latency_ms": 0.0,
            "stream_ttft_ms_estimate": 0.0,
            "avg_grounding_ratio": 0.0,
            "avg_estimated_cost_usd": 0.0,
        }
    return snapshot


@router.get(
    "/audit/{request_id}",
    response_model=AuditTraceResponseSchema,
    status_code=status.HTTP_200_OK,
    summary="Audit trace by audit_trail_id",
    tags=["RAG"],
)
async def rag_audit_trace(
    request_id: UUID,
    request: Request,
) -> AuditTraceResponseSchema:
    """
    Returns the persisted audit trace for a previously generated answer.
    """
    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    effective_bureau_id: Optional[str] = (
        str(tenant_context.bureau_id)
        if tenant_context and tenant_context.bureau_id
        else None
    )

    if (
        settings.multi_tenancy_enabled
        and settings.tenant_hard_fail_missing_bureau
        and not effective_bureau_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    bureau_uuid = UUID(effective_bureau_id) if effective_bureau_id else None
    trace = await supabase_audit_repository.get_audit_trace(
        request_id=request_id,
        bureau_id=bureau_uuid,
    )
    if trace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit trail not found for this request_id in the current tenant scope.",
        )
    return AuditTraceResponseSchema.model_validate(trace)
