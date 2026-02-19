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

import logging
import time
from typing import List, Optional, Tuple

from fastapi import HTTPException, status

from api.schemas import (
    APIErrorResponse,
    AnswerSentence,
    AuditTrailSchema,
    AymWarningSchema,
    CostEstimateSchema,
    InlineCitation,
    LegalDisclaimerSchema,
    LeheKanunNoticeSchema,
    NoSourceErrorDetail,
    PromptInjectionErrorDetail,
    RAGASMetricsSchema,
    RAGQueryRequest,
    RAGResponse,
    SourceDocumentSchema,
)
from domain.entities.legal_document import LegalDocument
from infrastructure.cache.semantic_cache import SemanticCache
from infrastructure.config import settings
from infrastructure.llm.tiered_router import LLMTieredRouter, QueryTier, llm_router
from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.retrieval.retrieval_client import RetrieverClient, retriever_client
from infrastructure.search.rrf_retriever import RRFRetriever, rrf_retriever
from infrastructure.reranking.legal_reranker import LegalReranker, legal_reranker
from infrastructure.security.prompt_guard import PromptGuard, prompt_guard
from infrastructure.context.context_builder import ContextBuilder, context_builder
from infrastructure.context.context_summarizer import ContextSummarizer, context_summarizer
from infrastructure.generation.zero_trust_prompt import ZeroTrustPromptBuilder, zero_trust_builder
from infrastructure.generation.disclaimer_engine import LegalDisclaimerEngine, disclaimer_engine
from infrastructure.audit.cost_tracker import CostTracker, cost_tracker
from infrastructure.audit.audit_trail import AuditTrailRecorder, audit_recorder
from infrastructure.metrics.ragas_adapter import RAGASAdapter, ragas_adapter
from infrastructure.graph.citation_graph import CitationGraphExpander, citation_graph_expander
from infrastructure.agents.tool_dispatcher import ToolDispatcher, tool_dispatcher
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
        self._summarizer: ContextSummarizer = summarizer or context_summarizer
        self._zt_builder: ZeroTrustPromptBuilder = zt_builder or zero_trust_builder
        self._disclaimer_engine: LegalDisclaimerEngine = disc_engine or disclaimer_engine
        self._cost_tracker: CostTracker = cost_tracker_inst or cost_tracker
        self._audit_recorder: AuditTrailRecorder = audit_recorder_inst or audit_recorder
        self._ragas_adapter: RAGASAdapter = ragas_adapter_inst or ragas_adapter
        self._ctx_builder: ContextBuilder = ctx_builder or context_builder
        self._lehe_engine: LeheKanunEngine = lehe_engine or lehe_kanun_engine
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
            "RAG query started | case_id=%r | max_sources=%d | query_len=%d",
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

        # ── 0b. KVKK PII detection (Step 6) ──────────────────────────────────────
        #        Detect and log PII in the user's query for compliance audit.
        #        Irreversible redaction is applied by KVKKRedactor if PII found.
        if settings.kvkk_redact_prompts and kvkk_redactor.has_pii(request.query):
            logger.info(
                "KVKK_PII_IN_QUERY | bureau=%s | query_len=%d",
                tenant_context.bureau_id if tenant_context else None,
                len(request.query),
            )

        # ── 0c. Semantic cache — L1 exact match (BEFORE embedding) ───────────
        #       Cheapest possible path: 1 Redis GET.  If hit, cost = $0.
        if self._cache and settings.semantic_cache_enabled:
            l1_hit = await self._cache.l1_lookup(request.query, request.case_id)
            if l1_hit:
                logger.info(
                    "CACHE_HIT L1 — embed+retrieve+LLM skipped | cost=$0 | "
                    "query_len=%d",
                    len(request.query),
                )
                return RAGResponse.model_validate(l1_hit)

        # ── 1. Embed the query ───────────────────────────────────────────────
        query_embedding = await self._embed_query(request.query)

        # ── 1b. Semantic cache — L2 cosine match (AFTER embedding) ───────────
        #        If hit, retrieval + LLM are skipped.  Cost = $0.
        if self._cache and settings.semantic_cache_enabled:
            l2_hit, similarity = await self._cache.l2_lookup(
                query_embedding, request.case_id
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
        # Determine bureau_id: TenantContext (middleware) takes precedence;
        # fall back to request.bureau_id (explicit client header / test fixture).
        _bureau_id = (
            tenant_context.bureau_id
            if tenant_context and tenant_context.is_isolated
            else getattr(request, "bureau_id", None)
        )

        # ── 2a. Lehe Kanun check (Step 10) ──────────────────────────────────────
        #        When event_date + decision_date are both present and the query
        #        is in the criminal / penalty domain, retrieve BOTH law versions.
        lehe_result = None
        lehe_notice: Optional[LeheKanunNoticeSchema] = None

        if (
            settings.lehe_kanun_enabled
            and request.event_date is not None
            and getattr(request, "decision_date", None) is not None
        ):
            lehe_result = self._lehe_engine.check(
                query_text=request.query,
                event_date=request.event_date,
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
                query_text=request.query,
                case_id=request.case_id,
                max_sources=request.max_sources,
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
            # When settings.rrf_enabled=True  → hibrit RRF füzyon (vektör + BM25)
            # When settings.rrf_enabled=False → doğrudan RetrieverClient.search()
            rrf_result = await self._rrf.search(
                embedding=query_embedding,
                query_text=request.query,
                case_id=request.case_id,
                max_sources=request.max_sources,
                min_score=request.min_score,
                event_date=request.event_date,  # Step 4: time-travel
                bureau_id=_bureau_id,            # Step 6: tenant isolation
            )
            retrieved_docs = rrf_result.documents
            version_type_map = {}  # no version tagging in standard mode

        # ── 2b. Hiyerarşi & Çatışma Duyarlı Re-Ranking (Step 12) ────────────
        #        RRF çıktısı belgeler norm hiyerarşisi, otorite skoru ve
        #        Lex Specialis / Lex Posterior kurallarıyla yeniden sıralanır.
        #        reranking_enabled=False → sıra korunur (pass-through).
        if retrieved_docs:
            rerank_results = self._reranker.rerank(retrieved_docs, request.query)
            retrieved_docs = [r.document for r in rerank_results]

        # ── 3. HARD-FAIL GATE ────────────────────────────────────────────────
        #       "Kaynak yoksa cevap yok"
        #
        #       The LLM is NOT called beyond this point if no documents were
        #       found.  Cost for this request path = $0.
        # ────────────────────────────────────────────────────────────────────
        if not retrieved_docs:
            logger.warning(
                "HARD_FAIL triggered | query=%r | case_id=%r | "
                "llm_called=False | cost=$0",
                request.query[:80],
                request.case_id,
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=NoSourceErrorDetail(
                    query=request.query,
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
        tier_decision = self._router.decide(
            request.query, "", len(retrieved_docs)
        )

        # ── 4a. GraphRAG Citation Chain Expansion (Step 13) ──────────────────
        #        Tier 3/4 sorgularında atıf grafı BFS ile genişletilir.
        #        Maksimum 2 derece derinlik, 15 düğüm sınırıyla token
        #        maliyeti kontrol altında tutulur.
        #        graphrag_enabled=False veya Tier 1/2 → geçilir (pass-through).
        if settings.graphrag_enabled and tier_decision.tier.value >= settings.graphrag_min_tier:

            async def _citation_fetcher(ref: str) -> Optional[LegalDocument]:
                """RRF retriever üzerinden atıf çözümleme kapatması."""
                try:
                    rrf_result = await self._rrf.search(
                        embedding=query_embedding,
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

        # ── 4a. Context Summarisation — Secondary Docs (Step 15) ─────────────
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
            logger.info(
                "CONTEXT_SUMMARIZE | tier=%s | primary=%d | secondary=%d | "
                "summarized=%d | target_tokens=%d",
                tier_decision.tier.name,
                len(_primary_docs),
                len(_secondary_docs),
                sum(1 for r in _summary_results if r.was_summarized),
                settings.context_summary_target_tokens,
            )

        tier_max_tokens = self._tier_max_tokens(tier_decision.tier)
        ctx_result = self._ctx_builder.build(
            retrieved_docs,
            tier_max_tokens,
            apply_litm_reorder=settings.context_litm_reorder_enabled,
        )
        context = ctx_result.context_str
        used_docs = ctx_result.used_docs

        # ── 4b. Agentic Tool Dispatch (Step 14) ──────────────────────────────
        #        Tier 3/4 sorgularında sorgu metni zamanaşımı/süre hesabı
        #        anahtar kelimelerine göre taranır; deterministik sonuçlar
        #        LLM bağlamının başına eklenerek halüsinasyon önlenir.
        dispatch_result = self._tool_dispatcher.dispatch(
            query_text=request.query,
            tier=tier_decision.tier,
            start_date=request.event_date,
        )

        if ctx_result.truncated or ctx_result.dropped_count:
            logger.info(
                "Context budget applied | tier=%s | budget=%d | "
                "included=%d/%d | truncated=%s | tokens=%d",
                tier_decision.tier,
                tier_max_tokens,
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

        # ── 5. Call LLM ──────────────────────────────────────────────────────
        #       Only reached after BOTH Hard-Fail gate AND context guard pass.
        #       source_count = len(used_docs) (budget-trimmed list).
        answer, model_used = await self._call_llm(
            request.query, numbered_context, len(used_docs)
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

        _answer_sentences: List[AnswerSentence] = [
            AnswerSentence(
                sentence_id=s.sentence_id,
                text=s.text,
                source_refs=sorted(s.source_refs),
            )
            for s in _zt_sentences
        ]
        _inline_citations: List[InlineCitation] = [
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
        source_schemas: List[SourceDocumentSchema] = [
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
                final_score=doc.final_score,
                bureau_id=doc.bureau_id,               # Step 6: tenant ownership
                version_type=version_type_map.get(doc.id),  # Step 10: lehe kanun tag
            )
            for doc in used_docs
        ]

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

        # ── Step 16: Generate mandatory legal disclaimer ───────────────────────────
        _disc_data = self._disclaimer_engine.generate(
            has_aym_warnings=bool(aym_warnings),
            has_lehe_notice=lehe_notice is not None,
            tier_value=tier_decision.tier.value,
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
            tier=tier_decision.tier.value,
            query=request.query,
            context=numbered_context,
            answer=answer,
            cached=False,
        ) if settings.cost_tracking_enabled else None

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
                tier=tier_decision.tier.value,
                tier_reason=tier_decision.reason,
                model_used=model_used,
                source_docs=used_docs,
                tool_calls=list(dispatch_result.tools_invoked),
                grounding_ratio=_zt_report.grounding_ratio,
                disclaimer_severity=_legal_disclaimer.severity,
                latency_ms=latency_ms,
                cost_estimate_usd=_cost_est.total_cost_usd if _cost_est else 0.0,
            )
            _audit_schema = AuditTrailSchema(
                request_id=_audit_entry.request_id,
                timestamp_utc=_audit_entry.timestamp_utc,
                query_hash=_audit_entry.query_hash,
                bureau_id=_audit_entry.bureau_id,
                tier=_audit_entry.tier,
                model_used=_audit_entry.model_used,
                source_count=len(used_docs),
                tool_calls_made=_audit_entry.tool_calls_made,
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
                why_this_answer=_audit_entry.why_this_answer,
                audit_signature=_audit_entry.audit_signature,
            )

        response = RAGResponse(
            answer=answer,
            sources=source_schemas,
            query=request.query,
            model_used=model_used,
            retrieval_count=len(used_docs),
            latency_ms=latency_ms,
            aym_warnings=aym_warnings,              # Step 4
            lehe_kanun_notice=lehe_notice,           # Step 10
            answer_sentences=_answer_sentences,      # Step 16
            inline_citations=_inline_citations,      # Step 16
            legal_disclaimer=_legal_disclaimer,      # Step 16
            audit_trail=_audit_schema,               # Step 17
        )

        # ── 7. Store response in cache (non-fatal) ───────────────────────────
        if self._cache and settings.semantic_cache_enabled:
            await self._cache.store(
                query=request.query,
                embedding=query_embedding,
                case_id=request.case_id,
                response=response.model_dump(mode="json"),
            )

        logger.info(
            "RAG query complete | latency=%dms | sources=%d | model=%s",
            latency_ms,
            len(source_schemas),
            model_used,
        )

        return response

    # ── Private helpers ───────────────────────────────────────────────────────

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

    def _tier_max_tokens(self, tier: QueryTier) -> int:
        """
        Returns the context-window token budget for the given LLM tier.

        Step 8: Maps QueryTier → settings field so ContextBuilder knows
        how many tokens it may fill.
        """
        return {
            QueryTier.TIER1: settings.llm_tier1_max_context_tokens,
            QueryTier.TIER2: settings.llm_tier2_max_context_tokens,
            QueryTier.TIER3: settings.llm_tier3_max_context_tokens,
            QueryTier.TIER4: settings.context_tier4_max_tokens,
        }[tier]

    async def _call_llm(
        self, query: str, context: str, source_count: int
    ) -> Tuple[str, str]:
        """
        Dispatches to LLMTieredRouter.generate().

        The router classifies the query into Tier 1-4 based on context token
        count, source count, and Turkish legal keyword complexity.  If a
        provider key is missing, fallback is applied automatically.

        Returns:
            (answer, model_label)  e.g. ("...", "openai/gpt-4o-mini")
        """
        return await self._router.generate(query, context, source_count)


# ============================================================================
# Module-level singleton — import and use directly in route handlers
# ============================================================================

rag_service = RAGService()
