"""RAG v3 routes: ingestion + baseline retrieval query."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from infrastructure.config import settings
from application.services.rag_v3_service import (
    RagV3IngestCommand,
    RagV3IngestResult,
    RagV3QueryCommand,
    RagV3QueryResult,
    rag_v3_service,
)
from domain.entities.tenant import TenantContext

router = APIRouter()


class RagV3IngestRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    source_type: str = Field(..., min_length=1, max_length=120)
    source_id: str = Field(..., min_length=1, max_length=120)
    raw_text: str = Field(..., min_length=1, max_length=2_000_000)
    source_format: str = Field(default="text", description="text | pdf | html")
    jurisdiction: str = Field(default="TR", min_length=2, max_length=10)
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    acl_tags: list[str] = Field(default_factory=lambda: ["public"])
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagV3IngestResponse(BaseModel):
    document_id: str
    chunk_count: int
    doc_hash: str
    chunk_hashes: list[str]
    warnings: list[str] = Field(default_factory=list)
    contract_version: str
    schema_version: str


class RagV3QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    top_k: int = Field(default=10, ge=1, le=20)
    jurisdiction: str = Field(default="TR", min_length=2, max_length=10)
    as_of_date: Optional[date] = None
    requested_tier: Optional[int] = Field(default=2, ge=1, le=4)
    acl_tags: list[str] = Field(default_factory=lambda: ["public"])


class RagV3CitationSchema(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    source_id: str
    source_type: str
    article_no: Optional[str] = None
    clause_no: Optional[str] = None
    subclause_no: Optional[str] = None
    page_range: Optional[str] = None
    final_score: float


class RagV3FingerprintSchema(BaseModel):
    model_name: str
    model_version: str
    index_version: str
    prompt_version: str
    doc_hashes: list[str]
    chunk_hashes: list[str]


class RagV3StructuredCitationSchema(BaseModel):
    source_id: str
    article_no: Optional[str] = None
    clause_no: Optional[str] = None
    chunk_id: Optional[str] = None


class RagV3StructuredAnswerSchema(BaseModel):
    answer_text: str
    citations: list[RagV3StructuredCitationSchema] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    should_escalate: bool = False
    follow_up_questions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    legal_disclaimer: str = ""


class RagV3ClaimVerificationSchema(BaseModel):
    total_claims: int = 0
    supported_claims: int = 0
    support_ratio: float = Field(default=1.0, ge=0.0, le=1.0)
    unsupported_claims: list[str] = Field(default_factory=list)
    passed: bool = True


class RagV3PolicySchema(BaseModel):
    risk_level: str = "LOW"
    policy_flags: list[str] = Field(default_factory=list)
    legal_disclaimer: str = ""
    should_escalate: bool = False


class RagV3AdmissionSchema(BaseModel):
    accepted: bool
    reason: str
    queue_wait_ms: int = 0
    effective_tier: int = Field(ge=1, le=4)
    degraded: bool = False


class RagV3QueryResponse(BaseModel):
    request_id: str
    answer: str
    status: str = Field(description="ok | no_answer")
    gate_decision: str
    citations: list[RagV3CitationSchema] = Field(default_factory=list)
    structured: RagV3StructuredAnswerSchema
    fingerprint: RagV3FingerprintSchema
    retrieved_count: int
    resolved_as_of_date: Optional[date] = None
    review_ticket_id: Optional[str] = None
    claim_verification: RagV3ClaimVerificationSchema
    policy: RagV3PolicySchema
    admission: RagV3AdmissionSchema
    contract_version: str
    schema_version: str


class RagV3QueryTraceResponse(BaseModel):
    request_id: str
    created_at: Optional[str] = None
    bureau_id: Optional[str] = None
    query_text: str
    response_status: str
    gate_decision: str
    requested_tier: int
    effective_tier: int
    top_k: int
    jurisdiction: str
    as_of_date: Optional[str] = None
    admission_reason: str
    retrieved_count: int
    retrieved_chunk_ids: list[str] = Field(default_factory=list)
    retrieval_trace: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    fingerprint: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    contract_version: str
    schema_version: str
    latency_ms: int
    metadata: dict[str, Any] = Field(default_factory=dict)


def _resolve_bureau_id(request: Request) -> Optional[UUID]:
    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    if tenant_context and tenant_context.bureau_id:
        return UUID(str(tenant_context.bureau_id))
    return None


@router.post(
    "/ingest",
    response_model=RagV3IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="RAG v3 source ingest",
    tags=["RAG-V3"],
)
async def rag_v3_ingest(
    request_body: RagV3IngestRequest,
    request: Request,
) -> RagV3IngestResponse:
    bureau_id = _resolve_bureau_id(request)
    if (
        settings.multi_tenancy_enabled
        and settings.rag_v3_tenant_hard_fail_missing_bureau
        and (settings.is_production or settings.tenant_enforce_in_dev)
        and bureau_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    try:
        result: RagV3IngestResult = await rag_v3_service.ingest(
            RagV3IngestCommand(
                title=request_body.title,
                source_type=request_body.source_type,
                source_id=request_body.source_id,
                jurisdiction=request_body.jurisdiction,
                raw_text=request_body.raw_text,
                source_format=request_body.source_format,
                effective_from=request_body.effective_from,
                effective_to=request_body.effective_to,
                acl_tags=request_body.acl_tags,
                metadata=request_body.metadata,
            ),
            bureau_id=bureau_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 ingest unavailable.",
        ) from exc

    return RagV3IngestResponse(
        document_id=result.document_id,
        chunk_count=result.chunk_count,
        doc_hash=result.doc_hash,
        chunk_hashes=result.chunk_hashes,
        warnings=result.warnings,
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.post(
    "/query",
    response_model=RagV3QueryResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 baseline retrieval query",
    tags=["RAG-V3"],
)
async def rag_v3_query(
    request_body: RagV3QueryRequest,
    request: Request,
) -> RagV3QueryResponse:
    bureau_id = _resolve_bureau_id(request)
    if (
        settings.multi_tenancy_enabled
        and settings.rag_v3_tenant_hard_fail_missing_bureau
        and (settings.is_production or settings.tenant_enforce_in_dev)
        and bureau_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    try:
        result: RagV3QueryResult = await rag_v3_service.query(
            RagV3QueryCommand(
                query=request_body.query,
                top_k=request_body.top_k,
                jurisdiction=request_body.jurisdiction,
                as_of_date=request_body.as_of_date,
                requested_tier=request_body.requested_tier,
                acl_tags=request_body.acl_tags,
            ),
            bureau_id=bureau_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 query unavailable.",
        ) from exc

    return RagV3QueryResponse(
        request_id=result.request_id,
        answer=result.answer,
        status=result.status,
        gate_decision=result.gate_decision,
        citations=[
            RagV3CitationSchema(
                chunk_id=item.chunk_id,
                document_id=item.document_id,
                title=item.title,
                source_id=item.source_id,
                source_type=item.source_type,
                article_no=item.article_no,
                clause_no=item.clause_no,
                subclause_no=item.subclause_no,
                page_range=item.page_range,
                final_score=item.final_score,
            )
            for item in result.citations
        ],
        structured=RagV3StructuredAnswerSchema(
            answer_text=result.structured.answer_text,
            citations=[
                RagV3StructuredCitationSchema(
                    source_id=item.source_id,
                    article_no=item.article_no,
                    clause_no=item.clause_no,
                    chunk_id=item.chunk_id,
                )
                for item in result.structured.citations
            ],
            confidence=result.structured.confidence,
            should_escalate=result.structured.should_escalate,
            follow_up_questions=result.structured.follow_up_questions,
            warnings=result.structured.warnings,
            legal_disclaimer=result.structured.legal_disclaimer,
        ),
        fingerprint=RagV3FingerprintSchema(
            model_name=result.fingerprint.model_name,
            model_version=result.fingerprint.model_version,
            index_version=result.fingerprint.index_version,
            prompt_version=result.fingerprint.prompt_version,
            doc_hashes=result.fingerprint.doc_hashes,
            chunk_hashes=result.fingerprint.chunk_hashes,
        ),
        retrieved_count=result.retrieved_count,
        resolved_as_of_date=result.resolved_as_of_date,
        review_ticket_id=result.review_ticket_id,
        claim_verification=RagV3ClaimVerificationSchema(
            total_claims=result.claim_verification.total_claims,
            supported_claims=result.claim_verification.supported_claims,
            support_ratio=result.claim_verification.support_ratio,
            unsupported_claims=result.claim_verification.unsupported_claims,
            passed=result.claim_verification.passed,
        ),
        policy=RagV3PolicySchema(
            risk_level=result.policy.risk_level,
            policy_flags=result.policy.policy_flags,
            legal_disclaimer=result.policy.legal_disclaimer,
            should_escalate=result.policy.should_escalate,
        ),
        admission=RagV3AdmissionSchema(
            accepted=result.admission.accepted,
            reason=result.admission.reason,
            queue_wait_ms=result.admission.queue_wait_ms,
            effective_tier=result.admission.effective_tier,
            degraded=result.admission.degraded,
        ),
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.get(
    "/audit/{request_id}",
    response_model=RagV3QueryTraceResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 request-level trace by request_id",
    tags=["RAG-V3"],
)
async def rag_v3_audit_trace(
    request_id: UUID,
    request: Request,
) -> RagV3QueryTraceResponse:
    bureau_id = _resolve_bureau_id(request)
    if (
        settings.multi_tenancy_enabled
        and settings.rag_v3_tenant_hard_fail_missing_bureau
        and (settings.is_production or settings.tenant_enforce_in_dev)
        and bureau_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context missing: X-Bureau-ID header is required.",
        )

    trace = await rag_v3_service.get_query_trace(
        request_id=str(request_id),
        bureau_id=bureau_id,
    )
    if trace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="RAG v3 trace not found for this request_id in the current tenant scope.",
        )
    return RagV3QueryTraceResponse.model_validate(trace)
