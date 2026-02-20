"""
Ingest Route  —  Document Ingestion Endpoint
============================================
Exposes the full ingest pipeline as a FastAPI endpoint.

Endpoint:
    POST /api/v1/ingest/document

Pipeline (via IngestDocumentUseCase):
    1. OCR clean + Türkçe normalisation
    2. Structural parsing → LegalDocument segments
    3. Citation extraction (citation_edges table)
    4. Embedding generation
    5. DB upsert (public.documents via SupabaseDocumentRepository)
    6. Citation persistence (public.citation_edges via SupabaseCitationRepository)
    7. Async index enqueue (Celery — Step 11)

Tenant isolation (Step 6):
    TenantMiddleware injects ``request.state.tenant_context`` from the
    ``X-Bureau-ID`` header.  bureau_id from the header overrides the body
    field when both are provided.

Auth requirement:
    Ingestion is restricted to authenticated bureau users; the
    TenantMiddleware must have resolved a valid bureau context.
"""

from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from application.use_cases.ingest_document import (
    IngestDocumentRequest,
    IngestDocumentResult,
    IngestDocumentUseCase,
)
from domain.entities.tenant import TenantContext
from infrastructure.database.supabase_citation_repository import supabase_citation_repository
from infrastructure.database.supabase_document_repository import supabase_document_repository

logger = logging.getLogger("babylexit.routes.ingest")

router = APIRouter()

# Module-level use case singleton — shared across requests (thread-safe: stateless).
_ingest_use_case = IngestDocumentUseCase(
    document_repository=supabase_document_repository,
    citation_repository=supabase_citation_repository,
)


# ---------------------------------------------------------------------------
# HTTP Request / Response schemas (Pydantic v2)
# ---------------------------------------------------------------------------

class IngestDocumentHTTPRequest(BaseModel):
    """
    HTTP body for POST /api/v1/ingest/document.

    All heavy-lifting fields are passed through to IngestDocumentRequest.
    bureau_id / case_id can be omitted when the TenantMiddleware header
    provides the bureau context.
    """

    raw_text: str = Field(
        ...,
        min_length=1,
        description="Full raw text of the legal document (UTF-8). May contain OCR artefacts.",
    )
    source_url: str = Field(
        ...,
        min_length=1,
        description=(
            "Canonical URL or citation reference for provenance tracking. "
            "Example: 'https://www.lexpera.com.tr/...' or 'Yargıtay 9.HD, E.2020/12345'"
        ),
    )
    court_level: Optional[str] = Field(
        None,
        description="Court level identifier: AYM | YARGITAY | BÖLGE | ILK | YARGI",
    )
    citation: Optional[str] = Field(
        None,
        description=(
            "Formal citation string for this document. "
            "Example: 'Yargıtay 9. HD, 01.01.2023, E.2022/1, K.2023/1'"
        ),
    )
    norm_hierarchy: Optional[str] = Field(
        None,
        description=(
            "Norm hierarchy level for legal authority scoring (Step 3). "
            "Example: 'ANAYASA' | 'KANUN' | 'YONETMELIK'"
        ),
    )
    bureau_id: Optional[str] = Field(
        None,
        description=(
            "UUID of the bureau this document belongs to. "
            "Overridden by X-Bureau-ID header when TenantMiddleware resolves a context."
        ),
    )
    case_id: Optional[str] = Field(
        None,
        description="UUID of the legal case this document is associated with.",
    )
    document_type: str = Field(
        default="FULL",
        description="Segment type hint for the parser: FULL | HEADER | CLAUSE | FOOTNOTE",
    )


class IngestDocumentHTTPResponse(BaseModel):
    """
    HTTP response for POST /api/v1/ingest/document.

    Directly mirrors IngestDocumentResult but as a Pydantic model so
    FastAPI can serialise it automatically.
    """

    doc_id: str = Field(..., description="Primary document UUID created/updated in the DB.")
    segments_created: int = Field(..., description="Number of LegalDocument segments upserted.")
    citations_extracted: int = Field(..., description="Number of citation edges saved.")
    embedding_generated: bool = Field(..., description="True when at least one embedding was created.")
    enqueued_for_index: bool = Field(..., description="True when async Celery index task was enqueued.")
    warnings: List[str] = Field(
        default_factory=list,
        description="Non-fatal warnings collected during ingest (e.g. OCR issues, missing embeddings).",
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/document",
    response_model=IngestDocumentHTTPResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Hukuki Belge Yükle",
    description=(
        "Tek bir hukuki belgeyi tam ingest hattından geçirir:\n\n"
        "1. **OCR temizleme** + Türkçe normalleştirme\n"
        "2. **Yapısal ayrıştırma** → LegalDocument segmentleri\n"
        "3. **Atıf çıkarma** (citation_edges tablosu)\n"
        "4. **Embedding üretimi** (pgvector)\n"
        "5. **DB upsert** (public.documents)\n"
        "6. **Async indeksleme** (Celery kuyruğu — Adım 11)\n\n"
        "**Büro İzolasyonu (Adım 6)**: `X-Bureau-ID` başlığı belgeyi "
        "yalnızca o büronun namespace'ine yazar."
    ),
    responses={
        201: {"description": "Belge başarıyla işlendi ve kaydedildi."},
        400: {"description": "raw_text veya source_url eksik / boş."},
        422: {"description": "Pydantic doğrulama hatası (alan eksik/yanlış tip)."},
        503: {"description": "Supabase veya embedding servisi erişilemez."},
    },
    tags=["Ingest"],
)
async def ingest_document(
    request_body: IngestDocumentHTTPRequest,
    request: Request,
) -> IngestDocumentHTTPResponse:
    """
    Hukuki belge ingest endpoint'i.

    Akış:
        1. TenantMiddleware'in ``request.state.tenant_context`` alanından bureau_id al.
        2. IngestDocumentUseCase.execute() çağır.
        3. IngestDocumentHTTPResponse döndür.

    Args:
        request_body: Pydantic-validated IngestDocumentHTTPRequest.
        request:      FastAPI Request — tenant context alınır.

    Returns:
        IngestDocumentHTTPResponse with counts and status flags.

    Raises:
        HTTPException 400: raw_text / source_url boş.
        HTTPException 503: Supabase veya embedding servisi erişilemez.
    """
    # Resolve bureau context from TenantMiddleware (X-Bureau-ID header wins)
    tenant_context: Optional[TenantContext] = getattr(
        request.state, "tenant_context", None
    )

    # Determine effective bureau_id: header > body
    effective_bureau_id: Optional[UUID] = None
    if tenant_context and tenant_context.bureau_id:
        effective_bureau_id = UUID(str(tenant_context.bureau_id))
    elif request_body.bureau_id:
        try:
            effective_bureau_id = UUID(request_body.bureau_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"bureau_id is not a valid UUID: {request_body.bureau_id}",
            )

    case_id: Optional[UUID] = None
    if request_body.case_id:
        try:
            case_id = UUID(request_body.case_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"case_id is not a valid UUID: {request_body.case_id}",
            )

    logger.info(
        "INGEST_ROUTE_REQUEST | source_url=%s | bureau=%s | doc_type=%s",
        request_body.source_url[:80],
        effective_bureau_id,
        request_body.document_type,
    )

    dto = IngestDocumentRequest(
        raw_text=request_body.raw_text,
        source_url=request_body.source_url,
        court_level=request_body.court_level,
        citation=request_body.citation,
        norm_hierarchy=request_body.norm_hierarchy,
        bureau_id=effective_bureau_id,
        case_id=case_id,
        document_type=request_body.document_type,
    )

    try:
        result: IngestDocumentResult = await _ingest_use_case.execute(dto)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error("Ingest pipeline error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingest pipeline unavailable. Please try again later.",
        ) from exc

    logger.info(
        "INGEST_ROUTE_COMPLETE | doc_id=%s | segments=%d | citations=%d | "
        "embedding=%s | enqueued=%s | warnings=%d",
        result.doc_id,
        result.segments_created,
        result.citations_extracted,
        result.embedding_generated,
        result.enqueued_for_index,
        len(result.warnings),
    )

    return IngestDocumentHTTPResponse(
        doc_id=result.doc_id,
        segments_created=result.segments_created,
        citations_extracted=result.citations_extracted,
        embedding_generated=result.embedding_generated,
        enqueued_for_index=result.enqueued_for_index,
        warnings=result.warnings,
    )
