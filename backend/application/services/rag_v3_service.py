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
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException
from domain.entities.tenant import AccessLevel
from infrastructure.config import settings
from infrastructure.audit.cost_tracker import estimate_cost
from infrastructure.database.connection import get_supabase_client
from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.llm.tiered_router import LLMTieredRouter, llm_router
from infrastructure.rag_v3.admission import RagV3AdmissionController, rag_v3_admission_controller
from infrastructure.rag_v3.chunker import LegalChunkDraft, LegalStructuredChunker
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
from infrastructure.rag_v3.normalizer import LegalTextNormalizer, legal_text_normalizer
from infrastructure.rag_v3.reranker import RagV3RerankItem, RagV3Reranker, rag_v3_reranker
from infrastructure.rag_v3.repository import (
    RagV3ChunkMatch,
    RagV3ChunkUpsert,
    SupabaseRagV3Repository,
    rag_v3_repository,
)
from infrastructure.rag_v3.source_parser import ParsedSourceContent, parse_source_content
from infrastructure.security.prompt_guard import PromptGuard, prompt_guard

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

RAG_V3_ALLOWED_CLASSIFICATIONS = ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "SENSITIVE")
RAG_V3_CLASSIFICATIONS_BY_ACCESS: dict[AccessLevel, tuple[str, ...]] = {
    AccessLevel.READ_ONLY: ("PUBLIC", "INTERNAL"),
    AccessLevel.MEMBER: ("PUBLIC", "INTERNAL", "CONFIDENTIAL"),
    AccessLevel.OWNER: ("PUBLIC", "INTERNAL", "CONFIDENTIAL", "SENSITIVE"),
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
    final_score: float
    temporal_version: Optional[str] = None
    evidence_text: Optional[str] = None
    evidence_start: Optional[int] = None
    evidence_end: Optional[int] = None
    evidence_overlap: Optional[float] = None


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
    as_of_date: Optional[date] = None
    event_date: Optional[date] = None
    decision_date: Optional[date] = None
    requested_tier: Optional[int] = None
    snapshot_id: Optional[int] = None
    acl_tags: list[str] = field(default_factory=list)
    history: list[dict[str, str]] = field(default_factory=list)
    policy_context: dict[str, Any] = field(default_factory=dict)


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
    contract_version: str = RAG_V3_QUERY_CONTRACT_VERSION
    schema_version: str = RAG_V3_QUERY_SCHEMA_VERSION


@dataclass(frozen=True)
class RagV3DeleteCommand:
    document_id: Optional[str] = None
    source_id: Optional[str] = None
    purge_raw_storage: bool = False


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

        parsed = parse_source_content(
            command.raw_text,
            command.source_format,
            metadata=command.metadata,
        )
        normalized = self._normalizer.normalize(parsed.text)
        normalized_text = normalized.text
        if not normalized_text:
            raise ValueError("No ingestible text remained after normalization.")

        chunks = self._chunker.chunk(normalized_text)
        if not chunks:
            raise ValueError("No chunks produced from source text.")

        chunk_texts = [chunk.text for chunk in chunks]
        warnings: list[str] = list(dict.fromkeys([*parsed.warnings, *normalized.warnings]))
        embeddings = await self._safe_embed_texts(chunk_texts, warnings=warnings)

        doc_hash = _sha256(normalized_text)
        storage_meta = self._store_raw_payload(
            command=command,
            parsed=parsed,
            doc_hash=doc_hash,
            warnings=warnings,
        )
        chunk_hashes: list[str] = []
        upserts: list[RagV3ChunkUpsert] = []
        for ordinal, (chunk, embedding) in enumerate(zip(chunks, embeddings), start=1):
            chunk_hash = _chunk_hash(
                chunk=chunk,
                source_id=command.source_id,
                ordinal=ordinal,
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
                    source_id=command.source_id,
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
                **(command.metadata or {}),
                "classification": classification,
                **storage_meta,
                "source_format": parsed.source_format,
                "parsed_page_count": parsed.page_count,
                "parsed_heading_count": parsed.heading_count,
                "ocr_used": parsed.ocr_used,
                "ocr_confidence": parsed.ocr_confidence,
                "ocr_engine": parsed.ocr_engine,
                "source_parse_warnings": parsed.warnings[:200],
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
        query = command.query.strip()
        if not query:
            raise ValueError("query cannot be empty.")
        try:
            self._guard.check_query(query)
        except HTTPException as exc:
            await self._persist_security_block_trace(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=query,
                command=command,
                detail=exc.detail,
            )
            raise
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
        policy_summary = self._to_policy_summary(policy, lattice=policy_lattice)

        top_k = _normalize_top_k(int(command.top_k))
        requested_tier = command.requested_tier if command.requested_tier in (1, 2, 3, 4) else 2
        normalized_acl_tags = _normalize_acl_tags(command.acl_tags, classification=None)
        allowed_classifications = list(_allowed_classifications_for(access))
        cache_key = self._build_query_cache_key(
            query=query,
            command=command,
            top_k=top_k,
            bureau_id=bureau_id,
            acl_tags=normalized_acl_tags,
            allowed_classifications=allowed_classifications,
            as_of_date=temporal_resolution.as_of_date,
            requested_tier=requested_tier,
            policy_context=command.policy_context,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=replace(cached_result),
                    matches=[],
                    extra_metadata={"cache_hit": True},
                )
                return cached_result

            embedding = await self._safe_embed_query(query)
            jurisdiction = (command.jurisdiction or "TR").strip() or "TR"
            dual_temporal_metadata: dict[str, Any] = {
                "dual_temporal_applied": False,
                "snapshot_id": int(snapshot_state.snapshot_id),
                "publish_epoch": int(snapshot_state.publish_epoch),
                "revocation_epoch_start": int(snapshot_state.revocation_epoch),
            }
            dual_temporal_notes: list[str] = []
            snapshot_notes: list[str] = list(snapshot_state.warnings)
            temporal_labels: dict[str, str] = {}
            dual_temporal_enabled = bool(getattr(settings, "rag_v3_dual_temporal_enabled", True))
            dual_temporal_requested = (
                dual_temporal_enabled
                and command.as_of_date is None
                and _is_dual_temporal_requested(
                event_date=command.event_date,
                decision_date=command.decision_date,
                )
            )
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
                            query=query,
                            embedding=embedding,
                            top_k=top_k,
                            jurisdiction=jurisdiction,
                            event_date=command.event_date,
                            decision_date=command.decision_date,
                            acl_tags=normalized_acl_tags,
                            allowed_classifications=allowed_classifications,
                            bureau_id=bureau_id,
                        )
                    )
                else:
                    matches = await self._retrieve_matches(
                        query=query,
                        embedding=embedding,
                        top_k=top_k,
                        jurisdiction=jurisdiction,
                        as_of_date=temporal_resolution.as_of_date,
                        acl_tags=normalized_acl_tags,
                        allowed_classifications=allowed_classifications,
                        bureau_id=bureau_id,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                    extra_metadata=dual_temporal_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=[],
                    extra_metadata=dual_temporal_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
                    result=result,
                )
                return result

            rerank_timeout_s = max(0.5, float(getattr(settings, "rag_v3_reranker_timeout_s", 4.0) or 4.0))
            selected = await self._safe_rerank_with_timeout(
                query=query,
                matches=matches,
                top_k=top_k,
                timeout_s=rerank_timeout_s,
            )
            hierarchy_as_of = None if dual_temporal_requested else temporal_resolution.as_of_date
            selected, hierarchy_notes = apply_norm_hierarchy(
                selected,
                query=query,
                as_of_date=hierarchy_as_of,
            )
            threshold = _clamp01(float(settings.rag_v3_no_answer_min_score))
            answerability_gate_enabled = bool(settings.rag_v3_answerability_check_enabled)
            confidence = _retrieval_confidence(selected)
            answerability_ok = (not answerability_gate_enabled) or _passes_answerability_gate(query, selected)
            iterative_metadata: dict[str, Any] = {"iterative_retrieval_applied": False}
            iterative_notes: list[str] = []

            iterative_enabled = bool(getattr(settings, "rag_v3_iterative_retrieval_enabled", True))
            should_iterate = iterative_enabled and (
                confidence < threshold
                or (answerability_gate_enabled and not answerability_ok)
            )
            if should_iterate:
                try:
                    iterative_pool, iterative_metadata = await self._iterative_retrieve(
                        query=query,
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
                    selected = await self._safe_rerank_with_timeout(
                        query=query,
                        matches=iterative_pool,
                        top_k=top_k,
                        timeout_s=rerank_timeout_s,
                    )
                    selected, iterative_notes = apply_norm_hierarchy(
                        selected,
                        query=query,
                        as_of_date=hierarchy_as_of,
                    )
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
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
                    query=query,
                    command=command,
                    requested_tier=requested_tier,
                    result=result,
                    matches=selected,
                    extra_metadata=combined_retrieval_metadata,
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
                    result=result,
                )
                return result

            citations = _to_citations(selected, temporal_labels=selected_temporal_labels)
            context = self._build_context(selected, temporal_labels=selected_temporal_labels)
            try:
                self._guard.check_context(context)
            except HTTPException as exc:
                await self._persist_security_block_trace(
                    request_id=request_id,
                    started_at=started_at,
                    bureau_id=bureau_id,
                    query=query,
                    command=command,
                    detail=exc.detail,
                    matches=selected,
                )
                raise
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
                        query=_build_baseline_query(
                            query,
                            dual_temporal=dual_temporal_requested,
                            event_date=command.event_date,
                            decision_date=command.decision_date,
                        ),
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
                        query=query,
                        command=command,
                        requested_tier=requested_tier,
                        result=result,
                        matches=selected,
                        extra_metadata={**combined_retrieval_metadata, "mid_turn_revoke_detected": True},
                    )
                    await self._maybe_capture_feedback_candidate(
                        enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                        bureau_id=bureau_id,
                        query=query,
                        result=result,
                    )
                    return result

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
            claim_verification: ClaimVerification = verify_claim_support(
                answer_text=answer,
                evidence_chunks=selected,
                cited_chunk_ids=cited_chunk_ids,
                min_overlap=float(settings.rag_v3_claim_min_overlap),
                min_supported_ratio=float(settings.rag_v3_claim_min_supported_ratio),
            )
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
            if should_escalate != structured.should_escalate:
                structured = replace(structured, should_escalate=should_escalate)
            if claim_graph_metadata:
                combined_retrieval_metadata.update(claim_graph_metadata)

            review_ticket_id = await self._maybe_enqueue_human_review(
                enabled=bool(settings.rag_v3_human_review_enabled),
                bureau_id=bureau_id,
                query=query,
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
                fingerprint=self._fingerprint(model_label=model_label, matches=selected),
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
            )
            await self._query_cache_set(cache_key, replace(result, request_id=""))
            result = await self._finalize_query_result(
                request_id=request_id,
                started_at=started_at,
                bureau_id=bureau_id,
                query=query,
                command=command,
                requested_tier=requested_tier,
                result=result,
                matches=selected,
                extra_metadata={"cache_hit": False, **combined_retrieval_metadata},
            )
            await self._maybe_capture_feedback_candidate(
                enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                bureau_id=bureau_id,
                query=query,
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
        )

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
        snapshot_id: int,
        revocation_epoch: int,
    ) -> str:
        normalized_query = " ".join((query or "").strip().lower().split())
        history_token = _history_cache_token(command.history)
        policy_token = _policy_context_cache_token(policy_context)
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
        }
        if extra_metadata:
            metadata = {**metadata, **dict(extra_metadata)}
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
    ) -> list[RagV3ChunkMatch]:
        candidate_k = max(top_k, int(settings.rag_v3_reranker_top_n))
        if settings.rag_v3_hybrid_enabled:
            dense_k = max(candidate_k, int(settings.rag_v3_dense_top_k))
            sparse_k = max(candidate_k, int(settings.rag_v3_sparse_top_k))
            try:
                dense, sparse = await asyncio.gather(
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
                )
                fused = _rrf_fuse(dense, sparse, max_results=candidate_k)
                if fused:
                    return fused
            except Exception as exc:  # noqa: BLE001
                logger.warning("RAG_V3_HYBRID_FALLBACK | reason=%s", exc)

        return await self._repository.match_chunks_dense(
            query_embedding=embedding,
            top_k=candidate_k,
            jurisdiction=jurisdiction,
            as_of_date=as_of_date,
            acl_tags=acl_tags,
            allowed_classifications=allowed_classifications,
            bureau_id=bureau_id,
        )

    async def _rerank(
        self,
        query: str,
        matches: list[RagV3ChunkMatch],
        *,
        top_k: int,
    ) -> list[RagV3ChunkMatch]:
        if not matches:
            return []
        pool_size = max(top_k, int(settings.rag_v3_reranker_top_n))
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
    ) -> list[RagV3ChunkMatch]:
        try:
            return await asyncio.wait_for(
                self._rerank(query, matches, top_k=top_k),
                timeout=max(0.5, float(timeout_s)),
            )
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
        rewritten_embedding = await self._safe_embed_query(rewritten_query)
        second_pass = await self._retrieve_matches(
            query=rewritten_query,
            embedding=rewritten_embedding,
            top_k=iterative_top_k,
            jurisdiction=jurisdiction,
            as_of_date=as_of_date,
            acl_tags=acl_tags,
            allowed_classifications=allowed_classifications,
            bureau_id=bureau_id,
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
        blocks: list[str] = []
        for idx, match in enumerate(matches, start=1):
            sanitized = self._guard.sanitize_document_text(match.chunk_text)
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
                    body=sanitized.sanitized_text,
                )
            )
        return "\n\n---\n\n".join(blocks)

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
        )

    def _fingerprint(self, *, model_label: str, matches: list[RagV3ChunkMatch]) -> RagV3Fingerprint:
        model_name = model_label.split("/", 1)[-1] if "/" in model_label else model_label
        doc_hashes = _unique_in_order([row.doc_hash for row in matches if row.doc_hash])
        chunk_hashes = _unique_in_order([row.chunk_hash for row in matches if row.chunk_hash])
        index_version = (
            "rag_v3_baseline_dense:"
            "top_k=8-12"
            f"|embed={settings.embedding_model}"
            f"|dim={settings.embedding_dimensions}"
        )
        return RagV3Fingerprint(
            model_name=model_name,
            model_version=model_label,
            index_version=index_version,
            prompt_version=RAG_V3_PROMPT_VERSION,
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

    async def _safe_embed_texts(self, texts: list[str], *, warnings: list[str]) -> list[list[float]]:
        try:
            embeddings = await self._embedder.embed_texts(texts)
            if len(embeddings) != len(texts):
                raise RuntimeError("Embedding count mismatch for chunk list.")
            return embeddings
        except Exception as exc:  # noqa: BLE001
            if not settings.embedding_fail_open_enabled:
                raise
            logger.warning("RAG_V3_EMBED_FAIL_OPEN | mode=ingest | reason=%s", str(exc))
            warnings.append("Embedding provider unavailable; local hash-embedding fallback used.")
            return [_hash_embedding(text, settings.embedding_dimensions) for text in texts]

    async def _safe_embed_query(self, query: str) -> list[float]:
        try:
            return await self._embedder.embed_query(query)
        except Exception as exc:  # noqa: BLE001
            if not settings.embedding_fail_open_enabled:
                raise
            logger.warning("RAG_V3_EMBED_FAIL_OPEN | mode=query | reason=%s", str(exc))
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


def _to_citations(
    matches: list[RagV3ChunkMatch],
    *,
    temporal_labels: Optional[dict[str, str]] = None,
) -> list[RagV3Citation]:
    return [
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
            final_score=_clamp01(row.final_score),
            temporal_version=(temporal_labels or {}).get(row.chunk_id),
        )
        for row in matches
    ]


def _rrf_fuse(
    dense: list[RagV3ChunkMatch],
    sparse: list[RagV3ChunkMatch],
    *,
    max_results: int,
) -> list[RagV3ChunkMatch]:
    if not dense and not sparse:
        return []
    rrf_k = max(1, int(settings.rag_v3_rrf_k))
    sw = max(0.0, float(settings.rag_v3_rrf_semantic_weight))
    kw = max(0.0, float(settings.rag_v3_rrf_keyword_weight))
    if sw <= 0.0 and kw <= 0.0:
        sw, kw = 1.0, 1.0

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

    ranked = sorted(rrf.items(), key=lambda x: x[1], reverse=True)
    out: list[RagV3ChunkMatch] = []
    for cid, rrf_score in ranked[: max(1, max_results)]:
        row = base.get(cid)
        if row is None:
            continue
        sem = semantic.get(cid, 0.0)
        key = keyword.get(cid, 0.0)
        blended = _clamp01((0.7 * sem) + (0.3 * key))
        single = 1.0 / float(rrf_k + 1)
        rrf_norm = _clamp01(rrf_score / (2.0 * single)) if single > 0 else 0.0
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


def _unique_in_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


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
        overlap = len(query_tokens & row_tokens) / float(max(1, len(query_tokens)))
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
        overlap = len(query_tokens & tokens) / float(max(1, len(query_tokens)))
        number_bonus = 0.15 if needs_numeric and re.search(r"\d", sentence) else 0.0
        anchor_coverage = 0.0
        if anchor_tokens:
            anchor_coverage = len(anchor_tokens & tokens) / float(max(1, len(anchor_tokens)))
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
