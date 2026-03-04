"""
RAG Service  —  V2.1 Zero-Trust Legal Retrieval
================================================
Orchestrates the full query → retrieve → answer pipeline.

STEP 1 — HARD-FAIL CONTRACT  ("Kaynak yoksa cevap yok"):
    If the retrieval step returns 0 documents, this service raises
    NoSourceError immediately.  The LLM is NEVER called for empty
    retrievals.  Cost for this code path = $0.

STEP 2 — SOURCE METADATA:
    Every retrieved document is mapped to a LegalDocument entity that
    carries source_url, version, and collected_at provenance fields
    (added by the rag_v2_step2_metadata.sql migration).

ARCHITECTURE NOTE:
    The Hard-Fail has TWO independent enforcement layers:
      Layer 1 (here, line ~80):  `if not retrieved_docs: raise NoSourceError`
      Layer 2 (schemas.py):      `RAGResponse @model_validator` blocks
                                  construction without sources.
    Both must remain in place.  Removing either weakens the contract.

STEP 3 — SEMANTIC CACHE (Redis):
    Two-level cache sits in front of the retrieval pipeline.
    L1 (exact match) is checked BEFORE embedding — cheapest path ($0).
    L2 (cosine similarity ≥ 0.92) is checked AFTER embedding but BEFORE
    retrieval and LLM — also $0 for the LLM.
    Both levels store full RAGResponse dicts with a 24 h TTL.

STEP 5 — PROMPT INJECTION GUARD:
    Two scan surfaces protect the pipeline:
      Surface A — query scan (user input):  runs BEFORE the L1 cache lookup.
          Detects jailbreak / role-override / system-prompt-leak attempts.
          If triggered → HTTP 400.  LLM cost = $0.
      Surface B — context scan (retrieved documents): runs AFTER
          ContextBuilder.build(), BEFORE _call_llm().
          Detects poisoned document content (injected [INST], SYSTEM:, etc.).
          If triggered → HTTP 400.  LLM cost = $0.

STEP 8 — CONTEXT BUILDER (token budget management):
    Before calling the LLM, retrieved documents are packed into the context
    window by ContextBuilder.  It respects per-tier token budgets:
        Tier 1 → 800 tokens    Tier 3 → 5000 tokens
        Tier 2 → 2500 tokens   Tier 4 → 8192 tokens
    Documents are included greedily (highest final_score first).
    If a document doesn't fit, it is soft-truncated or dropped.
    AT LEAST 1 document is always included (the Hard-Fail gate guarantees
    at least 1 document was retrieved).
    source_schemas in RAGResponse reflects the actually-included docs,
    not the full retrieved set.  This ensures every citation was seen by LLM.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from api import ChatMode as APIChatMode
from api import ResponseType
from api.schemas import (
    APIErrorResponse,
    AnswerSentence,
    AuditTrailSchema,
    AymWarningSchema,
    CitationQualitySchema,
    CostEstimateSchema,
    InlineCitation,
    LegalDisclaimerSchema,
    LeheKanunNoticeSchema,
    NoSourceErrorDetail,
    PromptInjectionErrorDetail,
    RAGASMetricsSchema,
    RAGQueryRequestV3 as RAGQueryRequest,
    RAGResponseV3 as RAGResponse,
    SourceDocumentSchema,
    TemporalFieldsSchema,
)
from domain.entities.legal_document import LegalDocument
from infrastructure.cache.semantic_cache import SemanticCache
from infrastructure.config import settings
from infrastructure.llm.tiered_router import LLMTieredRouter, QueryTier, classify_query_tier, llm_router
from infrastructure.llm.query_rewriter import QueryRewriter, query_rewriter
from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.retrieval.retrieval_client import (
    SOURCE_TYPE_ICTIHAT,
    SOURCE_TYPE_MEVZUAT,
    RetrieverClient,
    infer_source_type,
    retriever_client,
)
from infrastructure.search.rrf_retriever import RRFRetriever, rrf_retriever
from infrastructure.reranking.legal_reranker import LegalReranker, detect_query_domain, legal_reranker
from infrastructure.security.prompt_guard import PromptGuard, prompt_guard
from infrastructure.context.context_builder import ContextBuilder, context_builder
from infrastructure.context.context_summarizer import ContextSummarizer, context_summarizer
from infrastructure.generation.zero_trust_prompt import ZeroTrustPromptBuilder, zero_trust_builder
from infrastructure.generation.disclaimer_engine import LegalDisclaimerEngine, disclaimer_engine
from infrastructure.audit.cost_tracker import CostTracker, cost_tracker, estimate_cost
from infrastructure.audit.audit_trail import AuditTrailRecorder, audit_recorder
from infrastructure.metrics.ragas_adapter import RAGASAdapter, ragas_adapter
from infrastructure.graph.citation_graph import CitationGraphExpander, citation_graph_expander
from infrastructure.agents.tool_dispatcher import ToolDispatcher, tool_dispatcher
from infrastructure.intent.intent_classifier import IntentClassifier, intent_classifier
from domain.entities.tenant import TenantContext
from infrastructure.security.kvkk_redactor import kvkk_redactor
from infrastructure.legal.lehe_kanun_engine import LeheKanunEngine, lehe_kanun_engine

logger = logging.getLogger("babylexit.rag_service")


# ============================================================================
# Custom Exceptions
# ============================================================================

class NoSourceError(Exception):
    """
    STEP 1 — Hard-Fail sentinel.

    Raised by RAGService when the retrieval step returns zero documents.

    Guarantees:
        - LLM is NEVER called when this exception is propagated.
        - API response cost for this request = $0.
        - HTTP 422 is returned to the client with a structured payload.
    """

    def __init__(self, query: str) -> None:
        self.query = query
        super().__init__(
            f"Kaynak yoksa cevap yok: "
            f"'{query[:80]}' için hiç belge bulunamadı."
        )


# ============================================================================
# Module-level constants
# ============================================================================

_SAFE_REFUSAL: str = (
    "Mevcut kaynaklarda bu konuda yeterli bilgi bulunamadı. "
    "Lütfen sorunuzu daha spesifik hukuki terimlerle yeniden deneyin."
)
"""Safe refusal text returned to the client when the post-LLM Grounding
Hard-Fail gate fires (grounding_ratio < settings.zero_trust_min_grounding_ratio).
Defined at module level so tests can import it directly for assertion equality.
When the gate fires, answer_sentences and inline_citations are also cleared.
"""

_CITATION_MARKER_RE = re.compile(r"\[K:\d+\]")
_QUALITY_SOURCE_CLASS_ORDER = (
    "kanun",
    "ictihat",
    "ikincil_kaynak",
    "kullanici_notu",
)
_QUALITY_SOURCE_CLASS_WEIGHT = {
    "kanun": 1.0,
    "ictihat": 0.85,
    "ikincil_kaynak": 0.6,
    "kullanici_notu": 0.4,
}


def _strip_citation_markers(text: str) -> str:
    """Remove [K:N] markers before sentence significance checks."""
    return _CITATION_MARKER_RE.sub("", text or "").strip()


def _is_meaningful_sentence(text: str, min_chars: int) -> bool:
    """
    A sentence is meaningful when its marker-free payload is long enough.
    Short filler fragments do not participate in sentence-level grounding gates.
    """
    _clean = _strip_citation_markers(text).strip(" \t\n\r.,;:!?")
    return len(_clean) >= max(1, int(min_chars))


# ============================================================================
# RAG Service
# ============================================================================

class RAGService:
    """
    Orchestrates the full RAG pipeline.

    Pipeline steps:
        1. Embed query            (Step 3: semantic cache check before embedding)
        2. Retrieve documents     (Supabase hybrid_legal_search)
        3. HARD-FAIL gate  ◄────  "Kaynak yoksa cevap yok"  (Step 1)
        4. Build context block    (Step 8: ContextBuilder — token budget aware,
                                   trims docs by score to fit LLM tier window)
        5. Call LLM  ◄───────────  ONLY reached if step 3 passes
        6. Validate RAGResponse   (schema @model_validator = second Hard-Fail guard)

    The service is stateless and safe for use as a module-level singleton.
    """

    def __init__(
        self,
        cache: Optional[SemanticCache] = None,
        router: Optional[LLMTieredRouter] = None,
        guard: Optional[PromptGuard] = None,
        embedder: Optional[QueryEmbedder] = None,
        retriever: Optional[RetrieverClient] = None,
        ctx_builder: Optional[ContextBuilder] = None,
        lehe_engine: Optional[LeheKanunEngine] = None,
        rrf: Optional[RRFRetriever] = None,
        reranker: Optional[LegalReranker] = None,
        graph_expander: Optional[CitationGraphExpander] = None,
        dispatcher: Optional[ToolDispatcher] = None,
        summarizer: Optional[ContextSummarizer] = None,
        zt_builder: Optional[ZeroTrustPromptBuilder] = None,
        disc_engine: Optional[LegalDisclaimerEngine] = None,
        cost_tracker_inst: Optional[CostTracker] = None,
        audit_recorder_inst: Optional[AuditTrailRecorder] = None,
        ragas_adapter_inst: Optional[RAGASAdapter] = None,
        rewriter: Optional[QueryRewriter] = None,
        intent_classifier_inst: Optional[IntentClassifier] = None,
    ) -> None:
        self._cache: Optional[SemanticCache] = cache
        self._router: LLMTieredRouter = router or llm_router
        self._guard: PromptGuard = guard or prompt_guard
        self._embedder: QueryEmbedder = embedder or query_embedder
        self._retriever: RetrieverClient = retriever or retriever_client
        self._rrf: RRFRetriever = rrf or rrf_retriever
        self._reranker: LegalReranker = reranker or legal_reranker
        self._graph_expander: CitationGraphExpander = graph_expander or citation_graph_expander
        self._tool_dispatcher: ToolDispatcher = dispatcher or tool_dispatcher
        if summarizer is not None:
            self._summarizer: ContextSummarizer = summarizer
        else:
            # Production: LLM-backed summarisation — secondary docs are
            # summarised by the router so critical details are preserved.
            _rtr = self._router

            async def _llm_summarize_fn(prompt: str) -> str:
                _ans, _ = await _rtr.generate(prompt, "", 0)
                return _ans

            self._summarizer = ContextSummarizer(summarize_fn=_llm_summarize_fn)
        self._zt_builder: ZeroTrustPromptBuilder = zt_builder or zero_trust_builder
        self._disclaimer_engine: LegalDisclaimerEngine = disc_engine or disclaimer_engine
        self._cost_tracker: CostTracker = cost_tracker_inst or cost_tracker
        self._audit_recorder: AuditTrailRecorder = audit_recorder_inst or audit_recorder
        self._ragas_adapter: RAGASAdapter = ragas_adapter_inst or ragas_adapter
        self._ctx_builder: ContextBuilder = ctx_builder or context_builder
        self._lehe_engine: LeheKanunEngine = lehe_engine or lehe_kanun_engine
        self._rewriter: QueryRewriter = rewriter or query_rewriter
        self._intent_classifier: IntentClassifier = intent_classifier_inst or intent_classifier
        logger.info(
            "RAGService initialised — Hard-Fail: ACTIVE | cache: %s | "
            "router: %s | prompt_guard: ACTIVE | embedder: %s | retriever: ACTIVE | "
            "rrf: %s | reranker: %s | graphrag: %s | agentic_tools: %s | "
            "summarizer: %s | litm_reorder: %s | context_builder: ACTIVE | lehe_kanun: %s",
            "ENABLED" if cache else "DISABLED",
            type(self._router).__name__,
            self._embedder._model,
            "ENABLED" if settings.rrf_enabled else "DISABLED",
            "ENABLED" if settings.reranking_enabled else "DISABLED",
            "ENABLED" if settings.graphrag_enabled else "DISABLED",
            "ENABLED" if settings.agentic_tools_enabled else "DISABLED",
            "ENABLED" if settings.context_summarization_enabled else "DISABLED",
            "ENABLED" if settings.context_litm_reorder_enabled else "DISABLED",
            "ENABLED" if settings.lehe_kanun_enabled else "DISABLED",
        )

    async def query(
        self,
        request: RAGQueryRequest,
        tenant_context: Optional[TenantContext] = None,
    ) -> RAGResponse:
        """
        Main entry point for a legal RAG query.

        Args:
            request: Validated RAGQueryRequest from the API layer.

        Returns:
            RAGResponse with answer + grounding sources.

        Raises:
            HTTPException 400: Prompt injection detected in query or context.
            HTTPException 422: Hard-Fail — no sources found for the query.
            HTTPException 503: Supabase retrieval infrastructure unavailable.
        """
        start_time = time.monotonic()

        logger.info(
            "RAG query started | chat_mode=%s | ai_tier=%s | response_depth=%s | "
            "as_of_date=%s | event_date=%s | decision_date=%s | "
            "thread_id=%r | case_id=%r | max_sources=%d | query_len=%d",
            getattr(request.chat_mode, "value", request.chat_mode),
            getattr(getattr(request, "ai_tier", None), "value", getattr(request, "ai_tier", None)),
            getattr(getattr(request, "response_depth", None), "value", getattr(request, "response_depth", None)),
            getattr(request, "as_of_date", None),
            request.event_date,
            getattr(request, "decision_date", None),
            getattr(request, "thread_id", None),
            request.case_id,
            request.max_sources,
            len(request.query),
        )

        # ── 0a. Prompt injection guard — QUERY SCAN ──────────────────────────
        #        Detects jailbreak / role-override / system-prompt-leak in the
        #        user's raw query.  Runs BEFORE the cache, so no cached
        #        response is ever served for a detected injection attempt.
        #        On detection → HTTP 400, LLM never called, cost = $0.
        self._guard.check_query(request.query)

        # ── 0a.1. Konuşma geçmişini işle ve temizle (Conversation Memory) ─────
        #         İstemci önceki konuşma adımlarını gönderir. Bunları güvenlik
        #         kontrolünden geçirip LLM'e bağlamsal hafıza olarak sunarız.
        conversation_history = getattr(request, "history", []) or []
        if conversation_history:
            # Maliyet ve token kontrolü için kayan pencere (sliding window)
            max_history_turns = getattr(settings, "max_history_turns", 10)
            if len(conversation_history) > max_history_turns:
                conversation_history = conversation_history[-max_history_turns:]
                logger.info(
                    "CONVERSATION_HISTORY_TRUNCATED | turns=%d | max_turns=%d",
                    len(conversation_history),
                    max_history_turns,
                )

            logger.info("CONVERSATION_HISTORY_RECEIVED | turns=%d", len(conversation_history))
            # Güvenlik: Geçmişteki kullanıcı mesajlarını prompt injection'a karşı tara
            for message in conversation_history:
                # Pydantic model veya dict uyumlu kontrol
                if hasattr(message, "role") and message.role == "user" and hasattr(message, "content"):
                    if isinstance(message.content, str):
                        self._guard.check_query(message.content)
                elif isinstance(message, dict):
                    _role = str(message.get("role", "")).strip().lower()
                    _content = message.get("content", "")
                    if _role == "user" and isinstance(_content, str):
                        self._guard.check_query(_content)

        # ── 0b. KVKK PII detection (Step 6) ──────────────────────────────────────
        #        Detect and log PII in the user's query for compliance audit.
        #        Irreversible redaction is applied by KVKKRedactor if PII found.
        if settings.kvkk_redact_prompts and kvkk_redactor.has_pii(request.query):
            logger.info(
                "KVKK_PII_IN_QUERY | bureau=%s | query_len=%d",
                tenant_context.bureau_id if tenant_context else None,
                len(request.query),
            )

        # ── 0c. Resolve bureau_id early (needed for cache key scoping) ────────
        #        TenantContext (middleware) takes precedence;
        #        fall back to request.bureau_id (explicit client header / test fixture).
        _bureau_id = (
            tenant_context.bureau_id
            if tenant_context and tenant_context.is_isolated
            else getattr(request, "bureau_id", None)
        )

        _chat_mode_value = getattr(request.chat_mode, "value", request.chat_mode)
        _requested_tier_value, _requested_tier_label = self._requested_tier_from_request(request)
        _requested_tier_policy = settings.get_tier_policy(_requested_tier_label)
        _effective_max_sources = min(
            max(1, int(request.max_sources)),
            int(_requested_tier_policy.max_sources),
        )
        _case_id_str = str(request.case_id) if getattr(request, "case_id", None) else None
        _thread_id_str = str(getattr(request, "thread_id", None)) if getattr(request, "thread_id", None) else None
        _strict_grounding_enabled = (
            request.strict_grounding
            if request.strict_grounding is not None
            else settings.strict_grounding_default
        )
        if not settings.strict_grounding_v2:
            _strict_grounding_enabled = False
        self._enforce_tier_access_policy(
            requested_tier_label=_requested_tier_label,
            requested_tier_value=_requested_tier_value,
            tier_policy=_requested_tier_policy,
            tenant_context=tenant_context,
        )

        if _effective_max_sources != int(request.max_sources):
            logger.info(
                "TIER_MAX_SOURCES_CAP | requested=%d | effective=%d | tier=%s",
                int(request.max_sources),
                _effective_max_sources,
                _requested_tier_label,
            )

        # Step 11: classifier runs before router/rewrite/retrieval.
        _intent_decision = self._intent_classifier.classify(
            query=request.query,
            chat_mode=str(_chat_mode_value),
        )
        _intent_class = _intent_decision.intent_class.value
        logger.info(
            "INTENT_CLASSIFIED | intent=%s | reason=%s | chat_mode=%s",
            _intent_class,
            _intent_decision.reason,
            _chat_mode_value,
        )
        _subtask_models: List[str] = ["intent_classifier/local-rules"]

        if _intent_decision.is_social_simple:
            social_answer = self._build_social_answer(request.query)
            latency_ms = int((time.monotonic() - start_time) * 1000)
            _temporal_fields = TemporalFieldsSchema(
                as_of_date=getattr(request, "as_of_date", None),
                event_date=getattr(request, "event_date", None),
                decision_date=getattr(request, "decision_date", None),
            )

            _audit_schema: Optional[AuditTrailSchema] = None
            if settings.audit_trail_enabled:
                _audit_entry = self._audit_recorder.record(
                    query=request.query,
                    bureau_id=_bureau_id,
                    tier=_requested_tier_value,
                    tier_reason="intent_classifier.social_simple",
                    model_used="social/local-template",
                    final_model="social/local-template",
                    final_generation_tier=_requested_tier_value,
                    subtask_models=list(_subtask_models),
                    source_docs=[],
                    tool_calls=[],
                    tool_errors=[],
                    requested_tier=_requested_tier_label,
                    final_tier=_requested_tier_value,
                    response_type=ResponseType.SOCIAL_UNGROUNDED.value,
                    source_count=0,
                    case_id=_case_id_str,
                    thread_id=_thread_id_str,
                    intent_class=_intent_class,
                    strict_grounding=False,
                    grounding_ratio=0.0,
                    disclaimer_severity="INFO",
                    latency_ms=latency_ms,
                    cost_estimate_usd=0.0,
                    temporal_fields=_temporal_fields.model_dump(mode="json", exclude_none=True),
                    tenant_context={
                        "bureau_id": _bureau_id,
                        "user_id": tenant_context.user_id if tenant_context else None,
                        "is_isolated": (
                            bool(tenant_context.is_isolated)
                            if tenant_context is not None
                            else False
                        ),
                        "is_service_account": (
                            bool(tenant_context.is_service_account)
                            if tenant_context is not None
                            else False
                        ),
                    },
                )
                _audit_schema = AuditTrailSchema(
                    request_id=_audit_entry.request_id,
                    timestamp_utc=_audit_entry.timestamp_utc,
                    query_hash=_audit_entry.query_hash,
                    bureau_id=_audit_entry.bureau_id,
                    requested_tier=_audit_entry.requested_tier,
                    final_tier=_audit_entry.final_tier,
                    final_generation_tier=_audit_entry.final_generation_tier,
                    tier=_audit_entry.tier,
                    final_model=_audit_entry.final_model,
                    model_used=_audit_entry.model_used,
                    subtask_models=list(_audit_entry.subtask_models),
                    response_type=_audit_entry.response_type,
                    source_count=_audit_entry.source_count,
                    case_id=_audit_entry.case_id,
                    thread_id=_audit_entry.thread_id,
                    intent_class=_audit_entry.intent_class,
                    strict_grounding=_audit_entry.strict_grounding,
                    tool_calls_made=[],
                    tool_errors=[],
                    docs_summarized_count=0,
                    tokens_saved=0,
                    litm_applied=False,
                    grounding_ratio=0.0,
                    disclaimer_severity="INFO",
                    latency_ms=latency_ms,
                    cost_estimate=None,
                    ragas_metrics=None,
                    temporal_fields=_temporal_fields,
                    tenant_context=_audit_entry.tenant_context,
                    why_this_answer=_audit_entry.why_this_answer,
                    audit_signature=_audit_entry.audit_signature,
                )

            return RAGResponse(
                response_type=ResponseType.SOCIAL_UNGROUNDED,
                answer=social_answer,
                tier_used=_requested_tier_value,
                sources=[],
                query=request.query,
                model_used="social/local-template",
                grounding_ratio=0.0,
                citation_quality_summary="Sosyal sohbet: kaynak kullanilmadi.",
                estimated_cost=0.0,
                audit_trail_id=(
                    _audit_schema.request_id
                    if _audit_schema is not None
                    else f"social-no-audit-{int(time.time() * 1000)}"
                ),
                retrieval_count=0,
                latency_ms=latency_ms,
                aym_warnings=[],
                lehe_kanun_notice=None,
                answer_sentences=[],
                inline_citations=[],
                legal_disclaimer=None,
                temporal_fields=_temporal_fields,
                audit_trail=_audit_schema,
            )

        _tier1_direct_llm = (
            _requested_tier_value == 1
            and not _strict_grounding_enabled
            and str(_chat_mode_value) == APIChatMode.GENERAL_CHAT.value
            and request.case_id is None
            and getattr(request, "as_of_date", None) is None
            and getattr(request, "event_date", None) is None
            and getattr(request, "decision_date", None) is None
            and not list(getattr(request, "active_document_ids", []) or [])
        )
        if _tier1_direct_llm:
            logger.info(
                "DIRECT_LLM_TIER1_BYPASS | intent=%s | chat_mode=%s | case_id=None | retrieval=SKIPPED",
                _intent_class,
                _chat_mode_value,
            )
            self._enforce_cost_precheck(
                query=request.query,
                context="",
                source_count=0,
                requested_tier_value=_requested_tier_value,
                requested_tier_label=_requested_tier_label,
                requested_tier_policy=_requested_tier_policy,
            )
            _subtask_models.append("tier1_direct_llm/no_retrieval")
            answer, model_used, _final_generation_tier = await self._call_llm(
                query=request.query,
                context="",
                source_count=0,
                history=conversation_history,
                requested_tier=_requested_tier_value,
            )

            latency_ms = int((time.monotonic() - start_time) * 1000)
            _temporal_fields = TemporalFieldsSchema(
                as_of_date=getattr(request, "as_of_date", None),
                event_date=getattr(request, "event_date", None),
                decision_date=getattr(request, "decision_date", None),
            )
            _cost_est = (
                self._cost_tracker.estimate(
                    model_id=model_used,
                    tier=_final_generation_tier,
                    query=request.query,
                    context="",
                    answer=answer,
                    cached=False,
                )
                if settings.cost_tracking_enabled
                else None
            )

            _audit_schema: Optional[AuditTrailSchema] = None
            if settings.audit_trail_enabled:
                _audit_entry = self._audit_recorder.record(
                    query=request.query,
                    bureau_id=_bureau_id,
                    tier=_final_generation_tier,
                    tier_reason="tier1_direct_llm_bypass",
                    model_used=model_used,
                    final_model=model_used,
                    final_generation_tier=_final_generation_tier,
                    subtask_models=list(_subtask_models),
                    source_docs=[],
                    tool_calls=[],
                    tool_errors=[],
                    requested_tier=_requested_tier_label,
                    final_tier=_final_generation_tier,
                    response_type=ResponseType.SOCIAL_UNGROUNDED.value,
                    source_count=0,
                    case_id=_case_id_str,
                    thread_id=_thread_id_str,
                    intent_class=_intent_class,
                    strict_grounding=False,
                    grounding_ratio=0.0,
                    disclaimer_severity="INFO",
                    latency_ms=latency_ms,
                    cost_estimate_usd=_cost_est.total_cost_usd if _cost_est else 0.0,
                    temporal_fields=_temporal_fields.model_dump(mode="json", exclude_none=True),
                    tenant_context={
                        "bureau_id": _bureau_id,
                        "user_id": tenant_context.user_id if tenant_context else None,
                        "is_isolated": (
                            bool(tenant_context.is_isolated)
                            if tenant_context is not None
                            else False
                        ),
                        "is_service_account": (
                            bool(tenant_context.is_service_account)
                            if tenant_context is not None
                            else False
                        ),
                    },
                )
                _audit_schema = AuditTrailSchema(
                    request_id=_audit_entry.request_id,
                    timestamp_utc=_audit_entry.timestamp_utc,
                    query_hash=_audit_entry.query_hash,
                    bureau_id=_audit_entry.bureau_id,
                    requested_tier=_audit_entry.requested_tier,
                    final_tier=_audit_entry.final_tier,
                    final_generation_tier=_audit_entry.final_generation_tier,
                    tier=_audit_entry.tier,
                    final_model=_audit_entry.final_model,
                    model_used=_audit_entry.model_used,
                    subtask_models=list(_audit_entry.subtask_models),
                    response_type=_audit_entry.response_type,
                    source_count=_audit_entry.source_count,
                    case_id=_audit_entry.case_id,
                    thread_id=_audit_entry.thread_id,
                    intent_class=_audit_entry.intent_class,
                    strict_grounding=_audit_entry.strict_grounding,
                    tool_calls_made=[],
                    tool_errors=[],
                    docs_summarized_count=0,
                    tokens_saved=0,
                    litm_applied=False,
                    grounding_ratio=0.0,
                    disclaimer_severity="INFO",
                    latency_ms=latency_ms,
                    cost_estimate=CostEstimateSchema(
                        input_tokens=_cost_est.input_tokens,
                        output_tokens=_cost_est.output_tokens,
                        total_cost_usd=_cost_est.total_cost_usd,
                        model_id=_cost_est.model_id,
                        tier=_cost_est.tier,
                        cached=_cost_est.cached,
                        rate_per_1m_in=_cost_est.rate_per_1m_in,
                        rate_per_1m_out=_cost_est.rate_per_1m_out,
                    ) if _cost_est else None,
                    ragas_metrics=None,
                    temporal_fields=_temporal_fields,
                    tenant_context=_audit_entry.tenant_context,
                    why_this_answer=_audit_entry.why_this_answer,
                    audit_signature=_audit_entry.audit_signature,
                )

            return RAGResponse(
                response_type=ResponseType.SOCIAL_UNGROUNDED,
                answer=answer,
                tier_used=_final_generation_tier,
                sources=[],
                query=request.query,
                model_used=model_used,
                grounding_ratio=0.0,
                citation_quality_summary="Hazir Cevap modu: dogrudan LLM (RAG devre disi).",
                estimated_cost=(
                    float(_cost_est.total_cost_usd)
                    if _cost_est is not None
                    else 0.0
                ),
                audit_trail_id=(
                    _audit_schema.request_id
                    if _audit_schema is not None
                    else f"tier1-direct-{int(time.time() * 1000)}"
                ),
                retrieval_count=0,
                latency_ms=latency_ms,
                aym_warnings=[],
                lehe_kanun_notice=None,
                answer_sentences=[],
                inline_citations=[],
                legal_disclaimer=None,
                temporal_fields=_temporal_fields,
                audit_trail=_audit_schema,
            )

        # ── 0d. Semantic cache — L1 exact match (BEFORE embedding) ─────────────
        #       Cheapest possible path: 1 Redis GET.  If hit, cost = $0.
        if self._cache and settings.semantic_cache_enabled:
            l1_hit = await self._cache.l1_lookup(
                request.query, request.case_id, bureau_id=_bureau_id
            )
            if l1_hit:
                logger.info(
                    "CACHE_HIT L1 — embed+retrieve+LLM skipped | cost=$0 | "
                    "query_len=%d",
                    len(request.query),
                )
                return RAGResponse.model_validate(l1_hit)

        # ── 0d. Query Rewriting (Step 9) ─────────────────────────────────────
        #        Tier 2+ sorgularını gündelik Türkçe'den formal hukuki
        #        terminolojiye dönüştürür.  Retrieval için kullanılır;
        #        audit trail, LLM prompt ve kullanıcı cevabı her zaman
        #        ORIGINAL sorguyu görür.
        #        Tier 1 veya query_rewrite_enabled=False → pass-through.
        _prelim_tier = classify_query_tier(request.query, "", 0)
        _rewrite_eligible = (
            settings.query_rewrite_enabled
            and _prelim_tier.value >= settings.query_rewrite_min_tier
        )
        if _rewrite_eligible:
            if settings.openai_api_key:
                _subtask_models.append(
                    f"query_rewriter/openai/{settings.query_rewrite_model}"
                )
            else:
                _subtask_models.append("query_rewriter/pass-through")
            _search_query: str = await self._rewriter.rewrite(
                request.query,
                _prelim_tier.value,
            )
        else:
            _search_query = request.query

        # ── 1. Embed the query ───────────────────────────────────────────────
        try:
            query_embedding = await self._embed_query(_search_query)
        except HTTPException as exc:
            if not self._should_fail_open_embedding(
                requested_tier_value=_requested_tier_value,
                exc=exc,
            ):
                raise
            error_code = self._extract_http_error_code(exc) or str(exc.detail)
            query_embedding = self._zero_embedding_vector()
            _subtask_models.append("embedder/fail-open-zero-vector")
            logger.warning(
                "EMBED_FAIL_OPEN_ACTIVE | tier=%s | status=%s | error=%s | dims=%d",
                _requested_tier_label,
                exc.status_code,
                error_code,
                len(query_embedding),
            )

        # ── 1b. Semantic cache — L2 cosine match (AFTER embedding) ───────────
        #        If hit, retrieval + LLM are skipped.  Cost = $0.
        if self._cache and settings.semantic_cache_enabled:
            l2_hit, similarity = await self._cache.l2_lookup(
                query_embedding, request.case_id, bureau_id=_bureau_id
            )
            if l2_hit:
                logger.info(
                    "CACHE_HIT L2 — retrieve+LLM skipped | similarity=%.4f | "
                    "cost=$0 | query_len=%d",
                    similarity,
                    len(request.query),
                )
                return RAGResponse.model_validate(l2_hit)

        # ── 2. Retrieve documents ────────────────────────────────────────────
        # ── 2a. Lehe Kanun check (Step 10) ──────────────────────────────────────
        #        When event_date + decision_date are both present and the query
        #        is in the criminal / penalty domain, retrieve BOTH law versions.
        # Step 4 (Temporal Law): when event_date is absent, as_of_date is used
        # as the retrieval anchor for non-lehe queries.
        _effective_event_date = request.event_date or getattr(request, "as_of_date", None)

        lehe_result = None
        lehe_notice: Optional[LeheKanunNoticeSchema] = None
        _source_origin_map: dict[str, str] = {}
        _injection_flags_map: dict[str, bool] = {}
        _injection_notes_map: dict[str, list[str]] = {}
        _injection_doc_count: int = 0

        if (
            settings.lehe_kanun_enabled
            and _effective_event_date is not None
            and getattr(request, "decision_date", None) is not None
        ):
            lehe_result = self._lehe_engine.check(
                query_text=request.query,
                event_date=_effective_event_date,
                decision_date=request.decision_date,  # type: ignore[arg-type]
            )
            logger.info(
                "LEHE_CHECK | domain=%s | applicable=%s | event=%s | decision=%s",
                lehe_result.law_domain.value,
                lehe_result.lehe_applicable,
                lehe_result.event_date,
                lehe_result.decision_date,
            )

        if lehe_result and lehe_result.both_versions_needed:
            # Two-version retrieval — fetch event_date version AND decision_date version
            event_docs, decision_docs = await self._retriever.lehe_kanun_search(
                embedding=query_embedding,
                query_text=_search_query,
                case_id=request.case_id,
                max_sources=_effective_max_sources,
                min_score=request.min_score,
                event_date=lehe_result.event_date,
                decision_date=lehe_result.decision_date,
                bureau_id=_bureau_id,
            )
            # Tag each doc with its version_type (stored in a side dict; entity is frozen)
            event_ids = {d.id for d in event_docs}
            decision_ids = {d.id for d in decision_docs}

            # Deduplicate if enabled: docs in both sets appear only in event_docs
            if settings.lehe_kanun_deduplicate:
                decision_docs = [d for d in decision_docs if d.id not in event_ids]

            retrieved_docs = event_docs + decision_docs
            _source_origin_map = {
                d.id: ("legal_corpus" if d.bureau_id is None else "case_doc")
                for d in retrieved_docs
            }

            # Build version_type map for source schema tagging
            version_type_map: dict[str, str] = {
                d.id: "EVENT_DATE" for d in event_docs
            }
            version_type_map.update(
                {d.id: "DECISION_DATE" for d in decision_docs}
            )

            lehe_notice = LeheKanunNoticeSchema(
                law_domain=lehe_result.law_domain.value,
                event_date=lehe_result.event_date,
                decision_date=lehe_result.decision_date,
                event_doc_count=len(event_docs),
                decision_doc_count=len(decision_docs),
                reason=lehe_result.reason,
                legal_basis=lehe_result.legal_basis,
            )
        else:
            # Standard single-version retrieval (Step 11: via RRFRetriever when enabled)
            # When settings.rrf_enabled=True  -> hibrit RRF fuzyon (vektor + BM25)
            # When settings.rrf_enabled=False -> dogrudan RetrieverClient.search()
            _query_domain = detect_query_domain(request.query)  # Step 12: Gap 2
            _is_document_analysis = (
                str(getattr(request.chat_mode, "value", request.chat_mode))
                == APIChatMode.DOCUMENT_ANALYSIS.value
            )
            if _is_document_analysis:
                _active_doc_ids = list(getattr(request, "active_document_ids", []) or [])
                case_docs: List[LegalDocument] = []
                uploaded_docs: List[LegalDocument] = []
                legal_docs: List[LegalDocument] = []

                if request.case_id is not None:
                    case_rrf = await self._rrf.search(
                        embedding=query_embedding,
                        query_text=_search_query,
                        case_id=request.case_id,
                        max_sources=_effective_max_sources,
                        min_score=request.min_score,
                        event_date=_effective_event_date,
                        bureau_id=_bureau_id,
                        law_domain=_query_domain,
                        global_legal_only=False,
                    )
                    case_docs = case_rrf.documents

                if _active_doc_ids:
                    uploaded_docs = await self._retriever.search_uploaded_documents(
                        query_text=_search_query,
                        document_ids=_active_doc_ids,
                        max_sources=_effective_max_sources,
                        bureau_id=_bureau_id,
                    )

                legal_rrf = await self._rrf.search(
                    embedding=query_embedding,
                    query_text=_search_query,
                    case_id=None,
                    max_sources=_effective_max_sources,
                    min_score=request.min_score,
                    event_date=_effective_event_date,
                    bureau_id=_bureau_id,
                    law_domain=_query_domain,
                    global_legal_only=True,
                )
                legal_docs = legal_rrf.documents

                retrieved_docs, _ = self._rrf.fuse_ranked_lists(
                    ranked_lists=[case_docs, uploaded_docs, legal_docs],
                    max_sources=_effective_max_sources,
                    min_score=request.min_score,
                    law_domain=_query_domain,
                )

                # Origin precedence: uploaded_doc > case_doc > legal_corpus
                _source_origin_map = {doc.id: "legal_corpus" for doc in legal_docs}
                _source_origin_map.update({doc.id: "case_doc" for doc in case_docs})
                _source_origin_map.update({doc.id: "uploaded_doc" for doc in uploaded_docs})

                logger.info(
                    "DOCUMENT_ANALYSIS_FUSED_RETRIEVAL | case_docs=%d | uploaded_docs=%d | legal_docs=%d | fused=%d",
                    len(case_docs),
                    len(uploaded_docs),
                    len(legal_docs),
                    len(retrieved_docs),
                )
            else:
                _global_legal_only = bool(
                    _intent_decision.is_legal
                    and request.case_id is None
                )
                if _global_legal_only:
                    logger.info(
                        "GLOBAL_LEGAL_RETRIEVAL_ENFORCED | intent=%s | chat_mode=%s | case_id=None",
                        _intent_class,
                        _chat_mode_value,
                    )
                rrf_result = await self._rrf.search(
                    embedding=query_embedding,
                    query_text=_search_query,
                    case_id=request.case_id,
                    max_sources=_effective_max_sources,
                    min_score=request.min_score,
                    event_date=_effective_event_date,  # Step 4: time-travel
                    bureau_id=_bureau_id,            # Step 6: tenant isolation
                    law_domain=_query_domain,        # Step 12: Gap 2 - domain-aware RRF k
                    global_legal_only=_global_legal_only,  # Step 13: belgesiz legal => global corpus
                )
                retrieved_docs = rrf_result.documents

                # Step 30: If global corpus is empty for this tenant, retry once on
                # tenant-scoped corpus instead of hard-failing immediately.
                if _global_legal_only and not retrieved_docs and _bureau_id:
                    logger.warning(
                        "GLOBAL_LEGAL_EMPTY_BUREAU_FALLBACK | bureau=%s | intent=%s | chat_mode=%s",
                        _bureau_id,
                        _intent_class,
                        _chat_mode_value,
                    )
                    fallback_rrf = await self._rrf.search(
                        embedding=query_embedding,
                        query_text=_search_query,
                        case_id=None,
                        max_sources=_effective_max_sources,
                        min_score=request.min_score,
                        event_date=_effective_event_date,
                        bureau_id=_bureau_id,
                        law_domain=_query_domain,
                        global_legal_only=False,
                    )
                    retrieved_docs = fallback_rrf.documents
                    logger.info(
                        "GLOBAL_LEGAL_BUREAU_FALLBACK_RESULT | docs=%d",
                        len(retrieved_docs),
                    )

                _source_origin_map = {
                    d.id: ("legal_corpus" if d.bureau_id is None else "case_doc")
                    for d in retrieved_docs
                }

            version_type_map = {}  # no version tagging in standard mode

        if _intent_decision.is_legal and request.case_id is None and retrieved_docs:
            _source_type_dist: dict[str, int] = {}
            for _doc in retrieved_docs:
                _stype = infer_source_type(_doc)
                _source_type_dist[_stype] = _source_type_dist.get(_stype, 0) + 1
            logger.info(
                "GLOBAL_LEGAL_RETRIEVAL_RESULT | docs=%d | source_type_dist=%s",
                len(retrieved_docs),
                _source_type_dist,
            )

        # Step 12: Gap 3 — init conflict map; populated below if reranking runs
        _conflict_notes_map: dict[str, list[str]] = {}
        tier_decision = self._router.decide(
            request.query,
            "",
            len(retrieved_docs),
            requested_tier=_requested_tier_value,
        )
        _rerank_depth = min(
            len(retrieved_docs),
            self._tier_rerank_depth(tier_decision.tier),
        )
        _context_budget = self._tier_context_budget(tier_decision.tier)

        if (
            retrieved_docs
            and bool(getattr(settings, "parent_child_retrieval_enabled", False))
            and hasattr(self._retriever, "fetch_parent_segments_for_children")
        ):
            try:
                _parent_limit = self._tier_parent_child_budget(tier_decision.tier)
                if _parent_limit > 0:
                    _parent_docs = await self._retriever.fetch_parent_segments_for_children(  # type: ignore[attr-defined]
                        docs=retrieved_docs[:_rerank_depth],
                        max_parents=_parent_limit,
                        bureau_id=_bureau_id,
                    )
                    if _parent_docs:
                        _existing_ids = {d.id for d in retrieved_docs}
                        _new_parents = [d for d in _parent_docs if d.id not in _existing_ids]
                        if _new_parents:
                            retrieved_docs = _new_parents + retrieved_docs
                            for _pd in _new_parents:
                                _source_origin_map.setdefault(
                                    _pd.id,
                                    "legal_corpus" if _pd.bureau_id is None else "case_doc",
                                )
                            logger.info(
                                "PARENT_CHILD_EXPANSION | tier=%s | added_parents=%d | total_docs=%d",
                                tier_decision.tier.name,
                                len(_new_parents),
                                len(retrieved_docs),
                            )
            except Exception as exc:
                logger.warning("PARENT_CHILD_EXPANSION_FAILED (non-fatal): %s", exc)

        if retrieved_docs and _rerank_depth > 0:
            _rerank_head = retrieved_docs[:_rerank_depth]
            _rerank_tail = retrieved_docs[_rerank_depth:]
            rerank_results = self._reranker.rerank(
                _rerank_head,
                request.query,
                bureau_id=_bureau_id,
                case_id=request.case_id,
            )
            retrieved_docs = [r.document for r in rerank_results] + _rerank_tail
            _conflict_notes_map = {
                r.document.id: r.conflict_notes for r in rerank_results
            }
            logger.info(
                "RERANK_DEPTH_APPLIED | tier=%s | rerank_depth=%d | total_docs=%d",
                tier_decision.tier.name,
                _rerank_depth,
                len(retrieved_docs),
            )

        # Step 16: document text is evidence; sanitize instruction-like payloads.
        if retrieved_docs and bool(getattr(settings, "sanitize_doc_injection_enabled", True)):
            for _doc in retrieved_docs:
                _san = self._guard.sanitize_document_text(_doc.content)
                _flag = getattr(_san, "injection_flag", False)
                if not isinstance(_flag, bool) or not _flag:
                    continue
                _sanitized_text = getattr(_san, "sanitized_text", _doc.content)
                _patterns = list(getattr(_san, "matched_patterns", []) or [])
                _doc.content = _sanitized_text
                _doc.injection_flag = True
                _doc.injection_notes = _patterns
                _injection_flags_map[_doc.id] = True
                _injection_notes_map[_doc.id] = _patterns
                _injection_doc_count += 1

            if _injection_doc_count > 0:
                logger.warning(
                    "DOCUMENT_SANITIZATION_APPLIED | docs_flagged=%d | total_docs=%d",
                    _injection_doc_count,
                    len(retrieved_docs),
                )

        # ── 3. HARD-FAIL GATE ────────────────────────────────────────────────
        #       "Kaynak yoksa cevap yok"
        #
        #       The LLM is NOT called beyond this point if no documents were
        #       found.  Cost for this request path = $0.
        # ────────────────────────────────────────────────────────────────────
        if not retrieved_docs:
            logger.warning(
                "HARD_FAIL triggered | intent=%s | query=%r | case_id=%r | "
                "llm_called=False | cost=$0",
                _intent_class,
                request.query[:80],
                request.case_id,
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=NoSourceErrorDetail(
                    query=request.query,
                    intent_class=_intent_class,
                    strict_grounding=bool(_strict_grounding_enabled),
                    llm_called=False,
                ).model_dump(),
            )

        logger.info(
            "Retrieval successful | docs=%d | top_score=%.3f",
            len(retrieved_docs),
            retrieved_docs[0].final_score,
        )

        # ── 4. Context builder  (Step 8) ─────────────────────────────────────
        #       Classify the LLM tier from query keywords + source count
        #       (context="" avoids circular dependency — we don't know the
        #       context size until we build it).  Then trim retrieved_docs to
        #       the tier's token budget, highest-score-first.
        # ── 4a. GraphRAG Citation Chain Expansion (Step 13) ──────────────────
        #        Tier 3/4 sorgularında atıf grafı BFS ile genişletilir.
        #        Maksimum 2 derece derinlik, 15 düğüm sınırıyla token
        #        maliyeti kontrol altında tutulur.
        #        graphrag_enabled=False veya Tier 1/2 → geçilir (pass-through).
        if settings.graphrag_enabled and tier_decision.tier.value >= settings.graphrag_min_tier:

            async def _citation_fetcher(ref: str) -> Optional[LegalDocument]:
                """RRF retriever üzerinden atıf çözümleme kapatması."""
                try:
                    # Step 13 Gap 4: atıf metnini ayrıca vektörize et
                    # (orijinal sorgu vektörü değil, ref metni semantik araması için)
                    ref_embedding = await self._embedder.embed_query(ref)
                    rrf_result = await self._rrf.search(
                        embedding=ref_embedding,
                        query_text=ref,
                        case_id=request.case_id,
                        max_sources=1,
                        min_score=0.5,
                        event_date=None,
                        bureau_id=_bureau_id,
                    )
                    return rrf_result.documents[0] if rrf_result.documents else None
                except Exception as exc:
                    logger.warning(
                        "GRAPHRAG_FETCHER_ERROR | ref=%r | err=%s",
                        ref[:40],
                        exc,
                    )
                    return None

            graph_result = await self._graph_expander.expand(
                root_docs=retrieved_docs,
                tier=tier_decision.tier,
                fetcher=_citation_fetcher,
            )
            if graph_result.expansion_count > 0:
                logger.info(
                    "GRAPHRAG | expanded=%d | total=%d | depth=%d | cycle=%s",
                    graph_result.expansion_count,
                    len(graph_result.all_docs),
                    graph_result.total_depth_reached,
                    graph_result.cycle_detected,
                )
            retrieved_docs = graph_result.all_docs

            # Step 13 Gap 5: BFS sırasında çıkarılan kenarları citation_edges'e kaydet
            # Best-effort: hata main pipeline'ı çökertmez
            if graph_result.edges:
                try:
                    from collections import defaultdict
                    from uuid import UUID as _UUID
                    from infrastructure.ingest.citation_extractor import ExtractedCitation as _EC
                    from infrastructure.database.supabase_citation_repository import (
                        supabase_citation_repository as _cit_repo,
                    )  # noqa: PLC0415
                    _edges_by_source: dict = defaultdict(list)
                    for _edge in graph_result.edges:
                        _edges_by_source[_edge.source_id].append(_edge)
                    for _src_id, _src_edges in _edges_by_source.items():
                        _cits = [
                            _EC(raw_text=e.raw_text, citation_type=e.citation_type)
                            for e in _src_edges
                        ]
                        await _cit_repo.save_citations(
                            source_doc_id=_UUID(_src_id),
                            citations=_cits,
                            bureau_id=_UUID(_bureau_id) if _bureau_id else None,
                        )
                    logger.debug(
                        "GRAPHRAG_EDGES_PERSISTED | sources=%d | total_edges=%d",
                        len(_edges_by_source),
                        len(graph_result.edges),
                    )
                except Exception as _exc:
                    logger.warning("GRAPHRAG_EDGE_PERSIST_FAILED (non-fatal): %s", _exc)
        _docs_summarized_count: int = 0  # Step 15: set inside summarisation block
        _tokens_saved: int = 0            # Step 15: approximate tokens saved        # ── 4a. Context Summarisation — Secondary Docs (Step 15) ─────────────
        #        Tier 4 (MUAZZAM) sorgularında düşük-öncelikli belgeler özetlenerek
        #        daha fazla kaynak bağlam penceresine sığdırılır.  Birincil
        #        belgeler (top-N) tam içerikle, ikincil belgeler özetlenmiş
        #        olarak bağlama dahil edilir.
        if (
            settings.context_summarization_enabled
            and tier_decision.tier.value >= settings.context_summarization_min_tier
            and len(retrieved_docs) > settings.context_summarization_primary_count
        ):
            _primary_docs = retrieved_docs[: settings.context_summarization_primary_count]
            _secondary_docs = retrieved_docs[settings.context_summarization_primary_count :]
            _summary_results = await self._summarizer.summarize_batch(
                _secondary_docs,
                target_tokens=settings.context_summary_target_tokens,
                query_context=request.query,
            )
            _summarized_docs = [r.document for r in _summary_results]
            retrieved_docs = _primary_docs + _summarized_docs
            _docs_summarized_count = sum(1 for r in _summary_results if r.was_summarized)
            _tokens_saved = sum(
                r.original_tokens - r.summary_tokens
                for r in _summary_results
                if r.was_summarized
            )
            if _docs_summarized_count > 0:
                _subtask_models.append("context_summarizer/router:auto")
            logger.info(
                "CONTEXT_SUMMARIZE | tier=%s | primary=%d | secondary=%d | "
                "summarized=%d | target_tokens=%d",
                tier_decision.tier.name,
                len(_primary_docs),
                len(_secondary_docs),
                sum(1 for r in _summary_results if r.was_summarized),
                settings.context_summary_target_tokens,
            )

        ctx_result = self._ctx_builder.build(
            retrieved_docs,
            _context_budget,
            apply_litm_reorder=settings.context_litm_reorder_enabled,
        )
        context = ctx_result.context_str
        used_docs = ctx_result.used_docs
        _litm_applied: bool = ctx_result.litm_applied

        # ── 4b. Agentic Tool Dispatch (Step 14) ──────────────────────────────
        #        Tier 3/4 sorgularında sorgu metni zamanaşımı/süre hesabı
        #        anahtar kelimelerine göre taranır; deterministik sonuçlar
        #        LLM bağlamının başına eklenerek halüsinasyon önlenir.
        dispatch_result = self._tool_dispatcher.dispatch(
            query_text=request.query,
            tier=tier_decision.tier,
            start_date=_effective_event_date,
            seniority_years=request.seniority_years,
        )

        if ctx_result.truncated or ctx_result.dropped_count:
            logger.info(
                "Context budget applied | tier=%s | budget=%d | "
                "included=%d/%d | truncated=%s | tokens=%d",
                tier_decision.tier,
                _context_budget,
                len(used_docs),
                len(retrieved_docs),
                ctx_result.truncated,
                ctx_result.total_tokens,
            )

        # ── 5a. Zero-Trust Numbered Context (Step 16) ──────────────────────────
        #        Each document is prefixed [K:N] so the LLM cites by number.
        #        Tool dispatch deterministic block (Step 14) is prepended as an
        #        unnumbered preamble so it doesn't corrupt [K:N] numbering.
        _zt_citations = [
            doc.citation or f"Kaynak {i + 1}" for i, doc in enumerate(used_docs)
        ]
        _zt_contents = [doc.content for doc in used_docs]
        numbered_context = self._zt_builder.build_context(_zt_citations, _zt_contents)
        if dispatch_result.was_triggered:
            numbered_context = dispatch_result.context_block + "\n\n" + numbered_context
            logger.info(
                "TOOL_DISPATCH | tools=%s | context_prepended=True",
                dispatch_result.tools_invoked,
            )

        # ── 4b. Prompt injection guard — CONTEXT SCAN ─────────────────────
        #        Detects poisoned document content: injected [INST], SYSTEM:
        #        headers, or override directives inside retrieved legal docs.
        #        On detection → HTTP 400, LLM never called, cost = $0.
        self._guard.check_context(numbered_context)

        # Cost preflight gate (before LLM call).
        self._enforce_cost_precheck(
            query=request.query,
            context=numbered_context,
            source_count=len(used_docs),
            requested_tier_value=_requested_tier_value,
            requested_tier_label=_requested_tier_label,
            requested_tier_policy=_requested_tier_policy,
        )

        # ── 5. Call LLM ──────────────────────────────────────────────────────
        #       Only reached after BOTH Hard-Fail gate AND context guard pass.
        #       source_count = len(used_docs) (budget-trimmed list).
        answer, model_used, _final_generation_tier = await self._call_llm(
            request.query,
            numbered_context,
            len(used_docs),
            history=conversation_history,
            requested_tier=_requested_tier_value,
        )
        # ── 5b. Zero-Trust Citation Parsing (Step 16) ──────────────────────────
        #        Parse [K:N] markers in the LLM answer; build per-sentence
        #        citation map and validate grounding coverage.
        _zt_sentences, _zt_invalid = self._zt_builder.parse(answer, len(used_docs))
        _zt_report = self._zt_builder.validate(
            _zt_sentences, len(used_docs), _zt_invalid
        )
        if not _zt_report.is_fully_grounded:
            logger.warning(
                "ZERO_TRUST_PARTIAL | grounded=%d/%d | ratio=%.2f | "
                "invalid_refs=%s",
                _zt_report.grounded_sentences,
                _zt_report.total_sentences,
                _zt_report.grounding_ratio,
                _zt_invalid,
            )

        # ── 5c. Post-LLM Grounding Hard-Fail Gate (Hukuki Güvenlik Sözleşmesi) ──
        #        If grounding_ratio is below the configured threshold the LLM
        #        answer is discarded and replaced with _SAFE_REFUSAL text so
        #        no hallucinated claim ever reaches the user ("kaynak yoksa cevap yok").
        #        answer_sentences + inline_citations are ALSO cleared atomically
        #        so the client never receives hallucinated sentence-level data.
        # ── Step 3 (Plan): Resolve strict_grounding policy ────────────────
        #    Per-request override > config default.
        #    strict=True  → strict_grounding_min_ratio (hukuki kaynak zorunlu)
        #    strict=False → relaxed_grounding_min_ratio (sosyal/kaynaksız sohbet)
        _strict = _strict_grounding_enabled
        _meaningful_min_chars = settings.sentence_grounding_min_chars
        _ungrounded_meaningful = [
            s
            for s in _zt_sentences
            if (not s.source_refs) and _is_meaningful_sentence(s.text, _meaningful_min_chars)
        ]
        _forced_sentence_refusal = False
        _policy = (settings.ungrounded_sentence_policy or "safe_refusal").strip().lower()

        if (
            settings.strict_grounding_v2
            and settings.sentence_level_grounding_enforcement
            and _ungrounded_meaningful
        ):
            logger.warning(
                "SENTENCE_GROUNDING_GAP | ungrounded_meaningful=%d | strict=%s | policy=%s",
                len(_ungrounded_meaningful),
                _strict,
                _policy,
            )

            if _strict:
                _forced_sentence_refusal = True
            elif _policy == "drop_ungrounded":
                _filtered_sentences = [
                    s
                    for s in _zt_sentences
                    if s.source_refs or not _is_meaningful_sentence(s.text, _meaningful_min_chars)
                ]
                if any(s.source_refs for s in _filtered_sentences):
                    _zt_sentences = _filtered_sentences
                    answer = " ".join(s.text for s in _zt_sentences).strip()
                    _zt_report = self._zt_builder.validate(
                        _zt_sentences,
                        len(used_docs),
                        _zt_invalid,
                    )
                else:
                    _forced_sentence_refusal = True
            elif _policy == "safe_refusal":
                logger.info(
                    "SENTENCE_GROUNDING_RELAXED_SKIP | ungrounded_meaningful=%d",
                    len(_ungrounded_meaningful),
                )
            else:
                logger.warning(
                    "UNKNOWN_SENTENCE_POLICY | value=%s | fallback=relaxed_noop",
                    _policy,
                )

        _final_tier_policy = settings.get_tier_policy(_final_generation_tier)
        _base_threshold = (
            settings.zero_trust_min_grounding_ratio
            if settings.strict_grounding_v2
            else 0.0
        )
        _tier_strict_threshold = float(
            getattr(_final_tier_policy, "strict_grounding_min_ratio", settings.strict_grounding_min_ratio)
        )
        _mode_threshold = (
            _tier_strict_threshold
            if _strict
            else settings.relaxed_grounding_min_ratio
        )
        _effective_grounding_threshold = max(_base_threshold, _mode_threshold)

        _grounding_hard_fail = _forced_sentence_refusal
        if not _grounding_hard_fail and _zt_report.grounding_ratio < _effective_grounding_threshold:
            logger.warning(
                "GROUNDING_HARD_FAIL | ratio=%.2f | threshold=%.2f | "
                "strict=%s | answer replaced with safe refusal",
                _zt_report.grounding_ratio,
                _effective_grounding_threshold,
                _strict,
            )
            _grounding_hard_fail = True

        if _grounding_hard_fail:
            answer = _SAFE_REFUSAL

        if _grounding_hard_fail:
            # The original LLM sentences are discarded alongside the answer;
            # returning them would expose potentially hallucinated claims.
            _answer_sentences: List[AnswerSentence] = []
            _inline_citations: List[InlineCitation] = []
        else:
            _answer_sentences = [
                AnswerSentence(
                    sentence_id=s.sentence_id,
                    text=s.text,
                    source_refs=sorted(s.source_refs),
                )
                for s in _zt_sentences
            ]
            _inline_citations = [
                InlineCitation(
                    sentence_id=s.sentence_id,
                    source_indices=sorted(s.source_refs),
                    source_ids=[
                        used_docs[idx - 1].id
                        for idx in s.source_refs
                        if 1 <= idx <= len(used_docs)
                    ],
                )
                for s in _zt_sentences
                if s.source_refs
            ]
        # ── 6. Build + validate response ─────────────────────────────────────
        #       RAGResponse @model_validator acts as second Hard-Fail guard.
        #       STEP 8: source_schemas reflects used_docs, not all retrieved_docs.
        #       This ensures citations shown to the user were actually sent to LLM.
        _quality_reference_date = self._resolve_quality_reference_date(
            request=request,
            fallback_event_date=_effective_event_date,
        )
        _source_sentence_hits: Dict[int, int] = {}
        _grounded_sentence_total = 0
        for _sentence in _answer_sentences:
            if not _sentence.source_refs:
                continue
            _grounded_sentence_total += 1
            for _ref in _sentence.source_refs:
                _source_sentence_hits[_ref] = _source_sentence_hits.get(_ref, 0) + 1

        source_schemas: List[SourceDocumentSchema] = []
        for idx, doc in enumerate(used_docs, start=1):
            _source_type = infer_source_type(doc)
            _document_type = (
                SOURCE_TYPE_MEVZUAT
                if _source_type == SOURCE_TYPE_MEVZUAT
                else SOURCE_TYPE_ICTIHAT
                if _source_type == SOURCE_TYPE_ICTIHAT
                else "UNKNOWN"
            )
            _source_origin = _source_origin_map.get(
                doc.id,
                "legal_corpus" if doc.bureau_id is None else "case_doc",
            )
            _quality_source_class = self._classify_quality_source_class(
                source_type=_source_type,
                source_origin=_source_origin,
            )
            _support_span = self._resolve_support_span_chars(doc)
            _support_span_score = self._compute_support_span_score(
                support_span_chars=_support_span,
                source_sentence_hits=_source_sentence_hits.get(idx, 0),
                grounded_sentence_total=_grounded_sentence_total,
            )
            _recency_score = self._compute_recency_score(
                doc=doc,
                reference_date=_quality_reference_date,
            )
            _citation_confidence = self._compute_citation_confidence(
                final_score=doc.final_score,
                grounding_ratio=_zt_report.grounding_ratio,
                recency_score=_recency_score,
                support_span_score=_support_span_score,
                source_type_weight=self._source_class_weight(_quality_source_class),
                citation_hits=_source_sentence_hits.get(idx, 0),
            )
            _segment_type = self._coerce_optional_str(getattr(doc, "segment_type", None))
            _madde_no = self._coerce_optional_str(getattr(doc, "madde_no", None))
            _fikra_no = self._coerce_optional_str(getattr(doc, "fikra_no", None))
            _source_anchor = self._coerce_optional_str(getattr(doc, "source_anchor", None))
            if _source_anchor is None:
                _source_anchor = self._coerce_optional_str(getattr(doc, "citation", None))
            _page_no = self._coerce_optional_int(getattr(doc, "page_no", None))
            _char_start = self._coerce_optional_int(getattr(doc, "char_start", None))
            _char_end = self._coerce_optional_int(getattr(doc, "char_end", None))
            if _char_start is None:
                _char_start = 0
            if _char_end is None:
                _char_end = len(getattr(doc, "content", "") or "")
            if _char_end < _char_start:
                _char_end = _char_start

            source_schemas.append(
                SourceDocumentSchema(
                    id=doc.id,
                    content=doc.content,
                    citation=doc.citation,
                    court_level=doc.court_level,
                    ruling_date=doc.ruling_date,
                    source_url=doc.source_url,           # Step 2
                    version=doc.version,                  # Step 2
                    collected_at=doc.collected_at,        # Step 2
                    norm_hierarchy=doc.norm_hierarchy,    # Step 3
                    chamber=doc.chamber,                  # Step 3
                    majority_type=doc.majority_type,      # Step 3
                    dissent_present=doc.dissent_present,  # Step 3
                    authority_score=doc.authority_score,  # Step 3 (computed property)
                    is_binding_precedent=doc.is_binding_precedent,  # Step 3
                    # Step 4: versioning + AYM cancellation
                    effective_date=doc.effective_date,
                    expiry_date=doc.expiry_date,
                    aym_iptal_durumu=doc.aym_iptal_durumu,
                    iptal_yururluk_tarihi=doc.iptal_yururluk_tarihi,
                    aym_karar_no=doc.aym_karar_no,
                    aym_karar_tarihi=doc.aym_karar_tarihi,
                    aym_warning=doc.aym_warning_text,     # Step 4 (computed property)
                    # Step 5/15: segment + anchor metadata
                    segment_type=_segment_type,
                    madde_no=_madde_no,
                    fikra_no=_fikra_no,
                    source_anchor=_source_anchor,
                    page_no=_page_no,
                    char_start=_char_start,
                    char_end=_char_end,
                    injection_flag=_injection_flags_map.get(
                        doc.id,
                        self._coerce_bool(getattr(doc, "injection_flag", False), default=False),
                    ),
                    injection_notes=_injection_notes_map.get(doc.id, list(getattr(doc, "injection_notes", []))),
                    final_score=doc.final_score,
                    recency_score=_recency_score,
                    support_span=_support_span,
                    citation_confidence=_citation_confidence,
                    quality_source_class=_quality_source_class,
                    source_type=_source_type,             # Step 13: source taxonomy
                    source_origin=_source_origin,
                    document_type=_document_type,
                    bureau_id=doc.bureau_id,               # Step 6: tenant ownership
                    version_type=version_type_map.get(doc.id),  # Step 10: lehe kanun tag
                    conflict_notes=_conflict_notes_map.get(doc.id, []),  # Step 12: lex notes
                )
            )

        # Step 4: collect mandatory AYM cancellation warnings
        aym_warnings: List[AymWarningSchema] = [
            AymWarningSchema(
                document_id=doc.id,
                citation=doc.citation,
                aym_iptal_durumu=doc.aym_iptal_durumu,  # type: ignore[arg-type]
                aym_karar_no=doc.aym_karar_no,
                aym_karar_tarihi=doc.aym_karar_tarihi,
                iptal_yururluk_tarihi=doc.iptal_yururluk_tarihi,
                warning_text=doc.aym_warning_text,
                is_currently_effective=doc.is_currently_effective,
            )
            for doc in used_docs
            if doc.requires_aym_warning
        ]

        latency_ms = int((time.monotonic() - start_time) * 1000)
        _temporal_fields = TemporalFieldsSchema(
            as_of_date=getattr(request, "as_of_date", None),
            event_date=_effective_event_date,
            decision_date=getattr(request, "decision_date", None),
        )

        # ── Step 16: Generate mandatory legal disclaimer ───────────────────────────
        _disc_data = self._disclaimer_engine.generate(
            has_aym_warnings=bool(aym_warnings),
            has_lehe_notice=lehe_notice is not None,
            tier_value=_final_generation_tier,
            grounding_ratio=_zt_report.grounding_ratio,
            min_grounding_ratio=_effective_grounding_threshold,
        )
        _legal_disclaimer = LegalDisclaimerSchema(
            disclaimer_text=_disc_data.disclaimer_text,
            disclaimer_types=_disc_data.disclaimer_types,
            severity=_disc_data.severity,
            requires_expert_review=_disc_data.requires_expert_review,
            generated_at=_disc_data.generated_at,
            legal_basis=_disc_data.legal_basis,
        )

        # ── Step 17: Cost tracking ────────────────────────────────────────────
        _cost_est = self._cost_tracker.estimate(
            model_id=model_used,
            tier=_final_generation_tier,
            query=request.query,
            context=numbered_context,
            answer=answer,
            cached=False,
        ) if settings.cost_tracking_enabled else None
        _tier_cost_cap = float(getattr(_final_tier_policy, "max_cost_per_request", 0.0))
        if (
            _cost_est is not None
            and _tier_cost_cap > 0.0
            and float(_cost_est.total_cost_usd) > _tier_cost_cap
        ):
            logger.warning(
                "TIER_COST_CAP_EXCEEDED | tier=%s | estimated=%.6f | cap=%.6f",
                _requested_tier_label,
                float(_cost_est.total_cost_usd),
                _tier_cost_cap,
            )
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error_code": "TIER_COST_CAP_EXCEEDED",
                    "message": (
                        "Secilen zeka seviyesi icin istek maliyeti plan limitini asti. "
                        "Lutfen daha dusuk bir seviye secin veya planinizi yukseltin."
                    ),
                    "requested_tier": _requested_tier_label,
                    "estimated_cost_usd": float(_cost_est.total_cost_usd),
                    "max_cost_per_request": _tier_cost_cap,
                },
            )

        # ── Step 17: RAGAS metrics ────────────────────────────────────────────
        _ragas = self._ragas_adapter.compute(
            query=request.query,
            answer=answer,
            total_sentences=_zt_report.total_sentences,
            grounded_sentences=_zt_report.grounded_sentences,
            source_scores=[doc.final_score for doc in used_docs],
            target_source_count=settings.audit_ragas_target_source_count,
        ) if settings.ragas_metrics_enabled else None

        # ── Step 17: Audit Trail ──────────────────────────────────────────────
        _audit_schema: Optional[AuditTrailSchema] = None
        if settings.audit_trail_enabled:
            _audit_entry = self._audit_recorder.record(
                query=request.query,
                bureau_id=_bureau_id,
                tier=_final_generation_tier,
                tier_reason=tier_decision.reason,
                model_used=model_used,
                final_model=model_used,
                final_generation_tier=_final_generation_tier,
                subtask_models=list(_subtask_models),
                source_docs=used_docs,
                tool_calls=list(dispatch_result.tools_invoked),
                tool_errors=list(dispatch_result.tools_errored),
                docs_summarized_count=_docs_summarized_count,
                tokens_saved=_tokens_saved,
                litm_applied=_litm_applied,
                injection_doc_count=_injection_doc_count,
                grounding_ratio=_zt_report.grounding_ratio,
                disclaimer_severity=_legal_disclaimer.severity,
                latency_ms=latency_ms,
                cost_estimate_usd=_cost_est.total_cost_usd if _cost_est else 0.0,
                requested_tier=_requested_tier_label,
                final_tier=_final_generation_tier,
                response_type=ResponseType.LEGAL_GROUNDED.value,
                source_count=len(used_docs),
                case_id=_case_id_str,
                thread_id=_thread_id_str,
                intent_class=_intent_class,
                strict_grounding=bool(_strict),
                temporal_fields=_temporal_fields.model_dump(mode="json", exclude_none=True),
                tenant_context={
                    "bureau_id": _bureau_id,
                    "user_id": tenant_context.user_id if tenant_context else None,
                    "is_isolated": (
                        bool(tenant_context.is_isolated)
                        if tenant_context is not None
                        else False
                    ),
                    "is_service_account": (
                        bool(tenant_context.is_service_account)
                        if tenant_context is not None
                        else False
                    ),
                },
            )
            _audit_schema = AuditTrailSchema(
                request_id=_audit_entry.request_id,
                timestamp_utc=_audit_entry.timestamp_utc,
                query_hash=_audit_entry.query_hash,
                bureau_id=_audit_entry.bureau_id,
                requested_tier=_audit_entry.requested_tier,
                final_tier=_audit_entry.final_tier,
                final_generation_tier=_audit_entry.final_generation_tier,
                tier=_audit_entry.tier,
                final_model=_audit_entry.final_model,
                model_used=_audit_entry.model_used,
                subtask_models=list(_audit_entry.subtask_models),
                response_type=_audit_entry.response_type,
                source_count=len(used_docs),
                case_id=_audit_entry.case_id,
                thread_id=_audit_entry.thread_id,
                intent_class=_audit_entry.intent_class,
                strict_grounding=_audit_entry.strict_grounding,
                tool_calls_made=_audit_entry.tool_calls_made,
                tool_errors=_audit_entry.tool_errors,
                docs_summarized_count=_audit_entry.docs_summarized_count,
                tokens_saved=_audit_entry.tokens_saved,
                litm_applied=_audit_entry.litm_applied,
                grounding_ratio=_audit_entry.grounding_ratio,
                disclaimer_severity=_audit_entry.disclaimer_severity,
                latency_ms=_audit_entry.latency_ms,
                cost_estimate=CostEstimateSchema(
                    input_tokens=_cost_est.input_tokens,
                    output_tokens=_cost_est.output_tokens,
                    total_cost_usd=_cost_est.total_cost_usd,
                    model_id=_cost_est.model_id,
                    tier=_cost_est.tier,
                    cached=_cost_est.cached,
                    rate_per_1m_in=_cost_est.rate_per_1m_in,
                    rate_per_1m_out=_cost_est.rate_per_1m_out,
                ) if _cost_est else None,
                ragas_metrics=RAGASMetricsSchema(
                    faithfulness=_ragas.faithfulness,
                    answer_relevancy=_ragas.answer_relevancy,
                    context_precision=_ragas.context_precision,
                    context_recall=_ragas.context_recall,
                    overall_quality=_ragas.overall_quality,
                    computed_at=_ragas.computed_at,
                ) if _ragas else None,
                temporal_fields=TemporalFieldsSchema.model_validate(_audit_entry.temporal_fields)
                if getattr(_audit_entry, "temporal_fields", None)
                else None,
                tenant_context=_audit_entry.tenant_context if getattr(_audit_entry, "tenant_context", None) else None,
                why_this_answer=_audit_entry.why_this_answer,
                audit_signature=_audit_entry.audit_signature,
            )

        _estimated_cost = float(_cost_est.total_cost_usd) if _cost_est else 0.0
        _audit_trail_id = (
            _audit_schema.request_id
            if _audit_schema is not None
            else f"no-audit-{int(time.time() * 1000)}"
        )
        _citation_quality_summary, _citation_quality = self._build_citation_quality(
            source_schemas=source_schemas,
            grounding_ratio=_zt_report.grounding_ratio,
        )

        response = RAGResponse(
            response_type=ResponseType.LEGAL_GROUNDED,  # Step 2: all RAG pipeline responses are grounded
            answer=answer,
            tier_used=_final_generation_tier,
            sources=source_schemas,
            query=request.query,
            model_used=model_used,
            grounding_ratio=_zt_report.grounding_ratio,
            citation_quality_summary=_citation_quality_summary,
            citation_quality=_citation_quality,
            estimated_cost=_estimated_cost,
            audit_trail_id=_audit_trail_id,
            retrieval_count=len(used_docs),
            latency_ms=latency_ms,
            aym_warnings=aym_warnings,              # Step 4
            lehe_kanun_notice=lehe_notice,           # Step 10
            answer_sentences=_answer_sentences,      # Step 16
            inline_citations=_inline_citations,      # Step 16
            legal_disclaimer=_legal_disclaimer,      # Step 16
            temporal_fields=_temporal_fields,        # Step 4: temporal badges
            audit_trail=_audit_schema,               # Step 17
        )

        # ── 7. Store response in cache (non-fatal) ───────────────────────────
        if self._cache and settings.semantic_cache_enabled:
            await self._cache.store(
                query=request.query,
                embedding=query_embedding,
                case_id=request.case_id,
                response=response.model_dump(mode="json"),
                bureau_id=_bureau_id,
            )

        logger.info(
            "RAG query complete | latency=%dms | sources=%d | model=%s",
            latency_ms,
            len(source_schemas),
            model_used,
        )

        return response

    # ── Private helpers ───────────────────────────────────────────────────────

    def _requested_tier_from_request(self, request: RAGQueryRequest) -> Tuple[int, str]:
        """
        Returns (tier_value, tier_label) from request.ai_tier.
        """
        label = str(getattr(getattr(request, "ai_tier", None), "value", getattr(request, "ai_tier", "hazir_cevap")))
        mapping = {
            "hazir_cevap": 1,
            "dusunceli": 2,
            "uzman": 3,
            "muazzam": 4,
        }
        return mapping.get(label, 1), label

    @staticmethod
    def _coerce_optional_int(value: object) -> Optional[int]:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            _s = value.strip()
            if not _s:
                return None
            try:
                return int(_s)
            except Exception:
                return None
        try:
            return int(value) if type(value).__name__ in {"int", "float"} else None
        except Exception:
            return None

    @staticmethod
    def _coerce_optional_str(value: object) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            _s = value.strip()
            return _s or None
        return None

    @staticmethod
    def _coerce_bool(value: object, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        return default

    def _enforce_tier_access_policy(
        self,
        requested_tier_label: str,
        requested_tier_value: int,
        tier_policy: object,
        tenant_context: Optional[TenantContext],
    ) -> None:
        """
        Step 23 freemium policy gate (config-driven).

        Enforcement depends on configured policy mode:
        - open / none / disabled: no gate
        - strict / hard / paid_only: paid-only tiers and quotas are enforced
        """
        policy_mode = str(
            getattr(tier_policy, "tier_access_policy", "open") or "open"
        ).strip().lower()
        if policy_mode in {"open", "none", "disabled", "off", ""}:
            return

        plan_tier = str(getattr(tenant_context, "plan_tier", "FREE") or "FREE").upper()
        paid_only_tiers = {
            str(t).strip().lower()
            for t in list(getattr(settings, "paid_only_tiers", []) or [])
            if str(t).strip()
        }
        upgrade_prompts_enabled = bool(
            getattr(tier_policy, "upgrade_prompts_enabled", True)
        )
        strict_mode = policy_mode in {"strict", "hard", "paid_only"}

        if strict_mode and requested_tier_label.lower() in paid_only_tiers and plan_tier in {"FREE", "TRIAL"}:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error_code": "TIER_UPGRADE_REQUIRED",
                    "message": "Secilen zeka seviyesi aktif planinizda kullanilamiyor.",
                    "requested_tier": requested_tier_label,
                    "requested_tier_value": int(requested_tier_value),
                    "plan_tier": plan_tier,
                    "upgrade_prompts_enabled": upgrade_prompts_enabled,
                },
            )

        daily_limit = int(getattr(tier_policy, "daily_message_limit", 0) or 0)
        messages_today = self._coerce_optional_int(
            getattr(tenant_context, "messages_today", None)
        )
        if strict_mode and daily_limit > 0 and messages_today is not None and messages_today >= daily_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error_code": "DAILY_MESSAGE_LIMIT_REACHED",
                    "message": "Gunluk mesaj limitinize ulastiniz.",
                    "requested_tier": requested_tier_label,
                    "daily_message_limit": daily_limit,
                    "messages_today": messages_today,
                    "upgrade_prompts_enabled": upgrade_prompts_enabled,
                },
            )

        monthly_budget = int(getattr(tier_policy, "monthly_token_budget", 0) or 0)
        tokens_month = self._coerce_optional_int(
            getattr(tenant_context, "tokens_used_month", None)
        )
        if strict_mode and monthly_budget > 0 and tokens_month is not None and tokens_month >= monthly_budget:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error_code": "MONTHLY_TOKEN_BUDGET_EXCEEDED",
                    "message": "Aylik token butcenize ulastiniz.",
                    "requested_tier": requested_tier_label,
                    "monthly_token_budget": monthly_budget,
                    "tokens_used_month": tokens_month,
                    "upgrade_prompts_enabled": upgrade_prompts_enabled,
                },
            )

    def _build_social_answer(self, query: str) -> str:
        """
        Deterministic social response used when intent=social_simple.
        """
        lowered = (query or "").strip().lower()
        if any(k in lowered for k in ("tesekkur", "teşekkür", "sag ol", "sağ ol")):
            return "Rica ederim. Hukuki bir konuda yardim isterseniz kaynakli olarak devam edebilirim."
        if any(k in lowered for k in ("nasilsin", "nasılsın", "naber", "iyi misin")):
            return "Iyiyim, tesekkurler. Hazirsaniz hukuki sorunuzu yazabilirsiniz."
        if any(k in lowered for k in ("merhaba", "selam", "hello", "hi", "hey")):
            return "Merhaba. Buradayim; dilerseniz hukuki sorunuzu kaynakli analiz edecek sekilde ele alabilirim."
        return "Buradayim. Basit sohbet edebiliriz; hukuki bir soru yazarsaniz kaynakli yanit moduna gecerim."

    def _build_citation_quality(
        self,
        source_schemas: List[SourceDocumentSchema],
        grounding_ratio: float,
    ) -> Tuple[str, CitationQualitySchema]:
        """
        Step 18 citation quality layer.

        Produces both:
            1) Human-readable compact summary for backward-compatible UI badges.
            2) Structured CitationQualitySchema for richer frontend rendering.
        """
        if not source_schemas:
            _empty = CitationQualitySchema(
                source_strength="Dusuk",
                source_count=0,
                source_type_distribution={},
                recency_label="Bilinmiyor",
                average_support_span=0,
                average_citation_confidence=0.0,
            )
            return "Kaynak Gucu: Dusuk | Kaynak sayisi: 0 | Tur dagilimi: yok", _empty

        source_count = len(source_schemas)
        avg_final_score = sum(src.final_score for src in source_schemas) / source_count
        avg_confidence = (
            sum(float(src.citation_confidence or 0.0) for src in source_schemas) / source_count
        )
        avg_support_span = int(
            round(sum(int(src.support_span or 0) for src in source_schemas) / source_count)
        )
        avg_recency = sum(float(src.recency_score or 0.0) for src in source_schemas) / source_count

        type_dist: Dict[str, int] = {k: 0 for k in _QUALITY_SOURCE_CLASS_ORDER}
        for src in source_schemas:
            _class_key = (src.quality_source_class or "ikincil_kaynak").strip().lower()
            if _class_key not in type_dist:
                _class_key = "ikincil_kaynak"
            type_dist[_class_key] += 1

        primary_count = type_dist.get("kanun", 0) + type_dist.get("ictihat", 0)
        primary_share = primary_count / max(1, source_count)
        composite = (
            0.40 * grounding_ratio
            + 0.25 * avg_confidence
            + 0.20 * avg_final_score
            + 0.15 * primary_share
        )

        if composite >= 0.78 and primary_share >= 0.5:
            strength = "Yuksek"
        elif composite >= 0.52:
            strength = "Orta"
        else:
            strength = "Dusuk"

        if avg_recency >= 0.75:
            recency_label = "Guncel"
        elif avg_recency >= 0.45:
            recency_label = "Karisik"
        else:
            recency_label = "Arsiv"

        summary = (
            f"Kaynak Gucu: {strength} | Kaynak sayisi: {source_count} | "
            f"Tur dagilimi: kanun:{type_dist['kanun']}, ictihat:{type_dist['ictihat']}, "
            f"ikincil_kaynak:{type_dist['ikincil_kaynak']}, kullanici_notu:{type_dist['kullanici_notu']}"
        )
        structured = CitationQualitySchema(
            source_strength=strength,
            source_count=source_count,
            source_type_distribution=type_dist,
            recency_label=recency_label,
            average_support_span=avg_support_span,
            average_citation_confidence=max(0.0, min(1.0, avg_confidence)),
        )
        return summary, structured

    def _resolve_quality_reference_date(
        self,
        request: RAGQueryRequest,
        fallback_event_date: Optional[date],
    ) -> date:
        return (
            getattr(request, "as_of_date", None)
            or getattr(request, "decision_date", None)
            or fallback_event_date
            or date.today()
        )

    def _classify_quality_source_class(
        self,
        source_type: Optional[str],
        source_origin: Optional[str],
    ) -> str:
        """
        Step 18 priority:
            kanun > ictihat > ikincil_kaynak > kullanici_notu
        """
        st = (source_type or "").upper()
        origin = (source_origin or "").strip().lower()
        if st == SOURCE_TYPE_MEVZUAT:
            return "kanun"
        if st == SOURCE_TYPE_ICTIHAT:
            return "ictihat"
        if origin in {"uploaded_doc", "case_doc"}:
            return "kullanici_notu"
        return "ikincil_kaynak"

    def _source_class_weight(self, source_class: str) -> float:
        return float(_QUALITY_SOURCE_CLASS_WEIGHT.get(source_class, 0.5))

    def _resolve_support_span_chars(self, doc: LegalDocument) -> int:
        char_start = getattr(doc, "char_start", None)
        char_end = getattr(doc, "char_end", None)

        # Test doubles (e.g. MagicMock) may expose non-numeric placeholders here.
        # Only trust explicit numeric primitives; otherwise fall back to content length.
        if isinstance(char_start, (int, float)) and isinstance(char_end, (int, float)):
            _start = int(char_start)
            _end = int(char_end)
            if _end >= _start:
                return max(0, _end - _start)
        return max(0, min(800, len(doc.content or "")))

    def _compute_support_span_score(
        self,
        support_span_chars: int,
        source_sentence_hits: int,
        grounded_sentence_total: int,
    ) -> float:
        span_norm = max(0.0, min(1.0, float(support_span_chars) / 800.0))
        hit_norm = (
            0.0
            if grounded_sentence_total <= 0
            else max(0.0, min(1.0, float(source_sentence_hits) / float(grounded_sentence_total)))
        )
        return max(0.0, min(1.0, 0.55 * hit_norm + 0.45 * span_norm))

    def _compute_recency_score(self, doc: LegalDocument, reference_date: date) -> float:
        candidate_raw = doc.ruling_date or doc.effective_date
        candidate: Optional[date] = None
        if isinstance(candidate_raw, datetime):
            candidate = candidate_raw.date()
        elif isinstance(candidate_raw, date):
            candidate = candidate_raw
        elif isinstance(doc.collected_at, datetime):
            candidate = doc.collected_at.date()
        elif isinstance(doc.collected_at, date):
            candidate = doc.collected_at
        if candidate is None:
            return 0.45
        days = abs((reference_date - candidate).days)
        if days <= 365:
            return 1.0
        if days >= 3650:
            return 0.2
        ratio = (days - 365) / (3650 - 365)
        return max(0.2, min(1.0, 1.0 - 0.8 * ratio))

    def _compute_citation_confidence(
        self,
        final_score: float,
        grounding_ratio: float,
        recency_score: float,
        support_span_score: float,
        source_type_weight: float,
        citation_hits: int,
    ) -> float:
        base = (
            0.30 * float(final_score)
            + 0.25 * float(grounding_ratio)
            + 0.15 * float(recency_score)
            + 0.15 * float(support_span_score)
            + 0.15 * float(source_type_weight)
        )
        if citation_hits <= 0:
            base *= 0.70
        return max(0.0, min(1.0, base))

    async def _embed_query(self, query: str) -> List[float]:
        """
        Produces a 1536-dim embedding vector for the query.

        Step 6: delegates to QueryEmbedder which calls OpenAI
        text-embedding-3-small.  Retries up to
        settings.embedding_max_retries times on 429 / 5xx.

        Returns:
            List[float] of length settings.embedding_dimensions (1536).

        Raises:
            HTTPException 503: On embedding API failure.
        """
        return await self._embedder.embed_query(query)

    @staticmethod
    def _extract_http_error_code(exc: HTTPException) -> Optional[str]:
        detail = exc.detail
        if isinstance(detail, dict):
            raw = detail.get("error") or detail.get("error_code")
            if isinstance(raw, str) and raw.strip():
                return raw.strip().upper()
        return None

    def _should_fail_open_embedding(
        self,
        requested_tier_value: int,
        exc: HTTPException,
    ) -> bool:
        if not bool(getattr(settings, "embedding_fail_open_enabled", False)):
            return False

        max_tier = int(getattr(settings, "embedding_fail_open_max_tier", 0) or 0)
        if int(requested_tier_value) > max_tier:
            return False

        status_code = int(getattr(exc, "status_code", 0) or 0)
        if status_code < 500:
            return False

        allowed_error_codes = {
            "EMBEDDING_RETRIES_EXHAUSTED",
            "EMBEDDING_UNEXPECTED_ERROR",
            "EMBEDDING_CLIENT_ERROR",
            "EMBEDDING_ZERO_VECTOR",
            "EMBEDDING_QUOTA_EXHAUSTED",
            "EMBEDDING_QUOTA_COOLDOWN",
        }
        error_code = self._extract_http_error_code(exc)
        if error_code is None:
            return True
        return error_code in allowed_error_codes

    @staticmethod
    def _zero_embedding_vector() -> List[float]:
        dims = int(getattr(settings, "embedding_dimensions", 1536) or 1536)
        return [0.0] * max(1, dims)

    def _tier_rerank_depth(self, tier: QueryTier) -> int:
        """
        Step 23: rerank depth comes from central tier policy config.
        Falls back to legacy per-tier settings for backward compatibility.
        """
        policy = settings.get_tier_policy(int(tier))
        legacy = {
            QueryTier.TIER1: getattr(settings, "reranking_depth_tier1", 8),
            QueryTier.TIER2: getattr(settings, "reranking_depth_tier2", 12),
            QueryTier.TIER3: getattr(settings, "reranking_depth_tier3", 16),
            QueryTier.TIER4: getattr(settings, "reranking_depth_tier4", 24),
        }.get(tier, 8)
        depth = int(getattr(policy, "rerank_depth", legacy) or legacy)
        return max(1, int(depth))

    def _tier_parent_child_budget(self, tier: QueryTier) -> int:
        """
        Step 15: maximum injected parent segments per tier.
        """
        limit = {
            QueryTier.TIER1: getattr(settings, "parent_child_max_parents_tier1", 1),
            QueryTier.TIER2: getattr(settings, "parent_child_max_parents_tier2", 2),
            QueryTier.TIER3: getattr(settings, "parent_child_max_parents_tier3", 3),
            QueryTier.TIER4: getattr(settings, "parent_child_max_parents_tier4", 4),
        }.get(tier, getattr(settings, "parent_child_max_parents_tier1", 1))
        return max(0, int(limit))

    def _tier_context_budget(self, tier: QueryTier) -> int:
        """
        Step 23: context budget is derived from central tier policy.
        """
        return self._tier_max_tokens(tier)

    def _tier_max_tokens(self, tier: QueryTier) -> int:
        """
        Returns context budget for selected generation tier.

        Step 23:
        - primary source: settings.tier_config[*].context_budget
        - allow_long_context=False clamps to legacy tier window
        - legacy settings remain fallback-safe
        """
        legacy_budget = {
            QueryTier.TIER1: settings.llm_tier1_max_context_tokens,
            QueryTier.TIER2: settings.llm_tier2_max_context_tokens,
            QueryTier.TIER3: settings.llm_tier3_max_context_tokens,
            QueryTier.TIER4: settings.context_tier4_max_tokens,
        }[tier]
        policy = settings.get_tier_policy(int(tier))
        configured_budget = int(getattr(policy, "context_budget", legacy_budget) or legacy_budget)
        allow_long = bool(getattr(policy, "allow_long_context", False))
        if not allow_long:
            return max(256, min(configured_budget, int(legacy_budget)))
        return max(256, configured_budget)

    def _tier_timeout_seconds(self, tier: QueryTier) -> int:
        """
        Step 23: per-tier timeout budget for final generation call.
        """
        policy = settings.get_tier_policy(int(tier))
        timeout_s = int(getattr(policy, "timeout_seconds", 120) or 120)
        return max(10, timeout_s)

    def _enforce_cost_precheck(
        self,
        query: str,
        context: str,
        source_count: int,
        requested_tier_value: int,
        requested_tier_label: str,
        requested_tier_policy: object,
    ) -> None:
        """
        Blocks requests that cannot fit within the per-request cost cap.

        Uses a conservative upper-bound estimate by assuming the model may use
        `llm_max_response_tokens` output tokens.
        """
        if not settings.cost_tracking_enabled:
            return

        tier_cap = float(getattr(requested_tier_policy, "max_cost_per_request", 0.0) or 0.0)
        if tier_cap <= 0.0:
            return

        try:
            decision = self._router.decide(
                query=query,
                context=context,
                source_count=source_count,
                requested_tier=requested_tier_value,
            )
        except Exception as exc:
            logger.warning("COST_PREFLIGHT_SKIPPED | reason=%s", exc)
            return

        fallback_suffix = "+fallback" if getattr(decision, "fallback_used", False) else ""
        model_label = f"{decision.provider}/{decision.model_id}{fallback_suffix}"

        max_output_tokens = int(getattr(settings, "llm_max_response_tokens", 2048) or 2048)
        synthetic_max_answer = "x" * max(4, max_output_tokens * 4)
        projected = estimate_cost(
            model_id=model_label,
            tier=int(decision.tier),
            query=query,
            context=context,
            answer=synthetic_max_answer,
            cached=False,
        )
        projected_cost = float(projected.total_cost_usd)
        if projected_cost <= tier_cap:
            return

        logger.warning(
            "TIER_COST_CAP_PRECHECK_FAILED | tier=%s | projected=%.6f | cap=%.6f | model=%s | max_output_tokens=%d",
            requested_tier_label,
            projected_cost,
            tier_cap,
            model_label,
            max_output_tokens,
        )
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error_code": "TIER_COST_CAP_PRECHECK_FAILED",
                "message": (
                    "Secilen zeka seviyesi icin tahmini istek maliyeti plan limitini asiyor. "
                    "Lutfen daha dusuk bir seviye secin veya planinizi yukseltin."
                ),
                "requested_tier": requested_tier_label,
                "model": model_label,
                "projected_max_cost_usd": projected_cost,
                "max_cost_per_request": tier_cap,
                "max_output_tokens": max_output_tokens,
            },
        )

    @staticmethod
    def _build_llm_provider_fail_open_answer(context: str, source_count: int) -> str:
        """
        Deterministic, source-cited fallback when provider generation is unavailable.
        """
        if source_count <= 0 or not context.strip():
            return "Model servisi gecici olarak kullanilamiyor; lutfen daha sonra tekrar deneyin."

        # Supports both context formats:
        # 1) [K:1] KAYNAK: ...
        # 2) --- Kaynak 1: ... ---
        pattern = re.compile(
            r"(?:\[K:(\d+)\]\s*KAYNAK:[^\n]*\n(.*?)(?=\n\n---\n\n\[K:\d+\]\s*KAYNAK:|\Z))"
            r"|(?:---\s*Kaynak\s+(\d+):[^\n]*---\n(?:\[.*?\]\n)?(.*?)(?=\n---\s*Kaynak\s+\d+:|\Z))",
            re.S | re.I,
        )
        parts: List[str] = []
        for match in pattern.finditer(context):
            try:
                idx_group = match.group(1) or match.group(3)
                idx = int(idx_group)
            except Exception:
                continue
            body_group = match.group(2) if match.group(2) is not None else match.group(4)
            body = re.sub(r"\s+", " ", (body_group or "")).strip()
            if not body:
                continue
            # Keep every meaningful fragment in a single cited sentence.
            snippet = re.sub(r"\[[Kk]:\d+\]", "", body)
            snippet = re.sub(r"[.!?;:]+", ",", snippet)
            snippet = re.sub(r"\s*,\s*", ", ", snippet)
            snippet = re.sub(r"\s+", " ", snippet).strip(" ,")
            if not snippet:
                continue
            snippet = snippet[:220].rstrip(" ,")
            parts.append(f"Kaynak {idx}: {snippet} [K:{idx}]")
            if len(parts) >= max(1, min(3, int(source_count))):
                break

        if parts:
            return "\n".join(parts)

        return "Ilgili hukuki kaynaklar bulundu ancak model servisi gecici olarak kullanilamiyor [K:1]."

    async def _call_llm(
        self,
        query: str,
        context: str,
        source_count: int,
        history: Optional[List[Dict[str, str]]] = None,
        requested_tier: Optional[int] = None,
    ) -> Tuple[str, str, int]:
        """
        Dispatches to LLMTieredRouter.generate().

        When requested_tier is provided (Step 21), final model selection is
        tied to the user-visible tier map (Hazir Cevap / Dusunceli / Uzman / Muazzam).
        If a primary provider is unavailable, configured fallback model is used.

        Returns:
            (answer, model_label, final_generation_tier)
            e.g. ("...", "openai/gpt-4o-mini", 2)
        """
        _timeout_seconds = 120
        _final_generation_tier = int(requested_tier) if requested_tier is not None else 1
        try:
            _decision = self._router.decide(
                query=query,
                context=context,
                source_count=source_count,
                requested_tier=requested_tier,
            )
            _final_generation_tier = int(_decision.tier)
            if requested_tier is not None and _final_generation_tier < int(requested_tier):
                raise RuntimeError(
                    "FINAL_TIER_DOWNGRADE_BLOCKED | "
                    f"requested_tier={int(requested_tier)} | "
                    f"final_generation_tier={_final_generation_tier}"
                )

            _timeout_seconds = self._tier_timeout_seconds(_decision.tier)
            _answer, _model_label = await asyncio.wait_for(
                self._router.generate(
                    query=query,
                    context=context,
                    source_count=source_count,
                    history=history,
                    requested_tier=requested_tier,
                ),
                timeout=_timeout_seconds,
            )
            return _answer, _model_label, _final_generation_tier
        except asyncio.TimeoutError as exc:
            logger.error(
                "LLM_TIMEOUT | requested_tier=%s | timeout_s=%s",
                requested_tier,
                _timeout_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error_code": "TIER_TIMEOUT_EXCEEDED",
                    "message": "Secilen zeka seviyesi icin istek zaman asimina ugradi.",
                    "requested_tier": int(requested_tier) if requested_tier is not None else None,
                },
            ) from exc
        except RuntimeError as exc:
            _err = str(exc)
            _is_requested_unavailable = "REQUESTED_TIER_UNAVAILABLE_NO_DOWNGRADE" in _err
            _is_downgrade_blocked = "FINAL_TIER_DOWNGRADE_BLOCKED" in _err

            # RuntimeError is used both for strict routing policy failures and
            # provider/runtime failures (SDK import/model invocation).  Only
            # policy failures should hard-fail here; provider failures are
            # re-raised so the generic fail-open branch can return a grounded
            # extractive answer when possible.
            if not (_is_requested_unavailable or _is_downgrade_blocked):
                if (
                    bool(getattr(settings, "llm_provider_fail_open_enabled", True))
                    and int(source_count) > 0
                    and bool(context.strip())
                ):
                    logger.error(
                        "LLM_PROVIDER_FAIL_OPEN_ACTIVE | requested_tier=%s | final_tier=%s | error=%s",
                        requested_tier,
                        _final_generation_tier,
                        exc,
                    )
                    fallback_answer = self._build_llm_provider_fail_open_answer(
                        context=context,
                        source_count=source_count,
                    )
                    return (
                        fallback_answer,
                        "local/source-extractive-fallback",
                        _final_generation_tier,
                    )

                logger.error(
                    "LLM_PROVIDER_ERROR | requested_tier=%s | error=%s",
                    requested_tier,
                    exc,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "error_code": "LLM_PROVIDER_ERROR",
                        "message": (
                            "Secilen zeka seviyesi icin model servisi gecici olarak kullanilamiyor. "
                            "Lutfen daha sonra tekrar deneyin veya farkli bir seviye secin."
                        ),
                        "requested_tier": int(requested_tier) if requested_tier is not None else None,
                    },
                ) from exc

            _code = (
                "REQUESTED_TIER_UNAVAILABLE_NO_DOWNGRADE"
                if _is_requested_unavailable
                else "FINAL_TIER_DOWNGRADE_BLOCKED"
            )
            _requested = int(requested_tier) if requested_tier is not None else None
            _message = (
                "Secilen zeka seviyesi icin final model kullanilamadi. "
                "Lutfen provider anahtarlarini kontrol edin veya farkli bir seviye secin."
            )
            if _code == "REQUESTED_TIER_UNAVAILABLE_NO_DOWNGRADE":
                if _requested in {1, 2}:
                    _message = (
                        "Hazir Cevap ve Dusunceli seviyesi sadece Gemini 2.0 Flash ile calisir. "
                        "GOOGLE_API_KEY tanimlayin."
                    )
                elif _requested in {3, 4}:
                    _message = (
                        "Uzman/Muazzam seviyesi icin OpenAI modeli kullanilamadi. "
                        "OPENAI_API_KEY ve tier model ayarlarini kontrol edin."
                    )

            logger.error("LLM_ROUTER_POLICY_FAIL | code=%s | err=%s", _code, _err)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error_code": _code,
                    "message": _message,
                    "requested_tier": _requested,
                },
            ) from exc
        except Exception as exc:  # noqa: BLE001
            if (
                bool(getattr(settings, "llm_provider_fail_open_enabled", True))
                and int(source_count) > 0
                and bool(context.strip())
            ):
                logger.error(
                    "LLM_PROVIDER_FAIL_OPEN_ACTIVE | requested_tier=%s | final_tier=%s | error=%s",
                    requested_tier,
                    _final_generation_tier,
                    exc,
                )
                fallback_answer = self._build_llm_provider_fail_open_answer(
                    context=context,
                    source_count=source_count,
                )
                return (
                    fallback_answer,
                    "local/source-extractive-fallback",
                    _final_generation_tier,
                )

            logger.error(
                "LLM_PROVIDER_ERROR | requested_tier=%s | error=%s",
                requested_tier,
                exc,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error_code": "LLM_PROVIDER_ERROR",
                    "message": (
                        "Secilen zeka seviyesi icin model servisi gecici olarak kullanilamiyor. "
                        "Lutfen daha sonra tekrar deneyin veya farkli bir seviye secin."
                    ),
                    "requested_tier": int(requested_tier) if requested_tier is not None else None,
                },
            ) from exc


# ============================================================================
# Module-level singleton — import and use directly in route handlers
# ============================================================================

rag_service = RAGService()
