"""
Tests for Step 17: CI/CD Kalite Kapısı, Cost ve Hukuki Denetim İzi
====================================================================
Coverage groups:
    A  — CostTracker / estimate_cost()                                  (10 tests)
    B  — RAGASAdapter / metric pure functions                           (10 tests)
    C  — Cryptographic helpers (sha256_hex, hmac_sha256)               ( 5 tests)
    D  — LegalAuditEntry construction & why_this_answer                ( 8 tests)
    E  — AuditTrailRecorder.record() + verify_entry()                  ( 6 tests)
    F  — Schema validation (CostEstimateSchema, RAGASMetricsSchema,
         AuditTrailSchema, RAGResponse.audit_trail)                    ( 8 tests)
    G  — RAGService integration: cost + RAGAS + audit wired end-to-end ( 8 tests)

Total: 55 tests
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# A: CostTracker imports
# ---------------------------------------------------------------------------
from infrastructure.audit.cost_tracker import (
    CostEstimate,
    CostTracker,
    _MODEL_RATES,
    _strip_model_prefix,
    cost_tracker,
    estimate_cost,
)

# ---------------------------------------------------------------------------
# B: RAGASAdapter imports
# ---------------------------------------------------------------------------
from infrastructure.metrics.ragas_adapter import (
    RAGASAdapter,
    RAGASMetrics,
    _W_FAITHFULNESS,
    _W_PRECISION,
    _W_RECALL,
    _W_RELEVANCY,
    compute_answer_relevancy,
    compute_context_precision,
    compute_context_recall,
    compute_faithfulness,
    compute_overall_quality,
    ragas_adapter,
)

# ---------------------------------------------------------------------------
# C / D / E: Audit trail imports
# ---------------------------------------------------------------------------
from infrastructure.audit.audit_trail import (
    AuditTrailRecorder,
    LegalAuditEntry,
    SourceVersionRecord,
    _build_why_this_answer,
    audit_recorder,
    hmac_sha256,
    sha256_hex,
    verify_entry,
)

# ---------------------------------------------------------------------------
# F / G: Schema + RAGService imports
# ---------------------------------------------------------------------------
from api.schemas import (
    AuditTrailSchema,
    CostEstimateSchema,
    RAGASMetricsSchema,
    RAGResponse,
    SourceDocumentSchema,
)


# ============================================================================
# Shared helpers
# ============================================================================

def _make_mock_doc(
    doc_id: str = "doc-001",
    citation: str = "İş Kanunu md. 17",
    version: str = "2024-01-01",
    collected_at_str: Optional[str] = "2024-01-01T12:00:00+00:00",
    norm_hierarchy: str = "KANUN",
    authority_score: float = 0.75,
    final_score: float = 0.85,
) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.citation = citation
    doc.version = version
    if collected_at_str:
        dt = datetime.fromisoformat(collected_at_str)
        doc.collected_at = dt
    else:
        doc.collected_at = None
    doc.norm_hierarchy = norm_hierarchy
    doc.authority_score = authority_score
    doc.final_score = final_score
    doc.content = f"Content for {citation}"
    doc.court_level = None
    doc.ruling_date = None
    doc.source_url = None
    doc.chamber = None
    doc.majority_type = None
    doc.dissent_present = False
    doc.is_binding_precedent = False
    doc.effective_date = None
    doc.expiry_date = None
    doc.aym_iptal_durumu = None
    doc.iptal_yururluk_tarihi = None
    doc.aym_karar_no = None
    doc.aym_karar_tarihi = None
    doc.aym_warning_text = ""
    doc.bureau_id = None
    doc.requires_aym_warning = False
    doc.is_currently_effective = True
    return doc


def _record_entry(
    query: str = "İhbar süresi nedir?",
    bureau_id: Optional[str] = None,
    tier: int = 1,
    tier_reason: str = "test routing",
    model_used: str = "groq/llama-3.3-70b-versatile",
    tool_calls: Optional[List[str]] = None,
    grounding_ratio: float = 0.9,
    disclaimer_severity: str = "INFO",
    latency_ms: int = 120,
    cost_usd: float = 0.00012,
) -> LegalAuditEntry:
    """Calls AuditTrailRecorder.record() with a single mock doc."""
    docs = [_make_mock_doc()]
    return audit_recorder.record(
        query=query,
        bureau_id=bureau_id,
        tier=tier,
        tier_reason=tier_reason,
        model_used=model_used,
        source_docs=docs,
        tool_calls=tool_calls or [],
        grounding_ratio=grounding_ratio,
        disclaimer_severity=disclaimer_severity,
        latency_ms=latency_ms,
        cost_estimate_usd=cost_usd,
    )


def _minimal_source(doc_id: str = "src-01") -> SourceDocumentSchema:
    return SourceDocumentSchema(
        id=doc_id,
        content="İş Kanunu md. 17 uyarınca ihbar süresi kıdeme göre belirlenir.",
        citation="İş Kanunu md. 17",
        final_score=0.85,
    )


# ============================================================================
# A — CostTracker / estimate_cost
# ============================================================================

class TestCostTracker:
    """A. Per-request LLM cost estimation."""

    def test_cached_returns_zero_cost(self):
        """Cache hit → total_cost_usd = 0.00."""
        est = estimate_cost("gpt-4o-mini", 2, "query", "context", "answer", cached=True)
        assert est.total_cost_usd == 0.0

    def test_cached_returns_zero_tokens(self):
        """Cache hit → input_tokens = output_tokens = 0."""
        est = estimate_cost("gpt-4o-mini", 2, "q", "c", "a", cached=True)
        assert est.input_tokens == 0
        assert est.output_tokens == 0

    def test_cached_flag_set(self):
        est = estimate_cost("gpt-4o-mini", 2, "q", "c", "a", cached=True)
        assert est.cached is True

    def test_tier1_groq_rate_applied(self):
        """Tier 1 (Groq llama) uses the correct per-token rates."""
        est = estimate_cost("groq/llama-3.3-70b-versatile", 1, "q", "c", "a")
        assert est.rate_per_1m_in == _MODEL_RATES["llama-3.3-70b-versatile"][0]
        assert est.rate_per_1m_out == _MODEL_RATES["llama-3.3-70b-versatile"][1]

    def test_tier2_gpt4o_mini_rate_applied(self):
        """Tier 2 (GPT-4o-mini) uses the correct per-token rates."""
        est = estimate_cost("openai/gpt-4o-mini", 2, "q", "c", "a")
        assert est.rate_per_1m_in == _MODEL_RATES["gpt-4o-mini"][0]
        assert est.rate_per_1m_out == _MODEL_RATES["gpt-4o-mini"][1]

    def test_tier3_gpt4o_rate_applied(self):
        est = estimate_cost("openai/gpt-4o", 3, "q", "c", "a")
        assert est.rate_per_1m_in == _MODEL_RATES["gpt-4o"][0]

    def test_tier4_claude_rate_applied(self):
        est = estimate_cost("anthropic/claude-3-5-sonnet-20241022", 4, "q", "c", "a")
        assert est.rate_per_1m_in == _MODEL_RATES["claude-3-5-sonnet-20241022"][0]

    def test_unknown_model_gets_default_rate(self):
        """Unlisted model falls back to '_default' conservative rate."""
        est = estimate_cost("some-unknown-model", 3, "q", "c", "a")
        assert est.rate_per_1m_in == _MODEL_RATES["_default"][0]
        assert est.rate_per_1m_out == _MODEL_RATES["_default"][1]

    def test_total_cost_formula(self):
        """total_cost_usd = (in_tokens * rate_in + out_tokens * rate_out) / 1M."""
        # Use a predictable text length: 400 chars → 100 tokens each
        q = "Q" * 400    # 100 input tokens
        ctx = "C" * 400  # 100 input tokens → total input = 200
        ans = "A" * 400  # 100 output tokens

        rate_in, rate_out = _MODEL_RATES["gpt-4o-mini"]
        expected = (200 * rate_in + 100 * rate_out) / 1_000_000

        est = estimate_cost("gpt-4o-mini", 2, q, ctx, ans)
        assert abs(est.total_cost_usd - round(expected, 6)) < 1e-9
        assert est.input_tokens == 200
        assert est.output_tokens == 100

    def test_session_total_accumulates(self):
        """CostTracker accumulates cost across multiple calls."""
        tracker = CostTracker()
        tracker.estimate("gpt-4o-mini", 2, "A" * 400, "B" * 400, "C" * 400)
        tracker.estimate("gpt-4o-mini", 2, "A" * 400, "B" * 400, "C" * 400)
        rate_in, rate_out = _MODEL_RATES["gpt-4o-mini"]
        per_call = (200 * rate_in + 100 * rate_out) / 1_000_000
        assert abs(tracker.session_total_usd - round(per_call * 2, 6)) < 1e-9
        assert tracker.session_request_count == 2


# ============================================================================
# B — RAGASAdapter / metric pure functions
# ============================================================================

class TestRAGASAdapter:
    """B. RAGAS-inspired quality metrics."""

    def test_faithfulness_fully_grounded(self):
        assert compute_faithfulness(3, 3) == 1.0

    def test_faithfulness_ungrounded(self):
        assert compute_faithfulness(3, 0) == 0.0

    def test_faithfulness_partial(self):
        assert compute_faithfulness(2, 1) == 0.5

    def test_faithfulness_empty_answer_returns_1(self):
        """No sentences → vacuously grounded (no un-grounded claims)."""
        assert compute_faithfulness(0, 0) == 1.0

    def test_answer_relevancy_high_overlap(self):
        """Query terms appearing in answer → high score."""
        score = compute_answer_relevancy(
            query="ihbar süresi iş kanunu",
            answer="İhbar süresi iş kanununda dört haftadır. [K:1]",
        )
        assert score > 0.0

    def test_answer_relevancy_no_overlap(self):
        """Completely disjoint vocabularies → 0.0."""
        score = compute_answer_relevancy(
            query="xyzzyx aabbcc",
            answer="qwerty dvorak colemak",
        )
        assert score == 0.0

    def test_context_precision_mean_of_scores(self):
        prec = compute_context_precision([0.8, 0.6])
        assert abs(prec - 0.7) < 0.001

    def test_context_recall_sufficient_sources(self):
        """source_count >= target → recall = 1.0."""
        assert compute_context_recall(3, target_source_count=3) == 1.0
        assert compute_context_recall(5, target_source_count=3) == 1.0

    def test_context_recall_insufficient_sources(self):
        """source_count < target → recall < 1.0."""
        recall = compute_context_recall(1, target_source_count=3)
        assert abs(recall - round(1 / 3, 4)) < 0.001

    def test_overall_quality_weighted_combination(self):
        """overall_quality must equal the declared weight formula."""
        faith, relev, prec, recall = 0.9, 0.7, 0.8, 1.0
        expected = (
            _W_FAITHFULNESS * faith
            + _W_RELEVANCY   * relev
            + _W_PRECISION   * prec
            + _W_RECALL      * recall
        )
        result = compute_overall_quality(faith, relev, prec, recall)
        assert abs(result - round(expected, 4)) < 1e-6


# ============================================================================
# C — Cryptographic helpers
# ============================================================================

class TestCryptoHelpers:
    """C. sha256_hex and hmac_sha256 utilities."""

    def test_sha256_hex_returns_64_char_string(self):
        digest = sha256_hex("test input")
        assert isinstance(digest, str)
        assert len(digest) == 64

    def test_sha256_hex_is_deterministic(self):
        assert sha256_hex("hello") == sha256_hex("hello")

    def test_sha256_hex_different_for_different_inputs(self):
        assert sha256_hex("input A") != sha256_hex("input B")

    def test_hmac_sha256_returns_64_char_string(self):
        digest = hmac_sha256("payload", "secret")
        assert isinstance(digest, str)
        assert len(digest) == 64

    def test_hmac_sha256_different_payloads_differ(self):
        d1 = hmac_sha256("payload_one", "secret")
        d2 = hmac_sha256("payload_two", "secret")
        assert d1 != d2


# ============================================================================
# D — LegalAuditEntry construction
# ============================================================================

class TestLegalAuditEntry:
    """D. LegalAuditEntry fields and why_this_answer content."""

    def test_request_id_is_valid_uuid(self):
        entry = _record_entry()
        uid = uuid.UUID(entry.request_id)   # raises ValueError if invalid
        assert uid.version == 4

    def test_query_hash_is_sha256_of_query(self):
        query = "İhbar süresi nedir?"
        entry = _record_entry(query=query)
        assert entry.query_hash == sha256_hex(query)

    def test_query_hash_is_64_chars(self):
        entry = _record_entry()
        assert len(entry.query_hash) == 64

    def test_query_not_stored_in_entry(self):
        """Raw query must NOT appear in any field of the audit entry."""
        raw_query = "UNIQUE_SENTINEL_QUERY_12345"
        entry = _record_entry(query=raw_query)
        # Stringify the whole entry and check no raw query leaked
        entry_str = str(entry)
        assert raw_query not in entry_str

    def test_source_versions_count_matches_docs(self):
        docs = [_make_mock_doc("d1"), _make_mock_doc("d2")]
        entry = audit_recorder.record(
            query="test", bureau_id=None, tier=1, tier_reason="t",
            model_used="groq/llama-3.3-70b-versatile",
            source_docs=docs, tool_calls=[],
            grounding_ratio=1.0, disclaimer_severity="INFO",
            latency_ms=50, cost_estimate_usd=0.001,
        )
        assert len(entry.source_versions) == 2

    def test_source_version_records_doc_id(self):
        docs = [_make_mock_doc("abc-123")]
        entry = audit_recorder.record(
            query="test", bureau_id=None, tier=1, tier_reason="t",
            model_used="groq/llama-3.3-70b-versatile",
            source_docs=docs, tool_calls=[],
            grounding_ratio=1.0, disclaimer_severity="INFO",
            latency_ms=50, cost_estimate_usd=0.001,
        )
        assert entry.source_versions[0].doc_id == "abc-123"

    def test_audit_signature_is_64_char_hex(self):
        entry = _record_entry()
        assert len(entry.audit_signature) == 64
        # All chars must be valid hex digits
        assert all(c in "0123456789abcdef" for c in entry.audit_signature)

    def test_why_this_answer_contains_tier_number(self):
        entry = _record_entry(tier=2, tier_reason="keyword match")
        assert "2" in entry.why_this_answer

    def test_why_this_answer_contains_source_count(self):
        entry = _record_entry()
        # 1 mock doc → "1" should appear in the why_this_answer text
        assert "1" in entry.why_this_answer

    def test_why_this_answer_contains_grounding_percentage(self):
        entry = _record_entry(grounding_ratio=1.0)
        assert "100.0" in entry.why_this_answer

    def test_tool_calls_recorded_in_entry(self):
        entry = _record_entry(tool_calls=["IS_AKDI_IHBAR_6AY"])
        assert "IS_AKDI_IHBAR_6AY" in entry.tool_calls_made


# ============================================================================
# E — AuditTrailRecorder.record() + verify_entry
# ============================================================================

class TestAuditTrailRecorder:
    """E. AuditTrailRecorder and entry integrity verification."""

    def test_record_returns_legal_audit_entry(self):
        entry = _record_entry()
        assert isinstance(entry, LegalAuditEntry)

    def test_bureau_id_none_for_public_access(self):
        entry = _record_entry(bureau_id=None)
        assert entry.bureau_id is None

    def test_bureau_id_recorded_for_tenant(self):
        entry = _record_entry(bureau_id="buro-xyz-456")
        assert entry.bureau_id == "buro-xyz-456"

    def test_latency_ms_recorded_correctly(self):
        entry = _record_entry(latency_ms=321)
        assert entry.latency_ms == 321

    def test_tool_calls_made_as_list(self):
        entry = _record_entry(tool_calls=["TOOL_A", "TOOL_B"])
        assert isinstance(entry.tool_calls_made, list)
        assert set(entry.tool_calls_made) == {"TOOL_A", "TOOL_B"}

    def test_verify_entry_passes_on_unmodified(self):
        """HMAC signature should verify correctly on an untouched entry."""
        entry = _record_entry()
        assert verify_entry(entry) is True

    def test_step22_hybrid_fields_are_recorded(self):
        entry = audit_recorder.record(
            query="test",
            bureau_id=None,
            tier=3,
            tier_reason="step22",
            model_used="openai/gpt-4o",
            final_model="openai/gpt-4o",
            final_generation_tier=3,
            subtask_models=[
                "intent_classifier/local-rules",
                "query_rewriter/openai/gpt-4o-mini",
            ],
            source_docs=[_make_mock_doc()],
            tool_calls=[],
            grounding_ratio=1.0,
            disclaimer_severity="INFO",
            latency_ms=10,
            cost_estimate_usd=0.001,
        )
        assert entry.final_model == "openai/gpt-4o"
        assert entry.final_generation_tier == 3
        assert entry.subtask_models == [
            "intent_classifier/local-rules",
            "query_rewriter/openai/gpt-4o-mini",
        ]


# ============================================================================
# F — Schema validation
# ============================================================================

class TestSchemaValidation:
    """F. Pydantic schema correctness."""

    def test_cost_estimate_schema_validates_correctly(self):
        schema = CostEstimateSchema(
            input_tokens=100,
            output_tokens=50,
            total_cost_usd=0.00025,
            model_id="openai/gpt-4o-mini",
            tier=2,
        )
        assert schema.tier == 2
        assert schema.cached is False

    def test_cost_estimate_schema_rejects_negative_cost(self):
        with pytest.raises(Exception):
            CostEstimateSchema(
                input_tokens=100,
                output_tokens=50,
                total_cost_usd=-0.01,
                model_id="gpt-4o-mini",
                tier=2,
            )

    def test_ragas_metrics_schema_validates_correctly(self):
        schema = RAGASMetricsSchema(
            faithfulness=0.9,
            answer_relevancy=0.7,
            context_precision=0.8,
            context_recall=1.0,
            overall_quality=0.85,
            computed_at=datetime.now(tz=timezone.utc),
        )
        assert schema.faithfulness == 0.9

    def test_ragas_metrics_schema_rejects_out_of_range(self):
        with pytest.raises(Exception):
            RAGASMetricsSchema(
                faithfulness=1.5,          # > 1.0 — invalid
                answer_relevancy=0.7,
                context_precision=0.8,
                context_recall=1.0,
                overall_quality=0.85,
                computed_at=datetime.now(tz=timezone.utc),
            )

    def test_audit_trail_schema_validates_correctly(self):
        schema = AuditTrailSchema(
            request_id=str(uuid.uuid4()),
            timestamp_utc=datetime.now(tz=timezone.utc),
            query_hash=sha256_hex("query"),
            final_generation_tier=1,
            tier=1,
            final_model="groq/llama-3.3-70b-versatile",
            model_used="groq/llama-3.3-70b-versatile",
            subtask_models=["intent_classifier/local-rules"],
            source_count=2,
            grounding_ratio=1.0,
            disclaimer_severity="INFO",
            latency_ms=100,
            why_this_answer="[TİER 1] test. Kaynak sayısı: 2.",
            audit_signature="a" * 64,
        )
        assert schema.source_count == 2

    def test_audit_trail_schema_requires_audit_signature(self):
        with pytest.raises(Exception):
            AuditTrailSchema(
                request_id=str(uuid.uuid4()),
                timestamp_utc=datetime.now(tz=timezone.utc),
                query_hash=sha256_hex("q"),
                tier=1,
                model_used="groq/llama-3.3-70b-versatile",
                source_count=1,
                grounding_ratio=1.0,
                disclaimer_severity="INFO",
                latency_ms=50,
                why_this_answer="test",
                # audit_signature missing → validation error
            )

    def test_rag_response_has_audit_trail_field(self):
        """RAGResponse.model_fields must include 'audit_trail'."""
        assert "audit_trail" in RAGResponse.model_fields

    def test_audit_trail_in_model_dump(self):
        """audit_trail key appears in the serialised response dict."""
        resp = RAGResponse(
            answer="test answer",
            sources=[_minimal_source()],
            query="test?",
            model_used="test/model",
            retrieval_count=1,
            latency_ms=10,
        )
        dumped = resp.model_dump()
        assert "audit_trail" in dumped


# ============================================================================
# G — RAGService integration: Step 17 wired end-to-end
# ============================================================================

class TestRAGServiceStep17Integration:
    """G. RAGService integration — audit_trail + cost + RAGAS wired correctly."""

    def _make_step16_doc(
        self,
        doc_id: str = "d1",
        content: str = "İhbar süresi 4 haftadır.",
        citation: str = "İş Kanunu md. 17",
        final_score: float = 0.9,
    ) -> MagicMock:
        """Build a MagicMock mimicking a LegalDocument for RAGService tests."""
        doc = MagicMock()
        doc.id = doc_id
        doc.content = content
        doc.citation = citation
        doc.final_score = final_score
        doc.court_level = None
        doc.ruling_date = None
        doc.source_url = None
        doc.version = "2024-01-01"
        doc.collected_at = None
        doc.norm_hierarchy = None
        doc.chamber = None
        doc.majority_type = None
        doc.dissent_present = False
        doc.authority_score = 0.5
        doc.is_binding_precedent = False
        doc.effective_date = None
        doc.expiry_date = None
        doc.aym_iptal_durumu = None
        doc.iptal_yururluk_tarihi = None
        doc.aym_karar_no = None
        doc.aym_karar_tarihi = None
        doc.aym_warning_text = ""
        doc.bureau_id = None
        doc.requires_aym_warning = False
        doc.is_currently_effective = True
        return doc

    def _make_service(self):
        """Build a RAGService with all external dependencies mocked."""
        from infrastructure.context.context_builder import ContextBuildResult
        from infrastructure.llm.tiered_router import QueryTier, TierDecision
        from application.services.rag_service import RAGService

        docs = [
            self._make_step16_doc("d1", "İhbar süresi 4 haftadır.", "İş Kanunu md. 17", 0.9),
            self._make_step16_doc("d2", "Kıdem tazminatı her yıl için 30 günlük ücrettir.", "İş Kanunu md. 14", 0.8),
        ]

        mock_rrf = MagicMock()
        mock_rrf_result = MagicMock()
        mock_rrf_result.documents = docs
        mock_rrf.search = AsyncMock(return_value=mock_rrf_result)

        mock_reranker = MagicMock()
        mock_reranker.rerank = MagicMock(
            return_value=[MagicMock(document=d) for d in docs]
        )

        def _build_fn(d, max_tokens, apply_litm_reorder=False):
            return ContextBuildResult(
                context_str=" | ".join(doc.content for doc in d[:2]),
                used_docs=d[:2],
                total_tokens=len(d[:2]) * 30,
                dropped_count=0,
                truncated=False,
            )

        mock_ctx = MagicMock()
        mock_ctx.build = MagicMock(side_effect=_build_fn)

        mock_router = MagicMock()
        mock_router.decide = MagicMock(
            return_value=TierDecision(
                tier=QueryTier.TIER1,
                model_id="llama-3.3-70b-versatile",
                provider="groq",
                reason="test tier1 routing reason",
            )
        )
        mock_router.generate = AsyncMock(
            return_value=(
                "İhbar süresi 4 haftadır. [K:1] Kıdem tazminatı her yıl için 30 gündür. [K:2]",
                "groq/llama-3.3-70b-versatile",
            )
        )

        mock_dispatcher = MagicMock()
        mock_dispatch_result = MagicMock()
        mock_dispatch_result.was_triggered = False
        mock_dispatch_result.tools_invoked = []
        mock_dispatcher.dispatch = MagicMock(return_value=mock_dispatch_result)

        mock_graph = MagicMock()
        graph_result = MagicMock()
        graph_result.expansion_count = 0
        graph_result.all_docs = docs
        mock_graph.expand = AsyncMock(return_value=graph_result)

        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 1536)

        svc = RAGService(
            rrf=mock_rrf,
            reranker=mock_reranker,
            ctx_builder=mock_ctx,
            router=mock_router,
            dispatcher=mock_dispatcher,
            graph_expander=mock_graph,
            embedder=mock_embedder,
        )
        return svc

    @pytest.mark.asyncio
    async def test_audit_trail_not_none(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="İhbar süresi nedir?"))
        assert resp.audit_trail is not None

    @pytest.mark.asyncio
    async def test_audit_trail_tier_is_integer(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="İhbar süresi nedir?"))
        assert isinstance(resp.audit_trail.tier, int)
        assert resp.audit_trail.tier == 1

    @pytest.mark.asyncio
    async def test_audit_trail_source_count_matches_sources(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="İhbar süresi nedir?"))
        assert resp.audit_trail.source_count == len(resp.sources)

    @pytest.mark.asyncio
    async def test_audit_trail_cost_estimate_not_none(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="Kıdem tazminatı nedir?"))
        assert resp.audit_trail.cost_estimate is not None
        assert isinstance(resp.audit_trail.cost_estimate, CostEstimateSchema)

    @pytest.mark.asyncio
    async def test_audit_trail_ragas_metrics_not_none(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="İhbar süresi nedir?"))
        assert resp.audit_trail.ragas_metrics is not None
        assert isinstance(resp.audit_trail.ragas_metrics, RAGASMetricsSchema)

    @pytest.mark.asyncio
    async def test_ragas_faithfulness_in_valid_range(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="Deneme süresi nedir?"))
        faith = resp.audit_trail.ragas_metrics.faithfulness
        assert 0.0 <= faith <= 1.0

    @pytest.mark.asyncio
    async def test_audit_signature_is_64_hex_chars(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query="Tazminat hesaplama?"))
        sig = resp.audit_trail.audit_signature
        assert len(sig) == 64
        assert all(c in "0123456789abcdef" for c in sig)

    @pytest.mark.asyncio
    async def test_query_hash_is_not_raw_query(self):
        from api.schemas import RAGQueryRequest
        raw = "İhbar süresi nedir?"
        svc = self._make_service()
        resp = await svc.query(RAGQueryRequest(query=raw))
        # query_hash must be a SHA-256 hex, NOT the raw query
        assert resp.audit_trail.query_hash != raw
        assert len(resp.audit_trail.query_hash) == 64
