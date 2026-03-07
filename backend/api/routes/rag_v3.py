"""RAG v3 routes: ingestion + baseline retrieval query."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from infrastructure.config import settings
from application.services.rag_v3_service import (
    RagV3DeleteCommand,
    RagV3DeleteResult,
    RagV3IngestCommand,
    RagV3IngestResult,
    RagV3ObservabilitySnapshot,
    RagV3QueryCommand,
    RagV3QueryResult,
    RagV3RevokeCommand,
    RagV3RevokeResult,
    rag_v3_service,
)
from domain.entities.tenant import AccessLevel, TenantContext

router = APIRouter()
logger = logging.getLogger("babylexit.rag_v3.route")


class RagV3IngestRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    source_type: str = Field(..., min_length=1, max_length=120)
    source_id: str = Field(..., min_length=1, max_length=120)
    raw_text: str = Field(..., min_length=1, max_length=2_000_000)
    source_format: str = Field(default="text", description="text | pdf | html | docx")
    classification: str = Field(
        ...,
        description="PUBLIC | INTERNAL | CONFIDENTIAL | SENSITIVE",
    )
    jurisdiction: str = Field(default="TR", min_length=2, max_length=10)
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    acl_tags: list[str] = Field(default_factory=list)
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
    history: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    top_k: int = Field(default=10, ge=1, le=20)
    jurisdiction: str = Field(default="TR", min_length=2, max_length=10)
    as_of_date: Optional[date] = None
    event_date: Optional[date] = None
    decision_date: Optional[date] = None
    requested_tier: Optional[int] = Field(default=2, ge=1, le=4)
    snapshot_id: Optional[int] = Field(default=None, ge=0)
    acl_tags: list[str] = Field(default_factory=list)
    policy_context: dict[str, Any] = Field(default_factory=dict)


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
    temporal_version: Optional[str] = None
    evidence_text: Optional[str] = None
    evidence_start: Optional[int] = None
    evidence_end: Optional[int] = None
    evidence_overlap: Optional[float] = None


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
    sensitivity: str = "public"
    residency: str = "global"
    external_transfer: str = "allowed"
    retention: str = "standard"
    privilege_scope: str = "none"
    purpose_of_use: str = "research"
    source_rights: str = "owned"
    exportability: str = "exportable"
    provider_allowlist: list[str] = Field(default_factory=list)


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
    snapshot_id: Optional[int] = None
    revocation_epoch: int = 0
    review_ticket_id: Optional[str] = None
    claim_verification: RagV3ClaimVerificationSchema
    policy: RagV3PolicySchema
    admission: RagV3AdmissionSchema
    estimated_cost: float = Field(default=0.0, ge=0.0)
    cost_estimate: dict[str, Any] = Field(default_factory=dict)
    contract_version: str
    schema_version: str


class RagV3DeleteRequest(BaseModel):
    document_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    source_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    purge_raw_storage: bool = Field(
        default=False,
        description="If true, attempts to delete raw stored object(s) from Supabase storage.",
    )

    @model_validator(mode="after")
    def _validate_identity(self) -> "RagV3DeleteRequest":
        has_document_id = bool((self.document_id or "").strip())
        has_source_id = bool((self.source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id is required.")
        return self


class RagV3DeleteResponse(BaseModel):
    deleted_document_ids: list[str] = Field(default_factory=list)
    deleted_documents: int = 0
    deleted_chunks: int = 0
    raw_storage_delete_attempted: int = 0
    raw_storage_deleted: int = 0
    warnings: list[str] = Field(default_factory=list)
    contract_version: str
    schema_version: str


class RagV3RevokeRequest(BaseModel):
    action: str = Field(..., description="revoke | tombstone | legal_hold | restore")
    document_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    source_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    reason: Optional[str] = Field(default=None, max_length=400)

    @model_validator(mode="after")
    def _validate_identity(self) -> "RagV3RevokeRequest":
        has_document_id = bool((self.document_id or "").strip())
        has_source_id = bool((self.source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id is required.")
        return self


class RagV3RevokeResponse(BaseModel):
    action: str
    affected_document_ids: list[str] = Field(default_factory=list)
    affected_documents: int = 0
    revocation_epoch: int = 0
    warnings: list[str] = Field(default_factory=list)
    contract_version: str
    schema_version: str


class RagV3IntegrityResponse(BaseModel):
    bureau_id: Optional[str] = None
    document_count: int = 0
    chunk_count: int = 0
    documents_without_chunks: int = 0
    documents_without_chunks_ids: list[str] = Field(default_factory=list)
    classification_breakdown: dict[str, int] = Field(default_factory=dict)
    checked_at: str
    contract_version: str
    schema_version: str


class RagV3ObservabilityResponse(BaseModel):
    window_hours: int
    request_count: int
    avg_query_latency_ms: float
    p95_query_latency_ms: float
    no_answer_rate: float
    security_block_rate: float
    cache_hit_rate: float
    avg_retrieved_count: float
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


def _coerce_access_level(value: Any) -> AccessLevel:
    if isinstance(value, AccessLevel):
        return value
    token = str(value or "").strip().upper()
    if token in {"OWNER", "LAWYER", "ADMIN"}:
        return AccessLevel.OWNER
    if token in {"READ_ONLY", "READONLY", "READ-ONLY", "CLIENT", "GUEST", "VIEWER"}:
        return AccessLevel.READ_ONLY
    return AccessLevel.MEMBER


def _resolve_access_level(request: Request) -> AccessLevel:
    tenant_context: Optional[TenantContext] = (
        getattr(request.state, "tenant", None)
        or getattr(request.state, "tenant_context", None)
    )
    if tenant_context:
        return _coerce_access_level(getattr(tenant_context, "access_level", None))
    header_value = request.headers.get("x-access-level") or request.headers.get("X-Access-Level")
    if header_value:
        return _coerce_access_level(header_value)
    return AccessLevel.MEMBER


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
    access_level = _resolve_access_level(request)
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
                classification=request_body.classification,
                effective_from=request_body.effective_from,
                effective_to=request_body.effective_to,
                acl_tags=request_body.acl_tags,
                metadata=request_body.metadata,
            ),
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
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
    access_level = _resolve_access_level(request)
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
                history=request_body.history,
                top_k=request_body.top_k,
                jurisdiction=request_body.jurisdiction,
                as_of_date=request_body.as_of_date,
                event_date=request_body.event_date,
                decision_date=request_body.decision_date,
                requested_tier=request_body.requested_tier,
                snapshot_id=request_body.snapshot_id,
                acl_tags=request_body.acl_tags,
                policy_context=request_body.policy_context,
            ),
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if not bool(getattr(settings, "llm_provider_fail_open_enabled", True)):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="RAG v3 query unavailable.",
            ) from exc

        logger.error("RAG_V3_QUERY_ROUTE_FAIL_OPEN | reason=%s", exc, exc_info=True)
        tier = request_body.requested_tier if request_body.requested_tier in (1, 2, 3, 4) else 2
        no_answer_text = "Mevcut baglamda yeterli kanit yok / bulunamadi."
        return RagV3QueryResponse(
            request_id=str(uuid4()),
            answer=no_answer_text,
            status="no_answer",
            gate_decision="route_exception_fail_open",
            citations=[],
            structured=RagV3StructuredAnswerSchema(
                answer_text=no_answer_text,
                citations=[],
                confidence=0.0,
                should_escalate=True,
                follow_up_questions=["Madde/fikra veya kaynak id belirterek soruyu daraltabilir misiniz?"],
                warnings=["route_exception_fail_open"],
                legal_disclaimer="",
            ),
            fingerprint=RagV3FingerprintSchema(
                model_name="none",
                model_version="none/none",
                index_version="rag_v3_route_fail_open",
                prompt_version="rag_v3_zero_trust_v2",
                doc_hashes=[],
                chunk_hashes=[],
            ),
            retrieved_count=0,
            resolved_as_of_date=request_body.as_of_date,
            review_ticket_id=None,
            claim_verification=RagV3ClaimVerificationSchema(
                total_claims=0,
                supported_claims=0,
                support_ratio=1.0,
                unsupported_claims=[],
                passed=True,
            ),
            policy=RagV3PolicySchema(
                risk_level="LOW",
                policy_flags=["ROUTE_EXCEPTION_FAIL_OPEN"],
                legal_disclaimer="",
                should_escalate=True,
            ),
            admission=RagV3AdmissionSchema(
                accepted=True,
                reason="route_exception_fail_open",
                queue_wait_ms=0,
                effective_tier=tier,
                degraded=True,
            ),
            estimated_cost=0.0,
            cost_estimate={},
            contract_version=settings.rag_v3_query_contract_version,
            schema_version=settings.rag_v3_query_schema_version,
        )

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
                temporal_version=item.temporal_version,
                evidence_text=item.evidence_text,
                evidence_start=item.evidence_start,
                evidence_end=item.evidence_end,
                evidence_overlap=item.evidence_overlap,
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
        snapshot_id=result.snapshot_id,
        revocation_epoch=int(result.revocation_epoch),
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
            sensitivity=result.policy.sensitivity,
            residency=result.policy.residency,
            external_transfer=result.policy.external_transfer,
            retention=result.policy.retention,
            privilege_scope=result.policy.privilege_scope,
            purpose_of_use=result.policy.purpose_of_use,
            source_rights=result.policy.source_rights,
            exportability=result.policy.exportability,
            provider_allowlist=result.policy.provider_allowlist,
        ),
        admission=RagV3AdmissionSchema(
            accepted=result.admission.accepted,
            reason=result.admission.reason,
            queue_wait_ms=result.admission.queue_wait_ms,
            effective_tier=result.admission.effective_tier,
            degraded=result.admission.degraded,
        ),
        estimated_cost=max(0.0, float(result.estimated_cost or 0.0)),
        cost_estimate=dict(result.cost_estimate or {}),
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.post(
    "/delete",
    response_model=RagV3DeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 document delete (document_id or source_id)",
    tags=["RAG-V3"],
)
async def rag_v3_delete_document(
    request_body: RagV3DeleteRequest,
    request: Request,
) -> RagV3DeleteResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
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
        result: RagV3DeleteResult = await rag_v3_service.delete_document(
            RagV3DeleteCommand(
                document_id=request_body.document_id,
                source_id=request_body.source_id,
                purge_raw_storage=request_body.purge_raw_storage,
            ),
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 delete unavailable.",
        ) from exc

    return RagV3DeleteResponse(
        deleted_document_ids=result.deleted_document_ids,
        deleted_documents=result.deleted_documents,
        deleted_chunks=result.deleted_chunks,
        raw_storage_delete_attempted=result.raw_storage_delete_attempted,
        raw_storage_deleted=result.raw_storage_deleted,
        warnings=result.warnings,
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.post(
    "/revoke",
    response_model=RagV3RevokeResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 lifecycle action (revoke/tombstone/legal_hold/restore)",
    tags=["RAG-V3"],
)
async def rag_v3_revoke(
    request_body: RagV3RevokeRequest,
    request: Request,
) -> RagV3RevokeResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
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
        result: RagV3RevokeResult = await rag_v3_service.revoke_document(
            RagV3RevokeCommand(
                action=request_body.action,
                document_id=request_body.document_id,
                source_id=request_body.source_id,
                reason=request_body.reason,
            ),
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 revoke unavailable.",
        ) from exc

    return RagV3RevokeResponse(
        action=result.action,
        affected_document_ids=result.affected_document_ids,
        affected_documents=result.affected_documents,
        revocation_epoch=result.revocation_epoch,
        warnings=result.warnings,
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.get(
    "/integrity",
    response_model=RagV3IntegrityResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 corpus integrity snapshot",
    tags=["RAG-V3"],
)
async def rag_v3_integrity_snapshot(
    request: Request,
) -> RagV3IntegrityResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
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
        payload = await rag_v3_service.get_index_integrity(
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 integrity snapshot unavailable.",
        ) from exc

    return RagV3IntegrityResponse.model_validate(payload)


@router.get(
    "/observability",
    response_model=RagV3ObservabilityResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 tenant-scoped observability snapshot",
    tags=["RAG-V3"],
)
async def rag_v3_observability_snapshot(
    request: Request,
    window_hours: int = 24,
) -> RagV3ObservabilityResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
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
        snapshot: RagV3ObservabilitySnapshot = await rag_v3_service.get_observability_snapshot(
            bureau_id=bureau_id,
            window_hours=window_hours,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 observability snapshot unavailable.",
        ) from exc

    return RagV3ObservabilityResponse(
        window_hours=snapshot.window_hours,
        request_count=snapshot.request_count,
        avg_query_latency_ms=snapshot.avg_query_latency_ms,
        p95_query_latency_ms=snapshot.p95_query_latency_ms,
        no_answer_rate=snapshot.no_answer_rate,
        security_block_rate=snapshot.security_block_rate,
        cache_hit_rate=snapshot.cache_hit_rate,
        avg_retrieved_count=snapshot.avg_retrieved_count,
        contract_version=snapshot.contract_version,
        schema_version=snapshot.schema_version,
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
