"""Application service for RAG v3 (documents + chunks)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import time
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any, Optional
from uuid import UUID, uuid4

from infrastructure.config import settings
from infrastructure.database.connection import get_supabase_client
from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.llm.tiered_router import LLMTieredRouter, llm_router
from infrastructure.rag_v3.admission import RagV3AdmissionController, rag_v3_admission_controller
from infrastructure.rag_v3.chunker import LegalChunkDraft, LegalStructuredChunker
from infrastructure.rag_v3.governance import (
    ClaimVerification,
    PolicyDecision,
    TemporalResolution,
    apply_norm_hierarchy,
    evaluate_policy,
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
_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_JSON_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)
_SAFE_TOKEN_RE = re.compile(r"[^a-z0-9._-]+")


@dataclass(frozen=True)
class RagV3IngestCommand:
    title: str
    source_type: str
    source_id: str
    jurisdiction: str
    raw_text: str
    source_format: str = "text"
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    acl_tags: list[str] = field(default_factory=lambda: ["public"])
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
class RagV3PolicySummary:
    risk_level: str
    policy_flags: list[str]
    legal_disclaimer: str
    should_escalate: bool


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
    requested_tier: Optional[int] = None
    acl_tags: list[str] = field(default_factory=lambda: ["public"])


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
    request_id: str = ""
    gate_decision: str = "answered"
    contract_version: str = RAG_V3_QUERY_CONTRACT_VERSION
    schema_version: str = RAG_V3_QUERY_SCHEMA_VERSION


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
        self._chunker = chunker or LegalStructuredChunker()
        self._normalizer = normalizer or legal_text_normalizer
        self._reranker = reranker or rag_v3_reranker
        self._admission = admission_controller or rag_v3_admission_controller

    async def ingest(
        self,
        command: RagV3IngestCommand,
        *,
        bureau_id: Optional[UUID],
    ) -> RagV3IngestResult:
        if not command.raw_text.strip():
            raise ValueError("raw_text cannot be empty.")

        parsed = parse_source_content(command.raw_text, command.source_format)
        normalized = self._normalizer.normalize(parsed.text)
        normalized_text = normalized.text
        if not normalized_text:
            raise ValueError("No ingestible text remained after normalization.")

        chunks = self._chunker.chunk(normalized_text)
        if not chunks:
            raise ValueError("No chunks produced from source text.")

        chunk_texts = [chunk.text for chunk in chunks]
        warnings: list[str] = list(dict.fromkeys(normalized.warnings))
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
            acl_tags=command.acl_tags or ["public"],
            bureau_id=bureau_id,
            metadata={
                **(command.metadata or {}),
                **storage_meta,
                "source_format": parsed.source_format,
                "parsed_page_count": parsed.page_count,
                "parsed_heading_count": parsed.heading_count,
                "normalizer": "rag_v3.legal_text_normalizer",
                "footnote_count": len(normalized.footnotes),
                "footnotes": normalized.footnotes[:200],
            },
            chunks=upserts,
        )
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
    ) -> RagV3QueryResult:
        query = command.query.strip()
        if not query:
            raise ValueError("query cannot be empty.")
        self._guard.check_query(query)
        if (
            settings.multi_tenancy_enabled
            and settings.rag_v3_tenant_hard_fail_missing_bureau
            and (settings.is_production or settings.tenant_enforce_in_dev)
            and bureau_id is None
        ):
            raise ValueError("bureau_id is required for tenant-isolated rag_v3 query.")

        request_id = str(uuid4())
        started_at = time.monotonic()
        temporal_resolution = resolve_as_of_date(query, command.as_of_date)
        policy = evaluate_policy(query)
        policy_summary = self._to_policy_summary(policy)

        top_k = _normalize_top_k(int(command.top_k))
        requested_tier = command.requested_tier if command.requested_tier in (1, 2, 3, 4) else 2
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

            embedding = await self._safe_embed_query(query)
            matches = await self._retrieve_matches(
                query=query,
                embedding=embedding,
                top_k=top_k,
                jurisdiction=(command.jurisdiction or "TR").strip() or "TR",
                as_of_date=temporal_resolution.as_of_date,
                acl_tags=command.acl_tags or ["public"],
                bureau_id=bureau_id,
            )
            if not matches:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=[],
                    reason="retrieval_empty",
                    confidence=0.0,
                    temporal=temporal_resolution,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
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

            try:
                selected = await self._rerank(query, matches, top_k=top_k)
            except Exception as exc:  # noqa: BLE001
                logger.warning("RAG_V3_RERANK_FALLBACK | reason=%s", exc)
                selected = list(matches[:top_k])

            selected, hierarchy_notes = apply_norm_hierarchy(
                selected,
                query=query,
                as_of_date=temporal_resolution.as_of_date,
            )
            confidence = _retrieval_confidence(selected)
            threshold = _clamp01(float(settings.rag_v3_no_answer_min_score))
            if confidence < threshold:
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=selected,
                    reason="retrieval_score_below_threshold",
                    confidence=confidence,
                    temporal=temporal_resolution,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
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
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
                    result=result,
                )
                return result
            if settings.rag_v3_answerability_check_enabled and not _passes_answerability_gate(query, selected):
                result = self._no_answer_result(
                    model_label="none/none",
                    matches=selected,
                    reason="answerability_overlap_low",
                    confidence=confidence,
                    temporal=temporal_resolution,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
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
                    temporal=temporal_resolution,
                    policy=policy_summary,
                    claim_report=claim_report,
                    admission=admission_summary,
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
                )
                await self._maybe_capture_feedback_candidate(
                    enabled=bool(settings.rag_v3_feedback_auto_capture_enabled),
                    bureau_id=bureau_id,
                    query=query,
                    result=result,
                )
                return result

            citations = _to_citations(selected)
            context = self._build_context(selected)
            self._guard.check_context(context)
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
            try:
                raw_answer, model_label = await self._router.generate(
                    query=_build_baseline_query(query),
                    context=context,
                    source_count=len(selected),
                    requested_tier=effective_tier,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error("RAG v3 model call failed: %s", exc, exc_info=True)
                raw_answer = _extractive_fallback(selected)

            status = "no_answer" if _looks_like_no_answer(raw_answer) else "ok"
            if status == "no_answer":
                raw_answer = RAG_V3_NO_ANSWER
            structured = await self._build_structured(
                query=query,
                context=context,
                raw_answer=raw_answer,
                status=status,
                confidence=confidence,
                default_citations=citations,
            )

            warning_items = [*structured.warnings, *temporal_resolution.warnings, *hierarchy_notes]
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
                answer = RAG_V3_NO_ANSWER

            resolved_citations = _resolve_response_citations(structured.citations, citations, top_k)
            claim_verification: ClaimVerification = verify_claim_support(
                answer_text=answer,
                evidence_chunks=selected,
                cited_chunk_ids=[item.chunk_id for item in structured.citations if item.chunk_id],
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

            if (
                settings.rag_v3_no_answer_on_claim_verification_fail
                and not claim_verification.passed
                and status == "ok"
            ):
                status = "no_answer"
                answer = RAG_V3_NO_ANSWER
                structured = replace(
                    structured,
                    answer_text=RAG_V3_NO_ANSWER,
                    should_escalate=True,
                    warnings=_append_unique(structured.warnings, "claim_verification_failed"),
                )

            should_escalate = (
                structured.should_escalate
                or policy.should_escalate
                or (not claim_verification.passed)
            )
            if should_escalate != structured.should_escalate:
                structured = replace(structured, should_escalate=should_escalate)

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
                temporal=temporal_resolution,
            )

            result = RagV3QueryResult(
                answer=answer,
                status=status,
                citations=resolved_citations,
                structured=structured,
                fingerprint=self._fingerprint(model_label=model_label, matches=selected),
                retrieved_count=len(selected),
                resolved_as_of_date=temporal_resolution.as_of_date,
                review_ticket_id=review_ticket_id,
                claim_verification=claim_report,
                policy=policy_summary,
                admission=admission_summary,
                gate_decision="answered" if status == "ok" else "model_no_answer",
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
    ) -> None:
        if not hasattr(self._repository, "append_query_trace"):
            return

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
            "review_ticket_id": result.review_ticket_id,
            "claim_total": result.claim_verification.total_claims,
            "claim_supported": result.claim_verification.supported_claims,
            "claim_support_ratio": result.claim_verification.support_ratio,
            "policy_risk_level": result.policy.risk_level,
            "policy_flags": list(result.policy.policy_flags),
            "admission_accepted": result.admission.accepted,
            "admission_degraded": result.admission.degraded,
            "admission_queue_wait_ms": result.admission.queue_wait_ms,
        }
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
                as_of_date=result.resolved_as_of_date or command.as_of_date,
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

    async def _retrieve_matches(
        self,
        *,
        query: str,
        embedding: list[float],
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
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
                        bureau_id=bureau_id,
                    ),
                    self._repository.match_chunks_sparse(
                        query_text=query,
                        top_k=sparse_k,
                        jurisdiction=jurisdiction,
                        as_of_date=as_of_date,
                        acl_tags=acl_tags,
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

    def _build_context(self, matches: list[RagV3ChunkMatch]) -> str:
        blocks: list[str] = []
        for idx, match in enumerate(matches, start=1):
            sanitized = self._guard.sanitize_document_text(match.chunk_text)
            blocks.append(
                "[BAGLAM:{idx}] source_id={source_id}; source_type={source_type}; "
                "madde={article}; fikra={clause}; alt_fikra={subclause}; sayfa={page}\n{body}".format(
                    idx=idx,
                    source_id=match.source_id,
                    source_type=match.source_type,
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
    ) -> RagV3StructuredAnswer:
        fallback = _fallback_structured(raw_answer, status, confidence, default_citations, warnings=[])
        if not settings.rag_v3_structured_output_enabled:
            return fallback

        parsed = _parse_structured(raw_answer, default_citations, confidence, status)
        if parsed is not None:
            return parsed

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
    ) -> RagV3QueryResult:
        citations = _to_citations(matches)
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

    def _to_policy_summary(self, policy: PolicyDecision) -> RagV3PolicySummary:
        return RagV3PolicySummary(
            risk_level=policy.risk_level,
            policy_flags=list(policy.policy_flags),
            legal_disclaimer=policy.legal_disclaimer,
            should_escalate=policy.should_escalate,
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


def _to_citations(matches: list[RagV3ChunkMatch]) -> list[RagV3Citation]:
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


def _match_label(match: RagV3ChunkMatch) -> str:
    parts = [f"{match.title} ({match.source_id})"]
    if match.article_no:
        parts.append(f"Madde {match.article_no}")
    if match.clause_no:
        parts.append(f"Fikra {match.clause_no}")
    if match.subclause_no:
        parts.append(f"Bent {match.subclause_no}")
    return " | ".join(parts)


def _build_baseline_query(user_query: str) -> str:
    return (
        "Sadece BAGLAM alanini kullanarak cevap ver.\n"
        "Kurallar:\n"
        "1) BAGLAM disinda bilgi uretme.\n"
        "2) Cevap sonunda en az bir atif satiri ver.\n"
        "3) Atif formati: source_id=<id>; madde=<article_no>; fikra=<clause_no>\n"
        "4) BAGLAM yetersizse sadece 'Bulamadim.' yaz.\n"
        "5) Kesin hukuk sonucu vaat etme, hukuki gorus yerine gecmedigini belirt.\n"
        "6) En fazla 200 token kullan.\n"
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


def _extractive_fallback(matches: list[RagV3ChunkMatch]) -> str:
    if not matches:
        return RAG_V3_NO_ANSWER
    best = matches[0]
    snippet = " ".join(best.chunk_text.split())
    if len(snippet) > 700:
        snippet = snippet[:697] + "..."
    return (
        "Model yaniti olusturulamadi; en guclu kanit parcasi donuluyor. "
        f"Kaynak: {_match_label(best)}.\n\n{snippet}"
    )


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
