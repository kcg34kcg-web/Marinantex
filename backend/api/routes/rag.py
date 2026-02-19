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

from fastapi import APIRouter, Request, status

from api.schemas import RAGQueryRequest, RAGResponse
from application.services.rag_service import rag_service
from domain.entities.tenant import TenantContext

logger = logging.getLogger("babylexit.routes.rag")

router = APIRouter()


@router.post(
    "/query",
    response_model=RAGResponse,
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
    request_body: RAGQueryRequest,
    request: Request,
) -> RAGResponse:
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
    # Resolve bureau context injected by TenantMiddleware
    tenant_context: Optional[TenantContext] = getattr(
        request.state, "tenant_context", None
    )

    logger.info(
        "RAG_ROUTE_REQUEST | query_len=%d | bureau=%s | "
        "event_date=%s | decision_date=%s",
        len(request_body.query),
        tenant_context.bureau_id if tenant_context else getattr(request_body, "bureau_id", None),
        request_body.event_date,
        getattr(request_body, "decision_date", None),
    )

    return await rag_service.query(request_body, tenant_context)
