"""Application service for RAG v3 (documents + chunks)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import HTTPException, status as http_status
from domain.entities.tenant import AccessLevel
from infrastructure.config import settings
from infrastructure.audit.cost_tracker import estimate_cost
from infrastructure.database.connection import get_supabase_client
from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.llm.tiered_router import LLMTieredRouter, llm_router
from infrastructure.rag_v3.admission import RagV3AdmissionController, rag_v3_admission_controller
from infrastructure.rag_v3.claim_verifier import (
    SemanticClaimVerifier,
    combine_claim_verification,
)
from infrastructure.rag_v3.chunker import LegalChunkDraft, LegalStructuredChunker
from infrastructure.rag_v3.context_summarizer import RagV3ContextSummarizer, rag_v3_context_summarizer
from infrastructure.rag_v3.delta_compare import compare_chunk_versions
from infrastructure.rag_v3.doc_retriever import RagV3DocLevelRetriever, rag_v3_doc_retriever
from infrastructure.rag_v3.document_understanding import (
    DocumentUnderstandingReport,
    evaluate_document_understanding,
)
from infrastructure.rag_v3.embedding_policy import decide_embedding_fail_open
from infrastructure.rag_v3.exact_search import apply_exact_legal_boost
from infrastructure.rag_v3.governance import (
    ClaimVerification,
    PolicyLattice,
    PolicyDecision,
    TemporalResolution,
    apply_norm_hierarchy,
    evaluate_policy,
    evaluate_policy_lattice,
    resolve_as_of_date,
    verify_claim_support,
)
from infrastructure.rag_v3.metadata_authority import extract_authority_tags, validate_metadata_contract
from infrastructure.rag_v3.metadata_governance import (
    MetadataValidationInput,
    MetadataValidationResult,
    validate_ingest_metadata,
)
from infrastructure.rag_v3.normalizer import LegalTextNormalizer, legal_text_normalizer
from infrastructure.rag_v3.planner import RagV3QueryPlan, RagV3QueryPlanner, rag_v3_query_planner
from infrastructure.rag_v3.prompt_registry import (
    PromptRegistryError,
    compose_prompted_query,
    prompt_registry,
)
from infrastructure.rag_v3.query_expansion import QueryExpansionResult, legal_query_expander
from infrastructure.rag_v3.reranker import RagV3RerankItem, RagV3Reranker, rag_v3_reranker
from infrastructure.rag_v3.reranker_health import assess_reranker_output
from infrastructure.rag_v3.parser_orchestrator import rag_v3_parser_orchestrator
from infrastructure.rag_v3.repository import (
    RagV3ChunkMatch,
    RagV3ChunkUpsert,
    SupabaseRagV3Repository,
    rag_v3_repository,
)
from infrastructure.rag_v3.review_assist import build_review_assist
from infrastructure.rag_v3.source_parser import ParsedSourceContent
from infrastructure.rag_v3.tier_policy import (
    is_safe_operational_intent,
    resolve_tier_policy,
)
from infrastructure.security.prompt_guard import PromptGuard, prompt_guard
from infrastructure.serving.qwen_deployment import resolve_qwen_serving_config

logger = logging.getLogger("babylexit.rag_v3")

RAG_V3_PROMPT_VERSION = "rag_v3_zero_trust_v2"
RAG_V3_NO_ANSWER = "Mevcut baglamda yeterli kanit yok / bulunamadi."
RAG_V3_INGEST_CONTRACT_VERSION = "rag.v3.ingest.response.v1"
RAG_V3_INGEST_SCHEMA_VERSION = "rag.v3.ingest.response.schema.v1"
RAG_V3_QUERY_CONTRACT_VERSION = "rag.v3.query.response.v1"
RAG_V3_QUERY_SCHEMA_VERSION = "rag.v3.query.response.schema.v1"
RAG_V3_DELETE_CONTRACT_VERSION = "rag.v3.delete.response.v1"
RAG_V3_DELETE_SCHEMA_VERSION = "rag.v3.delete.response.schema.v1"
RAG_V3_REVOKE_CONTRACT_VERSION = "rag.v3.revoke.response.v1"
RAG_V3_REVOKE_SCHEMA_VERSION = "rag.v3.revoke.response.schema.v1"
RAG_V3_INTEGRITY_CONTRACT_VERSION = "rag.v3.integrity.response.v1"
RAG_V3_INTEGRITY_SCHEMA_VERSION = "rag.v3.integrity.response.schema.v1"
_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_JSON_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)
_SAFE_TOKEN_RE = re.compile(r"[^a-z0-9._-]+")
_SENTENCE_SPLIT_RE = re.compile(r"(?:[\r\n]+|(?<=[.!?;])\s+)")
_THINK_TAG_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_REASONING_BLOCK_RE = re.compile(r"```(?:reasoning|analysis)\s*[\s\S]*?```", re.IGNORECASE)
_DECISION_NO_RE = re.compile(
    r"\b(?:E\.?\s*\d{4}/\d+\s*[,\-;]?\s*K\.?\s*\d{4}/\d+|\d{4}/\d+\s*E\.?\s*,?\s*\d{4}/\d+\s*K\.?)\b",
    re.IGNORECASE,
)
_TURKISH_TOKEN_SUFFIXES = (
    "lerinin",
    "larının",
    "lerin",
    "ların",
    "ndeki",
    "daki",
    "deki",
    "ndan",
    "nden",
    "dan",
    "den",
    "tan",
    "ten",
    "dır",
    "dir",
    "dur",
    "dür",
    "tir",
    "tır",
    "tur",
    "tür",
    "nin",
    "nın",
    "nun",
    "nün",
    "in",
    "ın",
    "un",
    "ün",
    "ye",
    "ya",
    "yi",
    "yı",
    "yu",
    "yü",
    "de",
    "da",
    "te",
    "ta",
    "si",
    "sı",
    "su",
    "sü",
)

RAG_V3_ALLOWED_CLASSIFICATIONS = ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "SENSITIVE")
RAG_V3_CLASSIFICATIONS_BY_ACCESS: dict[AccessLevel, tuple[str, ...]] = {
    AccessLevel.READ_ONLY: ("PUBLIC", "INTERNAL"),
    AccessLevel.MEMBER: ("PUBLIC", "INTERNAL", "CONFIDENTIAL"),
    AccessLevel.OWNER: ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "SENSITIVE"),
}
_SOURCE_TYPE_ALIASES: dict[str, str] = {
    "case_law": "case_law",
    "ictihat": "case_law",
    "icthat": "case_law",
    "ihtihat": "case_law",
    "karar": "case_law",
    "yargi_karari": "case_law",
    "mahkeme_karari": "case_law",
    "jurisprudence": "case_law",
    "legislation": "legislation",
    "mevzuat": "legislation",
    "kanun": "legislation",
    "law": "legislation",
    "regulation": "legislation",
    "academic": "academic",
    "akademik": "academic",
    "article": "academic",
    "doctrine": "academic",
    "web": "web",
    "internet": "web",
    "site": "web",
    "user_document": "user_document",
    "uploaded_document": "user_document",
    "kullanici_belgesi": "user_document",
    "internal_note": "internal_note",
    "platform_bilgi": "platform_bilgi",
}


@dataclass(frozen=True)
class RagV3IngestCommand:
    title: str
    source_type: str
    source_id: str
    jurisdiction: str
    raw_text: str
    source_format: str = "text"
    classification: str = "INTERNAL"
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    acl_tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RagV3IngestResult:
    document_id: str
    chunk_count: int
    doc_hash: str
    chunk_hashes: list[str]
    warnings: list[str]
    contract_version: str = RAG_V3_INGEST_CONTRACT_VERSION
    schema_version: str = RAG_V3_INGEST_SCHEMA_VERSION


@dataclass(frozen=True)
class RagV3Citation:
    chunk_id: str
    document_id: str
    title: str
    source_id: str
    source_type: str
    article_no: Optional[str]
    clause_no: Optional[str]
    subclause_no: Optional[str]
    page_range: Optional[str]
    source_char_start: Optional[int] = None
    source_char_end: Optional[int] = None
    paragraph_start: Optional[int] = None
    paragraph_end: Optional[int] = None
    section_path: Optional[str] = None
    source_url: Optional[str] = None
    final_score: float = 0.0
    temporal_version: Optional[str] = None
    evidence_text: Optional[str] = None
    evidence_start: Optional[int] = None
    evidence_end: Optional[int] = None
    evidence_overlap: Optional[float] = None
    citation_date: Optional[str] = None
    issuing_authority: Optional[str] = None
    decision_no: Optional[str] = None
    reference_no: Optional[str] = None


@dataclass(frozen=True)
class RagV3StructuredCitation:
    source_id: str
    article_no: Optional[str]
    clause_no: Optional[str]
    chunk_id: Optional[str]


@dataclass(frozen=True)
class RagV3StructuredAnswer:
    answer_text: str
    citations: list[RagV3StructuredCitation]
    confidence: float
    should_escalate: bool
    follow_up_questions: list[str]
    warnings: list[str]
    legal_disclaimer: str = ""


@dataclass(frozen=True)
class RagV3Fingerprint:
    model_name: str
    model_version: str
    index_version: str
    prompt_version: str
    doc_hashes: list[str]
    chunk_hashes: list[str]


@dataclass(frozen=True)
class RagV3ClaimVerificationReport:
    total_claims: int
    supported_claims: int
    support_ratio: float
    unsupported_claims: list[str]
    passed: bool


@dataclass(frozen=True)
class RagV3ClaimGraphNode:
    proposition: str
    supported: bool
    support_score: float
    supporting_chunk_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RagV3ClaimGraph:
    nodes: list[RagV3ClaimGraphNode]
    total_claims: int
    supported_claims: int


@dataclass(frozen=True)
class RagV3PolicySummary:
    risk_level: str
    policy_flags: list[str]
    legal_disclaimer: str
    should_escalate: bool
    sensitivity: str = "public"
    residency: str = "global"
    external_transfer: str = "allowed"
    retention: str = "standard"
    privilege_scope: str = "none"
    purpose_of_use: str = "research"
    source_rights: str = "owned"
    exportability: str = "exportable"
    provider_allowlist: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RagV3AdmissionSummary:
    accepted: bool
    reason: str
    queue_wait_ms: int
    effective_tier: int
    degraded: bool


@dataclass(frozen=True)
class RagV3QueryCommand:
    query: str
    top_k: int = 10
    jurisdiction: str = "TR"
    source_types: list[str] = field(default_factory=list)
    as_of_date: Optional[date] = None
    event_date: Optional[date] = None
    decision_date: Optional[date] = None
    requested_tier: Optional[int] = None
    snapshot_id: Optional[int] = None
    acl_tags: list[str] = field(default_factory=list)
    history: list[dict[str, str]] = field(default_factory=list)
    policy_context: dict[str, Any] = field(default_factory=dict)
    legal_disclaimer_ack: bool = False
    human_responsibility_ack: bool = False
    selected_mode: str = ""


@dataclass(frozen=True)
class RagV3QueryResult:
    answer: str
    status: str
    citations: list[RagV3Citation]
    structured: RagV3StructuredAnswer
    fingerprint: RagV3Fingerprint
    retrieved_count: int
    resolved_as_of_date: Optional[date]
    review_ticket_id: Optional[str]
    claim_verification: RagV3ClaimVerificationReport
    policy: RagV3PolicySummary
    admission: RagV3AdmissionSummary
    snapshot_id: Optional[int] = None
    revocation_epoch: int = 0
    estimated_cost: float = 0.0
    cost_estimate: dict[str, Any] = field(default_factory=dict)
    request_id: str = ""
    gate_decision: str = "answered"
    review_required: bool = False
    review_reason_codes: list[str] = field(default_factory=list)
    low_confidence: bool = False
    low_confidence_reason: str = ""
    legal_disclaimer_required: bool = True
    human_responsibility_notice: str = ""
    contract_version: str = RAG_V3_QUERY_CONTRACT_VERSION
    schema_version: str = RAG_V3_QUERY_SCHEMA_VERSION


@dataclass(frozen=True)
class RagV3DeleteCommand:
    document_id: Optional[str] = None
    source_id: Optional[str] = None
    purge_raw_storage: bool = False
    actor_id: Optional[str] = None


@dataclass(frozen=True)
class RagV3DeleteResult:
    deleted_document_ids: list[str]
    deleted_documents: int
    deleted_chunks: int
    raw_storage_delete_attempted: int
    raw_storage_deleted: int
    warnings: list[str]
    contract_version: str = RAG_V3_DELETE_CONTRACT_VERSION
    schema_version: str = RAG_V3_DELETE_SCHEMA_VERSION


@dataclass(frozen=True)
class RagV3RevokeCommand:
    action: str
    document_id: Optional[str] = None
    source_id: Optional[str] = None
    reason: Optional[str] = None


@dataclass(frozen=True)
class RagV3RevokeResult:
    action: str
    affected_document_ids: list[str]
    affected_documents: int
    revocation_epoch: int
    warnings: list[str]
    contract_version: str = RAG_V3_REVOKE_CONTRACT_VERSION
    schema_version: str = RAG_V3_REVOKE_SCHEMA_VERSION


@dataclass(frozen=True)
class RagV3SnapshotState:
    snapshot_id: int
    publish_epoch: int
    revocation_epoch: int
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RagV3ObservabilitySnapshot:
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
    contract_version: str = "rag.v3.observability.response.v1"
    schema_version: str = "rag.v3.observability.response.schema.v1"


class RagV3Service:
    """Ingest + hybrid retrieval + gated answering for RAG v3."""

    def __init__(
        self,
        *,
        repository: Optional[SupabaseRagV3Repository] = None,
        embedder: Optional[QueryEmbedder] = None,
        router: Optional[LLMTieredRouter] = None,
        guard: Optional[PromptGuard] = None,
        chunker: Optional[LegalStructuredChunker] = None,
        normalizer: Optional[LegalTextNormalizer] = None,
        reranker: Optional[RagV3Reranker] = None,
        admission_controller: Optional[RagV3AdmissionController] = None,
        planner: Optional[RagV3QueryPlanner] = None,
        doc_retriever: Optional[RagV3DocLevelRetriever] = None,
        context_summarizer: Optional[RagV3ContextSummarizer] = None,
        claim_verifier: Optional[SemanticClaimVerifier] = None,
    ) -> None:
        self._repository = repository or rag_v3_repository
        self._embedder = embedder or query_embedder
        self._router = router or llm_router
        self._guard = guard or prompt_guard
        self._chunker = chunker or LegalStructuredChunker(
            target_min_tokens=int(settings.rag_v3_chunk_target_min_tokens),
            target_max_tokens=int(settings.rag_v3_chunk_target_max_tokens),
            overlap_tokens=int(settings.rag_v3_chunk_overlap_tokens),
        )
        self._normalizer = normalizer or legal_text_normalizer
        self._reranker = reranker or rag_v3_reranker
        self._admission = admission_controller or rag_v3_admission_controller
        self._planner = planner or rag_v3_query_planner
        self._doc_retriever = doc_retriever or rag_v3_doc_retriever
        self._context_summarizer = context_summarizer or rag_v3_context_summarizer
        self._claim_verifier = claim_verifier or SemanticClaimVerifier(embedder=self._embedder)
        self._qwen_serving = resolve_qwen_serving_config()
        self._query_cache_enabled = bool(getattr(settings, "rag_v3_query_cache_enabled", True))
        self._query_cache_ttl_s = max(1, int(getattr(settings, "rag_v3_query_cache_ttl_s", 120) or 120))
        self._query_cache_max_entries = max(1, int(getattr(settings, "rag_v3_query_cache_max_entries", 500) or 500))
        self._query_cache: OrderedDict[str, tuple[float, RagV3QueryResult]] = OrderedDict()
        self._query_cache_lock = asyncio.Lock()

    async def ingest(
        self,
        command: RagV3IngestCommand,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> RagV3IngestResult:
        access = _coerce_access_level(access_level)
        _ensure_can_ingest(access)

        if not command.raw_text.strip():
            raise ValueError("raw_text cannot be empty.")

        classification = _normalize_classification(command.classification)
        _ensure_ingest_classification_allowed(access, classification)
        acl_tags = _normalize_acl_tags(command.acl_tags, classification=classification)

        parsed = rag_v3_parser_orchestrator.parse(
            raw_text=command.raw_text,
            source_format=command.source_format,
            metadata=command.metadata,
        )
        normalized = self._normalizer.normalize(parsed.text)
        normalized_text = normalized.text
        if not normalized_text:
            raise ValueError("No ingestible text remained after normalization.")

        chunks = self._chunker.chunk(normalized_text)
        if not chunks:
            raise ValueError("No chunks produced from source text.")

        warnings: list[str] = list(dict.fromkeys([*parsed.warnings, *normalized.warnings]))
        understanding_report = DocumentUnderstandingReport(
            quality_score=1.0,
            parser_confidence=1.0,
            layout_confidence=1.0,
            ocr_confidence=1.0,
            pass_gate=True,
            requires_human_review=False,
            reason_codes=[],
            warnings=[],
            metrics={},
        )
        if bool(getattr(settings, "rag_v3_document_understanding_enabled", True)):
            understanding_report = evaluate_document_understanding(
                parsed=parsed,
                normalized_text=normalized_text,
                chunks=chunks,
                metadata=command.metadata,
            )
            warnings.extend(understanding_report.warnings)
            if (
                bool(getattr(settings, "rag_v3_ingest_fail_closed_on_quality", True))
                and not understanding_report.pass_gate
            ):
                queue_id = await self._enqueue_ingest_reprocess(
                    enabled=bool(getattr(settings, "rag_v3_ingest_reprocess_queue_enabled", True)),
                    bureau_id=bureau_id,
                    command=command,
                    reason_codes=understanding_report.reason_codes or ["quality_gate_failed"],
                    detail={
                        "quality_score": understanding_report.quality_score,
                        "parser_confidence": understanding_report.parser_confidence,
                        "layout_confidence": understanding_report.layout_confidence,
                        "ocr_confidence": understanding_report.ocr_confidence,
                        "quality_metrics": understanding_report.metrics,
                        "quality_warnings": understanding_report.warnings,
                    },
                )
                queue_note = f" reprocess_ticket={queue_id}" if queue_id else ""
                raise ValueError(
                    "Ingest blocked by document understanding quality gate: "
                    f"{','.join(understanding_report.reason_codes)}.{queue_note}"
                )

        metadata_validation = MetadataValidationResult(
            passed=True,
            normalized_metadata=dict(command.metadata or {}),
            warnings=[],
            errors=[],
        )
        if bool(getattr(settings, "rag_v3_metadata_validation_enabled", True)):
            metadata_validation = validate_ingest_metadata(
                MetadataValidationInput(
                    title=command.title,
                    source_type=command.source_type,
                    source_id=command.source_id,
                    jurisdiction=command.jurisdiction or "TR",
                    effective_from=command.effective_from,
                    effective_to=command.effective_to,
                    metadata=dict(command.metadata or {}),
                    normalized_text=normalized_text,
                    chunks=chunks,
                )
            )
            warnings.extend(metadata_validation.warnings)
            if (
                bool(getattr(settings, "rag_v3_metadata_fail_closed", True))
                and not metadata_validation.passed
            ):
                queue_id = await self._enqueue_ingest_reprocess(
                    enabled=bool(getattr(settings, "rag_v3_ingest_reprocess_queue_enabled", True)),
                    bureau_id=bureau_id,
                    command=command,
                    reason_codes=metadata_validation.errors or ["metadata_validation_failed"],
                    detail={
                        "metadata_errors": metadata_validation.errors,
                        "metadata_warnings": metadata_validation.warnings,
                    },
                )
                queue_note = f" reprocess_ticket={queue_id}" if queue_id else ""
                raise ValueError(
                    "Ingest blocked by metadata authority/version/scope validator: "
                    f"{','.join(metadata_validation.errors)}.{queue_note}"
                )

        authority_tags = extract_authority_tags(
            title=command.title,
            source_type=command.source_type,
            source_id=command.source_id,
            jurisdiction=command.jurisdiction or "TR",
            text=normalized_text,
            metadata=metadata_validation.normalized_metadata,
        )
        authority_contract_errors = validate_metadata_contract(
            source_id=command.source_id,
            source_type=command.source_type,
            jurisdiction=command.jurisdiction or "TR",
            effective_from=command.effective_from,
            effective_to=command.effective_to,
            authority=authority_tags,
        )
        warnings.extend(authority_tags.warnings)
        if authority_contract_errors:
            warnings.extend([f"authority_contract:{item}" for item in authority_contract_errors])
        if (
            bool(getattr(settings, "rag_v3_metadata_fail_closed", True))
            and authority_contract_errors
        ):
            queue_id = await self._enqueue_ingest_reprocess(
                enabled=bool(getattr(settings, "rag_v3_ingest_reprocess_queue_enabled", True)),
                bureau_id=bureau_id,
                command=command,
                reason_codes=authority_contract_errors,
                detail={
                    "authority_errors": authority_contract_errors,
                    "authority_warnings": authority_tags.warnings,
                },
            )
            queue_note = f" reprocess_ticket={queue_id}" if queue_id else ""
            raise ValueError(
                "Ingest blocked by authority metadata contract validator: "
                f"{','.join(authority_contract_errors)}.{queue_note}"
            )

        delta_report = compare_chunk_versions(previous_chunks=[], current_chunks=[])
        if bool(getattr(settings, "rag_v3_delta_compare_enabled", True)):
            try:
                previous_doc: Optional[dict[str, Any]] = None
                if hasattr(self._repository, "get_latest_document_by_source"):
                    previous_doc = await self._repository.get_latest_document_by_source(
                        source_id=command.source_id,
                        jurisdiction=command.jurisdiction or "TR",
                        bureau_id=bureau_id,
                    )
                previous_chunks: list[dict[str, Any]] = []
                if previous_doc and str(previous_doc.get("id") or "").strip() and hasattr(
                    self._repository, "get_document_chunks"
                ):
                    previous_chunks = await self._repository.get_document_chunks(
                        document_id=str(previous_doc.get("id")),
                    )
                current_chunks = [
                    {
                        "article_no": chunk.article_no,
                        "clause_no": chunk.clause_no,
                        "subclause_no": chunk.subclause_no,
                        "text": chunk.text,
                    }
                    for chunk in chunks
                ]
                delta_report = compare_chunk_versions(
                    previous_chunks=previous_chunks,
                    current_chunks=current_chunks,
                )
                if delta_report.has_breaking_changes:
                    warnings.append("delta_breaking_changes_detected")
            except Exception as exc:  # noqa: BLE001
                warnings.append("delta_compare_failed")
                logger.warning("RAG_V3_DELTA_COMPARE_FAILED | reason=%s", exc)

        chunk_texts = [chunk.text for chunk in chunks]
        embeddings = await self._safe_embed_texts(
            chunk_texts,
            warnings=warnings,
            classification=classification,
        )

        doc_hash = _sha256(normalized_text)
        storage_meta = self._store_raw_payload(
            command=command,
            parsed=parsed,
            doc_hash=doc_hash,
            warnings=warnings,
        )
        chunk_hashes: list[str] = []
        upserts: list[RagV3ChunkUpsert] = []
        embedding_version = _embedding_version_token()
        index_version = _index_version_token()
        normalized_source_url = _str_or_none((metadata_validation.normalized_metadata or {}).get("source_url"))
        if not normalized_source_url:
            normalized_source_url = _str_or_none((command.metadata or {}).get("source_url"))
        if not normalized_source_url:
            normalized_source_url = _derive_fallback_source_url(
                source_type=command.source_type,
                source_id=command.source_id,
            )
            warnings.append("source_url_missing_fallback_derived")
        for ordinal, (chunk, embedding) in enumerate(zip(chunks, embeddings), start=1):
            chunk_hash = _chunk_hash(
                chunk=chunk,
                source_id=command.source_id,
                ordinal=ordinal,
            )
            chunk_token_count = _token_count_for_text(chunk.text)
            chunk_type = _infer_chunk_type(
                source_type=command.source_type,
                chunk=chunk,
                token_count=chunk_token_count,
            )
            chunk_hashes.append(chunk_hash)
            upserts.append(
                RagV3ChunkUpsert(
                    article_no=chunk.article_no,
                    clause_no=chunk.clause_no,
                    subclause_no=chunk.subclause_no,
                    heading_path=chunk.heading_path,
                    text=chunk.text,
                    embedding=embedding,
                    chunk_hash=chunk_hash,
                    page_range=chunk.page_range,
                    effective_from=command.effective_from,
                    effective_to=command.effective_to,
                    chunk_order=ordinal,
                    chunk_type=chunk_type,
                    token_count=chunk_token_count,
                    embedding_version=embedding_version,
                    index_version=index_version,
                    source_id=command.source_id,
                    source_char_start=int(chunk.char_start),
                    source_char_end=int(chunk.char_end),
                    paragraph_start=(
                        int(chunk.paragraph_start)
                        if chunk.paragraph_start is not None
                        else None
                    ),
                    paragraph_end=(
                        int(chunk.paragraph_end)
                        if chunk.paragraph_end is not None
                        else None
                    ),
                    section_path=chunk.heading_path,
                    source_url=normalized_source_url,
                )
            )

        doc_id = await self._repository.upsert_document_and_replace_chunks(
            title=command.title,
            source_type=command.source_type,
            source_id=command.source_id,
            jurisdiction=command.jurisdiction or "TR",
            effective_from=command.effective_from,
            effective_to=command.effective_to,
            doc_hash=doc_hash,
            acl_tags=acl_tags,
            classification=classification,
            bureau_id=bureau_id,
            metadata={
                **metadata_validation.normalized_metadata,
                **authority_tags.metadata,
                "classification": classification,
                "source_url": normalized_source_url,
                **storage_meta,
                "source_format": parsed.source_format,
                "parsed_page_count": parsed.page_count,
                "parsed_heading_count": parsed.heading_count,
                "ocr_used": parsed.ocr_used,
                "ocr_confidence": parsed.ocr_confidence,
                "ocr_engine": parsed.ocr_engine,
                "source_parse_warnings": parsed.warnings[:200],
                "document_understanding_quality_score": understanding_report.quality_score,
                "document_understanding_parser_confidence": understanding_report.parser_confidence,
                "document_understanding_layout_confidence": understanding_report.layout_confidence,
                "document_understanding_ocr_confidence": understanding_report.ocr_confidence,
                "document_understanding_reason_codes": understanding_report.reason_codes[:50],
                "document_understanding_metrics": understanding_report.metrics,
                "metadata_validation_warnings": metadata_validation.warnings[:50],
                "authority_level": authority_tags.authority_level,
                "authority_score": authority_tags.authority_score,
                "authority_scope": authority_tags.scope,
                "authority_source_id_normalized": authority_tags.source_id_normalized,
                "authority_warnings": authority_tags.warnings[:50],
                "authority_errors": authority_contract_errors[:50],
                "delta_summary": delta_report.summary,
                "delta_total_changes": delta_report.total_changes,
                "delta_critical_changes": delta_report.critical_changes,
                "delta_has_breaking_changes": delta_report.has_breaking_changes,
                "delta_changes": [
                    {
                        "kind": item.kind,
                        "identifier": item.identifier,
                        "severity": item.severity,
                        "similarity": item.similarity,
                        "old_preview": item.old_preview,
                        "new_preview": item.new_preview,
                    }
                    for item in delta_report.changes[:20]
                ],
                "normalizer": "rag_v3.legal_text_normalizer",
                "footnote_count": len(normalized.footnotes),
                "footnotes": normalized.footnotes[:200],
            },
            chunks=upserts,
        )
        publish_epoch = 0
        revocation_epoch = 0
        try:
            if hasattr(self._repository, "bump_publish_epoch"):
                publish_epoch = int(await self._repository.bump_publish_epoch(bureau_id=bureau_id) or 0)
            if hasattr(self._repository, "get_control_plane_state"):
                cp_state = await self._repository.get_control_plane_state(bureau_id=bureau_id)
                revocation_epoch = int(cp_state.get("revocation_epoch") or 0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_PUBLISH_EPOCH_BUMP_FAILED | reason=%s", exc)
            warnings.append("publish_epoch_bump_failed")
        try:
            if hasattr(self._repository, "mark_document_published"):
                await self._repository.mark_document_published(
                    document_id=doc_id,
                    bureau_id=bureau_id,
                    publish_epoch=publish_epoch,
                    revocation_epoch=revocation_epoch,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_PUBLISH_MARK_FAILED | document_id=%s | reason=%s", doc_id, exc)
            warnings.append("publish_mark_failed")
        await self._clear_query_cache(reason="ingest")
        return RagV3IngestResult(
            document_id=doc_id,
            chunk_count=len(chunks),
            doc_hash=doc_hash,
            chunk_hashes=chunk_hashes,
            warnings=warnings,
            contract_version=_rag_v3_ingest_contract_version(),
            schema_version=_rag_v3_ingest_schema_version(),
        )

    async def query(
        self,
        command: RagV3QueryCommand,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> RagV3QueryResult:
        access = _coerce_access_level(access_level)
        request_id = str(uuid4())
        started_at = time.monotonic()
        raw_query = command.query.strip()
        if not raw_query:
            raise ValueError("query cannot be empty.")
        if bool(getattr(settings, "rag_v3_require_legal_disclaimer_ack", True)):
            if not bool(command.legal_disclaimer_ack):
                raise ValueError("Legal disclaimer acknowledgement is required.")
            if not bool(command.human_responsibility_ack):
                raise ValueError("Human responsibility acknowledgement is required.")

        expanded_query = QueryExpansionResult(
            original_query=raw_query,
            normalized_query=raw_query,
            expanded_query=raw_query,
        )
        if bool(getattr(settings, "rag_v3_query_expansion_enabled", True)):
            expanded_query = legal_query_expander.expand(raw_query)
        query = expanded_query.normalized_query.strip() or raw_query
        try:
            self._guard.check_query(query)
        except HTTPException as exc:
            await self._persist_security_block_trace(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=raw_query,
                command=command,
                detail=exc.detail,
            )
            raise
        except Exception as exc:  # noqa: BLE001
            detail = {
                "error_code": "PROMPT_GUARD_RUNTIME_ERROR",
                "message": "Prompt guard runtime failure.",
                "threat_type": "GUARD_RUNTIME_ERROR",
                "location": "query",
                "llm_called": False,
            }
            await self._persist_security_block_trace(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=raw_query,
                command=command,
                detail=detail,
            )
            raise HTTPException(
                status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Prompt security guard unavailable.",
            ) from exc
        if (
            settings.multi_tenancy_enabled
            and settings.rag_v3_tenant_hard_fail_missing_bureau
            and (settings.is_production or settings.tenant_enforce_in_dev)
            and bureau_id is None
        ):
            raise ValueError("bureau_id is required for tenant-isolated rag_v3 query.")

        temporal_resolution = resolve_as_of_date(
            query,
            command.as_of_date,
            event_date=command.event_date,
            decision_date=command.decision_date,
        )
        base_policy = evaluate_policy(query)
        snapshot_state = await self._resolve_snapshot_state(
            bureau_id=bureau_id,
            requested_snapshot_id=command.snapshot_id,
        )
        default_provider_allowlist = _parse_provider_csv(
            str(getattr(settings, "rag_v3_policy_default_provider_allowlist", "") or "")
        )
        self_host_provider_allowlist = _parse_provider_csv(
            str(getattr(settings, "rag_v3_policy_self_host_provider_allowlist", "") or "")
        )
        policy_lattice_enabled = bool(getattr(settings, "rag_v3_policy_lattice_enabled", True))
        if policy_lattice_enabled:
            policy_lattice = evaluate_policy_lattice(
                matches=[],
                session_policy=command.policy_context,
                default_provider_allowlist=default_provider_allowlist,
                self_host_provider_allowlist=self_host_provider_allowlist,
            )
        else:
            policy_lattice = PolicyLattice(
                provider_allowlist=default_provider_allowlist or ["google", "openai", "anthropic", "groq"]
            )
        policy = self._merge_policy_decisions(base_policy=base_policy, lattice=policy_lattice)
        policy = self._enforce_external_transfer_guardrails(
            policy=policy,
            lattice=policy_lattice,
            self_host_provider_allowlist=self_host_provider_allowlist,
        )
        policy_summary = self._to_policy_summary(policy, lattice=policy_lattice)

        top_k = _normalize_top_k(int(command.top_k))
        requested_tier = command.requested_tier if command.requested_tier in (1, 2, 3, 4) else 2
        normalized_acl_tags = _normalize_acl_tags(command.acl_tags, classification=None)
        requested_source_types = _normalize_source_types(command.source_types)
        allowed_classifications = list(_allowed_classifications_for(access))
        dual_temporal_requested = (
            bool(getattr(settings, "rag_v3_dual_temporal_enabled", True))
            and command.as_of_date is None
            and _is_dual_temporal_requested(
                event_date=command.event_date,
                decision_date=command.decision_date,
            )
        )
        query_plan = RagV3QueryPlan(
            task_type="lookup",
            retrieval_mode="hybrid",
            rewritten_query=expanded_query.expanded_query or query,
            doc_shortlist_size=max(3, min(12, top_k)),
            reranker_enabled=True,
            exact_search_enabled=bool(getattr(settings, "rag_v3_legal_exact_lane_enabled", True)),
            decompose_steps=[],
            temporal_scope={
                "as_of_date": temporal_resolution.as_of_date.isoformat() if temporal_resolution.as_of_date else None,
                "event_date": command.event_date.isoformat() if command.event_date else None,
                "decision_date": command.decision_date.isoformat() if command.decision_date else None,
            },
            scope_split=[(command.jurisdiction or "TR").strip().upper() or "TR"],
            authority_constraints=[],
            exact_search_required=bool(getattr(settings, "rag_v3_legal_exact_lane_enabled", True)),
            exhaustive_mode_required=False,
            reasons=[],
        )
        if bool(getattr(settings, "rag_v3_planner_enabled", True)):
            query_plan = self._planner.plan(
                query=expanded_query.expanded_query or query,
                top_k=top_k,
                dual_temporal_requested=dual_temporal_requested,
                jurisdiction=command.jurisdiction or "TR",
                as_of_date=command.as_of_date,
                event_date=command.event_date,
                decision_date=command.decision_date,
            )
        retrieval_query = (query_plan.rewritten_query or expanded_query.expanded_query or query).strip() or query
        cache_key = self._build_query_cache_key(
            query=retrieval_query,
            command=command,
            top_k=top_k,
            bureau_id=bureau_id,
            acl_tags=normalized_acl_tags,
            allowed_classifications=allowed_classifications,
            as_of_date=temporal_resolution.as_of_date,
            requested_tier=requested_tier,
            policy_context=command.policy_context,
            source_types=requested_source_types,
            snapshot_id=snapshot_state.snapshot_id,
            revocation_epoch=snapshot_state.revocation_epoch,
        )
        admission_summary = RagV3AdmissionSummary(
            accepted=False,
            reason="not_admitted",
            queue_wait_ms=0,
            effective_tier=requested_tier,
            degraded=False,
        )
        claim_report = RagV3ClaimVerificationReport(
            total_claims=0,
            supported_claims=0,
            support_ratio=1.0,
            unsupported_claims=[],
            passed=True,
        )
        safe_intent_no_rag = bool(getattr(settings, "rag_v3_safe_intent_no_rag_enabled", True)) and (
            requested_tier == 1 and is_safe_operational_intent(raw_query)
        )

        async with self._admission.reserve(query=query, requested_tier=requested_tier) as admission:
            admission_summary = RagV3AdmissionSummary(
                accepted=admission.accepted,
                reason=admission.reason,
                queue_wait_ms=admission.queue_wait_ms,
                effective_tier=admission.effective_tier,
                degraded=admission.degraded,
            )
            if not admission.accepted:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=[],
                    reason=f"admission_{admission.reason}",
                    confidence=0.0,
                    temporal=temporal_resolution,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result

            if safe_intent_no_rag and not policy.should_block_generation:
                allowed_providers = set(policy_summary.provider_allowlist or [])
                prompt_query = raw_query
                prompt_version = RAG_V3_PROMPT_VERSION
                if bool(getattr(settings, "rag_v3_prompt_registry_enabled", True)):
                    try:
                        scenario = prompt_registry.resolve(
                            query=raw_query,
                            task_type="operations",
                            source_types=[],
                            bypass_rag=True,
                        )
                        prompt_query = compose_prompted_query(base_query=raw_query, scenario=scenario)
                        prompt_version = scenario.prompt_version
                    except PromptRegistryError as exc:
                        logger.warning("RAG_V3_PROMPT_REGISTRY_BYPASS | reason=%s", exc)
                model_label = "none/none"
                answer_text = RAG_V3_NO_ANSWER
                try:
                    answer_text, model_label = await self._router.generate(
                        query=prompt_query,
                        context="",
                        source_count=0,
                        history=list(command.history),
                        requested_tier=1,
                        allowed_providers=allowed_providers or None,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("RAG_V3_TIER1_NO_RAG_GENERATION_FAILED | reason=%s", exc)
                answer_text = (answer_text or "").strip() or RAG_V3_NO_ANSWER
                status = "no_answer" if _looks_like_no_answer(answer_text) else "ok"
                confidence = 0.65 if status == "ok" else 0.0
                structured = _fallback_structured(
                    answer_text,
                    status,
                    confidence,
                    [],
                    warnings=["tier1_safe_intent_no_rag"],
                )
                structured = replace(
                    structured,
                    legal_disclaimer=policy_summary.legal_disclaimer,
                    should_escalate=False,
                )
                estimated_cost, cost_estimate = (
                    _estimated_cost_payload(
                        model_id=model_label,
                        tier=1,
                        query=raw_query,
                        context="",
                        answer=answer_text,
                    )
                    if model_label != "none/none"
                    else _free_cost_estimate(model_id="none/none", tier=1, cached=False)
                )
                result = RagV3QueryResult(
                    answer=answer_text,
                    status=status,
                    citations=[],
                    structured=structured,
                    fingerprint=RagV3Fingerprint(
                        model_name=model_label.split("/", 1)[-1] if "/" in model_label else model_label,
                        model_version=model_label,
                        index_version=_index_version_token(),
                        prompt_version=prompt_version,
                        doc_hashes=[],
                        chunk_hashes=[],
                    ),
                    retrieved_count=0,
                    resolved_as_of_date=temporal_resolution.as_of_date,
                    review_ticket_id=None,
                    claim_verification=claim_report,
                    policy=policy_summary,
                    admission=replace(admission_summary, effective_tier=1),
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                    estimated_cost=estimated_cost,
                    cost_estimate=cost_estimate,
                    gate_decision="tier1_safe_intent_no_rag",
                    review_required=False,
                    review_reason_codes=[],
                    low_confidence=False,
                    low_confidence_reason="",
                    legal_disclaimer_required=bool(getattr(settings, "rag_v3_require_legal_disclaimer_ack", True)),
                    human_responsibility_notice=str(
                        getattr(settings, "rag_v3_human_responsibility_notice", "")
                        or "Nihai hukuki sorumluluk insandadir."
                    ),
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                    extra_metadata={
                        "cache_hit": False,
                        "tier_policy_route_reason": "tier1_safe_intent_no_rag",
                        "query_expansion": {
                            "normalized_query": expanded_query.normalized_query,
                            "expanded_query": expanded_query.expanded_query,
                            "typo_corrections": expanded_query.typo_corrections,
                            "synonyms": expanded_query.synonyms,
                            "filter_hints": expanded_query.filter_hints,
                        },
                    },
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result

            cached_result = await self._query_cache_get(cache_key)
            if cached_result is not None:
                _, cache_cost = _free_cost_estimate(
                    model_id=cached_result.fingerprint.model_version or "cache/hit",
                    tier=requested_tier,
                    cached=True,
                )
                cached_result = replace(
                    cached_result,
                    estimated_cost=0.0,
                    cost_estimate=cache_cost,
                )
                cached_result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=replace(cached_result),
                    matches=[],
                    extra_metadata={"cache_hit": True},
                )
                return cached_result

            embedding_warnings: list[str] = []
            embedding = await self._safe_embed_query(
                retrieval_query,
                requested_tier=admission_summary.effective_tier,
                warnings=embedding_warnings,
                acl_tags=normalized_acl_tags,
                allowed_classifications=allowed_classifications,
            )
            jurisdiction = (command.jurisdiction or "TR").strip() or "TR"
            dual_temporal_metadata: dict[str, Any] = {
                "dual_temporal_applied": False,
                "snapshot_id": int(snapshot_state.snapshot_id),
                "publish_epoch": int(snapshot_state.publish_epoch),
                "revocation_epoch_start": int(snapshot_state.revocation_epoch),
                "planner_retrieval_mode": query_plan.retrieval_mode,
                "planner_task_type": query_plan.task_type,
                "planner_reasons": query_plan.reasons[:20],
                "planner_decompose_steps": query_plan.decompose_steps[:20],
                "planner_temporal_scope": dict(query_plan.temporal_scope or {}),
                "planner_scope_split": query_plan.scope_split[:10],
                "planner_authority_constraints": query_plan.authority_constraints[:10],
                "planner_exact_required": bool(query_plan.exact_search_required),
                "planner_exhaustive_required": bool(query_plan.exhaustive_mode_required),
                "planner_doc_shortlist_size": int(query_plan.doc_shortlist_size),
                "planner_exact_enabled": bool(query_plan.exact_search_enabled),
                "qwen_serving_backend": self._qwen_serving.backend,
                "qwen_serving_base_url": self._qwen_serving.base_url,
                "embedding_warnings": embedding_warnings[:10],
                "query_expansion": {
                    "original_query": expanded_query.original_query,
                    "normalized_query": expanded_query.normalized_query,
                    "expanded_query": expanded_query.expanded_query,
                    "typo_corrections": dict(expanded_query.typo_corrections),
                    "synonyms": list(expanded_query.synonyms),
                    "filter_hints": dict(expanded_query.filter_hints),
                },
                "source_type_filter_requested": list(requested_source_types),
                "source_type_filter_applied": bool(requested_source_types),
            }
            dual_temporal_notes: list[str] = []
            snapshot_notes: list[str] = list(snapshot_state.warnings)
            temporal_labels: dict[str, str] = {}
            effective_temporal = temporal_resolution
            if dual_temporal_requested:
                effective_temporal = replace(
                    effective_temporal,
                    warnings=[
                        item
                        for item in effective_temporal.warnings
                        if item != "decision_date_not_used_in_single_as_of"
                    ],
                )
            try:
                if dual_temporal_requested:
                    matches, temporal_labels, dual_temporal_metadata, dual_temporal_notes = (
                        await self._retrieve_dual_temporal_matches(
                            query=retrieval_query,
                            embedding=embedding,
                            top_k=top_k,
                            jurisdiction=jurisdiction,
                            event_date=command.event_date,
                            decision_date=command.decision_date,
                            acl_tags=normalized_acl_tags,
                            allowed_classifications=allowed_classifications,
                            bureau_id=bureau_id,
                            retrieval_mode=query_plan.retrieval_mode,
                            exact_enabled=query_plan.exact_search_enabled,
                            doc_shortlist_size=query_plan.doc_shortlist_size,
                        )
                    )
                else:
                    matches = await self._retrieve_matches(
                        query=retrieval_query,
                        embedding=embedding,
                        top_k=top_k,
                        jurisdiction=jurisdiction,
                        as_of_date=temporal_resolution.as_of_date,
                        acl_tags=normalized_acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                        retrieval_mode=query_plan.retrieval_mode,
                        exact_enabled=query_plan.exact_search_enabled,
                        doc_shortlist_size=query_plan.doc_shortlist_size,
                    )
            except Exception as exc:  # noqa: BLE001
                logger.error("RAG_V3_RETRIEVAL_FAILED | reason=%s", exc, exc_info=True)
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=[],
                    reason="retrieval_error",
                    confidence=0.0,
                    temporal=effective_temporal,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                    extra_metadata=dual_temporal_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result

            matches, snapshot_filter_metadata, snapshot_filter_notes = await self._filter_matches_for_snapshot(
                matches=matches,
                bureau_id=bureau_id,
                snapshot_id=snapshot_state.snapshot_id,
            )
            if snapshot_filter_metadata:
                dual_temporal_metadata.update(snapshot_filter_metadata)
            if snapshot_filter_notes:
                snapshot_notes.extend(snapshot_filter_notes)

            matches, source_type_filter_metadata, source_type_filter_notes = _filter_matches_by_source_types(
                matches,
                requested_source_types,
            )
            if source_type_filter_metadata:
                dual_temporal_metadata.update(source_type_filter_metadata)
            if source_type_filter_notes:
                snapshot_notes.extend(source_type_filter_notes)

            if not matches:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=[],
                    reason="retrieval_empty_or_filtered",
                    confidence=0.0,
                    temporal=effective_temporal,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                    extra_metadata=dual_temporal_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result

            rerank_timeout_s = max(0.5, float(getattr(settings, "rag_v3_reranker_timeout_s", 4.0) or 4.0))
            if query_plan.reranker_enabled:
                selected = await self._safe_rerank_with_timeout(
                    query=query,
                    matches=matches,
                    top_k=top_k,
                    timeout_s=rerank_timeout_s,
                    rerank_top_n=query_plan.rerank_top_n,
                )
            else:
                selected = list(matches[:top_k])
            hierarchy_as_of = None if dual_temporal_requested else temporal_resolution.as_of_date
            selected, hierarchy_notes = apply_norm_hierarchy(
                selected,
                query=query,
                as_of_date=hierarchy_as_of,
            )
            selected, near_dup_notes = _suppress_near_duplicate_matches(
                selected,
                enabled=bool(getattr(settings, "rag_v3_near_duplicate_suppression_enabled", True)),
                threshold=float(getattr(settings, "rag_v3_near_duplicate_jaccard_threshold", 0.88) or 0.88),
            )
            threshold = _clamp01(float(settings.rag_v3_no_answer_min_score))
            answerability_gate_enabled = bool(settings.rag_v3_answerability_check_enabled)
            confidence = _retrieval_confidence(selected)
            answerability_ok = (not answerability_gate_enabled) or _passes_answerability_gate(query, selected)
            iterative_metadata: dict[str, Any] = {"iterative_retrieval_applied": False}
            iterative_notes: list[str] = list(near_dup_notes)

            iterative_enabled = bool(getattr(settings, "rag_v3_iterative_retrieval_enabled", True))
            should_iterate = iterative_enabled and (
                confidence < threshold
                or (answerability_gate_enabled and not answerability_ok)
            )
            if should_iterate:
                try:
                    iterative_pool, iterative_metadata = await self._iterative_retrieve(
                        query=retrieval_query,
                        current_matches=matches,
                        top_k=top_k,
                        jurisdiction=jurisdiction,
                        as_of_date=hierarchy_as_of,
                        acl_tags=normalized_acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    iterative_pool = []
                    iterative_metadata = {
                        "iterative_retrieval_applied": False,
                        "iterative_retrieval_error": str(exc)[:240],
                    }
                    logger.warning("RAG_V3_ITERATIVE_RETRIEVAL_FAILED | reason=%s", exc)
                if iterative_pool:
                    iterative_pool, iterative_source_type_filter_metadata, iterative_source_type_filter_notes = (
                        _filter_matches_by_source_types(iterative_pool, requested_source_types)
                    )
                    if iterative_source_type_filter_metadata:
                        iterative_metadata["iterative_source_type_filter"] = dict(
                            iterative_source_type_filter_metadata
                        )
                    if iterative_source_type_filter_notes:
                        iterative_notes.extend(iterative_source_type_filter_notes)
                    if query_plan.reranker_enabled:
                        selected = await self._safe_rerank_with_timeout(
                            query=query,
                            matches=iterative_pool,
                            top_k=top_k,
                            timeout_s=rerank_timeout_s,
                            rerank_top_n=query_plan.rerank_top_n,
                        )
                    else:
                        selected = list(iterative_pool[:top_k])
                    selected, iterative_notes = apply_norm_hierarchy(
                        selected,
                        query=query,
                        as_of_date=hierarchy_as_of,
                    )
                    selected, iterative_near_dup_notes = _suppress_near_duplicate_matches(
                        selected,
                        enabled=bool(getattr(settings, "rag_v3_near_duplicate_suppression_enabled", True)),
                        threshold=float(getattr(settings, "rag_v3_near_duplicate_jaccard_threshold", 0.88) or 0.88),
                    )
                    iterative_notes.extend(iterative_near_dup_notes)
                    confidence = _retrieval_confidence(selected)
                    answerability_ok = (not answerability_gate_enabled) or _passes_answerability_gate(query, selected)

            combined_retrieval_metadata = {**dual_temporal_metadata, **iterative_metadata}
            selected_temporal_labels = _labels_for_selected(selected, temporal_labels)
            if policy_lattice_enabled:
                policy_lattice = evaluate_policy_lattice(
                    matches=selected,
                    session_policy=command.policy_context,
                    default_provider_allowlist=default_provider_allowlist,
                    self_host_provider_allowlist=self_host_provider_allowlist,
                )
            policy = self._merge_policy_decisions(base_policy=base_policy, lattice=policy_lattice)
            policy = self._enforce_external_transfer_guardrails(
                policy=policy,
                lattice=policy_lattice,
                self_host_provider_allowlist=self_host_provider_allowlist,
            )
            policy_summary = self._to_policy_summary(policy, lattice=policy_lattice)
            combined_retrieval_metadata["policy_lattice"] = _policy_lattice_metadata(policy_lattice)
            combined_retrieval_metadata["snapshot_warnings"] = list(dict.fromkeys(snapshot_notes))

            if confidence < threshold:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=selected,
                    reason="retrieval_score_below_threshold",
                    confidence=confidence,
                    temporal=effective_temporal,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    temporal_labels=selected_temporal_labels,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result
            if not answerability_ok:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=selected,
                    reason="answerability_overlap_low",
                    confidence=confidence,
                    temporal=effective_temporal,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    temporal_labels=selected_temporal_labels,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result
            if policy.should_block_generation:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=selected,
                    reason="policy_block_generation",
                    confidence=confidence,
                    temporal=effective_temporal,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
                    temporal_labels=selected_temporal_labels,
                    snapshot_id=snapshot_state.snapshot_id,
                    revocation_epoch=snapshot_state.revocation_epoch,
                )
                result = await self._finalize_query_result(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=raw_query,
                    result=result,
                )
                return result

            try:
                citations = _to_citations(selected, temporal_labels=selected_temporal_labels)
                context, context_meta = self._build_context_with_meta(
                    selected,
                    query=query,
                    temporal_labels=selected_temporal_labels,
                )
                combined_retrieval_metadata["context_summarized_count"] = context_meta.get("summarized_count", 0)
                combined_retrieval_metadata["context_tokens_saved"] = context_meta.get("tokens_saved", 0)
                combined_retrieval_metadata["context_injection_doc_count"] = context_meta.get("injection_doc_count", 0)
                combined_retrieval_metadata["context_injection_pattern_count"] = context_meta.get(
                    "injection_pattern_count", 0
                )
                self._guard.check_context(context)
            except HTTPException as exc:
                await self._persist_security_block_trace(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    detail=exc.detail,
                    matches=selected,
                )
                raise
            except Exception as exc:  # noqa: BLE001
                detail = {
                    "error_code": "PROMPT_GUARD_RUNTIME_ERROR",
                    "message": "Prompt guard runtime failure.",
                    "threat_type": "GUARD_RUNTIME_ERROR",
                    "location": "context",
                    "llm_called": False,
                }
                await self._persist_security_block_trace(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=raw_query,
                    command=command,
                    detail=detail,
                    matches=selected,
                )
                if bool(getattr(settings, "rag_v3_prompt_guard_fail_closed", True)):
                    raise HTTPException(
                        status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Prompt security guard unavailable.",
                    ) from exc
                logger.warning("RAG_V3_PROMPT_GUARD_RUNTIME_FAIL_OPEN | reason=%s", exc)
            estimated_tokens = self._admission.estimate_token_load(query=query, context=context)
            effective_tier, token_degraded, token_reason = self._admission.clamp_requested_tier(
                requested_tier=admission_summary.effective_tier,
                estimated_tokens=estimated_tokens,
            )
            if token_degraded:
                admission_summary = RagV3AdmissionSummary(
                    accepted=True,
                    reason=token_reason,
                    queue_wait_ms=admission_summary.queue_wait_ms,
                    effective_tier=effective_tier,
                    degraded=True,
                )

            has_conflicting_case_law = _detect_conflicting_case_law(selected)
            max_chunk_chars = max([len(item.chunk_text or "") for item in selected], default=0)
            tier_policy = resolve_tier_policy(
                requested_tier=effective_tier,
                query=raw_query,
                retrieval_confidence=confidence,
                has_conflicting_case_law=has_conflicting_case_law,
                max_chunk_chars=max_chunk_chars,
                task_type=query_plan.task_type,
            )
            if bool(getattr(settings, "rag_v3_tier3_trigger_enabled", True)):
                effective_tier = int(tier_policy.effective_tier)
                effective_tier, policy_token_degraded, policy_token_reason = self._admission.clamp_requested_tier(
                    requested_tier=effective_tier,
                    estimated_tokens=estimated_tokens,
                )
                if policy_token_degraded:
                    tier_policy = replace(
                        tier_policy,
                        warnings=[*tier_policy.warnings, f"token_clamp:{policy_token_reason}"],
                    )
            combined_retrieval_metadata["tier_policy"] = {
                "requested_tier": int(tier_policy.requested_tier),
                "effective_tier": int(effective_tier),
                "route_reason": tier_policy.route_reason,
                "warnings": list(tier_policy.warnings),
                "tier3_triggers": list(tier_policy.tier3_triggers),
                "has_conflicting_case_law": bool(has_conflicting_case_law),
                "max_chunk_chars": int(max_chunk_chars),
            }
            if tier_policy.warnings:
                iterative_notes.extend([f"tier_policy:{item}" for item in tier_policy.warnings])
            if effective_tier != admission_summary.effective_tier:
                admission_summary = RagV3AdmissionSummary(
                    accepted=True,
                    reason=f"tier_policy:{tier_policy.route_reason}",
                    queue_wait_ms=admission_summary.queue_wait_ms,
                    effective_tier=effective_tier,
                    degraded=(admission_summary.degraded or bool(tier_policy.warnings)),
                )

            routed_query = _build_baseline_query(
                query,
                dual_temporal=dual_temporal_requested,
                event_date=command.event_date,
                decision_date=command.decision_date,
            )
            prompt_version = RAG_V3_PROMPT_VERSION
            if bool(getattr(settings, "rag_v3_prompt_registry_enabled", True)):
                try:
                    scenario = prompt_registry.resolve(
                        query=raw_query,
                        task_type=query_plan.task_type,
                        source_types=[item.source_type for item in selected],
                        bypass_rag=False,
                    )
                    routed_query = compose_prompted_query(
                        base_query=routed_query,
                        scenario=scenario,
                    )
                    prompt_version = scenario.prompt_version
                    combined_retrieval_metadata["prompt_registry"] = {
                        "scenario": scenario.scenario,
                        "prompt_version": scenario.prompt_version,
                        "registry_version": scenario.registry_version,
                    }
                except PromptRegistryError as exc:
                    combined_retrieval_metadata["prompt_registry_error"] = str(exc)
                    logger.warning("RAG_V3_PROMPT_REGISTRY_FALLBACK | reason=%s", exc)

            model_label = "fallback/extractive"
            raw_answer: str
            llm_called = False
            used_extractive_fallback = False
            revocation_epoch_end = int(snapshot_state.revocation_epoch)
            allowed_providers = set(policy_summary.provider_allowlist or [])
            if bool(getattr(settings, "llm_force_extractive_only", False)):
                raw_answer = _extractive_fallback(selected, query=query)
                used_extractive_fallback = True
            else:
                try:
                    raw_answer, model_label = await self._router.generate(
                        query=routed_query,
                        context=context,
                        source_count=len(selected),
                        history=list(command.history),
                        requested_tier=effective_tier,
                        allowed_providers=allowed_providers or None,
                    )
                    llm_called = True
                except Exception as exc:  # noqa: BLE001
                    logger.error("RAG v3 model call failed: %s", exc, exc_info=True)
                    raw_answer = _extractive_fallback(selected, query=query)
                    used_extractive_fallback = True

            if bool(getattr(settings, "rag_v3_mid_turn_revoke_check_enabled", True)):
                revocation_epoch_end = await self._current_revocation_epoch(bureau_id=bureau_id)
                combined_retrieval_metadata["revocation_epoch_end"] = int(revocation_epoch_end)
                if revocation_epoch_end > int(snapshot_state.revocation_epoch):
                    result = self._no_answer_result(
                        model_label="none/none",
                        matches=selected,
                        reason="mid_turn_revoke_detected",
                        confidence=confidence,
                        temporal=effective_temporal,
                        policy=policy_summary,
                        claim_report=claim_report,
                        admission=admission_summary,
                        temporal_labels=selected_temporal_labels,
                        snapshot_id=snapshot_state.snapshot_id,
                        revocation_epoch=revocation_epoch_end,
                    )
                    result = await self._finalize_query_result(
                        request_id=request_id,
                        started_at=started_at,
                        bureau_id=bureau_id,
                        query=raw_query,
                        command=command,
                        requested_tier=requested_tier,
                        result=result,
                        matches=selected,
                        extra_metadata={**combined_retrieval_metadata, "mid_turn_revoke_detected": True},
                    )
                    await self._maybe_capture_feedback_candidate(
                        enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                        bureau_id=bureau_id,
                        query=raw_query,
                        result=result,
                    )
                    return result

            if bool(getattr(settings, "rag_v3_reasoning_redaction_enabled", True)):
                raw_answer = _sanitize_answer_output(raw_answer)
            status = "no_answer" if _looks_like_no_answer(raw_answer) else "ok"
            if status == "no_answer":
                min_extractive_conf = max(0.0, threshold)
                force_low_conf_extractive = _should_force_low_conf_extractive(query, selected)
                answerability_ok = _passes_answerability_gate(query, selected)
                if (
                    selected
                    and (answerability_ok or force_low_conf_extractive)
                    and (confidence >= min_extractive_conf or force_low_conf_extractive)
                ):
                    raw_answer = _extractive_fallback(selected, query=query)
                    status = "ok"
                    used_extractive_fallback = True
                else:
                    raw_answer = RAG_V3_NO_ANSWER
            can_attempt_structured_repair = llm_called and not model_label.startswith("fallback/")
            structured = await self._build_structured(
                query=query,
                context=context,
                raw_answer=raw_answer,
                status=status,
                confidence=confidence,
                default_citations=citations,
                allow_repair=can_attempt_structured_repair,
            )

            warning_items = [
                *structured.warnings,
                *effective_temporal.warnings,
                *dual_temporal_notes,
                *hierarchy_notes,
                *iterative_notes,
            ]
            if admission_summary.degraded:
                warning_items.append(f"admission_degraded:{admission_summary.reason}")
            if policy.policy_flags:
                warning_items.append("policy_flags:" + ",".join(policy.policy_flags))
            structured = replace(
                structured,
                warnings=list(dict.fromkeys(warning_items)),
                legal_disclaimer=policy.legal_disclaimer,
            )

            answer = structured.answer_text.strip() or raw_answer.strip() or RAG_V3_NO_ANSWER
            if bool(getattr(settings, "rag_v3_reasoning_redaction_enabled", True)):
                answer = _sanitize_answer_output(answer)
            status = "no_answer" if _looks_like_no_answer(answer) else status
            if status == "no_answer":
                min_extractive_conf = max(0.0, threshold)
                force_low_conf_extractive = _should_force_low_conf_extractive(query, selected)
                answerability_ok = _passes_answerability_gate(query, selected)
                if (
                    selected
                    and (answerability_ok or force_low_conf_extractive)
                    and (confidence >= min_extractive_conf or force_low_conf_extractive)
                ):
                    answer = _extractive_fallback(selected, query=query)
                    status = "ok"
                    used_extractive_fallback = True
                    structured = replace(
                        structured,
                        answer_text=answer,
                        confidence=max(float(structured.confidence), confidence),
                        warnings=_append_unique(structured.warnings, "model_no_answer_extractive_fallback"),
                    )
                else:
                    answer = RAG_V3_NO_ANSWER
            if (
                status == "ok"
                and _should_force_numeric_fact_extractive(
                    query=query,
                    answer=answer,
                    matches=selected,
                )
            ):
                answer = _extractive_fallback(selected, query=query)
                used_extractive_fallback = True
                structured = replace(
                    structured,
                    answer_text=answer,
                    confidence=max(float(structured.confidence), confidence),
                    warnings=_append_unique(structured.warnings, "numeric_fact_extractive_fallback"),
                )

            cited_chunk_ids = [item.chunk_id for item in structured.citations if item.chunk_id]
            resolved_citations = _resolve_response_citations(structured.citations, citations, top_k)
            resolved_citations = _attach_citation_evidence(
                answer_text=answer,
                citations=resolved_citations,
                evidence_chunks=selected,
                min_overlap=float(getattr(settings, "rag_v3_citation_snippet_min_overlap", 0.18)),
            )
            citation_contract_violations: list[str] = []
            if bool(getattr(settings, "rag_v3_citation_require_core_fields", True)):
                (
                    resolved_citations,
                    citation_contract_violations,
                ) = _enforce_citation_core_fields(resolved_citations)
                if citation_contract_violations:
                    combined_retrieval_metadata["citation_contract_violations"] = citation_contract_violations
                    structured = replace(
                        structured,
                        warnings=_append_unique(
                            structured.warnings,
                            "citation_contract_core_fields_filtered",
                        ),
                    )
                    if status == "ok" and not resolved_citations:
                        status = "no_answer"
                        answer = RAG_V3_NO_ANSWER
                        structured = replace(
                            structured,
                            answer_text=RAG_V3_NO_ANSWER,
                            should_escalate=True,
                            warnings=_append_unique(
                                structured.warnings,
                                "citation_contract_zero_valid_citations",
                            ),
                        )
            if status == "ok" and bool(getattr(settings, "rag_v3_sentence_grounding_required", True)):
                grounding_passed, grounding_ratio, unsupported_sentences = _enforce_sentence_grounding(
                    answer_text=answer,
                    citations=resolved_citations,
                    min_overlap=float(getattr(settings, "rag_v3_claim_min_overlap", 0.22)),
                )
                combined_retrieval_metadata["sentence_grounding_ratio"] = float(grounding_ratio)
                combined_retrieval_metadata["sentence_grounding_passed"] = bool(grounding_passed)
                if unsupported_sentences:
                    combined_retrieval_metadata["sentence_grounding_unsupported_samples"] = unsupported_sentences[:5]
                if not grounding_passed:
                    status = "no_answer"
                    answer = RAG_V3_NO_ANSWER
                    structured = replace(
                        structured,
                        answer_text=RAG_V3_NO_ANSWER,
                        should_escalate=True,
                        warnings=_append_unique(structured.warnings, "sentence_grounding_failed"),
                    )
            claim_verification: ClaimVerification = verify_claim_support(
                answer_text=answer,
                evidence_chunks=selected,
                cited_chunk_ids=cited_chunk_ids,
                min_overlap=float(settings.rag_v3_claim_min_overlap),
                min_supported_ratio=float(settings.rag_v3_claim_min_supported_ratio),
            )
            if bool(getattr(settings, "rag_v3_claim_semantic_enabled", True)):
                semantic_claim = await self._claim_verifier.verify(
                    answer_text=answer,
                    evidence_chunks=selected,
                    cited_chunk_ids=cited_chunk_ids,
                    min_similarity=float(getattr(settings, "rag_v3_claim_min_entailment_score", 0.42) or 0.42),
                    min_overlap=float(settings.rag_v3_claim_min_overlap),
                    min_supported_ratio=float(settings.rag_v3_claim_min_supported_ratio),
                )
                claim_verification = combine_claim_verification(
                    lexical=claim_verification,
                    semantic=semantic_claim,
                    mode=str(getattr(settings, "rag_v3_claim_semantic_combine_mode", "and") or "and"),
                )
                combined_retrieval_metadata["claim_semantic_total"] = int(semantic_claim.total_claims)
                combined_retrieval_metadata["claim_semantic_supported"] = int(semantic_claim.supported_claims)
                combined_retrieval_metadata["claim_semantic_ratio"] = float(semantic_claim.support_ratio)
                combined_retrieval_metadata["claim_semantic_contradictions"] = int(semantic_claim.contradiction_count)
                if semantic_claim.contradiction_claims:
                    combined_retrieval_metadata["claim_semantic_contradiction_samples"] = (
                        semantic_claim.contradiction_claims[:5]
                    )
                    structured = replace(
                        structured,
                        should_escalate=True,
                        warnings=_append_unique(
                            structured.warnings,
                            "claim_semantic_contradiction_detected",
                        ),
                    )
                if (
                    bool(getattr(settings, "rag_v3_claim_contradiction_blocks_answer", True))
                    and semantic_claim.contradiction_count > 0
                ):
                    total_claims = max(1, int(claim_verification.total_claims))
                    supported_claims = max(
                        0,
                        int(claim_verification.supported_claims) - int(semantic_claim.contradiction_count),
                    )
                    claim_verification = ClaimVerification(
                        total_claims=total_claims,
                        supported_claims=supported_claims,
                        support_ratio=_clamp01(supported_claims / float(max(1, total_claims))),
                        unsupported_claims=list(
                            dict.fromkeys(
                                [*claim_verification.unsupported_claims, *semantic_claim.contradiction_claims]
                            )
                        )[:8],
                        passed=False,
                    )
                    combined_retrieval_metadata["claim_contradiction_blocked"] = True
            claim_report = RagV3ClaimVerificationReport(
                total_claims=claim_verification.total_claims,
                supported_claims=claim_verification.supported_claims,
                support_ratio=claim_verification.support_ratio,
                unsupported_claims=claim_verification.unsupported_claims,
                passed=claim_verification.passed,
            )
            claim_graph_enabled = bool(getattr(settings, "rag_v3_claim_graph_enabled", True))
            if claim_graph_enabled:
                claim_graph = _build_claim_graph(
                    answer_text=answer,
                    evidence_chunks=selected,
                    cited_chunk_ids=cited_chunk_ids,
                    min_overlap=float(settings.rag_v3_claim_min_overlap),
                )
                claim_graph_metadata = _claim_graph_trace_metadata(claim_graph)
            else:
                claim_graph = RagV3ClaimGraph(nodes=[], total_claims=0, supported_claims=0)
                claim_graph_metadata = {}

            enforce_claim_no_answer = bool(settings.rag_v3_no_answer_on_claim_verification_fail) and (
                not bool(getattr(settings, "llm_force_extractive_only", False))
            ) and (
                not str(model_label or "").startswith("fallback/")
            ) and (
                not used_extractive_fallback
            )
            if enforce_claim_no_answer and (not claim_verification.passed) and status == "ok":
                status = "no_answer"
                answer = RAG_V3_NO_ANSWER
                structured = replace(
                    structured,
                    answer_text=RAG_V3_NO_ANSWER,
                    should_escalate=True,
                    warnings=_append_unique(structured.warnings, "claim_verification_failed"),
                )

            if (
                claim_graph_enabled
                and bool(getattr(settings, "rag_v3_constrained_synthesis_enabled", True))
                and status == "ok"
            ):
                constrained_answer, constrained_warnings, constrained = _constrain_answer_to_verified_claims(
                    answer_text=answer,
                    claim_graph=claim_graph,
                )
                if constrained:
                    answer = constrained_answer
                    status = "no_answer" if _looks_like_no_answer(answer) else "ok"
                    next_warnings = list(structured.warnings)
                    for warning_code in constrained_warnings:
                        next_warnings = _append_unique(next_warnings, warning_code)
                    structured = replace(
                        structured,
                        answer_text=answer,
                        warnings=next_warnings,
                        should_escalate=(structured.should_escalate or status == "no_answer"),
                    )
                    if status == "ok":
                        resolved_citations = _attach_citation_evidence(
                            answer_text=answer,
                            citations=resolved_citations,
                            evidence_chunks=selected,
                            min_overlap=float(getattr(settings, "rag_v3_citation_snippet_min_overlap", 0.18)),
                        )
                        claim_verification = verify_claim_support(
                            answer_text=answer,
                            evidence_chunks=selected,
                            cited_chunk_ids=cited_chunk_ids,
                            min_overlap=float(settings.rag_v3_claim_min_overlap),
                            min_supported_ratio=float(settings.rag_v3_claim_min_supported_ratio),
                        )
                        if bool(getattr(settings, "rag_v3_claim_semantic_enabled", True)):
                            semantic_claim = await self._claim_verifier.verify(
                                answer_text=answer,
                                evidence_chunks=selected,
                                cited_chunk_ids=cited_chunk_ids,
                                min_similarity=float(
                                    getattr(settings, "rag_v3_claim_min_entailment_score", 0.42) or 0.42
                                ),
                                min_overlap=float(settings.rag_v3_claim_min_overlap),
                                min_supported_ratio=float(settings.rag_v3_claim_min_supported_ratio),
                            )
                            claim_verification = combine_claim_verification(
                                lexical=claim_verification,
                                semantic=semantic_claim,
                                mode=str(getattr(settings, "rag_v3_claim_semantic_combine_mode", "and") or "and"),
                            )
                            if (
                                bool(getattr(settings, "rag_v3_claim_contradiction_blocks_answer", True))
                                and semantic_claim.contradiction_count > 0
                            ):
                                total_claims = max(1, int(claim_verification.total_claims))
                                supported_claims = max(
                                    0,
                                    int(claim_verification.supported_claims) - int(semantic_claim.contradiction_count),
                                )
                                claim_verification = ClaimVerification(
                                    total_claims=total_claims,
                                    supported_claims=supported_claims,
                                    support_ratio=_clamp01(supported_claims / float(max(1, total_claims))),
                                    unsupported_claims=list(
                                        dict.fromkeys(
                                            [*claim_verification.unsupported_claims, *semantic_claim.contradiction_claims]
                                        )
                                    )[:8],
                                    passed=False,
                                )
                        claim_report = RagV3ClaimVerificationReport(
                            total_claims=claim_verification.total_claims,
                            supported_claims=claim_verification.supported_claims,
                            support_ratio=claim_verification.support_ratio,
                            unsupported_claims=claim_verification.unsupported_claims,
                            passed=claim_verification.passed,
                        )
                        claim_graph = _build_claim_graph(
                            answer_text=answer,
                            evidence_chunks=selected,
                            cited_chunk_ids=cited_chunk_ids,
                            min_overlap=float(settings.rag_v3_claim_min_overlap),
                        )
                    else:
                        unsupported = [n.proposition for n in claim_graph.nodes if not n.supported][:5]
                        support_ratio = 0.0
                        if claim_graph.total_claims > 0:
                            support_ratio = _clamp01(
                                claim_graph.supported_claims / float(claim_graph.total_claims)
                            )
                        claim_verification = ClaimVerification(
                            total_claims=claim_graph.total_claims,
                            supported_claims=claim_graph.supported_claims,
                            support_ratio=support_ratio,
                            unsupported_claims=unsupported,
                            passed=False,
                        )
                        claim_report = RagV3ClaimVerificationReport(
                            total_claims=claim_verification.total_claims,
                            supported_claims=claim_verification.supported_claims,
                            support_ratio=claim_verification.support_ratio,
                            unsupported_claims=claim_verification.unsupported_claims,
                            passed=claim_verification.passed,
                        )
                    claim_graph_metadata = _claim_graph_trace_metadata(claim_graph)

            should_escalate = (
                structured.should_escalate
                or policy.should_escalate
                or (not claim_verification.passed)
            )
            corpus_verified = bool(getattr(settings, "rag_v3_corpus_verified", False))
            if (
                bool(getattr(settings, "rag_v3_require_verified_corpus_for_high_confidence", True))
                and not corpus_verified
            ):
                bounded_confidence = min(float(structured.confidence), 0.55)
                structured = replace(
                    structured,
                    confidence=bounded_confidence,
                    warnings=_append_unique(structured.warnings, "corpus_unverified_confidence_degraded"),
                    should_escalate=True,
                )
                should_escalate = True
            if should_escalate != structured.should_escalate:
                structured = replace(structured, should_escalate=should_escalate)
            if claim_graph_metadata:
                combined_retrieval_metadata.update(claim_graph_metadata)

            review_ticket_id = await self._maybe_enqueue_human_review(
                enabled=bool(settings.rag_v3_human_review_enabled),
                bureau_id=bureau_id,
                query=raw_query,
                answer=answer,
                confidence=structured.confidence,
                citations=resolved_citations,
                policy=policy,
                claim_report=claim_report,
                admission=admission_summary,
                temporal=effective_temporal,
            )

            if llm_called and not model_label.startswith("fallback/"):
                estimated_cost, cost_estimate = _estimated_cost_payload(
                    model_id=model_label,
                    tier=effective_tier,
                    query=query,
                    context=context,
                    answer=answer,
                )
            else:
                estimated_cost, cost_estimate = _free_cost_estimate(
                    model_id=model_label or "none/none",
                    tier=effective_tier,
                    cached=False,
                )

            result = RagV3QueryResult(
                answer=answer,
                status=status,
                citations=resolved_citations,
                structured=structured,
                fingerprint=self._fingerprint(
                    model_label=model_label,
                    matches=selected,
                    prompt_version=prompt_version,
                ),
                retrieved_count=len(selected),
                resolved_as_of_date=effective_temporal.as_of_date,
                review_ticket_id=review_ticket_id,
                claim_verification=claim_report,
                policy=policy_summary,
                admission=admission_summary,
                snapshot_id=snapshot_state.snapshot_id,
                revocation_epoch=revocation_epoch_end,
                estimated_cost=estimated_cost,
                cost_estimate=cost_estimate,
                gate_decision="answered" if status == "ok" else "model_no_answer",
                review_required=bool(review_ticket_id),
                review_reason_codes=_review_reason_codes(
                    claim_report=claim_report,
                    policy_summary=policy_summary,
                    structured_warnings=structured.warnings,
                    admission=admission_summary,
                    confidence=float(structured.confidence),
                ),
                low_confidence=bool(float(structured.confidence) < float(settings.rag_v3_escalation_confidence_threshold)),
                low_confidence_reason=(
                    "confidence_below_escalation_threshold"
                    if float(structured.confidence) < float(settings.rag_v3_escalation_confidence_threshold)
                    else ""
                ),
                legal_disclaimer_required=bool(getattr(settings, "rag_v3_require_legal_disclaimer_ack", True)),
                human_responsibility_notice=str(
                    getattr(settings, "rag_v3_human_responsibility_notice", "")
                    or "Nihai hukuki sorumluluk insandadir."
                ),
            )
            await self._query_cache_set(cache_key, replace(result, request_id=""))
            result = await self._finalize_query_result(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=raw_query,
                command=command,
                requested_tier=requested_tier,
                result=result,
                matches=selected,
                extra_metadata={"cache_hit": False, **combined_retrieval_metadata},
            )
            await self._maybe_capture_feedback_candidate(
                enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                bureau_id=bureau_id,
                query=raw_query,
                result=result,
            )
            return result

    async def get_query_trace(
        self,
        *,
        request_id: str,
        bureau_id: Optional[UUID],
    ) -> Optional[dict[str, Any]]:
        if not hasattr(self._repository, "get_query_trace"):
            return None
        try:
            return await self._repository.get_query_trace(
                request_id=request_id,
                bureau_id=bureau_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_TRACE_READ_FAILED | request_id=%s | reason=%s", request_id, exc)
            return None

    async def list_human_review_queue(
        self,
        *,
        bureau_id: Optional[UUID],
        status: Optional[str],
        assigned_to: Optional[UUID],
        limit: int,
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> list[dict[str, Any]]:
        access = _coerce_access_level(access_level)
        _ensure_can_manage_review(access)
        if not hasattr(self._repository, "list_human_reviews"):
            return []
        return await self._repository.list_human_reviews(
            bureau_id=bureau_id,
            status=status,
            assigned_to=assigned_to,
            limit=max(1, min(int(limit), 200)),
        )

    async def assign_human_review_ticket(
        self,
        *,
        ticket_id: str,
        bureau_id: Optional[UUID],
        reviewer_id: UUID,
        assigned_by: Optional[UUID],
        sla_minutes: Optional[int],
        due_at: Optional[datetime],
        escalation_reason: Optional[str],
        access_level: AccessLevel = AccessLevel.OWNER,
    ) -> Optional[dict[str, Any]]:
        access = _coerce_access_level(access_level)
        _ensure_can_manage_review(access)
        if not hasattr(self._repository, "assign_human_review"):
            return None
        return await self._repository.assign_human_review(
            ticket_id=ticket_id,
            bureau_id=bureau_id,
            reviewer_id=reviewer_id,
            assigned_by=assigned_by,
            sla_minutes=sla_minutes,
            due_at=due_at,
            escalation_reason=escalation_reason,
        )

    async def close_human_review_ticket(
        self,
        *,
        ticket_id: str,
        bureau_id: Optional[UUID],
        closed_by: UUID,
        status: str,
        closure_code: str,
        reviewer_feedback: Optional[str],
        escalation_reason: Optional[str],
        access_level: AccessLevel = AccessLevel.OWNER,
    ) -> Optional[dict[str, Any]]:
        access = _coerce_access_level(access_level)
        _ensure_can_manage_review(access)
        if not hasattr(self._repository, "close_human_review"):
            return None
        return await self._repository.close_human_review(
            ticket_id=ticket_id,
            bureau_id=bureau_id,
            closed_by=closed_by,
            status=status,
            closure_code=closure_code,
            reviewer_feedback=reviewer_feedback,
            escalation_reason=escalation_reason,
            require_feedback=bool(getattr(settings, "rag_v3_review_require_feedback_on_close", True)),
        )

    async def delete_document(
        self,
        command: RagV3DeleteCommand,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> RagV3DeleteResult:
        access = _coerce_access_level(access_level)
        _ensure_can_delete(access)
        has_document_id = bool((command.document_id or "").strip())
        has_source_id = bool((command.source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id is required.")

        payload = await self._repository.delete_document_and_chunks(
            document_id=(command.document_id or "").strip() or None,
            source_id=(command.source_id or "").strip() or None,
            bureau_id=bureau_id,
        )

        deleted_ids = [str(item) for item in payload.get("deleted_document_ids") or [] if str(item).strip()]
        deleted_documents = int(payload.get("deleted_documents") or 0)
        deleted_chunks = int(payload.get("deleted_chunks") or 0)
        warnings = [
            str(item)
            for item in payload.get("warnings") or []
            if str(item).strip()
        ]

        raw_storage_delete_attempted = 0
        raw_storage_deleted = 0
        if command.purge_raw_storage:
            refs = payload.get("raw_storage_refs") or []
            for ref in refs:
                if not isinstance(ref, dict):
                    continue
                bucket = str(ref.get("bucket") or "").strip()
                path = str(ref.get("path") or "").strip()
                if not bucket or not path:
                    continue
                raw_storage_delete_attempted += 1
                if await self._delete_raw_payload(bucket=bucket, path=path):
                    raw_storage_deleted += 1
                else:
                    warnings.append(f"raw_storage_delete_failed:{bucket}/{path}")

        if deleted_ids and hasattr(self._repository, "append_retention_deletion_logs"):
            try:
                logged_rows = int(
                    await self._repository.append_retention_deletion_logs(
                        bureau_id=bureau_id,
                        target_table="rag_documents",
                        target_ids=deleted_ids,
                        reason=(
                            "delete_by_document_id"
                            if has_document_id
                            else "delete_by_source_id"
                        ),
                        delete_mode="hard",
                        deleted_by=(command.actor_id or "").strip() or None,
                        metadata={
                            "source_id": (command.source_id or "").strip() or None,
                            "document_id": (command.document_id or "").strip() or None,
                            "raw_storage_delete_attempted": int(raw_storage_delete_attempted),
                            "raw_storage_deleted": int(raw_storage_deleted),
                        },
                    )
                    or 0
                )
                warnings.append(f"retention_deletion_logged:{logged_rows}")
            except Exception as exc:  # noqa: BLE001
                warnings.append("retention_deletion_log_failed")
                logger.warning("RAG_V3_RETENTION_DELETION_LOG_FAILED | reason=%s", exc)

        if deleted_documents > 0 and hasattr(self._repository, "bump_revocation_epoch"):
            try:
                rev_epoch = int(await self._repository.bump_revocation_epoch(bureau_id=bureau_id) or 0)
                warnings.append(f"revocation_epoch_bumped:{rev_epoch}")
            except Exception as exc:  # noqa: BLE001
                warnings.append("revocation_epoch_bump_failed")
                logger.warning("RAG_V3_DELETE_REVOCATION_EPOCH_BUMP_FAILED | reason=%s", exc)

        await self._clear_query_cache(reason="delete")

        return RagV3DeleteResult(
            deleted_document_ids=deleted_ids,
            deleted_documents=deleted_documents,
            deleted_chunks=deleted_chunks,
            raw_storage_delete_attempted=raw_storage_delete_attempted,
            raw_storage_deleted=raw_storage_deleted,
            warnings=list(dict.fromkeys(warnings)),
            contract_version=RAG_V3_DELETE_CONTRACT_VERSION,
            schema_version=RAG_V3_DELETE_SCHEMA_VERSION,
        )

    async def revoke_document(
        self,
        command: RagV3RevokeCommand,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> RagV3RevokeResult:
        access = _coerce_access_level(access_level)
        _ensure_can_delete(access)
        action = _normalize_lifecycle_action(command.action)
        has_document_id = bool((command.document_id or "").strip())
        has_source_id = bool((command.source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id is required.")
        if not hasattr(self._repository, "apply_document_lifecycle_action"):
            raise RuntimeError("Lifecycle action repository support is unavailable.")

        payload = await self._repository.apply_document_lifecycle_action(
            document_id=(command.document_id or "").strip() or None,
            source_id=(command.source_id or "").strip() or None,
            bureau_id=bureau_id,
            action=action,
            reason=(command.reason or "").strip() or None,
        )
        await self._clear_query_cache(reason=f"lifecycle:{action}")
        return RagV3RevokeResult(
            action=action,
            affected_document_ids=[
                str(item)
                for item in payload.get("affected_document_ids") or []
                if str(item).strip()
            ],
            affected_documents=int(payload.get("affected_documents") or 0),
            revocation_epoch=int(payload.get("revocation_epoch") or 0),
            warnings=[str(item) for item in payload.get("warnings") or [] if str(item).strip()],
            contract_version=RAG_V3_REVOKE_CONTRACT_VERSION,
            schema_version=RAG_V3_REVOKE_SCHEMA_VERSION,
        )

    async def get_index_integrity(
        self,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> dict[str, Any]:
        access = _coerce_access_level(access_level)
        _ensure_can_view_integrity(access)

        payload = await self._repository.get_index_integrity(
            bureau_id=bureau_id,
            allowed_classifications=list(_allowed_classifications_for(access)),
        )
        checked_at = datetime.now(timezone.utc).isoformat()
        return {
            "bureau_id": str(bureau_id) if bureau_id else None,
            "document_count": int(payload.get("document_count") or 0),
            "chunk_count": int(payload.get("chunk_count") or 0),
            "documents_without_chunks": int(payload.get("documents_without_chunks") or 0),
            "documents_without_chunks_ids": [
                str(item)
                for item in payload.get("documents_without_chunks_ids") or []
                if str(item).strip()
            ],
            "classification_breakdown": dict(payload.get("classification_breakdown") or {}),
            "checked_at": checked_at,
            "contract_version": RAG_V3_INTEGRITY_CONTRACT_VERSION,
            "schema_version": RAG_V3_INTEGRITY_SCHEMA_VERSION,
        }

    async def get_observability_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
        window_hours: int,
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> RagV3ObservabilitySnapshot:
        access = _coerce_access_level(access_level)
        _ensure_can_view_observability(access)
        bounded_window = max(1, min(int(window_hours), 24 * 30))
        payload = await self._repository.get_observability_snapshot(
            bureau_id=bureau_id,
            window_hours=bounded_window,
        )
        return RagV3ObservabilitySnapshot(
            window_hours=bounded_window,
            request_count=int(payload.get("request_count") or 0),
            avg_query_latency_ms=float(payload.get("avg_query_latency_ms") or 0.0),
            p95_query_latency_ms=float(payload.get("p95_query_latency_ms") or 0.0),
            no_answer_rate=float(payload.get("no_answer_rate") or 0.0),
            security_block_rate=float(payload.get("security_block_rate") or 0.0),
            cache_hit_rate=float(payload.get("cache_hit_rate") or 0.0),
            avg_retrieved_count=float(payload.get("avg_retrieved_count") or 0.0),
            low_confidence_rate=float(payload.get("low_confidence_rate") or 0.0),
            review_required_rate=float(payload.get("review_required_rate") or 0.0),
        )

    async def get_corpus_coverage_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> dict[str, Any]:
        access = _coerce_access_level(access_level)
        _ensure_can_view_integrity(access)
        payload = await self._repository.get_corpus_coverage_snapshot(
            bureau_id=bureau_id,
            allowed_classifications=list(_allowed_classifications_for(access)),
        )
        payload["checked_at"] = datetime.now(timezone.utc).isoformat()
        payload["contract_version"] = "rag.v3.corpus.coverage.response.v1"
        payload["schema_version"] = "rag.v3.corpus.coverage.response.schema.v1"
        return payload

    async def get_compliance_evidence_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
        access_level: AccessLevel = AccessLevel.MEMBER,
    ) -> dict[str, Any]:
        access = _coerce_access_level(access_level)
        _ensure_can_view_observability(access)
        payload = await self._repository.get_compliance_evidence_snapshot(bureau_id=bureau_id)

        retention_policy_contract_path = str(
            getattr(settings, "compliance_retention_policy_contract_path", "")
            or "docs/compliance/data-retention-policy.contract.json"
        ).strip()
        dpia_evidence_path = str(
            getattr(settings, "compliance_dpia_evidence_path", "")
            or "docs/compliance/evidence/dpia-technical-evidence.json"
        ).strip()
        ropa_evidence_path = str(
            getattr(settings, "compliance_ropa_evidence_path", "")
            or "docs/compliance/evidence/ropa-technical-evidence.json"
        ).strip()

        payload["retention_policy_contract_path"] = retention_policy_contract_path
        payload["retention_policy_contract_present"] = bool(retention_policy_contract_path and Path(retention_policy_contract_path).exists())
        payload["retention_policy_contract_version"] = _read_contract_version(Path(retention_policy_contract_path))
        payload["dpia_evidence_present"] = bool(dpia_evidence_path and Path(dpia_evidence_path).exists())
        payload["ropa_evidence_present"] = bool(ropa_evidence_path and Path(ropa_evidence_path).exists())
        payload["legal_hold_pipeline_enabled"] = True
        payload["delete_pipeline_enabled"] = True
        payload["anonymize_pipeline_enabled"] = True

        payload["checked_at"] = datetime.now(timezone.utc).isoformat()
        payload["contract_version"] = "rag.v3.compliance.evidence.response.v1"
        payload["schema_version"] = "rag.v3.compliance.evidence.response.schema.v1"
        return payload

    async def _persist_security_block_trace(
        self,
        *,
        request_id: str,
        started_at: float,
        bureau_id: Optional[UUID],
        query: str,
        command: RagV3QueryCommand,
        detail: Any,
        matches: Optional[list[RagV3ChunkMatch]] = None,
    ) -> None:
        if not hasattr(self._repository, "append_query_trace"):
            return

        detail_obj = detail if isinstance(detail, dict) else {}
        threat_type = str(detail_obj.get("threat_type") or "UNKNOWN")
        location = str(detail_obj.get("location") or "query")
        warnings = [
            "prompt_injection_blocked",
            f"threat_type:{threat_type}",
            f"location:{location}",
        ]
        blocked_result = RagV3QueryResult(
            answer=RAG_V3_NO_ANSWER,
            status="no_answer",
            citations=[],
            structured=RagV3StructuredAnswer(
                answer_text=RAG_V3_NO_ANSWER,
                citations=[],
                confidence=0.0,
                should_escalate=True,
                follow_up_questions=[],
                warnings=list(warnings),
                legal_disclaimer="",
            ),
            fingerprint=RagV3Fingerprint(
                model_name="none",
                model_version="none/none",
                index_version="rag_v3_security_block",
                prompt_version=RAG_V3_PROMPT_VERSION,
                doc_hashes=[],
                chunk_hashes=[],
            ),
            retrieved_count=len(matches or []),
            resolved_as_of_date=command.as_of_date or command.event_date or command.decision_date,
            review_ticket_id=None,
            claim_verification=RagV3ClaimVerificationReport(
                total_claims=0,
                supported_claims=0,
                support_ratio=1.0,
                unsupported_claims=[],
                passed=True,
            ),
            policy=RagV3PolicySummary(
                risk_level="CRITICAL",
                policy_flags=["PROMPT_INJECTION_DETECTED"],
                legal_disclaimer="",
                should_escalate=True,
            ),
            admission=RagV3AdmissionSummary(
                accepted=False,
                reason="security_block",
                queue_wait_ms=0,
                effective_tier=command.requested_tier if command.requested_tier in (1, 2, 3, 4) else 2,
                degraded=False,
            ),
            gate_decision="security_block",
        )
        try:
            await self._finalize_query_result(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=query,
                command=command,
                requested_tier=command.requested_tier if command.requested_tier in (1, 2, 3, 4) else 2,
                result=blocked_result,
                matches=list(matches or []),
                extra_metadata={
                    "security_block": True,
                    "security_threat_type": threat_type,
                    "security_location": location,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "RAG_V3_SECURITY_TRACE_PERSIST_FAILED | request_id=%s | reason=%s",
                request_id,
                exc,
            )

    async def _query_cache_get(self, key: str) -> Optional[RagV3QueryResult]:
        if not self._query_cache_enabled:
            return None
        now = time.monotonic()
        async with self._query_cache_lock:
            entry = self._query_cache.get(key)
            if not entry:
                return None
            expires_at, cached_result = entry
            if expires_at <= now:
                self._query_cache.pop(key, None)
                return None
            self._query_cache.move_to_end(key)
            return cached_result

    async def _query_cache_set(self, key: str, result: RagV3QueryResult) -> None:
        if not self._query_cache_enabled:
            return
        expires_at = time.monotonic() + float(self._query_cache_ttl_s)
        async with self._query_cache_lock:
            self._query_cache[key] = (expires_at, result)
            self._query_cache.move_to_end(key)
            while len(self._query_cache) > self._query_cache_max_entries:
                self._query_cache.popitem(last=False)

    async def _clear_query_cache(self, *, reason: str) -> None:
        if not self._query_cache_enabled:
            return
        async with self._query_cache_lock:
            self._query_cache.clear()
        logger.info("RAG_V3_QUERY_CACHE_CLEARED | reason=%s", reason)

    def _build_query_cache_key(
        self,
        *,
        query: str,
        command: RagV3QueryCommand,
        top_k: int,
        bureau_id: Optional[UUID],
        acl_tags: list[str],
        allowed_classifications: list[str],
        as_of_date: Optional[date],
        requested_tier: int,
        policy_context: dict[str, Any],
        source_types: list[str],
        snapshot_id: int,
        revocation_epoch: int,
    ) -> str:
        normalized_query = " ".join((query or "").strip().lower().split())
        history_token = _history_cache_token(command.history)
        policy_token = _policy_context_cache_token(policy_context)
        normalized_source_types = sorted(_normalize_source_types(source_types))
        token = "|".join(
            [
                f"bureau={str(bureau_id) if bureau_id else 'public'}",
                f"query={normalized_query}",
                f"history={history_token}",
                f"jurisdiction={(command.jurisdiction or 'TR').strip().upper()}",
                f"as_of={as_of_date.isoformat() if as_of_date else ''}",
                f"event_date={command.event_date.isoformat() if command.event_date else ''}",
                f"decision_date={command.decision_date.isoformat() if command.decision_date else ''}",
                f"top_k={int(top_k)}",
                f"tier={int(requested_tier)}",
                f"acl={','.join(sorted(_unique_in_order([t.lower() for t in acl_tags])))}",
                f"class={','.join(sorted(_unique_in_order([c.upper() for c in allowed_classifications])))}",
                f"policy={policy_token}",
                f"source_types={','.join(normalized_source_types)}",
                f"snapshot={int(snapshot_id)}",
                f"rev_epoch={int(revocation_epoch)}",
                f"embed_model={settings.embedding_model}",
                f"prompt={RAG_V3_PROMPT_VERSION}",
            ]
        )
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    async def _finalize_query_result(
        self,
        *,
        request_id: str,
        started_at: float,
        bureau_id: Optional[UUID],
        query: str,
        command: RagV3QueryCommand,
        requested_tier: int,
        result: RagV3QueryResult,
        matches: list[RagV3ChunkMatch],
        extra_metadata: Optional[dict[str, Any]] = None,
    ) -> RagV3QueryResult:
        contract_version = _rag_v3_query_contract_version()
        schema_version = _rag_v3_query_schema_version()
        latency_ms = max(0, int((time.monotonic() - started_at) * 1000))
        finalized = replace(
            result,
            request_id=request_id,
            contract_version=contract_version,
            schema_version=schema_version,
        )
        await self._persist_query_trace(
            request_id=request_id,
            bureau_id=bureau_id,
            query=query,
            command=command,
            requested_tier=requested_tier,
            result=finalized,
            matches=matches,
            latency_ms=latency_ms,
            extra_metadata=extra_metadata,
        )
        return finalized

    async def _persist_query_trace(
        self,
        *,
        request_id: str,
        bureau_id: Optional[UUID],
        query: str,
        command: RagV3QueryCommand,
        requested_tier: int,
        result: RagV3QueryResult,
        matches: list[RagV3ChunkMatch],
        latency_ms: int,
        extra_metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        if not hasattr(self._repository, "append_query_trace"):
            return

        citation_temporal = {
            str(item.chunk_id): item.temporal_version
            for item in result.citations
            if str(item.chunk_id).strip()
        }
        retrieval_trace = [
            {
                "rank": rank,
                "chunk_id": item.chunk_id,
                "document_id": item.document_id,
                "source_id": item.source_id,
                "source_type": item.source_type,
                "article_no": item.article_no,
                "clause_no": item.clause_no,
                "subclause_no": item.subclause_no,
                "semantic_score": _clamp01(item.semantic_score),
                "keyword_score": _clamp01(item.keyword_score),
                "final_score": _clamp01(item.final_score),
                "temporal_version": citation_temporal.get(item.chunk_id),
            }
            for rank, item in enumerate(matches, start=1)
        ]
        citations = [
            {
                "chunk_id": item.chunk_id,
                "document_id": item.document_id,
                "source_id": item.source_id,
                "source_type": item.source_type,
                "article_no": item.article_no,
                "clause_no": item.clause_no,
                "subclause_no": item.subclause_no,
                "final_score": _clamp01(item.final_score),
                "temporal_version": item.temporal_version,
                "evidence_text": item.evidence_text,
                "evidence_start": item.evidence_start,
                "evidence_end": item.evidence_end,
                "evidence_overlap": item.evidence_overlap,
                "citation_date": item.citation_date,
                "issuing_authority": item.issuing_authority,
                "decision_no": item.decision_no,
                "reference_no": item.reference_no,
            }
            for item in result.citations
        ]
        fingerprint = {
            "model_name": result.fingerprint.model_name,
            "model_version": result.fingerprint.model_version,
            "index_version": result.fingerprint.index_version,
            "prompt_version": result.fingerprint.prompt_version,
            "doc_hashes": result.fingerprint.doc_hashes,
            "chunk_hashes": result.fingerprint.chunk_hashes,
        }
        model_audit = _build_model_lane_audit(
            requested_tier=requested_tier if requested_tier in (1, 2, 3, 4) else 2,
            effective_tier=result.admission.effective_tier if result.admission.effective_tier in (1, 2, 3, 4) else 2,
            runtime_model_version=result.fingerprint.model_version,
            gate_decision=result.gate_decision,
            response_status=result.status,
        )

        metadata = {
            "resolved_as_of_date": (
                result.resolved_as_of_date.isoformat() if result.resolved_as_of_date else None
            ),
            "event_date": command.event_date.isoformat() if command.event_date else None,
            "decision_date": command.decision_date.isoformat() if command.decision_date else None,
            "review_ticket_id": result.review_ticket_id,
            "estimated_cost_usd": float(result.estimated_cost),
            "cost_estimate": dict(result.cost_estimate or {}),
            "claim_total": result.claim_verification.total_claims,
            "claim_supported": result.claim_verification.supported_claims,
            "claim_support_ratio": result.claim_verification.support_ratio,
            "policy_risk_level": result.policy.risk_level,
            "policy_flags": list(result.policy.policy_flags),
            "policy_sensitivity": result.policy.sensitivity,
            "policy_residency": result.policy.residency,
            "policy_external_transfer": result.policy.external_transfer,
            "policy_retention": result.policy.retention,
            "policy_privilege_scope": result.policy.privilege_scope,
            "policy_purpose_of_use": result.policy.purpose_of_use,
            "policy_source_rights": result.policy.source_rights,
            "policy_exportability": result.policy.exportability,
            "policy_provider_allowlist": list(result.policy.provider_allowlist),
            "admission_accepted": result.admission.accepted,
            "admission_degraded": result.admission.degraded,
            "admission_queue_wait_ms": result.admission.queue_wait_ms,
            "snapshot_id": result.snapshot_id,
            "revocation_epoch": int(result.revocation_epoch),
            "legal_disclaimer_ack": bool(command.legal_disclaimer_ack),
            "human_responsibility_ack": bool(command.human_responsibility_ack),
            "review_required": bool(result.review_required),
            "review_reason_codes": list(result.review_reason_codes),
            "low_confidence": bool(result.low_confidence),
            "low_confidence_reason": str(result.low_confidence_reason or ""),
            "legal_disclaimer_required": bool(result.legal_disclaimer_required),
            "human_responsibility_notice": str(result.human_responsibility_notice or ""),
            "source_documents": _source_documents_from_citation_payload(citations),
            "model_lane": model_audit.get("model_lane"),
            "model_role": model_audit.get("model_role"),
            "model_expected_version": model_audit.get("model_expected_version"),
            "model_expected_family": model_audit.get("model_expected_family"),
            "model_runtime_version": model_audit.get("model_runtime_version"),
            "model_runtime_family": model_audit.get("model_runtime_family"),
            "model_execution_state": model_audit.get("model_execution_state"),
            "model_mapping_verified": bool(model_audit.get("mapping_verified")),
            "model_mapping_reason_codes": list(model_audit.get("reason_codes") or []),
            "model_mapping_evidence_complete": bool(model_audit.get("mapping_evidence_complete")),
        }
        if isinstance(extra_metadata, dict):
            metadata = {**metadata, **dict(extra_metadata)}
            tier_policy = extra_metadata.get("tier_policy")
            if isinstance(tier_policy, dict):
                route_reason = str(tier_policy.get("route_reason") or "").strip()
                if route_reason and "tier_policy_route_reason" not in metadata:
                    metadata["tier_policy_route_reason"] = route_reason
            query_expansion = extra_metadata.get("query_expansion")
            if isinstance(query_expansion, dict):
                metadata["query_expansion"] = dict(query_expansion)
            prompt_registry = extra_metadata.get("prompt_registry")
            if isinstance(prompt_registry, dict):
                scenario = str(prompt_registry.get("scenario") or "").strip()
                registry_version = str(prompt_registry.get("registry_version") or "").strip()
                if scenario:
                    metadata["prompt_scenario"] = scenario
                if registry_version:
                    metadata["prompt_registry_version"] = registry_version

        if bool(getattr(settings, "rag_v3_trace_require_model_mapping", True)):
            if not bool(metadata.get("model_mapping_evidence_complete")):
                raise ValueError("Query trace model mapping evidence missing.")

        if (
            bool(getattr(settings, "rag_v3_trace_model_mapping_fail_closed", True))
            and _is_prod_like_runtime()
            and str(metadata.get("model_execution_state") or "") not in {"not_invoked", "extractive_fallback"}
            and not bool(metadata.get("model_mapping_verified"))
        ):
            reason_codes = ",".join(list(metadata.get("model_mapping_reason_codes") or []))
            raise RuntimeError(
                "Query trace model mapping drift detected (fail-closed): "
                + (reason_codes or "unclassified_model_mapping_drift")
            )
        try:
            await self._repository.append_query_trace(
                request_id=request_id,
                bureau_id=bureau_id,
                query=query,
                response_status=result.status,
                gate_decision=result.gate_decision,
                requested_tier=requested_tier if requested_tier in (1, 2, 3, 4) else 2,
                effective_tier=result.admission.effective_tier,
                top_k=_normalize_top_k(int(command.top_k)),
                jurisdiction=(command.jurisdiction or "TR").strip() or "TR",
                as_of_date=(
                    result.resolved_as_of_date
                    or command.as_of_date
                    or command.event_date
                    or command.decision_date
                ),
                admission_reason=result.admission.reason,
                retrieved_count=result.retrieved_count,
                retrieved_chunk_ids=[item.chunk_id for item in matches if item.chunk_id],
                retrieval_trace=retrieval_trace,
                citations=citations,
                fingerprint=fingerprint,
                warnings=list(result.structured.warnings),
                contract_version=result.contract_version,
                schema_version=result.schema_version,
                latency_ms=latency_ms,
                metadata=metadata,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_TRACE_PERSIST_FAILED | request_id=%s | reason=%s", request_id, exc)

    async def _resolve_snapshot_state(
        self,
        *,
        bureau_id: Optional[UUID],
        requested_snapshot_id: Optional[int],
    ) -> RagV3SnapshotState:
        publish_epoch = 0
        revocation_epoch = 0
        warnings: list[str] = []
        if hasattr(self._repository, "get_control_plane_state"):
            try:
                payload = await self._repository.get_control_plane_state(bureau_id=bureau_id)
                publish_epoch = max(0, int((payload or {}).get("publish_epoch") or 0))
                revocation_epoch = max(0, int((payload or {}).get("revocation_epoch") or 0))
            except Exception as exc:  # noqa: BLE001
                warnings.append("control_plane_state_unavailable")
                logger.warning("RAG_V3_CONTROL_PLANE_READ_FAILED | reason=%s", exc)

        snapshot_id = publish_epoch if publish_epoch > 0 else 0
        if requested_snapshot_id is not None:
            requested = max(0, int(requested_snapshot_id))
            if publish_epoch > 0 and requested > publish_epoch:
                snapshot_id = publish_epoch
                warnings.append("snapshot_id_clamped_to_publish_epoch")
            else:
                snapshot_id = requested
        if snapshot_id <= 0 and publish_epoch > 0:
            snapshot_id = publish_epoch
        return RagV3SnapshotState(
            snapshot_id=int(snapshot_id),
            publish_epoch=int(publish_epoch),
            revocation_epoch=int(revocation_epoch),
            warnings=warnings,
        )

    async def _current_revocation_epoch(self, *, bureau_id: Optional[UUID]) -> int:
        if not hasattr(self._repository, "get_control_plane_state"):
            return 0
        try:
            payload = await self._repository.get_control_plane_state(bureau_id=bureau_id)
            return max(0, int((payload or {}).get("revocation_epoch") or 0))
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_REVOCATION_EPOCH_READ_FAILED | reason=%s", exc)
            return 0

    async def _filter_matches_for_snapshot(
        self,
        *,
        matches: list[RagV3ChunkMatch],
        bureau_id: Optional[UUID],
        snapshot_id: int,
    ) -> tuple[list[RagV3ChunkMatch], dict[str, Any], list[str]]:
        if not matches:
            return [], {"snapshot_state_filter_applied": False}, []
        if not bool(getattr(settings, "rag_v3_snapshot_enforcement_enabled", True)):
            return list(matches), {"snapshot_state_filter_applied": False}, []
        if not hasattr(self._repository, "get_document_lifecycle_states"):
            return list(matches), {"snapshot_state_filter_applied": False}, []

        states: dict[str, dict[str, Any]] = {}
        try:
            states = await self._repository.get_document_lifecycle_states(
                document_ids=[item.document_id for item in matches if item.document_id],
                bureau_id=bureau_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_SNAPSHOT_STATE_FILTER_FAILED | reason=%s", exc)
            return list(matches), {"snapshot_state_filter_applied": False, "snapshot_state_filter_error": str(exc)[:240]}, []

        filtered: list[RagV3ChunkMatch] = []
        dropped_tombstoned = 0
        dropped_revoked = 0
        dropped_future_snapshot = 0
        for item in matches:
            state = states.get(item.document_id) or {}
            tombstoned = bool(state.get("tombstoned"))
            revoked = bool(state.get("revoked"))
            publish_epoch = max(0, int(state.get("publish_epoch") or 0))
            if tombstoned:
                dropped_tombstoned += 1
                continue
            if revoked:
                dropped_revoked += 1
                continue
            if snapshot_id > 0 and publish_epoch > snapshot_id:
                dropped_future_snapshot += 1
                continue
            filtered.append(item)

        notes: list[str] = []
        if dropped_tombstoned:
            notes.append(f"snapshot_filter_dropped_tombstoned:{dropped_tombstoned}")
        if dropped_revoked:
            notes.append(f"snapshot_filter_dropped_revoked:{dropped_revoked}")
        if dropped_future_snapshot:
            notes.append(f"snapshot_filter_dropped_future_snapshot:{dropped_future_snapshot}")

        metadata = {
            "snapshot_state_filter_applied": True,
            "snapshot_filter_input_count": len(matches),
            "snapshot_filter_output_count": len(filtered),
            "snapshot_filter_dropped_tombstoned": dropped_tombstoned,
            "snapshot_filter_dropped_revoked": dropped_revoked,
            "snapshot_filter_dropped_future_snapshot": dropped_future_snapshot,
        }
        return filtered, metadata, notes

    async def _retrieve_matches(
        self,
        *,
        query: str,
        embedding: list[float],
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        allowed_classifications: list[str],
        bureau_id: Optional[UUID],
        retrieval_mode: str = "hybrid",
        exact_enabled: bool = True,
        doc_shortlist_size: Optional[int] = None,
    ) -> list[RagV3ChunkMatch]:
        candidate_k = max(top_k, int(settings.rag_v3_reranker_top_n))
        mode = (retrieval_mode or "hybrid").strip().lower()
        dense: list[RagV3ChunkMatch] = []
        sparse: list[RagV3ChunkMatch] = []
        exact: list[RagV3ChunkMatch] = []
        exact_lane_allowed = (
            bool(exact_enabled)
            and bool(getattr(settings, "rag_v3_legal_exact_lane_enabled", True))
            and hasattr(self._repository, "match_chunks_legal_exact")
        )
        exact_top_k = max(candidate_k, int(getattr(settings, "rag_v3_exact_top_k", 24) or 24))

        base_matches: list[RagV3ChunkMatch] = []
        if mode == "dense":
            dense = await self._repository.match_chunks_dense(
                query_embedding=embedding,
                top_k=candidate_k,
                jurisdiction=jurisdiction,
                as_of_date=as_of_date,
                acl_tags=acl_tags,
                allowed_classifications=allowed_classifications,
                bureau_id=bureau_id,
            )
            base_matches = list(dense)
        elif mode == "sparse":
            sparse = await self._repository.match_chunks_sparse(
                query_text=query,
                top_k=candidate_k,
                jurisdiction=jurisdiction,
                as_of_date=as_of_date,
                acl_tags=acl_tags,
                allowed_classifications=allowed_classifications,
                bureau_id=bureau_id,
            )
            base_matches = list(sparse)
        elif mode in {"exact", "exact_hybrid"}:
            tasks = [
                self._repository.match_chunks_dense(
                    query_embedding=embedding,
                    top_k=max(candidate_k, int(settings.rag_v3_dense_top_k)),
                    jurisdiction=jurisdiction,
                    as_of_date=as_of_date,
                    acl_tags=acl_tags,
                    allowed_classifications=allowed_classifications,
                    bureau_id=bureau_id,
                ),
                self._repository.match_chunks_sparse(
                    query_text=query,
                    top_k=max(candidate_k, int(settings.rag_v3_sparse_top_k)),
                    jurisdiction=jurisdiction,
                    as_of_date=as_of_date,
                    acl_tags=acl_tags,
                    allowed_classifications=allowed_classifications,
                    bureau_id=bureau_id,
                ),
            ]
            if exact_lane_allowed:
                tasks.append(
                    self._repository.match_chunks_legal_exact(
                        query_text=query,
                        top_k=exact_top_k,
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    )
                )
            try:
                results = await asyncio.gather(*tasks)
                dense = list(results[0])
                sparse = list(results[1])
                if exact_lane_allowed and len(results) >= 3:
                    exact = list(results[2])
                base_matches = _rrf_fuse(
                    dense,
                    sparse,
                    exact=exact,
                    exact_weight=max(0.1, float(getattr(settings, "rag_v3_exact_lane_weight", 1.0) or 1.0)),
                    max_results=candidate_k,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("RAG_V3_EXACT_HYBRID_FALLBACK | reason=%s", exc)
        elif settings.rag_v3_hybrid_enabled:
            dense_k = max(candidate_k, int(settings.rag_v3_dense_top_k))
            sparse_k = max(candidate_k, int(settings.rag_v3_sparse_top_k))
            try:
                tasks = [
                    self._repository.match_chunks_dense(
                        query_embedding=embedding,
                        top_k=dense_k,
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    ),
                    self._repository.match_chunks_sparse(
                        query_text=query,
                        top_k=sparse_k,
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    ),
                ]
                if exact_lane_allowed:
                    tasks.append(
                        self._repository.match_chunks_legal_exact(
                            query_text=query,
                            top_k=exact_top_k,
                            jurisdiction=jurisdiction,
                            as_of_date=as_of_date,
                            acl_tags=acl_tags,
                            allowed_classifications=allowed_classifications,
                            bureau_id=bureau_id,
                        )
                    )
                results = await asyncio.gather(*tasks)
                dense = list(results[0])
                sparse = list(results[1])
                if exact_lane_allowed and len(results) >= 3:
                    exact = list(results[2])
                fused = _rrf_fuse(
                    dense,
                    sparse,
                    exact=exact,
                    exact_weight=max(0.1, float(getattr(settings, "rag_v3_exact_lane_weight", 1.0) or 1.0)),
                    max_results=candidate_k,
                )
                if fused:
                    base_matches = fused
            except Exception as exc:  # noqa: BLE001
                logger.warning("RAG_V3_HYBRID_FALLBACK | reason=%s", exc)

        if not base_matches:
            dense = await self._repository.match_chunks_dense(
                query_embedding=embedding,
                top_k=candidate_k,
                jurisdiction=jurisdiction,
                as_of_date=as_of_date,
                acl_tags=acl_tags,
                allowed_classifications=allowed_classifications,
                bureau_id=bureau_id,
            )
            base_matches = list(dense)

        if exact_enabled and bool(getattr(settings, "rag_v3_legal_exact_lane_enabled", True)):
            if exact_lane_allowed and not exact and mode not in {"sparse"}:
                try:
                    exact = await self._repository.match_chunks_legal_exact(
                        query_text=query,
                        top_k=exact_top_k,
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("RAG_V3_EXACT_LANE_RPC_FAILED | reason=%s", exc)
            lane_weight = max(0.1, float(getattr(settings, "rag_v3_exact_lane_weight", 1.0) or 1.0))
            if exact:
                dense_for_fuse = dense if dense else base_matches
                base_matches = _rrf_fuse(
                    dense_for_fuse,
                    sparse,
                    exact=exact,
                    exact_weight=lane_weight,
                    max_results=candidate_k,
                )
            exact_boosted = apply_exact_legal_boost(
                query=query,
                matches=base_matches,
                strong_boost=0.12 * lane_weight,
                weak_boost=0.05 * lane_weight,
            )
            base_matches = exact_boosted.matches

        if bool(getattr(settings, "rag_v3_doc_shortlist_enabled", True)):
            shortlist_k = int(doc_shortlist_size or int(getattr(settings, "rag_v3_doc_shortlist_k", 12) or 12))
            if bool(getattr(settings, "rag_v3_doc_shortlist_rpc_enabled", True)) and hasattr(
                self._repository, "match_document_shortlist"
            ):
                try:
                    remote_shortlist = await self._repository.match_document_shortlist(
                        query_embedding=embedding,
                        query_text=query,
                        doc_k=max(2, shortlist_k),
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
                    )
                    doc_score_map = {
                        str(item.document_id): _clamp01(float(item.doc_score))
                        for item in remote_shortlist
                        if str(item.document_id).strip()
                    }
                    if doc_score_map:
                        shortlisted_ids = set(doc_score_map.keys())
                        filtered = [row for row in base_matches if row.document_id in shortlisted_ids]
                        if filtered:
                            base_matches = [
                                replace(
                                    row,
                                    final_score=_clamp01((0.85 * float(row.final_score)) + (0.15 * doc_score_map.get(row.document_id, 0.0))),
                                )
                                for row in filtered
                            ]
                            base_matches.sort(key=lambda item: item.final_score, reverse=True)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("RAG_V3_DOC_SHORTLIST_RPC_FAILED | reason=%s", exc)
            shortlist = self._doc_retriever.shortlist(
                matches=base_matches,
                max_docs=max(2, shortlist_k),
            )
            base_matches = shortlist.matches

        return list(base_matches[:candidate_k])

    async def _rerank(
        self,
        query: str,
        matches: list[RagV3ChunkMatch],
        *,
        top_k: int,
        rerank_top_n: Optional[int] = None,
    ) -> list[RagV3ChunkMatch]:
        if not matches:
            return []
        configured_top_n = int(getattr(settings, "rag_v3_reranker_top_n", 12) or 12)
        dynamic_top_n = int(rerank_top_n or 0)
        pool_size = max(top_k, configured_top_n, dynamic_top_n)
        candidates = list(matches[:pool_size])
        if not settings.rag_v3_reranker_enabled:
            return candidates[:top_k]

        rerank_scores = await self._reranker.rerank(
            query,
            [RagV3RerankItem(chunk_id=item.chunk_id, text=item.chunk_text, retrieval_score=item.final_score) for item in candidates],
        )
        if not rerank_scores:
            return candidates[:top_k]

        rw = max(0.0, float(settings.rag_v3_retrieval_score_weight))
        ww = max(0.0, float(settings.rag_v3_reranker_score_weight))
        denom = rw + ww if (rw + ww) > 0 else 1.0
        rescored: list[RagV3ChunkMatch] = []
        for item in candidates:
            retrieval = _clamp01(item.final_score)
            rerank = _clamp01(rerank_scores.get(item.chunk_id, 0.0))
            final = ((rw * retrieval) + (ww * rerank)) / denom
            rescored.append(
                replace(
                    item,
                    final_score=final,
                    semantic_score=_clamp01(item.semantic_score),
                    keyword_score=_clamp01(item.keyword_score),
                )
            )
        rescored.sort(key=lambda x: x.final_score, reverse=True)
        return rescored[:top_k]

    async def _safe_rerank_with_timeout(
        self,
        *,
        query: str,
        matches: list[RagV3ChunkMatch],
        top_k: int,
        timeout_s: float,
        rerank_top_n: Optional[int] = None,
    ) -> list[RagV3ChunkMatch]:
        try:
            reranked = await asyncio.wait_for(
                self._rerank(query, matches, top_k=top_k, rerank_top_n=rerank_top_n),
                timeout=max(0.5, float(timeout_s)),
            )
            health = assess_reranker_output(reranked)
            if (not health.healthy) and bool(getattr(settings, "rag_v3_reranker_release_gate_enabled", False)):
                logger.warning(
                    "RAG_V3_RERANK_RELEASE_GATE_FALLBACK | spread=%.5f | mean=%.5f | warnings=%s",
                    health.spread,
                    health.mean_score,
                    health.warnings,
                )
                return list(matches[:top_k])
            return reranked
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_RERANK_FALLBACK | reason=%s", exc)
            return list(matches[:top_k])

    async def _iterative_retrieve(
        self,
        *,
        query: str,
        current_matches: list[RagV3ChunkMatch],
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        allowed_classifications: list[str],
        bureau_id: Optional[UUID],
    ) -> tuple[list[RagV3ChunkMatch], dict[str, Any]]:
        rewritten_query = _rewrite_query_for_iterative_retrieval(query, current_matches)
        if not rewritten_query:
            return [], {"iterative_retrieval_applied": False}

        iterative_top_k = max(
            top_k + 2,
            int(getattr(settings, "rag_v3_iterative_top_k", top_k + 2) or (top_k + 2)),
        )
        iterative_plan = self._planner.plan(
            query=rewritten_query,
            top_k=iterative_top_k,
            dual_temporal_requested=False,
        )
        rewritten_embedding = await self._safe_embed_query(
            rewritten_query,
            acl_tags=acl_tags,
            allowed_classifications=allowed_classifications,
        )
        second_pass = await self._retrieve_matches(
            query=rewritten_query,
            embedding=rewritten_embedding,
            top_k=iterative_top_k,
            jurisdiction=jurisdiction,
            as_of_date=as_of_date,
            acl_tags=acl_tags,
            allowed_classifications=allowed_classifications,
            bureau_id=bureau_id,
            retrieval_mode=iterative_plan.retrieval_mode,
            exact_enabled=iterative_plan.exact_search_enabled,
            doc_shortlist_size=iterative_plan.doc_shortlist_size,
        )
        if not second_pass:
            return [], {
                "iterative_retrieval_applied": False,
                "iterative_retrieval_query": rewritten_query[:240],
            }

        merged = _merge_match_pools(
            primary=current_matches,
            secondary=second_pass,
            limit=max(iterative_top_k, int(settings.rag_v3_reranker_top_n)),
        )
        if not merged:
            return [], {
                "iterative_retrieval_applied": False,
                "iterative_retrieval_query": rewritten_query[:240],
            }

        return merged, {
            "iterative_retrieval_applied": True,
            "iterative_retrieval_query": rewritten_query[:240],
            "iterative_first_pass_count": len(current_matches),
            "iterative_second_pass_count": len(second_pass),
            "iterative_merged_count": len(merged),
        }

    async def _retrieve_dual_temporal_matches(
        self,
        *,
        query: str,
        embedding: list[float],
        top_k: int,
        jurisdiction: str,
        event_date: Optional[date],
        decision_date: Optional[date],
        acl_tags: list[str],
        allowed_classifications: list[str],
        bureau_id: Optional[UUID],
        retrieval_mode: str = "hybrid",
        exact_enabled: bool = True,
        doc_shortlist_size: Optional[int] = None,
    ) -> tuple[list[RagV3ChunkMatch], dict[str, str], dict[str, Any], list[str]]:
        if not _is_dual_temporal_requested(event_date=event_date, decision_date=decision_date):
            return [], {}, {"dual_temporal_applied": False}, []

        assert event_date is not None
        assert decision_date is not None
        swapped = False
        if event_date > decision_date:
            event_date, decision_date = decision_date, event_date
            swapped = True
        dual_top_k = max(
            top_k,
            int(getattr(settings, "rag_v3_dual_temporal_top_k", top_k + 2) or (top_k + 2)),
        )
        event_matches, decision_matches = await asyncio.gather(
            self._retrieve_matches(
                query=query,
                embedding=embedding,
                top_k=dual_top_k,
                jurisdiction=jurisdiction,
                as_of_date=event_date,
                acl_tags=acl_tags,
                allowed_classifications=allowed_classifications,
                bureau_id=bureau_id,
                retrieval_mode=retrieval_mode,
                exact_enabled=exact_enabled,
                doc_shortlist_size=doc_shortlist_size,
            ),
            self._retrieve_matches(
                query=query,
                embedding=embedding,
                top_k=dual_top_k,
                jurisdiction=jurisdiction,
                as_of_date=decision_date,
                acl_tags=acl_tags,
                allowed_classifications=allowed_classifications,
                bureau_id=bureau_id,
                retrieval_mode=retrieval_mode,
                exact_enabled=exact_enabled,
                doc_shortlist_size=doc_shortlist_size,
            ),
        )
        merged = _merge_match_pools(
            primary=event_matches,
            secondary=decision_matches,
            limit=max(dual_top_k * 2, int(settings.rag_v3_reranker_top_n)),
        )
        labels = _build_temporal_label_map(event_matches=event_matches, decision_matches=decision_matches)
        selected_labels = _labels_for_selected(merged, labels)
        metadata: dict[str, Any] = {
            "dual_temporal_applied": True,
            "dual_temporal_event_date": event_date.isoformat(),
            "dual_temporal_decision_date": decision_date.isoformat(),
            "dual_temporal_event_count": len(event_matches),
            "dual_temporal_decision_count": len(decision_matches),
            "dual_temporal_merged_count": len(merged),
            "dual_temporal_dates_swapped": swapped,
        }
        notes = [
            "dual_temporal_retrieval_applied",
            f"dual_temporal_event_date:{event_date.isoformat()}",
            f"dual_temporal_decision_date:{decision_date.isoformat()}",
        ]
        if swapped:
            notes.append("dual_temporal_dates_swapped")
        return merged, selected_labels, metadata, notes

    def _build_context(
        self,
        matches: list[RagV3ChunkMatch],
        *,
        temporal_labels: Optional[dict[str, str]] = None,
    ) -> str:
        context, _ = self._build_context_with_meta(
            matches,
            query="",
            temporal_labels=temporal_labels,
        )
        return context

    def _build_context_with_meta(
        self,
        matches: list[RagV3ChunkMatch],
        *,
        query: str,
        temporal_labels: Optional[dict[str, str]] = None,
    ) -> tuple[str, dict[str, int]]:
        blocks: list[str] = []
        injection_doc_count = 0
        injection_pattern_count = 0
        replacements, compression_meta = self._context_summarizer.summarize_matches_for_context(
            matches=matches,
            query=query,
            primary_count=int(getattr(settings, "context_summarization_primary_count", 3) or 3),
            target_tokens=int(getattr(settings, "context_summary_target_tokens", 200) or 200),
            enabled=bool(getattr(settings, "context_summarization_enabled", True)),
        )
        for idx, match in enumerate(matches, start=1):
            raw_text = replacements.get(match.chunk_id, match.chunk_text)
            sanitized_text = raw_text
            if bool(getattr(settings, "sanitize_doc_injection_enabled", True)):
                matched_patterns: list[str] = []
                injection_flag = False
                try:
                    sanitized = self._guard.sanitize_document_text(raw_text)
                    sanitized_text = str(getattr(sanitized, "sanitized_text", raw_text) or raw_text)
                    matched_patterns = list(getattr(sanitized, "matched_patterns", []) or [])
                    injection_flag = bool(getattr(sanitized, "injection_flag", False))
                except Exception as exc:  # noqa: BLE001
                    if bool(getattr(settings, "rag_v3_prompt_guard_fail_closed", True)):
                        raise HTTPException(
                            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={
                                "error_code": "PROMPT_GUARD_RUNTIME_ERROR",
                                "message": "Prompt guard runtime failure.",
                                "threat_type": "GUARD_RUNTIME_ERROR",
                                "location": "context_document",
                                "llm_called": False,
                            },
                        ) from exc
                    logger.warning("RAG_V3_SANITIZE_CONTEXT_FAIL_OPEN | reason=%s", exc)
                    sanitized_text = raw_text

                if injection_flag:
                    injection_doc_count += 1
                    injection_pattern_count += len(matched_patterns)
                    if bool(getattr(settings, "rag_v3_context_injection_fail_closed", True)):
                        raise HTTPException(
                            status_code=http_status.HTTP_400_BAD_REQUEST,
                            detail={
                                "error_code": "CONTEXT_INJECTION_DETECTED",
                                "message": "Context document contains injection or exfiltration directives.",
                                "threat_type": "CONTEXT_POISONING",
                                "location": "context_document",
                                "chunk_id": match.chunk_id,
                                "source_id": match.source_id,
                                "matched_patterns": matched_patterns[:10],
                                "llm_called": False,
                            },
                        )

            version = (temporal_labels or {}).get(match.chunk_id, "-")
            blocks.append(
                "[BAGLAM:{idx}] source_id={source_id}; source_type={source_type}; versiyon={version}; "
                "madde={article}; fikra={clause}; alt_fikra={subclause}; sayfa={page}\n{body}".format(
                    idx=idx,
                    source_id=match.source_id,
                    source_type=match.source_type,
                    version=version,
                    article=match.article_no or "-",
                    clause=match.clause_no or "-",
                    subclause=match.subclause_no or "-",
                    page=match.page_range or "-",
                    body=sanitized_text,
                )
            )
        return "\n\n---\n\n".join(blocks), {
            "summarized_count": int(compression_meta.summarized_count),
            "tokens_saved": int(compression_meta.estimated_tokens_saved),
            "injection_doc_count": int(injection_doc_count),
            "injection_pattern_count": int(injection_pattern_count),
        }

    async def _build_structured(
        self,
        *,
        query: str,
        context: str,
        raw_answer: str,
        status: str,
        confidence: float,
        default_citations: list[RagV3Citation],
        allow_repair: bool = False,
    ) -> RagV3StructuredAnswer:
        fallback = _fallback_structured(raw_answer, status, confidence, default_citations, warnings=[])
        if not settings.rag_v3_structured_output_enabled:
            return fallback

        parsed = _parse_structured(raw_answer, default_citations, confidence, status)
        if parsed is not None:
            return parsed

        if not allow_repair:
            return replace(
                fallback,
                warnings=_append_unique(fallback.warnings, "structured_output_repair_skipped"),
            )

        retries = max(0, int(settings.rag_v3_structured_output_retries))
        repaired = raw_answer
        for attempt in range(1, retries + 1):
            repaired = await self._repair_structured(
                query=query,
                context=context,
                raw_answer=repaired,
                citations=default_citations,
            )
            if not repaired:
                continue
            parsed = _parse_structured(repaired, default_citations, confidence, status)
            if parsed is not None:
                return replace(
                    parsed,
                    warnings=_append_unique(parsed.warnings, f"structured_output_repaired_attempt_{attempt}"),
                )

        return replace(fallback, warnings=_append_unique(fallback.warnings, "structured_output_fallback"))

    async def _repair_structured(
        self,
        *,
        query: str,
        context: str,
        raw_answer: str,
        citations: list[RagV3Citation],
    ) -> str:
        citation_hint = "\n".join(
            [
                f"- chunk_id={item.chunk_id}; source_id={item.source_id}; article={item.article_no or ''}; clause={item.clause_no or ''}"
                for item in citations[:8]
            ]
        )
        fix_query = (
            "Yalnizca gecerli bir JSON nesnesi don.\n"
            "Sema: {\"answer_text\":string,\"citations\":[{\"source_id\":string,\"article_no\":string|null,"
            "\"clause_no\":string|null,\"chunk_id\":string|null}],\"confidence\":number,\"should_escalate\":boolean,"
            "\"follow_up_questions\":string[],\"warnings\":string[],\"legal_disclaimer\":string}\n"
            f"Soru: {query}\nKanitlar:\n{citation_hint}\nHam yanit:\n{raw_answer}"
        )
        try:
            repaired, _ = await self._router.generate(
                query=fix_query,
                context=context,
                source_count=len(citations),
                requested_tier=2,
            )
            return repaired.strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_STRUCTURED_REPAIR_FAILED | reason=%s", exc)
            return ""

    def _no_answer_result(
        self,
        *,
        model_label: str,
        matches: list[RagV3ChunkMatch],
        reason: str,
        confidence: float,
        temporal: TemporalResolution,
        policy: RagV3PolicySummary,
        claim_report: RagV3ClaimVerificationReport,
        admission: RagV3AdmissionSummary,
        cost_model_label: Optional[str] = None,
        cost_tier: Optional[int] = None,
        cache_hit: bool = False,
        temporal_labels: Optional[dict[str, str]] = None,
        snapshot_id: Optional[int] = None,
        revocation_epoch: int = 0,
        review_reason_codes: Optional[list[str]] = None,
    ) -> RagV3QueryResult:
        citations = _to_citations(matches, temporal_labels=temporal_labels)
        estimated_cost, cost_estimate = _free_cost_estimate(
            model_id=cost_model_label or model_label or "none/none",
            tier=cost_tier if cost_tier in (1, 2, 3, 4) else admission.effective_tier,
            cached=cache_hit,
        )
        structured = _fallback_structured(
            RAG_V3_NO_ANSWER,
            "no_answer",
            confidence,
            citations,
            warnings=[reason, *temporal.warnings],
        )
        structured = replace(
            structured,
            legal_disclaimer=policy.legal_disclaimer,
            should_escalate=True,
            warnings=_append_unique(structured.warnings, f"policy_risk:{policy.risk_level}"),
        )
        return RagV3QueryResult(
            answer=RAG_V3_NO_ANSWER,
            status="no_answer",
            citations=citations,
            structured=structured,
            fingerprint=self._fingerprint(model_label=model_label, matches=matches),
            retrieved_count=len(matches),
            resolved_as_of_date=temporal.as_of_date,
            review_ticket_id=None,
            claim_verification=claim_report,
            policy=policy,
            admission=admission,
            snapshot_id=snapshot_id,
            revocation_epoch=int(revocation_epoch),
            estimated_cost=estimated_cost,
            cost_estimate=cost_estimate,
            gate_decision=reason,
            review_required=structured.should_escalate or policy.should_escalate,
            review_reason_codes=list(review_reason_codes or [reason]),
            low_confidence=True,
            low_confidence_reason=reason,
            legal_disclaimer_required=bool(getattr(settings, "rag_v3_require_legal_disclaimer_ack", True)),
            human_responsibility_notice=str(
                getattr(settings, "rag_v3_human_responsibility_notice", "")
                or "Nihai hukuki sorumluluk insandadir."
            ),
        )

    def _fingerprint(
        self,
        *,
        model_label: str,
        matches: list[RagV3ChunkMatch],
        prompt_version: Optional[str] = None,
    ) -> RagV3Fingerprint:
        model_name = model_label.split("/", 1)[-1] if "/" in model_label else model_label
        doc_hashes = _unique_in_order([row.doc_hash for row in matches if row.doc_hash])
        chunk_hashes = _unique_in_order([row.chunk_hash for row in matches if row.chunk_hash])
        index_version = _index_version_token()
        return RagV3Fingerprint(
            model_name=model_name,
            model_version=model_label,
            index_version=index_version,
            prompt_version=str(prompt_version or RAG_V3_PROMPT_VERSION),
            doc_hashes=doc_hashes,
            chunk_hashes=chunk_hashes,
        )

    def _to_policy_summary(
        self,
        policy: PolicyDecision,
        *,
        lattice: Optional[PolicyLattice] = None,
    ) -> RagV3PolicySummary:
        lattice_values = lattice or PolicyLattice(provider_allowlist=["google", "openai", "anthropic", "groq"])
        return RagV3PolicySummary(
            risk_level=policy.risk_level,
            policy_flags=list(policy.policy_flags),
            legal_disclaimer=policy.legal_disclaimer,
            should_escalate=policy.should_escalate,
            sensitivity=lattice_values.sensitivity,
            residency=lattice_values.residency,
            external_transfer=lattice_values.external_transfer,
            retention=lattice_values.retention,
            privilege_scope=lattice_values.privilege_scope,
            purpose_of_use=lattice_values.purpose_of_use,
            source_rights=lattice_values.source_rights,
            exportability=lattice_values.exportability,
            provider_allowlist=list(lattice_values.provider_allowlist),
        )

    def _merge_policy_decisions(
        self,
        *,
        base_policy: PolicyDecision,
        lattice: PolicyLattice,
    ) -> PolicyDecision:
        merged_flags = list(dict.fromkeys(list(base_policy.policy_flags) + list(lattice.policy_flags)))
        should_block = bool(base_policy.should_block_generation or lattice.should_block_generation)
        should_escalate = bool(
            base_policy.should_escalate
            or should_block
            or lattice.sensitivity in {"confidential", "privileged"}
            or lattice.privilege_scope in {"client_confidential", "attorney_work_product"}
        )
        return PolicyDecision(
            risk_level=base_policy.risk_level,
            policy_flags=merged_flags,
            legal_disclaimer=base_policy.legal_disclaimer,
            should_escalate=should_escalate,
            should_block_generation=should_block,
        )

    def _enforce_external_transfer_guardrails(
        self,
        *,
        policy: PolicyDecision,
        lattice: PolicyLattice,
        self_host_provider_allowlist: list[str],
    ) -> PolicyDecision:
        if str(lattice.external_transfer or "").strip().lower() != "forbidden":
            return policy

        flags = list(policy.policy_flags)
        should_block = bool(policy.should_block_generation)
        fail_closed = bool(getattr(settings, "rag_v3_data_exfiltration_fail_closed", True))
        self_host = {str(item or "").strip().lower() for item in (self_host_provider_allowlist or []) if str(item or "").strip()}
        providers = {str(item or "").strip().lower() for item in (lattice.provider_allowlist or []) if str(item or "").strip()}

        if not self_host:
            flags.append("EXTERNAL_TRANSFER_FORBIDDEN_NO_SELF_HOST_PROVIDER")
            should_block = should_block or fail_closed
        elif providers and not providers.issubset(self_host):
            flags.append("EXTERNAL_TRANSFER_FORBIDDEN_PROVIDER_MISMATCH")
            should_block = should_block or fail_closed

        if should_block == policy.should_block_generation and flags == list(policy.policy_flags):
            return policy

        return replace(
            policy,
            policy_flags=list(dict.fromkeys(flags)),
            should_block_generation=bool(should_block),
        )

    async def _maybe_enqueue_human_review(
        self,
        *,
        enabled: bool,
        bureau_id: Optional[UUID],
        query: str,
        answer: str,
        confidence: float,
        citations: list[RagV3Citation],
        policy: PolicyDecision,
        claim_report: RagV3ClaimVerificationReport,
        admission: RagV3AdmissionSummary,
        temporal: TemporalResolution,
    ) -> Optional[str]:
        if not enabled:
            return None
        should_enqueue = (
            policy.should_escalate
            or (not claim_report.passed)
            or confidence < _clamp01(float(settings.rag_v3_escalation_confidence_threshold))
        )
        if not should_enqueue:
            return None

        reason_codes: list[str] = [f"risk:{policy.risk_level}"]
        if policy.policy_flags:
            reason_codes.extend([f"policy:{flag}" for flag in policy.policy_flags])
        if not claim_report.passed:
            reason_codes.append("claim_verification_failed")
        if admission.degraded:
            reason_codes.append(f"admission:{admission.reason}")
        if temporal.source != "none":
            reason_codes.append(f"as_of:{temporal.source}")
        assist = build_review_assist(
            risk_level=policy.risk_level,
            confidence=confidence,
            claim_support_ratio=claim_report.support_ratio,
            reason_codes=reason_codes,
        )
        default_sla = max(15, int(getattr(settings, "rag_v3_review_default_sla_minutes", 240) or 240))
        effective_sla = min(int(assist.sla_minutes), default_sla) if assist.priority != "p1" else int(assist.sla_minutes)

        citation_payload = [
            {
                "chunk_id": item.chunk_id,
                "source_id": item.source_id,
                "article_no": item.article_no,
                "clause_no": item.clause_no,
                "final_score": item.final_score,
                "temporal_version": item.temporal_version,
            }
            for item in citations[:8]
        ]
        try:
            return await self._repository.enqueue_human_review(
                bureau_id=bureau_id,
                query=query,
                answer=answer,
                reason_codes=reason_codes,
                confidence=confidence,
                citations=citation_payload,
                metadata={
                    "claim_support_ratio": claim_report.support_ratio,
                    "claim_total": claim_report.total_claims,
                    "unsupported_claims": claim_report.unsupported_claims[:5],
                    "admission_reason": admission.reason,
                    "resolved_as_of_date": temporal.as_of_date.isoformat() if temporal.as_of_date else None,
                    "review_priority": assist.priority,
                    "review_sla_minutes": int(effective_sla),
                    "review_due_at": assist.due_at_iso,
                    "reviewer_roles": assist.reviewer_roles,
                    "review_checklist": assist.checklist,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_REVIEW_ENQUEUE_FAILED | reason=%s", exc)
            return None

    async def _maybe_capture_feedback_candidate(
        self,
        *,
        enabled: bool,
        bureau_id: Optional[UUID],
        query: str,
        result: RagV3QueryResult,
    ) -> Optional[str]:
        if not enabled:
            return None
        reasons: list[str] = []
        if result.status == "no_answer":
            reasons.append("status_no_answer")
        if not result.claim_verification.passed:
            reasons.append("claim_verification_failed")
        if result.admission.degraded:
            reasons.append(f"admission_{result.admission.reason}")
        if result.policy.policy_flags:
            reasons.extend([f"policy_{flag}" for flag in result.policy.policy_flags])
        if result.structured.should_escalate:
            reasons.append("should_escalate")
        if not reasons:
            return None

        payload_citations = [
            {
                "chunk_id": item.chunk_id,
                "source_id": item.source_id,
                "article_no": item.article_no,
                "clause_no": item.clause_no,
                "final_score": item.final_score,
                "temporal_version": item.temporal_version,
            }
            for item in result.citations[:12]
        ]
        try:
            return await self._repository.append_feedback_candidate(
                bureau_id=bureau_id,
                query=query,
                answer=result.answer,
                status=result.status,
                reasons=reasons,
                fingerprint={
                    "model_name": result.fingerprint.model_name,
                    "model_version": result.fingerprint.model_version,
                    "index_version": result.fingerprint.index_version,
                    "prompt_version": result.fingerprint.prompt_version,
                },
                citations=payload_citations,
                metadata={
                    "review_ticket_id": result.review_ticket_id,
                    "resolved_as_of_date": result.resolved_as_of_date.isoformat()
                    if result.resolved_as_of_date
                    else None,
                    "risk_level": result.policy.risk_level,
                    "claim_support_ratio": result.claim_verification.support_ratio,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_FEEDBACK_CAPTURE_FAILED | reason=%s", exc)
            return None

    async def _enqueue_ingest_reprocess(
        self,
        *,
        enabled: bool,
        bureau_id: Optional[UUID],
        command: RagV3IngestCommand,
        reason_codes: list[str],
        detail: dict[str, Any],
    ) -> Optional[str]:
        if not enabled:
            return None
        if not hasattr(self._repository, "enqueue_ingest_reprocess"):
            return None
        try:
            return await self._repository.enqueue_ingest_reprocess(
                bureau_id=bureau_id,
                title=command.title,
                source_type=command.source_type,
                source_id=command.source_id,
                jurisdiction=command.jurisdiction or "TR",
                reason_codes=list(dict.fromkeys(reason_codes)),
                quality_score=float(detail.get("quality_score") or 0.0),
                parser_confidence=float(detail.get("parser_confidence") or 0.0),
                ocr_confidence=float(detail.get("ocr_confidence") or 0.0),
                metadata={
                    **dict(command.metadata or {}),
                    **detail,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_INGEST_REPROCESS_ENQUEUE_FAILED | reason=%s", exc)
            return None

    async def _safe_embed_texts(
        self,
        texts: list[str],
        *,
        warnings: list[str],
        requested_tier: int = 2,
        classification: Optional[str] = None,
    ) -> list[list[float]]:
        try:
            embeddings = await self._embedder.embed_texts(texts)
            if len(embeddings) != len(texts):
                raise RuntimeError("Embedding count mismatch for chunk list.")
            return embeddings
        except Exception as exc:  # noqa: BLE001
            allowed_purposes = _parse_csv_tokens(
                str(getattr(settings, "embedding_fail_open_allowed_purposes", "ingest,query") or "ingest,query")
            )
            decision = decide_embedding_fail_open(
                fail_open_enabled=(
                    bool(settings.embedding_fail_open_enabled)
                    and _embedding_fail_open_acl_allowed(
                        mode="ingest",
                        classification=classification,
                    )
                ),
                mode="ingest",
                requested_tier=requested_tier if requested_tier in (1, 2, 3, 4) else 2,
                max_tier=int(getattr(settings, "embedding_fail_open_max_tier", 4) or 4),
                allow_ingest=("ingest" in allowed_purposes),
                allow_query=("query" in allowed_purposes),
            )
            if not decision.allowed:
                raise
            logger.warning(
                "RAG_V3_EMBED_FAIL_OPEN | mode=ingest | reason=%s | policy=%s",
                str(exc),
                decision.reason,
            )
            warnings.append("Embedding provider unavailable; local hash-embedding fallback used.")
            return [_hash_embedding(text, settings.embedding_dimensions) for text in texts]

    async def _safe_embed_query(
        self,
        query: str,
        *,
        requested_tier: int = 2,
        warnings: Optional[list[str]] = None,
        acl_tags: Optional[list[str]] = None,
        allowed_classifications: Optional[list[str]] = None,
    ) -> list[float]:
        try:
            return await self._embedder.embed_query(query)
        except Exception as exc:  # noqa: BLE001
            allowed_purposes = _parse_csv_tokens(
                str(getattr(settings, "embedding_fail_open_allowed_purposes", "ingest,query") or "ingest,query")
            )
            decision = decide_embedding_fail_open(
                fail_open_enabled=(
                    bool(settings.embedding_fail_open_enabled)
                    and _embedding_fail_open_acl_allowed(
                        mode="query",
                        acl_tags=list(acl_tags or []),
                        allowed_classifications=list(allowed_classifications or []),
                    )
                ),
                mode="query",
                requested_tier=requested_tier if requested_tier in (1, 2, 3, 4) else 2,
                max_tier=int(getattr(settings, "embedding_fail_open_max_tier", 4) or 4),
                allow_ingest=("ingest" in allowed_purposes),
                allow_query=("query" in allowed_purposes),
            )
            if not decision.allowed:
                raise
            logger.warning(
                "RAG_V3_EMBED_FAIL_OPEN | mode=query | reason=%s | policy=%s",
                str(exc),
                decision.reason,
            )
            if warnings is not None:
                warnings.append("Embedding provider unavailable; local hash-embedding fallback used.")
            return _hash_embedding(query, settings.embedding_dimensions)

    def _store_raw_payload(
        self,
        *,
        command: RagV3IngestCommand,
        parsed: ParsedSourceContent,
        doc_hash: str,
        warnings: list[str],
    ) -> dict[str, str]:
        bucket = _sanitize_token(
            str((command.metadata or {}).get("raw_storage_bucket") or "rag-v3-raw"),
            default="rag-v3-raw",
        )
        source_type = _sanitize_token(command.source_type, default="source")
        source_id = _sanitize_token(command.source_id, default="id")
        jurisdiction = _sanitize_token(command.jurisdiction or "tr", default="tr")
        extension = "html" if parsed.source_format == "html" else "txt"
        path = (
            f"rag-v3/{jurisdiction}/{source_type}/{date.today().isoformat()}/"
            f"{source_id}-{doc_hash[:16]}.{extension}"
        )
        content_type = "text/html; charset=utf-8" if parsed.source_format == "html" else "text/plain; charset=utf-8"
        raw_bytes = (command.raw_text or "").encode("utf-8", errors="ignore")

        try:
            client = get_supabase_client()
            storage = client.storage.from_(bucket)
            try:
                storage.upload(path, raw_bytes, {"content-type": content_type, "upsert": "true"})
            except Exception as exc:  # noqa: BLE001
                if "already exists" in str(exc).lower():
                    storage.update(path, raw_bytes, {"content-type": content_type, "upsert": "true"})
                else:
                    raise
            return {"raw_storage_bucket": bucket, "raw_storage_path": path}
        except Exception as exc:  # noqa: BLE001
            warnings.append("raw_storage_upload_failed")
            logger.warning(
                "RAG_V3_RAW_STORAGE_FAIL | bucket=%s | path=%s | reason=%s",
                bucket,
                path,
                exc,
            )
            return {}

    async def _delete_raw_payload(self, *, bucket: str, path: str) -> bool:
        try:
            client = get_supabase_client()
            storage = client.storage.from_(bucket)
            storage.remove([path])
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "RAG_V3_RAW_STORAGE_DELETE_FAIL | bucket=%s | path=%s | reason=%s",
                bucket,
                path,
                exc,
            )
            return False


def _coerce_access_level(value: AccessLevel | str | None) -> AccessLevel:
    if isinstance(value, AccessLevel):
        return value
    token = str(value or "").strip().upper()
    if token in {"OWNER", "LAWYER", "ADMIN"}:
        return AccessLevel.OWNER
    if token in {"READ_ONLY", "READONLY", "READ-ONLY", "CLIENT", "GUEST", "VIEWER"}:
        return AccessLevel.READ_ONLY
    return AccessLevel.MEMBER


def _allowed_classifications_for(access_level: AccessLevel | str | None) -> tuple[str, ...]:
    access = _coerce_access_level(access_level)
    return RAG_V3_CLASSIFICATIONS_BY_ACCESS.get(access, RAG_V3_ALLOWED_CLASSIFICATIONS)


def _normalize_classification(value: object) -> str:
    token = str(value or "").strip().upper()
    if token not in RAG_V3_ALLOWED_CLASSIFICATIONS:
        allowed = ", ".join(RAG_V3_ALLOWED_CLASSIFICATIONS)
        raise ValueError(f"classification must be one of: {allowed}.")
    return token


def _normalize_acl_tags(acl_tags: list[str], *, classification: Optional[str]) -> list[str]:
    tags = [
        str(item).strip().lower()
        for item in (acl_tags or [])
        if str(item).strip()
    ]
    tags = list(dict.fromkeys(tags))

    if classification:
        class_token = classification.strip().upper()
        if class_token == "PUBLIC":
            if "public" not in tags:
                tags.append("public")
        elif class_token in {"INTERNAL", "CONFIDENTIAL", "SENSITIVE"}:
            if class_token.lower() not in tags:
                tags.append(class_token.lower())

    if not tags:
        if classification:
            return ["public"] if classification == "PUBLIC" else [classification.lower()]
        return ["public", "internal", "confidential", "sensitive"]
    return tags[:16]


def _ensure_can_ingest(access_level: AccessLevel | str | None) -> None:
    access = _coerce_access_level(access_level)
    if access == AccessLevel.READ_ONLY:
        raise PermissionError("READ_ONLY access cannot ingest documents.")


def _ensure_ingest_classification_allowed(access_level: AccessLevel | str | None, classification: str) -> None:
    allowed = set(_allowed_classifications_for(access_level))
    if classification not in allowed:
        raise PermissionError(
            f"Access level cannot ingest classification '{classification}'. Allowed: {sorted(allowed)}"
        )


def _ensure_can_delete(access_level: AccessLevel | str | None) -> None:
    access = _coerce_access_level(access_level)
    if access != AccessLevel.OWNER:
        raise PermissionError("Only OWNER access can delete RAG documents.")


def _normalize_lifecycle_action(value: object) -> str:
    token = str(value or "").strip().lower()
    aliases = {
        "revoke": "revoke",
        "revoked": "revoke",
        "tombstone": "tombstone",
        "tombstoned": "tombstone",
        "legal_hold": "legal_hold",
        "legal-hold": "legal_hold",
        "legalhold": "legal_hold",
        "restore": "restore",
        "unrevoke": "restore",
    }
    action = aliases.get(token, "")
    if not action:
        raise ValueError("action must be one of: revoke, tombstone, legal_hold, restore.")
    return action


def _ensure_can_view_integrity(access_level: AccessLevel | str | None) -> None:
    access = _coerce_access_level(access_level)
    if access != AccessLevel.OWNER:
        raise PermissionError("Only OWNER access can view integrity snapshots.")


def _ensure_can_view_observability(access_level: AccessLevel | str | None) -> None:
    access = _coerce_access_level(access_level)
    if access not in (AccessLevel.OWNER, AccessLevel.MEMBER):
        raise PermissionError("Only MEMBER or OWNER access can view observability snapshots.")


def _ensure_can_manage_review(access_level: AccessLevel | str | None) -> None:
    access = _coerce_access_level(access_level)
    if access not in (AccessLevel.OWNER, AccessLevel.MEMBER):
        raise PermissionError("Only MEMBER or OWNER access can manage review queues.")


def _to_citations(
    matches: list[RagV3ChunkMatch],
    *,
    temporal_labels: Optional[dict[str, str]] = None,
) -> list[RagV3Citation]:
    out: list[RagV3Citation] = []
    labels = temporal_labels or {}
    for row in matches:
        decision_no = _decision_no_for_match(row)
        out.append(
            RagV3Citation(
                chunk_id=row.chunk_id,
                document_id=row.document_id,
                title=row.title,
                source_id=row.source_id,
                source_type=row.source_type,
                article_no=row.article_no,
                clause_no=row.clause_no,
                subclause_no=row.subclause_no,
                page_range=row.page_range,
                source_char_start=row.source_char_start,
                source_char_end=row.source_char_end,
                paragraph_start=row.paragraph_start,
                paragraph_end=row.paragraph_end,
                section_path=row.section_path,
                source_url=row.source_url,
                final_score=_clamp01(row.final_score),
                temporal_version=labels.get(row.chunk_id),
                citation_date=_citation_date_for_match(row),
                issuing_authority=_issuing_authority_for_match(row),
                decision_no=decision_no,
                reference_no=_reference_no_for_match(row, decision_no=decision_no),
            )
        )
    return out


def _rrf_fuse(
    dense: list[RagV3ChunkMatch],
    sparse: list[RagV3ChunkMatch],
    *,
    exact: Optional[list[RagV3ChunkMatch]] = None,
    exact_weight: float = 1.0,
    max_results: int,
) -> list[RagV3ChunkMatch]:
    exact_rows = list(exact or [])
    if not dense and not sparse and not exact_rows:
        return []
    rrf_k = max(1, int(settings.rag_v3_rrf_k))
    sw = max(0.0, float(settings.rag_v3_rrf_semantic_weight))
    kw = max(0.0, float(settings.rag_v3_rrf_keyword_weight))
    ew = max(0.0, float(exact_weight))
    if sw <= 0.0 and kw <= 0.0 and ew <= 0.0:
        sw, kw, ew = 1.0, 1.0, 0.0

    rrf: dict[str, float] = {}
    base: dict[str, RagV3ChunkMatch] = {}
    semantic: dict[str, float] = {}
    keyword: dict[str, float] = {}

    for rank, row in enumerate(dense, start=1):
        cid = row.chunk_id
        rrf[cid] = rrf.get(cid, 0.0) + (sw / float(rrf_k + rank))
        base[cid] = _prefer(base.get(cid), row)
        semantic[cid] = max(semantic.get(cid, 0.0), _clamp01(row.semantic_score))
        keyword[cid] = max(keyword.get(cid, 0.0), _clamp01(row.keyword_score))

    for rank, row in enumerate(sparse, start=1):
        cid = row.chunk_id
        rrf[cid] = rrf.get(cid, 0.0) + (kw / float(rrf_k + rank))
        base[cid] = _prefer(base.get(cid), row)
        semantic[cid] = max(semantic.get(cid, 0.0), _clamp01(row.semantic_score))
        keyword[cid] = max(keyword.get(cid, 0.0), _clamp01(row.keyword_score))

    for rank, row in enumerate(exact_rows, start=1):
        cid = row.chunk_id
        rrf[cid] = rrf.get(cid, 0.0) + (ew / float(rrf_k + rank))
        base[cid] = _prefer(base.get(cid), row)
        semantic[cid] = max(semantic.get(cid, 0.0), _clamp01(row.semantic_score))
        keyword[cid] = max(
            keyword.get(cid, 0.0),
            _clamp01(max(float(row.keyword_score), float(row.final_score))),
        )

    ranked = sorted(rrf.items(), key=lambda x: x[1], reverse=True)
    out: list[RagV3ChunkMatch] = []
    lane_count = 0
    if dense and sw > 0.0:
        lane_count += 1
    if sparse and kw > 0.0:
        lane_count += 1
    if exact_rows and ew > 0.0:
        lane_count += 1
    lane_count = max(1, lane_count)
    for cid, rrf_score in ranked[: max(1, max_results)]:
        row = base.get(cid)
        if row is None:
            continue
        sem = semantic.get(cid, 0.0)
        key = keyword.get(cid, 0.0)
        blended = _clamp01((0.7 * sem) + (0.3 * key))
        single = 1.0 / float(rrf_k + 1)
        rrf_norm = _clamp01(rrf_score / (float(lane_count) * single)) if single > 0 else 0.0
        out.append(
            replace(
                row,
                semantic_score=sem,
                keyword_score=key,
                final_score=max(blended, rrf_norm),
            )
        )
    return out


def _parse_structured(
    raw: str,
    default_citations: list[RagV3Citation],
    confidence: float,
    status: str,
) -> Optional[RagV3StructuredAnswer]:
    payload = _extract_json(raw)
    if not isinstance(payload, dict):
        return None
    answer = str(payload.get("answer_text") or payload.get("answer") or "").strip()
    if not answer:
        return None
    citations = _parse_structured_citations(payload.get("citations"), default_citations)
    conf = _coerce_float(payload.get("confidence"), confidence)
    escalate_raw = payload.get("should_escalate")
    if isinstance(escalate_raw, bool):
        escalate = escalate_raw
    else:
        escalate = (status == "no_answer") or (
            conf < _clamp01(float(settings.rag_v3_escalation_confidence_threshold))
        )
    warnings = _parse_str_list(payload.get("warnings"), limit=8)
    legal_disclaimer = str(payload.get("legal_disclaimer") or "").strip()
    if not citations:
        citations = [_as_structured(c) for c in default_citations[:5]]
        warnings = _append_unique(warnings, "structured_citations_missing_fallback_applied")
    return RagV3StructuredAnswer(
        answer_text=answer,
        citations=citations,
        confidence=conf,
        should_escalate=escalate,
        follow_up_questions=_parse_str_list(payload.get("follow_up_questions"), limit=5),
        warnings=warnings,
        legal_disclaimer=legal_disclaimer,
    )


def _fallback_structured(
    answer_text: str,
    status: str,
    confidence: float,
    citations: list[RagV3Citation],
    *,
    warnings: list[str],
) -> RagV3StructuredAnswer:
    answer = answer_text.strip() if status == "ok" else RAG_V3_NO_ANSWER
    if not answer:
        answer = RAG_V3_NO_ANSWER
    conf = _coerce_float(confidence, confidence)
    if status == "no_answer":
        conf = min(conf, 0.35)
    threshold = _clamp01(float(settings.rag_v3_escalation_confidence_threshold))
    follow_ups = [] if status == "ok" else ["Madde/fikra veya kaynak id belirterek soruyu daraltabilir misiniz?"]
    return RagV3StructuredAnswer(
        answer_text=answer,
        citations=[_as_structured(c) for c in citations[:5]],
        confidence=conf,
        should_escalate=(status == "no_answer") or (conf < threshold),
        follow_up_questions=follow_ups,
        warnings=list(dict.fromkeys(warnings)),
        legal_disclaimer="",
    )


def _resolve_response_citations(
    structured: list[RagV3StructuredCitation],
    available: list[RagV3Citation],
    limit: int,
) -> list[RagV3Citation]:
    if not available:
        return []
    by_chunk = {c.chunk_id: c for c in available if c.chunk_id}
    chosen: list[RagV3Citation] = []
    seen: set[str] = set()
    for item in structured:
        match: Optional[RagV3Citation] = None
        if item.chunk_id and item.chunk_id in by_chunk:
            match = by_chunk[item.chunk_id]
        else:
            for cand in available:
                if item.source_id and cand.source_id != item.source_id:
                    continue
                if item.article_no and (cand.article_no or "") != item.article_no:
                    continue
                if item.clause_no and (cand.clause_no or "") != item.clause_no:
                    continue
                match = cand
                break
        if match and match.chunk_id not in seen:
            chosen.append(match)
            seen.add(match.chunk_id)
    return (chosen or available)[:limit]


def _enforce_citation_core_fields(
    citations: list[RagV3Citation],
) -> tuple[list[RagV3Citation], list[str]]:
    violations: list[str] = []
    kept: list[RagV3Citation] = []
    for item in citations:
        missing: list[str] = []
        if not str(item.source_id or "").strip():
            missing.append("source_id")
        if not str(item.source_type or "").strip():
            missing.append("source_type")
        if not str(item.title or "").strip():
            missing.append("title")
        if not str(item.citation_date or "").strip():
            missing.append("citation_date")
        if not str(item.issuing_authority or "").strip():
            missing.append("issuing_authority")
        if not str(item.source_url or "").strip():
            missing.append("source_url")
        if item.source_char_start is None or item.source_char_end is None:
            missing.append("source_char_span")
        elif int(item.source_char_end) < int(item.source_char_start):
            missing.append("source_char_span_invalid")
        if item.paragraph_start is None or item.paragraph_end is None:
            missing.append("paragraph_span")
        elif int(item.paragraph_end) < int(item.paragraph_start):
            missing.append("paragraph_span_invalid")
        has_article = bool(str(item.article_no or "").strip())
        has_decision_no = bool(str(item.decision_no or "").strip())
        if not (has_article or has_decision_no):
            missing.append("article_or_decision_no")
        if missing:
            token = ",".join(sorted(missing))
            violations.append(f"{item.chunk_id or 'unknown'}:{token}")
            continue
        kept.append(item)
    dedup_violations = list(dict.fromkeys(violations))
    return kept, dedup_violations


def _detect_conflicting_case_law(matches: list[RagV3ChunkMatch]) -> bool:
    case_law_rows = [
        item
        for item in matches
        if "ictihat" in str(item.source_type or "").lower()
        or "case" in str(item.source_type or "").lower()
        or "mahkeme" in str(item.source_type or "").lower()
    ]
    if len(case_law_rows) < 2:
        return False
    doc_ids = {str(item.document_id or "").strip() for item in case_law_rows if str(item.document_id or "").strip()}
    if len(doc_ids) < 2:
        return False
    contradiction_tokens = ("celiski", "catisma", "aksi", "farkli", "aykiri")
    for row in case_law_rows:
        text = str(row.chunk_text or "").lower()
        if any(token in text for token in contradiction_tokens):
            return True
    return False


def _suppress_near_duplicate_matches(
    matches: list[RagV3ChunkMatch],
    *,
    enabled: bool,
    threshold: float,
) -> tuple[list[RagV3ChunkMatch], list[str]]:
    if not enabled or len(matches) < 2:
        return list(matches), []
    deduped: list[RagV3ChunkMatch] = []
    fingerprints: list[set[str]] = []
    dropped = 0
    effective_threshold = max(0.5, min(0.98, float(threshold)))
    for row in matches:
        token_set = _near_dup_tokens(row.chunk_text or "")
        if not token_set:
            deduped.append(row)
            fingerprints.append(set())
            continue
        is_dup = False
        for existing in fingerprints:
            if not existing:
                continue
            union = len(token_set | existing)
            if union <= 0:
                continue
            score = len(token_set & existing) / float(union)
            if score >= effective_threshold:
                is_dup = True
                break
        if is_dup:
            dropped += 1
            continue
        deduped.append(row)
        fingerprints.append(token_set)
    if dropped <= 0:
        return deduped, []
    return deduped, [f"near_duplicate_suppressed:{dropped}"]


def _near_dup_tokens(text: str) -> set[str]:
    tokens = [token for token in _legal_tokens(text) if len(token) > 2]
    if not tokens:
        return set()
    return set(tokens)


def _review_reason_codes(
    *,
    claim_report: RagV3ClaimVerificationReport,
    policy_summary: RagV3PolicySummary,
    structured_warnings: list[str],
    admission: RagV3AdmissionSummary,
    confidence: float,
) -> list[str]:
    reasons: list[str] = []
    if not claim_report.passed:
        reasons.append("claim_verification_failed")
    if policy_summary.should_escalate:
        reasons.append("policy_escalation")
    if confidence < 0.35:
        reasons.append("low_confidence")
    if admission.degraded:
        reasons.append(f"admission_degraded:{admission.reason}")
    for warning in structured_warnings:
        token = str(warning or "").strip()
        if not token:
            continue
        if token.startswith("claim_") or token.startswith("policy_") or token.startswith("tier_policy:"):
            reasons.append(token)
    if not reasons:
        return []
    return list(dict.fromkeys(reasons))[:12]


def _attach_citation_evidence(
    *,
    answer_text: str,
    citations: list[RagV3Citation],
    evidence_chunks: list[RagV3ChunkMatch],
    min_overlap: float,
) -> list[RagV3Citation]:
    if not citations:
        return citations
    by_chunk = {row.chunk_id: row for row in evidence_chunks if row.chunk_id}
    answer_claims = _candidate_claims_for_evidence(answer_text)
    min_threshold = _clamp01(min_overlap)
    enriched: list[RagV3Citation] = []
    for citation in citations:
        row = by_chunk.get(citation.chunk_id)
        if row is None or not row.chunk_text:
            enriched.append(citation)
            continue
        evidence = _best_evidence_span(
            claims=answer_claims,
            chunk_text=row.chunk_text,
            min_overlap=min_threshold,
        )
        if evidence is None:
            enriched.append(citation)
            continue
        text, start, end, overlap = evidence
        enriched.append(
            replace(
                citation,
                evidence_text=text,
                evidence_start=start,
                evidence_end=end,
                evidence_overlap=_clamp01(overlap),
            )
        )
    return enriched


def _candidate_claims_for_evidence(answer_text: str) -> list[str]:
    claims = [item.strip() for item in _SENTENCE_SPLIT_RE.split(answer_text or "") if item.strip()]
    if claims:
        return claims[:24]
    compact = " ".join((answer_text or "").split())
    return [compact] if compact else []


def _build_claim_graph(
    *,
    answer_text: str,
    evidence_chunks: list[RagV3ChunkMatch],
    cited_chunk_ids: list[str],
    min_overlap: float,
) -> RagV3ClaimGraph:
    claims = _candidate_claims_for_evidence(answer_text)
    if not claims:
        return RagV3ClaimGraph(nodes=[], total_claims=0, supported_claims=0)

    cited = {str(item).strip() for item in cited_chunk_ids if str(item).strip()}
    scoped = [row for row in evidence_chunks if row.chunk_id and row.chunk_id in cited] if cited else list(evidence_chunks)
    pool = scoped or list(evidence_chunks)
    threshold = _clamp01(min_overlap)

    nodes: list[RagV3ClaimGraphNode] = []
    for claim in claims[:24]:
        claim_tokens = _legal_tokens(claim)
        best_score = 0.0
        supporting: list[str] = []
        for row in pool[:48]:
            row_text = " ".join((row.chunk_text or "").split())
            if not row_text:
                continue
            row_tokens = _legal_tokens(row_text)
            if not row_tokens:
                continue
            if claim_tokens:
                score = len(claim_tokens & row_tokens) / float(max(1, len(claim_tokens)))
            else:
                score = 0.0
            if score > best_score:
                best_score = score
            if score >= threshold and row.chunk_id:
                supporting.append(row.chunk_id)
        unique_support = list(dict.fromkeys(supporting))[:4]
        nodes.append(
            RagV3ClaimGraphNode(
                proposition=claim[:320],
                supported=bool(unique_support),
                support_score=_clamp01(best_score),
                supporting_chunk_ids=unique_support,
            )
        )

    total_claims = len(nodes)
    supported_claims = sum(1 for node in nodes if node.supported)
    return RagV3ClaimGraph(
        nodes=nodes,
        total_claims=total_claims,
        supported_claims=supported_claims,
    )


def _claim_graph_trace_metadata(claim_graph: RagV3ClaimGraph) -> dict[str, object]:
    unsupported = [node.proposition for node in claim_graph.nodes if not node.supported][:5]
    return {
        "claim_graph_total": int(claim_graph.total_claims),
        "claim_graph_supported": int(claim_graph.supported_claims),
        "claim_graph_unsupported": int(max(0, claim_graph.total_claims - claim_graph.supported_claims)),
        "claim_graph_unsupported_samples": unsupported,
    }


def _constrain_answer_to_verified_claims(
    *,
    answer_text: str,
    claim_graph: RagV3ClaimGraph,
) -> tuple[str, list[str], bool]:
    if claim_graph.total_claims <= 0:
        return answer_text, [], False
    if claim_graph.supported_claims >= claim_graph.total_claims:
        return answer_text, [], False

    supported_claims = [node.proposition.strip() for node in claim_graph.nodes if node.supported and node.proposition]
    if not supported_claims:
        return RAG_V3_NO_ANSWER, ["constrained_synthesis_all_claims_unsupported"], True

    constrained = " ".join(" ".join(supported_claims).split())
    if not constrained:
        return RAG_V3_NO_ANSWER, ["constrained_synthesis_empty_after_prune"], True

    original = " ".join((answer_text or "").split())
    if constrained == original:
        return answer_text, [], False
    return constrained, ["constrained_synthesis_pruned_unverified_claims"], True


def _sanitize_answer_output(answer_text: str) -> str:
    text = str(answer_text or "")
    if not text:
        return ""
    text = _THINK_TAG_RE.sub(" ", text)
    text = _REASONING_BLOCK_RE.sub(" ", text)
    lines: list[str] = []
    for line in text.splitlines():
        lowered = line.strip().lower()
        if lowered.startswith("chain of thought"):
            continue
        if lowered.startswith("internal reasoning"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _enforce_sentence_grounding(
    *,
    answer_text: str,
    citations: list[RagV3Citation],
    min_overlap: float,
) -> tuple[bool, float, list[str]]:
    claims = [item.strip() for item in _SENTENCE_SPLIT_RE.split(answer_text or "") if item.strip()]
    if not claims:
        return False, 0.0, []
    threshold = _clamp01(float(min_overlap))
    citation_evidence = [str(item.evidence_text or "").strip() for item in citations if str(item.evidence_text or "").strip()]
    citation_tokens = [_legal_tokens(item) for item in citation_evidence]
    supported = 0
    unsupported: list[str] = []
    for claim in claims:
        claim_tokens = _legal_tokens(claim)
        if not claim_tokens:
            unsupported.append(claim[:180])
            continue
        claim_supported = False
        for evidence_tokens in citation_tokens:
            if not evidence_tokens:
                continue
            overlap = len(claim_tokens & evidence_tokens) / float(max(1, len(claim_tokens)))
            if overlap >= threshold:
                claim_supported = True
                break
        if claim_supported:
            supported += 1
        else:
            unsupported.append(claim[:180])
    ratio = _clamp01(supported / float(max(1, len(claims))))
    min_ratio = _clamp01(float(getattr(settings, "rag_v3_sentence_grounding_min_ratio", 0.85)))
    return ratio >= min_ratio, ratio, unsupported


def _best_evidence_span(
    *,
    claims: list[str],
    chunk_text: str,
    min_overlap: float,
) -> Optional[tuple[str, int, int, float]]:
    text = " ".join((chunk_text or "").split())
    if not text:
        return None
    candidate_sentences = [item.strip() for item in _SENTENCE_SPLIT_RE.split(text) if item.strip()]
    if not candidate_sentences:
        candidate_sentences = [text]
    claim_tokens = [_legal_tokens(item) for item in claims if item.strip()]
    if not claim_tokens:
        claim_tokens = [_legal_tokens(" ".join(claims))]
    if not claim_tokens:
        claim_tokens = [_legal_tokens(text)]

    best_sentence = ""
    best_overlap = 0.0
    for sentence in candidate_sentences[:40]:
        sentence_tokens = _legal_tokens(sentence)
        if not sentence_tokens:
            continue
        overlap = 0.0
        for claim in claim_tokens:
            if not claim:
                continue
            score = len(claim & sentence_tokens) / float(max(1, len(claim)))
            overlap = max(overlap, score)
        if overlap > best_overlap:
            best_overlap = overlap
            best_sentence = sentence

    if not best_sentence or best_overlap < min_overlap:
        return None
    start = text.find(best_sentence)
    if start < 0:
        start = 0
    end = start + len(best_sentence)
    return best_sentence[:700], start, end, best_overlap


def _parse_structured_citations(
    raw: object,
    available: list[RagV3Citation],
) -> list[RagV3StructuredCitation]:
    if not isinstance(raw, list):
        return []
    by_chunk = {c.chunk_id: c for c in available}
    out: list[RagV3StructuredCitation] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        chunk_id = _str_or_none(row.get("chunk_id"))
        source_id = _str_or_none(row.get("source_id"))
        article_no = _str_or_none(row.get("article_no"))
        clause_no = _str_or_none(row.get("clause_no"))
        if chunk_id and chunk_id in by_chunk:
            out.append(_as_structured(by_chunk[chunk_id]))
            continue
        if not source_id:
            continue
        out.append(
            RagV3StructuredCitation(
                source_id=source_id,
                article_no=article_no,
                clause_no=clause_no,
                chunk_id=chunk_id,
            )
        )
    return out


def _extract_json(text: str) -> Optional[dict[str, Any]]:
    body = (text or "").strip()
    if not body:
        return None
    candidates: list[str] = []
    m = _JSON_RE.search(body)
    if m:
        candidates.append(m.group(1).strip())
    start, end = body.find("{"), body.rfind("}")
    if start >= 0 and end > start:
        candidates.append(body[start : end + 1])
    for candidate in candidates:
        parsed = _json_try_load(candidate)
        if isinstance(parsed, dict):
            return parsed
    return None


def _json_try_load(text: str) -> Optional[dict[str, Any]]:
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        try:
            parsed = json.loads(text.replace("'", '"'))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def _parse_str_list(value: object, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item).strip()
        if not text:
            continue
        out.append(text)
        if len(out) >= max(0, limit):
            break
    return out


def _append_unique(items: list[str], item: str) -> list[str]:
    if item and item not in items:
        return [*items, item]
    return items


def _source_documents_from_citation_payload(citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in citations:
        if not isinstance(item, dict):
            continue
        document_id = str(item.get("document_id") or "").strip()
        source_id = str(item.get("source_id") or "").strip()
        key = document_id or source_id
        if not key or key in out:
            continue
        out[key] = {
            "document_id": document_id or None,
            "source_id": source_id or None,
            "source_type": str(item.get("source_type") or "").strip() or None,
            "article_no": str(item.get("article_no") or "").strip() or None,
            "clause_no": str(item.get("clause_no") or "").strip() or None,
            "subclause_no": str(item.get("subclause_no") or "").strip() or None,
            "temporal_version": str(item.get("temporal_version") or "").strip() or None,
            "citation_date": str(item.get("citation_date") or "").strip() or None,
            "issuing_authority": str(item.get("issuing_authority") or "").strip() or None,
            "decision_no": str(item.get("decision_no") or "").strip() or None,
            "reference_no": str(item.get("reference_no") or "").strip() or None,
        }
    return list(out.values())


def _citation_date_for_match(row: RagV3ChunkMatch) -> Optional[str]:
    if row.effective_from is not None:
        return row.effective_from.isoformat()
    if row.effective_to is not None:
        return row.effective_to.isoformat()
    source = str(row.source_id or "")
    year_match = re.search(r"\b(19\d{2}|20\d{2})\b", source)
    if year_match:
        return f"{year_match.group(1)}-01-01"
    return "unknown"


def _issuing_authority_for_match(row: RagV3ChunkMatch) -> Optional[str]:
    source_type = str(row.source_type or "").strip().lower()
    title = str(row.title or "").strip().lower()
    source_id = str(row.source_id or "").strip().lower()
    blob = f"{source_type} {title} {source_id}"
    if any(token in blob for token in ("yargitay", "mahkeme", "danistay", "aym", "case_law", "ictihat")):
        if "aym" in blob or "anayasa mahkemesi" in blob:
            return "AYM"
        if "danistay" in blob:
            return "DANISTAY"
        if "yargitay" in blob:
            return "YARGITAY"
        return "MAHKEME"
    if any(token in blob for token in ("kanun", "mevzuat", "yonetmelik", "teblig", "resmi gazete", "legislation")):
        return "RESMI_KAYNAK"
    if "sozlesme" in blob:
        return "KURUM_ICI_SOZLESME"
    return "unknown"


def _decision_no_for_match(row: RagV3ChunkMatch) -> Optional[str]:
    for candidate in (row.source_id, row.title, row.chunk_text):
        token = str(candidate or "").strip()
        if not token:
            continue
        match = _DECISION_NO_RE.search(token)
        if match:
            return re.sub(r"\s+", " ", match.group(0)).strip()
    return None


def _reference_no_for_match(row: RagV3ChunkMatch, *, decision_no: Optional[str]) -> Optional[str]:
    article_no = str(row.article_no or "").strip()
    clause_no = str(row.clause_no or "").strip()
    if article_no and clause_no:
        return f"madde:{article_no}/fikra:{clause_no}"
    if article_no:
        return f"madde:{article_no}"
    if decision_no:
        return f"karar:{decision_no}"
    source_id = str(row.source_id or "").strip()
    return source_id or None


def _prefer(existing: Optional[RagV3ChunkMatch], row: RagV3ChunkMatch) -> RagV3ChunkMatch:
    if existing is None:
        return row
    return row if row.final_score >= existing.final_score else existing


def _coerce_float(value: object, fallback: float) -> float:
    try:
        return _clamp01(float(value))
    except Exception:
        return _clamp01(float(fallback))


def _as_structured(citation: RagV3Citation) -> RagV3StructuredCitation:
    return RagV3StructuredCitation(
        source_id=citation.source_id,
        article_no=citation.article_no,
        clause_no=citation.clause_no,
        chunk_id=citation.chunk_id,
    )


def _str_or_none(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _derive_fallback_source_url(*, source_type: str, source_id: str) -> str:
    source_type_token = _sanitize_token(source_type, default="document")
    source_id_token = str(source_id or "").strip()
    if source_id_token.startswith(("http://", "https://", "legacy://", "urn:")):
        return source_id_token
    if source_id_token:
        return f"legacy://{source_type_token}/{quote(source_id_token, safe='')}"
    return f"legacy://{source_type_token}/unknown"


def _retrieval_confidence(matches: list[RagV3ChunkMatch]) -> float:
    if not matches:
        return 0.0
    top = _clamp01(matches[0].final_score)
    second = _clamp01(matches[1].final_score) if len(matches) > 1 else 0.0
    gap = max(0.0, top - second)
    depth = min(1.0, len(matches) / float(max(1, int(settings.rag_v3_reranker_top_n))))
    return _clamp01((0.70 * top) + (0.20 * gap) + (0.10 * depth))


def _passes_answerability_gate(query: str, matches: list[RagV3ChunkMatch]) -> bool:
    tokens = _legal_tokens(query)
    if not tokens:
        return True
    evidence: set[str] = set()
    for row in matches[:3]:
        evidence.update(_legal_tokens(row.chunk_text))
    overlap = len(tokens & evidence) / float(max(1, len(tokens)))
    return overlap >= _clamp01(float(settings.rag_v3_answerability_min_overlap))


def _legal_tokens(text: str) -> set[str]:
    return {tok for tok in _TOKEN_RE.findall((text or "").lower()) if len(tok) >= 3}


def _soft_token_overlap_ratio(query_tokens: set[str], candidate_tokens: set[str]) -> float:
    if not query_tokens or not candidate_tokens:
        return 0.0
    candidate_variants: set[str] = set()
    for token in candidate_tokens:
        candidate_variants.update(_token_variants(token))
    if not candidate_variants:
        return 0.0
    matched = 0
    for token in query_tokens:
        if _token_variants(token) & candidate_variants:
            matched += 1
    return matched / float(max(1, len(query_tokens)))


def _token_variants(token: str) -> set[str]:
    raw = str(token or "").strip().lower()
    if not raw:
        return set()
    stem = _strip_turkish_suffix(raw)
    out = {raw, stem}
    if len(raw) >= 4:
        out.add(raw[:4])
    if len(stem) >= 4:
        out.add(stem[:4])
    return {item for item in out if len(item) >= 3}


def _strip_turkish_suffix(token: str) -> str:
    raw = str(token or "").strip().lower()
    for suffix in _TURKISH_TOKEN_SUFFIXES:
        if raw.endswith(suffix) and len(raw) - len(suffix) >= 4:
            return raw[: -len(suffix)]
    return raw


def _focus_query_tokens(query: str) -> set[str]:
    tokens = _legal_tokens(query)
    filtered = {tok for tok in tokens if not _is_noisy_query_token(tok)}
    return filtered or tokens


def _rewrite_query_for_iterative_retrieval(
    query: str,
    current_matches: list[RagV3ChunkMatch],
) -> str:
    focus_tokens = sorted(_focus_query_tokens(query), key=len, reverse=True)
    focus_slice = focus_tokens[:8]
    source_hints: list[str] = []
    article_hints: list[str] = []
    for row in current_matches[:4]:
        sid = str(row.source_id or "").strip()
        if sid:
            source_hints.append(sid)
        article = str(row.article_no or "").strip()
        if article:
            article_hints.append(article)
    source_hints = _unique_in_order(source_hints)[:3]
    article_hints = _unique_in_order(article_hints)[:3]
    parts: list[str] = []
    if focus_slice:
        parts.append(" ".join(focus_slice))
    if source_hints:
        parts.append("source_id:" + ",".join(source_hints))
    if article_hints:
        parts.append("madde:" + ",".join(article_hints))
    rewritten = " ".join(parts).strip()
    if not rewritten:
        return ""
    normalized_original = " ".join((query or "").strip().lower().split())
    normalized_rewritten = " ".join(rewritten.lower().split())
    if not normalized_rewritten or normalized_rewritten == normalized_original:
        return ""
    return rewritten[:600]


def _is_dual_temporal_requested(
    *,
    event_date: Optional[date],
    decision_date: Optional[date],
) -> bool:
    if event_date is None or decision_date is None:
        return False
    return event_date != decision_date


def _build_temporal_label_map(
    *,
    event_matches: list[RagV3ChunkMatch],
    decision_matches: list[RagV3ChunkMatch],
) -> dict[str, str]:
    labels: dict[str, str] = {}
    for row in event_matches:
        labels[row.chunk_id] = "EVENT_DATE"
    for row in decision_matches:
        existing = labels.get(row.chunk_id)
        if existing == "EVENT_DATE":
            labels[row.chunk_id] = "BOTH"
        else:
            labels[row.chunk_id] = "DECISION_DATE"
    return labels


def _labels_for_selected(
    selected: list[RagV3ChunkMatch],
    labels: dict[str, str],
) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in selected:
        label = labels.get(row.chunk_id)
        if label:
            out[row.chunk_id] = label
    return out


def _is_noisy_query_token(token: str) -> bool:
    raw = (token or "").strip().lower()
    if len(raw) < 10:
        return False
    digit_count = sum(ch.isdigit() for ch in raw)
    if digit_count >= 4 and len(raw) >= 14:
        return True
    if digit_count >= 2 and ("_" in raw or "-" in raw):
        return True
    return False


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _chunk_hash(*, chunk: LegalChunkDraft, source_id: str, ordinal: int) -> str:
    normalized_text = " ".join((chunk.text or "").split())
    payload = "|".join(
        [
            "source=" + " ".join((source_id or "").strip().split()),
            f"ordinal={max(1, int(ordinal))}",
            "article=" + (chunk.article_no or ""),
            "clause=" + (chunk.clause_no or ""),
            "subclause=" + (chunk.subclause_no or ""),
            "heading=" + (chunk.heading_path or ""),
            "page=" + (chunk.page_range or ""),
            "text=" + normalized_text,
        ]
    )
    return _sha256(payload)


def _token_count_for_text(text: str) -> int:
    return max(0, len(_TOKEN_RE.findall(text or "")))


def _embedding_version_token() -> str:
    model = str(getattr(settings, "embedding_model", "unknown") or "").strip() or "unknown"
    dims = max(0, int(getattr(settings, "embedding_dimensions", 0) or 0))
    return f"{model}|dim={dims}"


def _index_version_token() -> str:
    return (
        "rag_v3_baseline_dense:"
        "top_k=8-12"
        f"|embed={settings.embedding_model}"
        f"|dim={settings.embedding_dimensions}"
    )


def _infer_chunk_type(
    *,
    source_type: str,
    chunk: LegalChunkDraft,
    token_count: int,
) -> str:
    text_lower = (chunk.text or "").lower()
    if not text_lower:
        return "generic"

    source_token = str(source_type or "").strip().lower()
    is_decision_like = any(
        token in source_token
        for token in ("case", "ictihat", "içtihat", "judgment", "decision", "karar")
    )
    if is_decision_like:
        if "gerekçe" in text_lower or "gerekce" in text_lower:
            return "reasoning"
        if "hüküm" in text_lower or "hukum" in text_lower or "sonuç" in text_lower or "sonuc" in text_lower:
            return "judgment_outcome"
        if "özet" in text_lower or "ozet" in text_lower:
            return "decision_summary"
        return "decision_summary" if token_count <= 80 else "reasoning"

    if "tanım" in text_lower or "tanim" in text_lower:
        return "definition"
    if any(marker in text_lower for marker in ("istisna", "şart", "sart", "koşul", "kosul")):
        return "exception_condition"
    if chunk.article_no or chunk.clause_no or chunk.subclause_no:
        return "normative_provision"
    return "generic"


def _unique_in_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _normalize_source_type_token(value: str) -> str:
    token = str(value or "").strip().lower()
    if not token:
        return ""
    folded = (
        token.replace("ı", "i")
        .replace("İ", "i")
        .replace("ç", "c")
        .replace("ş", "s")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ö", "o")
    )
    normalized = re.sub(r"[^a-z0-9]+", "_", folded).strip("_")
    if not normalized:
        return ""
    return _SOURCE_TYPE_ALIASES.get(normalized, normalized)


def _normalize_source_types(source_types: list[str]) -> list[str]:
    return _unique_in_order(
        [
            token
            for token in (
                _normalize_source_type_token(item)
                for item in list(source_types or [])[:16]
            )
            if token
        ]
    )


def _filter_matches_by_source_types(
    matches: list[RagV3ChunkMatch],
    source_types: list[str],
) -> tuple[list[RagV3ChunkMatch], dict[str, Any], list[str]]:
    normalized_filters = _normalize_source_types(source_types)
    if not normalized_filters:
        return list(matches), {}, []
    allowed = set(normalized_filters)
    filtered: list[RagV3ChunkMatch] = []
    dropped = 0
    for row in matches:
        row_type = _normalize_source_type_token(str(row.source_type or ""))
        if row_type in allowed:
            filtered.append(row)
        else:
            dropped += 1

    metadata: dict[str, Any] = {
        "source_type_filter_applied": True,
        "source_type_filter_requested": list(normalized_filters),
        "source_type_filter_input_count": len(matches),
        "source_type_filter_output_count": len(filtered),
        "source_type_filter_dropped": dropped,
    }
    notes: list[str] = []
    if dropped > 0:
        notes.append(f"source_type_filter_dropped:{dropped}")
    if not filtered:
        notes.append("source_type_filter_empty")
    return filtered, metadata, notes


def _merge_match_pools(
    *,
    primary: list[RagV3ChunkMatch],
    secondary: list[RagV3ChunkMatch],
    limit: int,
) -> list[RagV3ChunkMatch]:
    merged: dict[str, RagV3ChunkMatch] = {}
    for row in [*primary, *secondary]:
        existing = merged.get(row.chunk_id)
        if existing is None or row.final_score > existing.final_score:
            merged[row.chunk_id] = row
    ranked = sorted(merged.values(), key=lambda item: _clamp01(item.final_score), reverse=True)
    return ranked[: max(1, int(limit))]


def _match_label(match: RagV3ChunkMatch) -> str:
    parts = [f"{match.title} ({match.source_id})"]
    if match.article_no:
        parts.append(f"Madde {match.article_no}")
    if match.clause_no:
        parts.append(f"Fikra {match.clause_no}")
    if match.subclause_no:
        parts.append(f"Bent {match.subclause_no}")
    return " | ".join(parts)


def _build_baseline_query(
    user_query: str,
    *,
    dual_temporal: bool = False,
    event_date: Optional[date] = None,
    decision_date: Optional[date] = None,
) -> str:
    dual_rule = ""
    if dual_temporal and event_date and decision_date:
        dual_rule = (
            "7) BAGLAM icinde versiyon=EVENT_DATE ve versiyon=DECISION_DATE etiketlerini "
            "karsilastir; fark varsa acikca belirt, fark yoksa bunu da yaz.\n"
            f"8) Karsilastirma tarihleri: event_date={event_date.isoformat()}, "
            f"decision_date={decision_date.isoformat()}.\n"
        )
    return (
        "Sadece BAGLAM alanini kullanarak cevap ver.\n"
        "Kurallar:\n"
        "1) BAGLAM disinda bilgi uretme.\n"
        "2) Cevap sonunda en az bir atif satiri ver.\n"
        "3) Atif formati: source_id=<id>; madde=<article_no>; fikra=<clause_no>\n"
        "4) BAGLAM yetersizse sadece 'Bulamadim.' yaz.\n"
        "5) Kesin hukuk sonucu vaat etme, hukuki gorus yerine gecmedigini belirt.\n"
        "6) En fazla 200 token kullan.\n"
        f"{dual_rule}"
        f"SORU: {user_query}"
    )


def _normalize_top_k(value: int) -> int:
    raw = int(value) if value else 10
    return max(8, min(raw, 12))


def _model_lane_for_tier(tier: int) -> tuple[str, str]:
    lane = int(tier) if int(tier) in (1, 2, 3, 4) else 2
    if lane in (1, 2):
        return "instruct", "synthesis"
    return "thinking", "analysis"


def _expected_model_for_tier(tier: int) -> str:
    lane = int(tier) if int(tier) in (1, 2, 3, 4) else 2
    if lane == 1:
        return str(getattr(settings, "ai_tier_hazir_model", "") or "").strip()
    if lane == 2:
        return str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip()
    if lane == 3:
        return str(getattr(settings, "ai_tier_uzman_model", "") or "").strip()
    return str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip()


def _normalized_model_token(value: str) -> str:
    token = str(value or "").strip().lower()
    if not token:
        return ""
    return token.replace("+multi-agent", "")


def _model_family_from_token(value: str) -> str:
    token = _normalized_model_token(value)
    if "qwen3-next-80b-a3b" in token:
        return "qwen3-next-80b-a3b"
    if "gpt" in token or token.startswith("openai/"):
        return "openai"
    if "claude" in token or token.startswith("anthropic/"):
        return "anthropic"
    if "gemini" in token or token.startswith("google/"):
        return "google"
    if token.startswith("fallback/"):
        return "fallback"
    if token == "none/none":
        return "none"
    return "unknown"


def _is_prod_like_runtime() -> bool:
    return bool(settings.is_production or bool(getattr(settings, "tenant_enforce_in_dev", False)))


def _build_model_lane_audit(
    *,
    requested_tier: int,
    effective_tier: int,
    runtime_model_version: str,
    gate_decision: str,
    response_status: str,
) -> dict[str, Any]:
    model_lane, model_role = _model_lane_for_tier(effective_tier)
    expected_model = _expected_model_for_tier(effective_tier)
    runtime_model = str(runtime_model_version or "").strip()
    normalized_runtime = _normalized_model_token(runtime_model)
    normalized_expected = _normalized_model_token(expected_model)
    expected_family_token = str(getattr(settings, "rag_v3_trace_model_expected_family", "qwen3-next-80b-a3b") or "").strip().lower()

    execution_state = "llm_primary"
    if not normalized_runtime or normalized_runtime == "none/none":
        execution_state = "not_invoked"
    elif normalized_runtime.startswith("fallback/extractive"):
        execution_state = "extractive_fallback"
    elif "+fallback" in normalized_runtime:
        execution_state = "llm_fallback"

    reason_codes: list[str] = []
    runtime_invoked = execution_state in {"llm_primary", "llm_fallback"}
    if not normalized_expected:
        reason_codes.append("expected_model_missing")
    if runtime_invoked and not normalized_runtime:
        reason_codes.append("runtime_model_missing")

    lane_token_ok = (model_lane in normalized_runtime) if runtime_invoked else (model_lane in normalized_expected)
    if not lane_token_ok:
        reason_codes.append("lane_token_missing")

    family_token_ok = True
    if expected_family_token:
        check_token = normalized_runtime if runtime_invoked else normalized_expected
        family_token_ok = expected_family_token in check_token
        if not family_token_ok:
            reason_codes.append("model_family_mismatch")

    mapping_verified = lane_token_ok and family_token_ok and bool(normalized_expected)
    if runtime_invoked and normalized_expected and normalized_runtime != normalized_expected:
        reason_codes.append("runtime_model_differs_from_expected")
    if execution_state in {"not_invoked", "extractive_fallback"}:
        reason_codes.append("runtime_model_not_invoked")

    return {
        "requested_tier": int(requested_tier),
        "effective_tier": int(effective_tier),
        "model_lane": model_lane,
        "model_role": model_role,
        "model_expected_version": expected_model or None,
        "model_expected_family": _model_family_from_token(expected_model),
        "model_runtime_version": runtime_model or None,
        "model_runtime_family": _model_family_from_token(runtime_model),
        "model_execution_state": execution_state,
        "mapping_verified": bool(mapping_verified),
        "mapping_evidence_complete": True,
        "reason_codes": list(dict.fromkeys(reason_codes)),
        "gate_decision": gate_decision,
        "response_status": response_status,
    }


def _sanitize_token(value: str, *, default: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return default
    token = _SAFE_TOKEN_RE.sub("-", raw).strip("-")
    return token[:120] or default


def _extractive_fallback(matches: list[RagV3ChunkMatch], *, query: str = "") -> str:
    if not matches:
        return RAG_V3_NO_ANSWER
    best = _best_extractive_match(matches, query=query)
    snippet = _best_extractive_snippet(best.chunk_text, query=query)
    if len(snippet) > 700:
        snippet = snippet[:697] + "..."
    snippet = snippet.strip()
    if not snippet:
        return RAG_V3_NO_ANSWER
    return snippet


def _best_extractive_match(matches: list[RagV3ChunkMatch], *, query: str) -> RagV3ChunkMatch:
    if not matches:
        raise ValueError("matches cannot be empty")
    query_tokens = _focus_query_tokens(query)
    if not query_tokens:
        return matches[0]
    needs_numeric = any(token in query_tokens for token in ("oran", "yuzde", "faiz", "kac", "kaç", "nedir"))

    best = matches[0]
    best_score = -1.0
    for row in matches[:8]:
        row_tokens = _legal_tokens(row.chunk_text)
        overlap = _soft_token_overlap_ratio(query_tokens, row_tokens)
        number_bonus = 0.20 if needs_numeric and re.search(r"\d", row.chunk_text) else 0.0
        score = (0.65 * overlap) + (0.25 * _clamp01(row.final_score)) + number_bonus
        if score > best_score:
            best = row
            best_score = score
    return best


def _best_extractive_snippet(text: str, *, query: str) -> str:
    compact = " ".join((text or "").split())
    if not compact:
        return ""
    query_tokens = _focus_query_tokens(query)
    if not query_tokens:
        return compact

    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(compact) if str(s).strip()]
    if not sentences:
        return compact

    needs_numeric = any(token in query_tokens for token in ("oran", "yuzde", "faiz", "kac", "kaç", "nedir"))
    anchor_tokens = {tok for tok in query_tokens if tok in {"oran", "orani", "oranı", "yuzde", "faiz", "kac", "kaç"}}
    best_sentence = sentences[0]
    best_idx = 0
    best_score = -1.0
    for idx, sentence in enumerate(sentences[:30]):
        tokens = _legal_tokens(sentence)
        overlap = _soft_token_overlap_ratio(query_tokens, tokens)
        number_bonus = 0.15 if needs_numeric and re.search(r"\d", sentence) else 0.0
        anchor_coverage = 0.0
        if anchor_tokens:
            anchor_coverage = _soft_token_overlap_ratio(anchor_tokens, tokens)
        score = overlap + number_bonus + (0.25 * anchor_coverage)
        if score > best_score:
            best_sentence = sentence
            best_idx = idx
            best_score = score

    snippet = best_sentence or compact
    if needs_numeric and not re.search(r"\d", snippet):
        for neighbor_idx in (best_idx + 1, best_idx - 1):
            if not (0 <= neighbor_idx < len(sentences)):
                continue
            candidate = sentences[neighbor_idx].strip()
            if not candidate or not re.search(r"\d", candidate):
                continue
            candidate_tokens = _legal_tokens(candidate)
            if anchor_tokens and not (anchor_tokens & candidate_tokens):
                continue
            snippet = f"{snippet} {candidate}".strip()
            break

    return snippet


def _looks_like_no_answer(answer: str) -> bool:
    lowered = (answer or "").strip().lower()
    if not lowered:
        return True
    return any(
        token in lowered
        for token in (
            "bulamadim",
            "yeterli kanit",
            "yeterli baglam",
            "bulunamadi",
            "yeterli bilgi",
            "cannot find",
            "insufficient evidence",
        )
    )


def _should_force_numeric_fact_extractive(
    *,
    query: str,
    answer: str,
    matches: list[RagV3ChunkMatch],
) -> bool:
    if not matches:
        return False
    query_tokens = _focus_query_tokens(query)
    numeric_query = any(
        token in query_tokens
        for token in ("oran", "orani", "oranı", "yuzde", "faiz", "kac", "kaç")
    )
    if not numeric_query:
        return False

    best = _best_extractive_match(matches, query=query)
    target_numbers = _numeric_values(_best_extractive_snippet(best.chunk_text, query=query))
    if len(target_numbers) > 1:
        meaningful = {item for item in target_numbers if _numeric_magnitude(item) > 1.0}
        if meaningful:
            target_numbers = meaningful
    if not target_numbers:
        for item in matches[:3]:
            target_numbers.update(_numeric_values(item.chunk_text or ""))
    if not target_numbers:
        return False

    answer_numbers = _numeric_values(answer or "")
    return len(answer_numbers & target_numbers) == 0


def _should_force_low_conf_extractive(query: str, matches: list[RagV3ChunkMatch]) -> bool:
    if not matches:
        return False
    query_tokens = _focus_query_tokens(query)
    numeric_query = any(token in query_tokens for token in ("oran", "orani", "oranı", "yuzde", "faiz", "kac", "kaç"))
    if not numeric_query:
        return False
    return any(bool(re.search(r"\d", item.chunk_text or "")) for item in matches[:3])


def _numeric_values(text: str) -> set[str]:
    out: set[str] = set()
    for token in re.findall(r"\d+(?:[.,]\d+)?", text or ""):
        normalized = _normalize_numeric_token(token)
        if normalized:
            out.add(normalized)
    return out


def _normalize_numeric_token(value: str) -> str:
    raw = str(value or "").strip().replace(",", ".")
    if not raw:
        return ""
    try:
        numeric = float(raw)
    except Exception:
        return raw
    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.6f}".rstrip("0").rstrip(".")


def _numeric_magnitude(value: str) -> float:
    try:
        return abs(float(str(value or "").strip()))
    except Exception:
        return 0.0


def _hash_embedding(text: str, dims: int) -> list[float]:
    size = max(8, int(dims))
    vector = [0.0] * size
    tokens = _TOKEN_RE.findall((text or "").lower())
    if not tokens:
        vector[0] = 1.0
        return vector
    for token in tokens[:5000]:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[0:4], "big") % size
        sign = 1.0 if (digest[4] % 2 == 0) else -1.0
        weight = 1.0 + (digest[5] / 255.0) * 0.25
        vector[idx] += sign * weight
    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 1e-12:
        vector[0] = 1.0
        return vector
    return [v / norm for v in vector]


def _history_cache_token(history: list[dict[str, str]]) -> str:
    if not history:
        return "-"
    parts: list[str] = []
    for item in history[:20]:
        role = str(item.get("role", "")).strip().lower()
        content = " ".join(str(item.get("content", "")).strip().lower().split())
        if not content:
            continue
        parts.append(f"{role}:{content[:300]}")
    if not parts:
        return "-"
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:24]


def _policy_context_cache_token(policy_context: dict[str, Any]) -> str:
    if not isinstance(policy_context, dict) or not policy_context:
        return "-"
    try:
        raw = json.dumps(policy_context, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    except Exception:
        raw = str(policy_context)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest[:24]


def _parse_provider_csv(raw_value: str) -> list[str]:
    token = str(raw_value or "").strip()
    if not token:
        return []
    values = re.split(r"[,\s;+|]+", token)
    providers: list[str] = []
    aliases = {
        "gemini": "google",
        "google": "google",
        "qwen": "openai",
        "qwen_core": "openai",
        "qwen_deep": "openai",
        "self_host": "openai",
        "gpt": "openai",
        "chatgpt": "openai",
        "openai": "openai",
        "anthropic": "anthropic",
        "claude": "anthropic",
        "groq": "groq",
    }
    for item in values:
        normalized = aliases.get(str(item or "").strip().lower())
        if normalized and normalized not in providers:
            providers.append(normalized)
    return providers


def _parse_csv_tokens(raw_value: str) -> set[str]:
    token = str(raw_value or "").strip().lower()
    if not token:
        return set()
    return {
        part.strip().lower()
        for part in re.split(r"[,\s;+|]+", token)
        if part and part.strip()
    }


def _embedding_fail_open_acl_allowed(
    *,
    mode: str,
    classification: Optional[str] = None,
    acl_tags: Optional[list[str]] = None,
    allowed_classifications: Optional[list[str]] = None,
) -> bool:
    if not bool(getattr(settings, "embedding_fail_open_require_acl_public", True)):
        return True
    mode_token = str(mode or "").strip().lower()
    if mode_token == "ingest":
        return str(classification or "").strip().upper() == "PUBLIC"
    class_tokens = {
        str(item or "").strip().upper()
        for item in (allowed_classifications or [])
        if str(item or "").strip()
    }
    if class_tokens and class_tokens != {"PUBLIC"}:
        return False
    acl_token_set = {
        str(item or "").strip().lower()
        for item in (acl_tags or [])
        if str(item or "").strip()
    }
    if not acl_token_set:
        return True
    public_acl_tokens = {"public", "anon", "anonymous"}
    return acl_token_set.issubset(public_acl_tokens)


def _policy_lattice_metadata(lattice: PolicyLattice) -> dict[str, Any]:
    return {
        "sensitivity": lattice.sensitivity,
        "residency": lattice.residency,
        "external_transfer": lattice.external_transfer,
        "retention": lattice.retention,
        "privilege_scope": lattice.privilege_scope,
        "purpose_of_use": lattice.purpose_of_use,
        "source_rights": lattice.source_rights,
        "exportability": lattice.exportability,
        "provider_allowlist": list(lattice.provider_allowlist),
        "policy_flags": list(lattice.policy_flags),
        "should_block_generation": lattice.should_block_generation,
    }


def _free_cost_estimate(*, model_id: str, tier: int, cached: bool) -> tuple[float, dict[str, Any]]:
    return (
        0.0,
        {
            "model_id": str(model_id or "none/none"),
            "tier": int(tier if tier in (1, 2, 3, 4) else 2),
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost_usd": 0.0,
            "cached": bool(cached),
            "rate_per_1m_in": 0.0,
            "rate_per_1m_out": 0.0,
        },
    )


def _estimated_cost_payload(
    *,
    model_id: str,
    tier: int,
    query: str,
    context: str,
    answer: str,
) -> tuple[float, dict[str, Any]]:
    est = estimate_cost(
        model_id=str(model_id or "unknown/model"),
        tier=int(tier if tier in (1, 2, 3, 4) else 2),
        query=query,
        context=context,
        answer=answer,
        cached=False,
    )
    return (
        float(est.total_cost_usd),
        {
            "model_id": est.model_id,
            "tier": int(est.tier),
            "input_tokens": int(est.input_tokens),
            "output_tokens": int(est.output_tokens),
            "total_cost_usd": float(est.total_cost_usd),
            "cached": bool(est.cached),
            "rate_per_1m_in": float(est.rate_per_1m_in),
            "rate_per_1m_out": float(est.rate_per_1m_out),
        },
    )


def _rag_v3_ingest_contract_version() -> str:
    value = getattr(settings, "rag_v3_ingest_contract_version", RAG_V3_INGEST_CONTRACT_VERSION)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return RAG_V3_INGEST_CONTRACT_VERSION


def _rag_v3_ingest_schema_version() -> str:
    value = getattr(settings, "rag_v3_ingest_schema_version", RAG_V3_INGEST_SCHEMA_VERSION)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return RAG_V3_INGEST_SCHEMA_VERSION


def _read_contract_version(path: Path) -> str | None:
    try:
        if not path.exists():
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        token = str(payload.get("contract_version") or payload.get("version") or "").strip()
        return token or None
    except Exception:
        return None


def _rag_v3_query_contract_version() -> str:
    value = getattr(settings, "rag_v3_query_contract_version", RAG_V3_QUERY_CONTRACT_VERSION)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return RAG_V3_QUERY_CONTRACT_VERSION


def _rag_v3_query_schema_version() -> str:
    value = getattr(settings, "rag_v3_query_schema_version", RAG_V3_QUERY_SCHEMA_VERSION)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return RAG_V3_QUERY_SCHEMA_VERSION


rag_v3_service = RagV3Service()
