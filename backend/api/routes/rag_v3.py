"""RAG v3 routes: ingestion + baseline retrieval query."""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from infrastructure.config import settings
from infrastructure.alerting.dispatcher import evaluate_and_dispatch_alerts
from infrastructure.security.runtime_contract import active_model_fingerprint
from infrastructure.serving.qwen_deployment import resolve_qwen_serving_config
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
    source_format: str = Field(default="text", description="text | pdf | html | docx | xml | json")
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
    source_types: list[str] = Field(default_factory=list, max_length=16)
    as_of_date: Optional[date] = None
    event_date: Optional[date] = None
    decision_date: Optional[date] = None
    requested_tier: Optional[int] = Field(default=2, ge=1, le=4)
    snapshot_id: Optional[int] = Field(default=None, ge=0)
    acl_tags: list[str] = Field(default_factory=list)
    policy_context: dict[str, Any] = Field(default_factory=dict)
    legal_disclaimer_ack: bool = Field(default=False)
    human_responsibility_ack: bool = Field(default=False)
    selected_mode: str = Field(default="", max_length=40)

    @model_validator(mode="after")
    def _validate_disclaimer_ack(self) -> "RagV3QueryRequest":
        if bool(getattr(settings, "rag_v3_require_legal_disclaimer_ack", True)):
            if not self.legal_disclaimer_ack:
                raise ValueError("legal_disclaimer_ack must be true.")
            if not self.human_responsibility_ack:
                raise ValueError("human_responsibility_ack must be true.")
        return self


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
    source_char_start: Optional[int] = None
    source_char_end: Optional[int] = None
    paragraph_start: Optional[int] = None
    paragraph_end: Optional[int] = None
    section_path: Optional[str] = None
    source_url: Optional[str] = None
    final_score: float
    temporal_version: Optional[str] = None
    evidence_text: Optional[str] = None
    evidence_start: Optional[int] = None
    evidence_end: Optional[int] = None
    evidence_overlap: Optional[float] = None
    citation_date: Optional[str] = None
    issuing_authority: Optional[str] = None
    decision_no: Optional[str] = None
    reference_no: Optional[str] = None


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
    trace_id: str
    answer: str
    answer_text: str
    status: str = Field(description="ok | no_answer")
    gate_decision: str
    citations: list[RagV3CitationSchema] = Field(default_factory=list)
    source_documents: list[dict[str, Any]] = Field(default_factory=list)
    structured: RagV3StructuredAnswerSchema
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)
    fingerprint: RagV3FingerprintSchema
    retrieved_count: int
    resolved_as_of_date: Optional[date] = None
    snapshot_id: Optional[int] = None
    revocation_epoch: int = 0
    review_ticket_id: Optional[str] = None
    claim_verification: RagV3ClaimVerificationSchema
    policy: RagV3PolicySchema
    admission: RagV3AdmissionSchema
    review_required: bool = False
    review_reason_codes: list[str] = Field(default_factory=list)
    low_confidence: bool = False
    low_confidence_reason: str = ""
    legal_disclaimer_required: bool = True
    human_responsibility_notice: str = ""
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
    low_confidence_rate: float = 0.0
    review_required_rate: float = 0.0
    alerts_fired: int = 0
    alerts_delivered: int = 0
    alerts_failed: int = 0
    alerts_evaluated_rules: int = 0
    alerts_configured_sinks: list[str] = Field(default_factory=list)
    alerts_missing_metric_rules: list[str] = Field(default_factory=list)
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
    legal_disclaimer_ack: bool = False
    human_responsibility_ack: bool = False
    tier_policy_route_reason: Optional[str] = None
    query_expansion: dict[str, Any] = Field(default_factory=dict)
    prompt_scenario: Optional[str] = None
    prompt_registry_version: Optional[str] = None
    source_documents: list[dict[str, Any]] = Field(default_factory=list)
    review_required: bool = False
    review_reason_codes: list[str] = Field(default_factory=list)
    low_confidence: bool = False
    low_confidence_reason: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagV3ReviewQueueItemSchema(BaseModel):
    id: str
    status: str
    risk_level: Optional[str] = None
    severity: Optional[str] = None
    confidence: float = 0.0
    created_at: Optional[str] = None
    due_at: Optional[str] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[str] = None
    closure_code: Optional[str] = None
    escalation_reason: Optional[str] = None
    reason_codes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagV3ReviewQueueResponse(BaseModel):
    items: list[RagV3ReviewQueueItemSchema] = Field(default_factory=list)


class RagV3ModelRegistryResponse(BaseModel):
    backend: str
    served_model: str
    drift_detected: bool
    verified_80b_runtime: bool
    disallowed_models: dict[str, str] = Field(default_factory=dict)
    tiers: dict[str, str] = Field(default_factory=dict)


class RagV3SsoCapabilityResponse(BaseModel):
    oidc_supported: bool
    oidc_configured: bool
    oidc_verified: bool
    oidc_reason_codes: list[str] = Field(default_factory=list)
    saml_supported: bool
    saml_configured: bool
    saml_verified: bool
    saml_reason_codes: list[str] = Field(default_factory=list)
    enterprise_ready: bool = False
    federation_matrix: dict[str, dict[str, bool]] = Field(default_factory=dict)


class RagV3CorpusCoverageResponse(BaseModel):
    document_count: int
    verified_document_count: int
    verified_state: bool
    source_type_distribution: dict[str, int] = Field(default_factory=dict)
    court_distribution: dict[str, int] = Field(default_factory=dict)
    chamber_distribution: dict[str, int] = Field(default_factory=dict)
    date_range: dict[str, Optional[str]] = Field(default_factory=dict)
    metadata_completeness: dict[str, float] = Field(default_factory=dict)
    last_ingest_at: Optional[str] = None
    sample_truncated: bool = False
    checked_at: str
    contract_version: str
    schema_version: str


class RagV3ComplianceEvidenceResponse(BaseModel):
    legal_hold_document_count: int
    retention_events_30d: int
    anonymize_events_30d: int = 0
    hard_delete_events_30d: int = 0
    retention_last_event_at: Optional[str] = None
    freshness_checks_24h: int
    freshness_last_check_at: Optional[str] = None
    backup_restore_last_drill_at: Optional[str] = None
    rollback_last_drill_at: Optional[str] = None
    human_eval_rubric_count: int
    retention_policy_contract_path: Optional[str] = None
    retention_policy_contract_present: bool = False
    retention_policy_contract_version: Optional[str] = None
    dpia_evidence_present: bool = False
    ropa_evidence_present: bool = False
    legal_hold_pipeline_enabled: bool = False
    delete_pipeline_enabled: bool = False
    anonymize_pipeline_enabled: bool = False
    checked_at: str
    contract_version: str
    schema_version: str


class RagV3ReviewAssignRequest(BaseModel):
    reviewer_id: str = Field(..., min_length=36, max_length=36)
    sla_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 7 * 60)
    due_at: Optional[datetime] = None
    escalation_reason: Optional[str] = Field(default=None, max_length=400)


class RagV3ReviewCloseRequest(BaseModel):
    closed_by: str = Field(..., min_length=36, max_length=36)
    status: str = Field(..., description="resolved | rejected")
    closure_code: str = Field(..., min_length=2, max_length=60)
    reviewer_feedback: Optional[str] = Field(default=None, max_length=4000)
    escalation_reason: Optional[str] = Field(default=None, max_length=400)


class RagV3ReviewTicketResponse(BaseModel):
    id: str
    status: str
    assigned_to: Optional[str] = None
    due_at: Optional[str] = None
    resolved_at: Optional[str] = None
    closure_code: Optional[str] = None
    reviewer_feedback: Optional[str] = None


def _source_documents_from_citations(citations: list[Any]) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in citations:
        document_id = str(getattr(item, "document_id", "") or "").strip()
        source_id = str(getattr(item, "source_id", "") or "").strip()
        key = document_id or source_id
        if not key or key in out:
            continue
        out[key] = {
            "document_id": document_id or None,
            "source_id": source_id or None,
            "title": str(getattr(item, "title", "") or "").strip() or None,
            "source_type": str(getattr(item, "source_type", "") or "").strip() or None,
            "article_no": str(getattr(item, "article_no", "") or "").strip() or None,
            "clause_no": str(getattr(item, "clause_no", "") or "").strip() or None,
            "subclause_no": str(getattr(item, "subclause_no", "") or "").strip() or None,
            "page_range": str(getattr(item, "page_range", "") or "").strip() or None,
            "citation_date": str(getattr(item, "citation_date", "") or "").strip() or None,
            "issuing_authority": str(getattr(item, "issuing_authority", "") or "").strip() or None,
            "decision_no": str(getattr(item, "decision_no", "") or "").strip() or None,
            "reference_no": str(getattr(item, "reference_no", "") or "").strip() or None,
            "final_score": float(getattr(item, "final_score", 0.0) or 0.0),
            "temporal_version": str(getattr(item, "temporal_version", "") or "").strip() or None,
        }
    return list(out.values())


def _citation_contract_warnings(citations: list[Any]) -> list[str]:
    warnings: list[str] = []
    required_fields = (
        "chunk_id",
        "document_id",
        "source_id",
        "source_type",
        "citation_date",
        "issuing_authority",
    )
    for index, item in enumerate(citations, start=1):
        missing = [
            field
            for field in required_fields
            if not str(getattr(item, field, "") or "").strip()
        ]
        article_no = str(getattr(item, "article_no", "") or "").strip()
        decision_no = str(getattr(item, "decision_no", "") or "").strip()
        if not article_no and not decision_no:
            missing.append("article_or_decision_no")
        if missing:
            warnings.append(f"citation_contract_missing_fields:{index}:{','.join(missing)}")
    return warnings


def _has_valid_source_span(citation: Any) -> bool:
    char_start = getattr(citation, "source_char_start", None)
    char_end = getattr(citation, "source_char_end", None)
    paragraph_start = getattr(citation, "paragraph_start", None)
    paragraph_end = getattr(citation, "paragraph_end", None)

    has_char_span = isinstance(char_start, int) and isinstance(char_end, int) and char_start >= 0 and char_end > char_start
    has_paragraph_span = (
        isinstance(paragraph_start, int)
        and isinstance(paragraph_end, int)
        and paragraph_start >= 0
        and paragraph_end >= paragraph_start
    )
    return bool(has_char_span or has_paragraph_span)


def _strict_grounding_violation_codes(status_value: str, citations: list[Any]) -> list[str]:
    status_token = str(status_value or "").strip().lower()
    if status_token != "ok":
        return []

    violations: list[str] = []
    if not citations:
        return ["missing_citations"]

    for index, citation in enumerate(citations, start=1):
        source_url = str(getattr(citation, "source_url", "") or "").strip()
        if not source_url:
            violations.append(f"citation_{index}_missing_source_url")
        if not _has_valid_source_span(citation):
            violations.append(f"citation_{index}_missing_source_span")
    return violations


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


def _resolve_actor_id(request: Request) -> Optional[str]:
    state_subject = str(getattr(request.state, "auth_subject", "") or "").strip()
    if state_subject:
        return state_subject
    header_subject = str(request.headers.get("x-user-id") or request.headers.get("X-User-ID") or "").strip()
    if header_subject:
        return header_subject
    return None


def _coerce_ratio(value: Any) -> float:
    try:
        number = float(value)
    except Exception:  # noqa: BLE001
        return 0.0
    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number


def _alert_metrics_from_snapshot(snapshot: RagV3ObservabilitySnapshot) -> dict[str, float]:
    request_count = max(0, int(getattr(snapshot, "request_count", 0) or 0))
    no_answer_rate = _coerce_ratio(getattr(snapshot, "no_answer_rate", 0.0))
    low_confidence_rate = _coerce_ratio(getattr(snapshot, "low_confidence_rate", 0.0))
    security_block_rate = _coerce_ratio(getattr(snapshot, "security_block_rate", 0.0))
    security_alert_count = max(
        0.0,
        float(
            getattr(
                snapshot,
                "security_alert_count",
                round(float(request_count) * security_block_rate),
            )
            or 0.0
        ),
    )
    return {
        "rag_v3_retrieval_success_rate": max(0.0, 1.0 - no_answer_rate),
        "rag_v3_empty_result_rate": no_answer_rate,
        "rag_v3_low_confidence_rate": low_confidence_rate,
        "rag_v3_no_answer_rate": no_answer_rate,
        "rag_v3_repealed_source_hit_rate": max(0.0, float(getattr(snapshot, "repealed_source_hit_rate", 0.0) or 0.0)),
        "rag_v3_latency_p95_ms": max(0.0, float(getattr(snapshot, "p95_query_latency_ms", 0.0) or 0.0)),
        "rag_v3_provider_cost_per_1k_requests": max(
            0.0,
            float(getattr(snapshot, "provider_cost_per_1k_requests", 0.0) or 0.0),
        ),
        "rag_v3_ingestion_failure_rate": _coerce_ratio(getattr(snapshot, "ingestion_failure_rate", 0.0)),
        "rag_v3_security_alert_count": security_alert_count,
        "rag_v3_audit_pipeline_health": max(0.0, float(getattr(snapshot, "audit_pipeline_health", 1.0) or 0.0)),
    }


def _require_actor_id_for_mutation(request: Request) -> Optional[str]:
    require_subject_raw = getattr(settings, "rag_v3_require_auth_subject_for_mutations", True)
    require_subject = require_subject_raw if isinstance(require_subject_raw, bool) else True
    if not require_subject:
        return _resolve_actor_id(request)
    auth_enforced = getattr(settings, "auth_enforce_bearer", False) is True
    if not auth_enforced:
        return _resolve_actor_id(request)
    actor_id = str(getattr(request.state, "auth_subject", "") or "").strip()
    if actor_id:
        return actor_id
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authenticated subject required for mutation endpoints.",
    )


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
    _require_actor_id_for_mutation(request)
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
        logger.error("RAG_V3_INGEST_ROUTE_EXCEPTION | reason=%s", exc, exc_info=True)
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
                source_types=request_body.source_types,
                as_of_date=request_body.as_of_date,
                event_date=request_body.event_date,
                decision_date=request_body.decision_date,
                requested_tier=request_body.requested_tier,
                snapshot_id=request_body.snapshot_id,
                acl_tags=request_body.acl_tags,
                policy_context=request_body.policy_context,
                legal_disclaimer_ack=bool(request_body.legal_disclaimer_ack),
                human_responsibility_ack=bool(request_body.human_responsibility_ack),
                selected_mode=str(request_body.selected_mode or ""),
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
        logger.error("RAG_V3_QUERY_ROUTE_EXCEPTION | reason=%s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 query unavailable.",
        ) from exc

    citation_contract_warnings = _citation_contract_warnings(result.citations)
    grounding_violations = _strict_grounding_violation_codes(result.status, result.citations)
    if grounding_violations and bool(getattr(settings, "rag_v3_route_strict_grounding_enforced", True)):
        logger.warning(
            "RAG_V3_QUERY_STRICT_GROUNDING_REJECTED | request_id=%s | violations=%s",
            str(getattr(result, "request_id", "") or ""),
            ",".join(grounding_violations),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": "STRICT_GROUNDING_VIOLATION",
                "message": "Answered response failed strict citation grounding contract.",
                "violations": grounding_violations,
            },
        )
    response_warnings = list(dict.fromkeys([*result.structured.warnings, *citation_contract_warnings]))
    citation_contract_violation = bool(citation_contract_warnings)
    review_reason_codes = list(result.review_reason_codes)
    if citation_contract_violation and "citation_contract_violation" not in review_reason_codes:
        review_reason_codes.append("citation_contract_violation")

    return RagV3QueryResponse(
        request_id=result.request_id,
        trace_id=result.request_id,
        answer=result.answer,
        answer_text=result.structured.answer_text,
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
                source_char_start=getattr(item, "source_char_start", None),
                source_char_end=getattr(item, "source_char_end", None),
                paragraph_start=getattr(item, "paragraph_start", None),
                paragraph_end=getattr(item, "paragraph_end", None),
                section_path=getattr(item, "section_path", None),
                source_url=getattr(item, "source_url", None),
                final_score=item.final_score,
                temporal_version=item.temporal_version,
                evidence_text=item.evidence_text,
                evidence_start=item.evidence_start,
                evidence_end=item.evidence_end,
                evidence_overlap=item.evidence_overlap,
                citation_date=getattr(item, "citation_date", None),
                issuing_authority=getattr(item, "issuing_authority", None),
                decision_no=getattr(item, "decision_no", None),
                reference_no=getattr(item, "reference_no", None),
            )
            for item in result.citations
        ],
        source_documents=_source_documents_from_citations(result.citations),
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
            warnings=response_warnings,
            legal_disclaimer=result.structured.legal_disclaimer,
        ),
        confidence_score=result.structured.confidence,
        warnings=response_warnings,
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
        review_required=bool(result.review_required or citation_contract_violation),
        review_reason_codes=review_reason_codes,
        low_confidence=bool(result.low_confidence or citation_contract_violation),
        low_confidence_reason=(
            str(result.low_confidence_reason or "")
            or ("citation_contract_violation" if citation_contract_violation else "")
        ),
        legal_disclaimer_required=bool(result.legal_disclaimer_required),
        human_responsibility_notice=str(result.human_responsibility_notice or ""),
        estimated_cost=max(0.0, float(result.estimated_cost or 0.0)),
        cost_estimate=dict(result.cost_estimate or {}),
        contract_version=result.contract_version,
        schema_version=result.schema_version,
    )


@router.get(
    "/review-queue",
    response_model=RagV3ReviewQueueResponse,
    status_code=status.HTTP_200_OK,
    summary="List RAG v3 human-review queue items",
    tags=["RAG-V3"],
)
async def rag_v3_review_queue(
    request: Request,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    limit: int = 50,
) -> RagV3ReviewQueueResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
    reviewer_id: Optional[UUID] = None
    if assigned_to:
        try:
            reviewer_id = UUID(assigned_to)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="assigned_to must be UUID.") from exc
    try:
        rows = await rag_v3_service.list_human_review_queue(
            bureau_id=bureau_id,
            status=status,
            assigned_to=reviewer_id,
            limit=limit,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    return RagV3ReviewQueueResponse(
        items=[
            RagV3ReviewQueueItemSchema(
                id=str(row.get("id") or ""),
                status=str(row.get("status") or "pending"),
                risk_level=(str(row.get("risk_level")).upper() if row.get("risk_level") is not None else None),
                severity=(str(row.get("severity")).upper() if row.get("severity") is not None else None),
                confidence=float(row.get("confidence") or 0.0),
                created_at=row.get("created_at"),
                due_at=row.get("due_at"),
                assigned_to=str(row.get("assigned_to") or "") or None,
                resolved_at=row.get("resolved_at"),
                closure_code=str(row.get("closure_code") or "") or None,
                escalation_reason=str(row.get("escalation_reason") or "") or None,
                reason_codes=[str(item) for item in (row.get("reason_codes") or []) if str(item).strip()],
                metadata=dict(row.get("metadata") or {}),
            )
            for row in rows
            if str(row.get("id") or "").strip()
        ]
    )


@router.post(
    "/review-queue/{ticket_id}/assign",
    response_model=RagV3ReviewTicketResponse,
    status_code=status.HTTP_200_OK,
    summary="Assign RAG v3 human-review queue item",
    tags=["RAG-V3"],
)
async def rag_v3_review_assign(
    ticket_id: str,
    request_body: RagV3ReviewAssignRequest,
    request: Request,
) -> RagV3ReviewTicketResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
    actor_id = _require_actor_id_for_mutation(request)
    assigned_by_uuid: Optional[UUID] = None
    if actor_id:
        try:
            assigned_by_uuid = UUID(actor_id)
        except ValueError:
            assigned_by_uuid = None
    try:
        reviewer_id = UUID(request_body.reviewer_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="reviewer_id must be UUID.") from exc

    try:
        payload = await rag_v3_service.assign_human_review_ticket(
            ticket_id=ticket_id,
            bureau_id=bureau_id,
            reviewer_id=reviewer_id,
            assigned_by=assigned_by_uuid,
            sla_minutes=request_body.sla_minutes,
            due_at=request_body.due_at,
            escalation_reason=request_body.escalation_reason,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="review ticket not found.")

    return RagV3ReviewTicketResponse(
        id=str(payload.get("id") or ticket_id),
        status=str(payload.get("status") or "in_review"),
        assigned_to=str(payload.get("assigned_to") or "") or None,
        due_at=payload.get("due_at"),
        resolved_at=payload.get("resolved_at"),
        closure_code=str(payload.get("closure_code") or "") or None,
        reviewer_feedback=str(payload.get("reviewer_feedback") or "") or None,
    )


@router.post(
    "/review-queue/{ticket_id}/close",
    response_model=RagV3ReviewTicketResponse,
    status_code=status.HTTP_200_OK,
    summary="Close RAG v3 human-review queue item",
    tags=["RAG-V3"],
)
async def rag_v3_review_close(
    ticket_id: str,
    request_body: RagV3ReviewCloseRequest,
    request: Request,
) -> RagV3ReviewTicketResponse:
    bureau_id = _resolve_bureau_id(request)
    access_level = _resolve_access_level(request)
    actor_id = _require_actor_id_for_mutation(request)
    try:
        closed_by = UUID(request_body.closed_by)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="closed_by must be UUID.") from exc
    if actor_id:
        try:
            actor_uuid = UUID(actor_id)
        except ValueError:
            actor_uuid = None
        if actor_uuid is not None and actor_uuid != closed_by:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="closed_by must match authenticated actor.",
            )
        if actor_uuid is not None:
            closed_by = actor_uuid

    try:
        payload = await rag_v3_service.close_human_review_ticket(
            ticket_id=ticket_id,
            bureau_id=bureau_id,
            closed_by=closed_by,
            status=request_body.status,
            closure_code=request_body.closure_code,
            reviewer_feedback=request_body.reviewer_feedback,
            escalation_reason=request_body.escalation_reason,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="review ticket not found.")

    return RagV3ReviewTicketResponse(
        id=str(payload.get("id") or ticket_id),
        status=str(payload.get("status") or request_body.status),
        assigned_to=str(payload.get("assigned_to") or "") or None,
        due_at=payload.get("due_at"),
        resolved_at=payload.get("resolved_at"),
        closure_code=str(payload.get("closure_code") or request_body.closure_code),
        reviewer_feedback=str(payload.get("reviewer_feedback") or "") or None,
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
                actor_id=_require_actor_id_for_mutation(request),
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
    _require_actor_id_for_mutation(request)
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

    dispatch = evaluate_and_dispatch_alerts(metrics=_alert_metrics_from_snapshot(snapshot))

    return RagV3ObservabilityResponse(
        window_hours=snapshot.window_hours,
        request_count=snapshot.request_count,
        avg_query_latency_ms=snapshot.avg_query_latency_ms,
        p95_query_latency_ms=snapshot.p95_query_latency_ms,
        no_answer_rate=snapshot.no_answer_rate,
        security_block_rate=snapshot.security_block_rate,
        cache_hit_rate=snapshot.cache_hit_rate,
        avg_retrieved_count=snapshot.avg_retrieved_count,
        low_confidence_rate=snapshot.low_confidence_rate,
        review_required_rate=snapshot.review_required_rate,
        alerts_fired=len(dispatch.fired),
        alerts_delivered=int(dispatch.delivered),
        alerts_failed=int(dispatch.failed),
        alerts_evaluated_rules=int(dispatch.evaluated_rules),
        alerts_configured_sinks=list(dispatch.configured_sinks),
        alerts_missing_metric_rules=list(dispatch.missing_metric_rules),
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


@router.get(
    "/model-registry",
    response_model=RagV3ModelRegistryResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 active model registry and drift fingerprint",
    tags=["RAG-V3"],
)
async def rag_v3_model_registry() -> RagV3ModelRegistryResponse:
    serving = resolve_qwen_serving_config()
    fingerprint = active_model_fingerprint()
    return RagV3ModelRegistryResponse(
        backend=str(serving.backend),
        served_model=str(serving.model),
        drift_detected=bool(fingerprint.get("drift_detected")),
        verified_80b_runtime=bool(fingerprint.get("verified_80b_runtime")),
        disallowed_models=dict(fingerprint.get("disallowed_models") or {}),
        tiers={k: str(v) for k, v in dict(fingerprint.get("tiers") or {}).items()},
    )


@router.get(
    "/sso-capabilities",
    response_model=RagV3SsoCapabilityResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 enterprise SSO capability matrix",
    tags=["RAG-V3"],
)
async def rag_v3_sso_capabilities() -> RagV3SsoCapabilityResponse:
    oidc_supported = True
    oidc_reason_codes: list[str] = []
    oidc_enabled = bool(getattr(settings, "auth_enforce_bearer", False)) and bool(getattr(settings, "auth_jwt_use_jwks", False))
    auth_jwks_url = str(getattr(settings, "auth_jwks_url", "") or "").strip()
    auth_jwt_issuer = str(getattr(settings, "auth_jwt_issuer", "") or "").strip()
    oidc_configured = oidc_enabled and bool(auth_jwks_url) and bool(auth_jwt_issuer)
    oidc_verified = oidc_configured and bool(getattr(settings, "auth_verify_jwt_signature", True))
    if not oidc_enabled:
        oidc_reason_codes.append("oidc_disabled")
    if oidc_enabled and not auth_jwks_url:
        oidc_reason_codes.append("oidc_jwks_url_missing")
    if oidc_enabled and not auth_jwt_issuer:
        oidc_reason_codes.append("oidc_issuer_missing")
    if oidc_enabled and oidc_configured and not oidc_verified:
        oidc_reason_codes.append("oidc_not_verified")

    saml_supported = True
    saml_reason_codes: list[str] = []
    saml_enabled = bool(getattr(settings, "saml_enabled", False))
    saml_metadata_url = str(getattr(settings, "saml_metadata_url", "") or "").strip()
    saml_entity_id = str(getattr(settings, "saml_entity_id", "") or "").strip()
    saml_configured = saml_enabled and bool(saml_metadata_url) and bool(saml_entity_id)
    saml_verified = saml_configured and bool(getattr(settings, "saml_verified", False))
    if not saml_enabled:
        saml_reason_codes.append("saml_disabled")
    if saml_enabled and not saml_metadata_url:
        saml_reason_codes.append("saml_metadata_url_missing")
    if saml_enabled and not saml_entity_id:
        saml_reason_codes.append("saml_entity_id_missing")
    if saml_enabled and saml_configured and not saml_verified:
        saml_reason_codes.append("saml_not_verified")

    return RagV3SsoCapabilityResponse(
        oidc_supported=oidc_supported,
        oidc_configured=oidc_configured,
        oidc_verified=oidc_verified,
        oidc_reason_codes=oidc_reason_codes,
        saml_supported=saml_supported,
        saml_configured=saml_configured,
        saml_verified=saml_verified,
        saml_reason_codes=saml_reason_codes,
        enterprise_ready=bool(oidc_verified or saml_verified),
        federation_matrix={
            "oidc": {
                "supported": oidc_supported,
                "configured": oidc_configured,
                "verified": oidc_verified,
            },
            "saml": {
                "supported": saml_supported,
                "configured": saml_configured,
                "verified": saml_verified,
            },
        },
    )


@router.get(
    "/coverage",
    response_model=RagV3CorpusCoverageResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 corpus coverage evidence snapshot",
    tags=["RAG-V3"],
)
async def rag_v3_corpus_coverage(request: Request) -> RagV3CorpusCoverageResponse:
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
        payload = await rag_v3_service.get_corpus_coverage_snapshot(
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
            detail="RAG v3 corpus coverage unavailable.",
        ) from exc

    return RagV3CorpusCoverageResponse.model_validate(payload)


@router.get(
    "/compliance-evidence",
    response_model=RagV3ComplianceEvidenceResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG v3 compliance evidence snapshot",
    tags=["RAG-V3"],
)
async def rag_v3_compliance_evidence(request: Request) -> RagV3ComplianceEvidenceResponse:
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
        payload = await rag_v3_service.get_compliance_evidence_snapshot(
            bureau_id=bureau_id,
            access_level=access_level,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG v3 compliance evidence unavailable.",
        ) from exc

    return RagV3ComplianceEvidenceResponse.model_validate(payload)
