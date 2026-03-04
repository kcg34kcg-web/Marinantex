"""
Tests for Step 16: Zero-Trust Generation ve Zorunlu Hukuki Disclaimer
=======================================================================
Coverage groups:
    A  —  build_system_prompt() / ZeroTrustPromptBuilder.get_system_prompt()   (5 tests)
    B  —  build_numbered_context()                                              (7 tests)
    C  —  parse_answer_sentences()                                              (9 tests)
    D  —  validate_grounding() / GroundingReport                                (6 tests)
    E  —  DisclaimerType enum + LegalDisclaimerEngine.generate()               (8 tests)
    F  —  LegalDisclaimerData content verification                              (4 tests)
    G  —  api/schemas: AnswerSentence / InlineCitation / LegalDisclaimerSchema  (7 tests)
    H  —  RAGResponse.legal_disclaimer auto-generation (model_validator)        (6 tests)
    I  —  RAGService integration: numbered context + citation + disclaimer       (5 tests)
    J  —  DUSUK_GROUNDING disclaimer type activation tests                      (8 tests)
    K  —  Post-LLM GROUNDING_HARD_FAIL: answer replaced, sentences cleared      (5 tests)
    L  —  Pre-LLM NoSource Hard-Fail: HTTP 422, LLM never called                (4 tests)

Total: 74 tests
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas import (
    AnswerSentence,
    AymWarningSchema,
    InlineCitation,
    LegalDisclaimerSchema,
    LeheKanunNoticeSchema,
    RAGResponse,
    SourceDocumentSchema,
)
from infrastructure.generation.disclaimer_engine import (
    DisclaimerType,
    LegalDisclaimerData,
    LegalDisclaimerEngine,
    disclaimer_engine,
)
from infrastructure.generation.zero_trust_prompt import (
    GroundingReport,
    MIN_SENTENCE_CHARS,
    ParsedSentence,
    ZeroTrustPromptBuilder,
    build_numbered_context,
    build_system_prompt,
    parse_answer_sentences,
    validate_grounding,
    zero_trust_builder,
)


# ============================================================================
# Shared fixtures
# ============================================================================

def _minimal_source() -> SourceDocumentSchema:
    return SourceDocumentSchema(
        id="doc-001",
        content="İş Kanunu md. 17 uyarınca ihbar süresi işçinin kıdemine göre belirlenir.",
        citation="İş Kanunu md. 17",
        final_score=0.85,
    )


def _minimal_response(**kwargs) -> RAGResponse:
    defaults = dict(
        answer="İhbar süresi kıdeme göre belirlenir.",
        sources=[_minimal_source()],
        query="İhbar süresi nedir?",
        model_used="test/model",
        retrieval_count=1,
        latency_ms=50,
    )
    defaults.update(kwargs)
    return RAGResponse(**defaults)


# ============================================================================
# A — build_system_prompt / ZeroTrustPromptBuilder.get_system_prompt
# ============================================================================

class TestBuildSystemPrompt:
    """A. Zero-Trust system prompt content and format."""

    def test_returns_non_empty_string(self):
        prompt = build_system_prompt()
        assert isinstance(prompt, str)
        assert len(prompt) > 100

    def test_contains_kn_marker_instruction(self):
        """Prompt must explicitly mention [K:N] citation marker format."""
        prompt = build_system_prompt()
        assert "[K:N]" in prompt or "[K:" in prompt

    def test_contains_zero_trust_prohibition(self):
        """Prompt must forbid adding information not in sources."""
        prompt = build_system_prompt()
        lowered = prompt.lower()
        assert "kesinlikle" in lowered or "yasak" in lowered or "olmayan" in lowered

    def test_contains_fallback_phrase(self):
        """Prompt must specify what to say when sources are insufficient."""
        prompt = build_system_prompt()
        assert "bulunamadı" in prompt or "yetersiz" in prompt

    def test_builder_singleton_returns_same_content(self):
        """Module-level singleton should return same prompt as pure function."""
        assert zero_trust_builder.get_system_prompt() == build_system_prompt()


# ============================================================================
# B — build_numbered_context
# ============================================================================

class TestBuildNumberedContext:
    """B. Numbered context block formatting."""

    def test_single_doc_prefix_k1(self):
        ctx = build_numbered_context(["Yargıtay 9HD"], ["İhbar süresi içeriği"])
        assert "[K:1]" in ctx
        assert "Yargıtay 9HD" in ctx
        assert "İhbar süresi içeriği" in ctx

    def test_two_docs_both_prefixed(self):
        ctx = build_numbered_context(
            ["Kaynak A", "Kaynak B"],
            ["içerik A", "içerik B"],
        )
        assert "[K:1]" in ctx
        assert "[K:2]" in ctx

    def test_separator_between_docs(self):
        ctx = build_numbered_context(["A", "B"], ["içerik1", "içerik2"])
        assert "---" in ctx

    def test_empty_citation_uses_fallback_label(self):
        ctx = build_numbered_context([""], ["içerik"])
        # Empty citation should produce a fallback label, not crash
        assert "[K:1]" in ctx

    def test_mismatched_lengths_raises(self):
        with pytest.raises(ValueError):
            build_numbered_context(["A", "B"], ["tek"])

    def test_empty_inputs_returns_empty_string(self):
        assert build_numbered_context([], []) == ""

    def test_content_is_stripped(self):
        ctx = build_numbered_context(["Cit"], ["  içerik  "])
        # Content should be stripped of leading/trailing whitespace
        assert "  içerik  " not in ctx
        assert "içerik" in ctx


# ============================================================================
# C — parse_answer_sentences
# ============================================================================

class TestParseAnswerSentences:
    """C. LLM answer parsing — sentence splitting and [K:N] extraction."""

    def test_single_sentence_with_citation(self):
        raw = "İhbar süresi 4 haftadır. [K:1]"
        sentences, invalid = parse_answer_sentences(raw, source_count=2)
        assert len(sentences) == 1
        assert 1 in sentences[0].source_refs
        assert invalid == []

    def test_multiple_citations_on_one_sentence(self):
        raw = "Tazminat hesaplanır. [K:1][K:2]"
        sentences, _ = parse_answer_sentences(raw, source_count=3)
        assert 1 in sentences[0].source_refs
        assert 2 in sentences[0].source_refs

    def test_out_of_range_ref_flagged_as_invalid(self):
        raw = "Bu iddia doğrudur. [K:99]"
        sentences, invalid = parse_answer_sentences(raw, source_count=2)
        assert 99 in invalid
        # sentence has no valid refs
        assert len(sentences[0].source_refs) == 0

    def test_sentence_without_citation(self):
        raw = "Bu cümle kaynaksızdır ve uzun bir cümledir."
        sentences, _ = parse_answer_sentences(raw, source_count=1)
        assert sentences[0].source_refs == frozenset()

    def test_empty_answer_returns_empty(self):
        sentences, invalid = parse_answer_sentences("", source_count=3)
        assert sentences == []
        assert invalid == []

    def test_multiple_sentences_split_correctly(self):
        raw = "Birinci cümle. [K:1] İkinci cümle. [K:2]"
        sentences, _ = parse_answer_sentences(raw, source_count=2)
        assert len(sentences) == 2

    def test_sentence_id_is_sequential(self):
        raw = "Cümle bir. [K:1] Cümle iki. [K:2] Cümle üç. [K:3]"
        sentences, _ = parse_answer_sentences(raw, source_count=3)
        ids = [s.sentence_id for s in sentences]
        assert ids == list(range(len(ids)))

    def test_valid_refs_within_range_kept(self):
        raw = "Karar uygulanır. [K:3]"
        sentences, invalid = parse_answer_sentences(raw, source_count=5)
        assert 3 in sentences[0].source_refs
        assert invalid == []

    def test_mixed_valid_invalid_refs(self):
        raw = "İddia: madde uygulanır. [K:1][K:50]"
        sentences, invalid = parse_answer_sentences(raw, source_count=3)
        assert 1 in sentences[0].source_refs
        assert 50 not in sentences[0].source_refs
        assert 50 in invalid


# ============================================================================
# D — validate_grounding / GroundingReport
# ============================================================================

class TestValidateGrounding:
    """D. Grounding validation and GroundingReport accuracy."""

    def test_all_grounded_is_fully_grounded(self):
        s = ParsedSentence(0, "Bu uzun cümle kaynağa atıfta bulunur. [K:1]", frozenset({1}))
        report = validate_grounding([s], source_count=2, invalid_refs=[])
        assert report.is_fully_grounded is True
        assert report.grounding_ratio == 1.0

    def test_ungrounded_long_sentence_detected(self):
        long_text = "Bu cümle hiçbir kaynağa atıfta bulunmayan uzun bir ifadedir."
        s = ParsedSentence(0, long_text, frozenset())
        report = validate_grounding([s], source_count=2, invalid_refs=[])
        assert report.ungrouped_sentences == 1
        assert report.is_fully_grounded is False

    def test_short_sentences_excluded_from_check(self):
        """Sentences shorter than MIN_SENTENCE_CHARS are not evaluated."""
        short = ParsedSentence(0, "Evet.", frozenset())
        assert len(short.text) < MIN_SENTENCE_CHARS
        report = validate_grounding([short], source_count=1, invalid_refs=[])
        assert report.total_sentences == 0
        assert report.is_fully_grounded is True

    def test_invalid_refs_mark_not_fully_grounded(self):
        s = ParsedSentence(0, "Bu uzun cümle kaynağa atıf yapar.", frozenset({1}))
        report = validate_grounding([s], source_count=2, invalid_refs=[99])
        assert report.is_fully_grounded is False
        assert 99 in report.invalid_refs

    def test_empty_sentences_returns_fully_grounded(self):
        report = validate_grounding([], source_count=2, invalid_refs=[])
        assert report.is_fully_grounded is True
        assert report.grounding_ratio == 1.0

    def test_partial_grounding_ratio(self):
        long = "Bu cümle yeterince uzundur grounding testi için."
        s1 = ParsedSentence(0, long, frozenset({1}))
        s2 = ParsedSentence(1, long, frozenset())
        report = validate_grounding([s1, s2], source_count=2, invalid_refs=[])
        assert report.grounding_ratio == 0.5
        assert report.grounded_sentences == 1
        assert report.ungrouped_sentences == 1


# ============================================================================
# E — DisclaimerType enum + LegalDisclaimerEngine.generate()
# ============================================================================

class TestDisclaimerEngine:
    """E. Disclaimer types, severity escalation, and generate() outputs."""

    def test_genel_always_present(self):
        data = disclaimer_engine.generate()
        assert "GENEL_HUKUKI" in data.disclaimer_types

    def test_aym_warning_activates_type(self):
        data = disclaimer_engine.generate(has_aym_warnings=True)
        assert "AYM_IPTAL_UYARISI" in data.disclaimer_types

    def test_lehe_notice_activates_type(self):
        data = disclaimer_engine.generate(has_lehe_notice=True)
        assert "LEHE_KANUN" in data.disclaimer_types

    def test_tier3_activates_uzman_zorunlu(self):
        data = disclaimer_engine.generate(tier_value=3, expert_review_min_tier=3)
        assert "UZMAN_ZORUNLU" in data.disclaimer_types

    def test_tier1_does_not_activate_uzman(self):
        data = disclaimer_engine.generate(tier_value=1, expert_review_min_tier=3)
        assert "UZMAN_ZORUNLU" not in data.disclaimer_types

    def test_aym_warning_produces_critical_severity(self):
        data = disclaimer_engine.generate(has_aym_warnings=True)
        assert data.severity == "CRITICAL"

    def test_lehe_only_produces_warning_severity(self):
        data = disclaimer_engine.generate(has_lehe_notice=True)
        assert data.severity == "WARNING"

    def test_genel_only_produces_info_severity(self):
        data = disclaimer_engine.generate()
        assert data.severity == "INFO"


# ============================================================================
# F — LegalDisclaimerData content
# ============================================================================

class TestLegalDisclaimerData:
    """F. LegalDisclaimerData field values from generate()."""

    def test_disclaimer_text_is_non_empty(self):
        data = disclaimer_engine.generate()
        assert len(data.disclaimer_text) > 50

    def test_requires_expert_false_for_tier1(self):
        data = disclaimer_engine.generate(tier_value=1, expert_review_min_tier=3)
        assert data.requires_expert_review is False

    def test_requires_expert_true_for_tier3(self):
        data = disclaimer_engine.generate(tier_value=3, expert_review_min_tier=3)
        assert data.requires_expert_review is True

    def test_generated_at_is_utc_datetime(self):
        data = disclaimer_engine.generate()
        assert isinstance(data.generated_at, datetime)
        # Should be timezone-aware UTC
        assert data.generated_at.tzinfo is not None


# ============================================================================
# G — api/schemas: AnswerSentence / InlineCitation / LegalDisclaimerSchema
# ============================================================================

class TestStep16Schemas:
    """G. Pydantic schemas for Step 16 zero-trust output."""

    def test_answer_sentence_is_grounded_when_refs_present(self):
        s = AnswerSentence(sentence_id=0, text="Test.", source_refs=[1, 2])
        assert s.is_grounded is True

    def test_answer_sentence_not_grounded_when_no_refs(self):
        s = AnswerSentence(sentence_id=0, text="Test.", source_refs=[])
        assert s.is_grounded is False

    def test_inline_citation_serialises(self):
        ic = InlineCitation(
            sentence_id=0,
            source_indices=[1, 2],
            source_ids=["doc-001", "doc-002"],
        )
        d = ic.model_dump()
        assert d["sentence_id"] == 0
        assert d["source_ids"] == ["doc-001", "doc-002"]

    def test_legal_disclaimer_schema_required_fields(self):
        ld = LegalDisclaimerSchema(
            disclaimer_text="Uyarı metni.",
            disclaimer_types=["GENEL_HUKUKI"],
            severity="INFO",
            requires_expert_review=False,
            generated_at=datetime.now(tz=timezone.utc),
        )
        assert ld.severity == "INFO"
        assert ld.legal_basis is None  # optional

    def test_legal_disclaimer_schema_with_legal_basis(self):
        ld = LegalDisclaimerSchema(
            disclaimer_text="Uyarı.",
            disclaimer_types=["GENEL_HUKUKI", "UZMAN_ZORUNLU"],
            severity="CRITICAL",
            requires_expert_review=True,
            generated_at=datetime.now(tz=timezone.utc),
            legal_basis="Avukatlık Kanunu md. 35",
        )
        assert ld.requires_expert_review is True
        assert "Avukatlık" in ld.legal_basis

    def test_answer_sentence_source_refs_default_empty(self):
        s = AnswerSentence(sentence_id=1, text="Cümle.")
        assert s.source_refs == []

    def test_legal_disclaimer_serialises_to_dict(self):
        ld = LegalDisclaimerSchema(
            disclaimer_text="Test.",
            disclaimer_types=["GENEL_HUKUKI"],
            severity="INFO",
            requires_expert_review=False,
            generated_at=datetime.now(tz=timezone.utc),
        )
        d = ld.model_dump()
        assert "disclaimer_text" in d
        assert "severity" in d
        assert "generated_at" in d


# ============================================================================
# H — RAGResponse.legal_disclaimer auto-generation (model_validator Guard 4)
# ============================================================================

class TestRAGResponseDisclaimerAutoGeneration:
    """H. model_validator Guard 4: legal_disclaimer always populated."""

    def test_disclaimer_auto_generated_when_absent(self):
        resp = _minimal_response()
        # legal_disclaimer was not passed → auto-generated by model_validator
        assert resp.legal_disclaimer is not None
        assert isinstance(resp.legal_disclaimer, LegalDisclaimerSchema)

    def test_auto_disclaimer_always_has_genel_type(self):
        resp = _minimal_response()
        assert "GENEL_HUKUKI" in resp.legal_disclaimer.disclaimer_types

    def test_auto_disclaimer_with_aym_warnings_is_critical(self):
        aym_w = AymWarningSchema(
            document_id="doc-001",
            aym_iptal_durumu="IPTAL_EDILDI",
            warning_text="İptal edildi.",
            is_currently_effective=False,
        )
        resp = _minimal_response(aym_warnings=[aym_w])
        assert resp.legal_disclaimer.severity == "CRITICAL"
        assert "AYM_IPTAL_UYARISI" in resp.legal_disclaimer.disclaimer_types

    def test_auto_disclaimer_with_lehe_notice_is_warning(self):
        notice = LeheKanunNoticeSchema(
            law_domain="CEZA",
            event_date=date(2020, 1, 1),
            decision_date=date(2023, 1, 1),
            reason="TCK md. 7/2",
        )
        resp = _minimal_response(lehe_kanun_notice=notice)
        assert resp.legal_disclaimer.severity in ("WARNING", "CRITICAL")
        assert "LEHE_KANUN" in resp.legal_disclaimer.disclaimer_types

    def test_provided_disclaimer_is_not_overwritten(self):
        custom = LegalDisclaimerSchema(
            disclaimer_text="Özel uyarı.",
            disclaimer_types=["GENEL_HUKUKI"],
            severity="INFO",
            requires_expert_review=False,
            generated_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        resp = _minimal_response(legal_disclaimer=custom)
        assert resp.legal_disclaimer.disclaimer_text == "Özel uyarı."
        assert resp.legal_disclaimer.generated_at == datetime(2025, 1, 1, tzinfo=timezone.utc)

    def test_legal_disclaimer_present_in_model_dump(self):
        resp = _minimal_response()
        d = resp.model_dump()
        assert "legal_disclaimer" in d
        assert d["legal_disclaimer"] is not None
        assert "disclaimer_text" in d["legal_disclaimer"]


# ============================================================================
# I — RAGService integration: numbered context + citation + disclaimer
# ============================================================================

class TestRAGServiceStep16Integration:
    """I. RAGService produces Step 16 outputs (mocked LLM + retrieval)."""

    def _make_doc(self, doc_id: str, content: str, citation: str, score: float):
        """Build a minimal LegalDocument-like mock."""
        from domain.entities.legal_document import LegalDocument
        doc = MagicMock(spec=LegalDocument)
        doc.id = doc_id
        doc.content = content
        doc.citation = citation
        doc.final_score = score
        doc.court_level = None
        doc.ruling_date = None
        doc.source_url = None
        doc.version = None
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
            self._make_doc("d1", "İhbar süresi 4 haftadır.", "İş Kanunu md. 17", 0.9),
            self._make_doc("d2", "Kıdem tazminatı her yıl için 30 günlük ücrettir.", "İş Kanunu md. 14", 0.8),
        ]

        # Mock RRF search
        mock_rrf = MagicMock()
        mock_rrf_result = MagicMock()
        mock_rrf_result.documents = docs
        mock_rrf.search = AsyncMock(return_value=mock_rrf_result)

        # Mock reranker (pass-through)
        mock_reranker = MagicMock()
        mock_reranker.rerank = MagicMock(
            return_value=[MagicMock(document=d) for d in docs]
        )

        # Mock context builder
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

        # Mock router — Tier 1 response with [K:1] citation
        mock_router = MagicMock()
        mock_router.decide = MagicMock(
            return_value=TierDecision(
                tier=QueryTier.TIER1,
                model_id="llama-3.3-70b-versatile",
                provider="groq",
                reason="test",
            )
        )
        mock_router.generate = AsyncMock(
            return_value=(
                "İhbar süresi 4 haftadır. [K:1] Kıdem tazminatı her yıl için 30 gündür. [K:2]",
                "groq/llama-3.3-70b-versatile",
            )
        )

        # Mock tool dispatcher (no-op)
        mock_dispatcher = MagicMock()
        mock_dispatch_result = MagicMock()
        mock_dispatch_result.was_triggered = False
        mock_dispatcher.dispatch = MagicMock(return_value=mock_dispatch_result)

        # Mock graph expander (no-op)
        mock_graph = MagicMock()
        graph_result = MagicMock()
        graph_result.expansion_count = 0
        graph_result.all_docs = docs
        mock_graph.expand = AsyncMock(return_value=graph_result)

        # Mock embedder — avoids real OpenAI API calls in tests
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
    async def test_response_has_legal_disclaimer(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        req = RAGQueryRequest(query="İhbar süresi nedir?")
        resp = await svc.query(req)
        assert resp.legal_disclaimer is not None
        assert isinstance(resp.legal_disclaimer, LegalDisclaimerSchema)

    @pytest.mark.asyncio
    async def test_response_has_answer_sentences(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        req = RAGQueryRequest(
            query="İhbar süresi nedir?",
            strict_grounding=False,
        )
        resp = await svc.query(req)
        assert isinstance(resp.answer_sentences, list)
        # The mocked LLM returns two sentences with [K:1] and [K:2]
        assert len(resp.answer_sentences) >= 1

    @pytest.mark.asyncio
    async def test_response_has_inline_citations(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        req = RAGQueryRequest(
            query="Kıdem tazminatı nasıl hesaplanır?",
            strict_grounding=False,
        )
        resp = await svc.query(req)
        assert isinstance(resp.inline_citations, list)
        # At least one sentence cited a source
        assert len(resp.inline_citations) >= 1

    @pytest.mark.asyncio
    async def test_disclaimer_severity_info_for_tier1(self):
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        req = RAGQueryRequest(query="Deneme süresi nedir?")
        resp = await svc.query(req)
        # Tier 1, no AYM warnings, no lehe notice → INFO
        assert resp.legal_disclaimer.severity == "INFO"

    @pytest.mark.asyncio
    async def test_answer_sentences_source_refs_map_to_docs(self):
        """source_refs in AnswerSentence must be within [1, len(sources)] range."""
        from api.schemas import RAGQueryRequest
        svc = self._make_service()
        req = RAGQueryRequest(
            query="Tazminat hesaplama?",
            strict_grounding=False,
        )
        resp = await svc.query(req)
        assert len(resp.answer_sentences) >= 1
        source_count = len(resp.sources)
        for sentence in resp.answer_sentences:
            for ref in sentence.source_refs:
                assert 1 <= ref <= source_count


# ============================================================================
# J — DUSUK_GROUNDING disclaimer type activation
# ============================================================================

class TestDusukGroundingDisclaimer:
    """J. DUSUK_GROUNDING risk class — grounding ratio threshold enforcement."""

    def test_low_grounding_activates_dusuk_grounding_type(self):
        """grounding_ratio below threshold must add DUSUK_GROUNDING to types."""
        data = disclaimer_engine.generate(grounding_ratio=0.3, min_grounding_ratio=0.5)
        assert "DUSUK_GROUNDING" in data.disclaimer_types

    def test_grounding_at_threshold_not_activated(self):
        """Exactly at threshold (0.5 == 0.5) uses strict less-than — must NOT activate."""
        data = disclaimer_engine.generate(grounding_ratio=0.5, min_grounding_ratio=0.5)
        assert "DUSUK_GROUNDING" not in data.disclaimer_types

    def test_high_grounding_not_activated(self):
        """Well above threshold — must NOT activate."""
        data = disclaimer_engine.generate(grounding_ratio=0.9, min_grounding_ratio=0.5)
        assert "DUSUK_GROUNDING" not in data.disclaimer_types

    def test_low_grounding_produces_critical_severity(self):
        """DUSUK_GROUNDING must escalate overall severity to CRITICAL."""
        data = disclaimer_engine.generate(grounding_ratio=0.2, min_grounding_ratio=0.5)
        assert data.severity == "CRITICAL"

    def test_zero_ratio_activates_and_is_critical(self):
        """Zero grounding (no citations at all) must trigger DUSUK_GROUNDING + CRITICAL."""
        data = disclaimer_engine.generate(grounding_ratio=0.0, min_grounding_ratio=0.5)
        assert "DUSUK_GROUNDING" in data.disclaimer_types
        assert data.severity == "CRITICAL"

    def test_default_call_ratio_1_does_not_activate(self):
        """Default generate() call uses ratio=1.0 — must not trigger DUSUK_GROUNDING."""
        data = disclaimer_engine.generate()
        assert "DUSUK_GROUNDING" not in data.disclaimer_types

    def test_dusuk_grounding_text_warns_about_sources(self):
        """Disclaimer text must reference source-limitation in Turkish."""
        data = disclaimer_engine.generate(grounding_ratio=0.1, min_grounding_ratio=0.5)
        assert "DUSUK_GROUNDING" in data.disclaimer_types
        lowered = data.disclaimer_text.lower()
        assert "kaynak" in lowered or "desteklenmemektedir" in lowered

    def test_dusuk_grounding_combined_with_aym_still_critical(self):
        """Low grounding + AYM warning: both types active, severity CRITICAL."""
        data = disclaimer_engine.generate(
            has_aym_warnings=True,
            grounding_ratio=0.1,
            min_grounding_ratio=0.5,
        )
        assert "AYM_IPTAL_UYARISI" in data.disclaimer_types
        assert "DUSUK_GROUNDING" in data.disclaimer_types
        assert data.severity == "CRITICAL"


# ============================================================================
# K — Post-LLM GROUNDING_HARD_FAIL: answer replaced, sentences cleared
# ============================================================================

class TestGroundingHardFailGate:
    """K. Post-LLM gate: answer and answer_sentences/inline_citations are
    replaced/cleared atomically when grounding_ratio < threshold."""

    def _make_doc(self, doc_id: str, content: str, citation: str, score: float):
        from domain.entities.legal_document import LegalDocument
        doc = MagicMock(spec=LegalDocument)
        doc.id = doc_id
        doc.content = content
        doc.citation = citation
        doc.final_score = score
        doc.court_level = None
        doc.ruling_date = None
        doc.source_url = None
        doc.version = None
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

    def _make_low_grounding_service(self):
        """RAGService whose LLM returns an answer with ZERO [K:N] citations.
        Two long sentences, no markers → grounding_ratio=0.0 < 0.5 → gate fires.
        """
        from infrastructure.context.context_builder import ContextBuildResult
        from infrastructure.llm.tiered_router import QueryTier, TierDecision
        from application.services.rag_service import RAGService

        docs = [
            self._make_doc("d1", "\u0130hbar süresi 4 haftadır.", "\u0130\u015f Kanunu md. 17", 0.9),
            self._make_doc("d2", "Kıdem tazminatı hesaplanır.", "\u0130\u015f Kanunu md. 14", 0.8),
        ]

        mock_rrf = MagicMock()
        mock_rrf_result = MagicMock()
        mock_rrf_result.documents = docs
        mock_rrf.search = AsyncMock(return_value=mock_rrf_result)

        mock_reranker = MagicMock()
        mock_reranker.rerank = MagicMock(
            return_value=[MagicMock(document=d) for d in docs]
        )

        mock_ctx = MagicMock()
        mock_ctx.build = MagicMock(
            return_value=ContextBuildResult(
                context_str="\u0130hbar süresi 4 haftadır. | Kıdem tazminatı hesaplanır.",
                used_docs=docs,
                total_tokens=60,
                dropped_count=0,
                truncated=False,
            )
        )

        mock_router = MagicMock()
        mock_router.decide = MagicMock(
            return_value=TierDecision(
                tier=QueryTier.TIER1,
                model_id="llama-3.3-70b-versatile",
                provider="groq",
                reason="test",
            )
        )
        # Two long sentences with NO [K:N] markers → grounding_ratio = 0.0
        mock_router.generate = AsyncMock(
            return_value=(
                "Bu hukuki konuda kaynaklar yeterince bilgi içermemektedir ve detaylı araştırma gereklidir. "
                "Ayrıca bu meseleye ilişkin içtihat oldukça sınırlı kalmaktadır bu nedenle uzmana danışılmalıdır.",
                "groq/llama-3.3-70b-versatile",
            )
        )

        mock_dispatcher = MagicMock()
        mock_dispatch_result = MagicMock()
        mock_dispatch_result.was_triggered = False
        mock_dispatcher.dispatch = MagicMock(return_value=mock_dispatch_result)

        mock_graph = MagicMock()
        graph_result = MagicMock()
        graph_result.expansion_count = 0
        graph_result.all_docs = docs
        mock_graph.expand = AsyncMock(return_value=graph_result)

        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 1536)

        return RAGService(
            rrf=mock_rrf,
            reranker=mock_reranker,
            ctx_builder=mock_ctx,
            router=mock_router,
            dispatcher=mock_dispatcher,
            graph_expander=mock_graph,
            embedder=mock_embedder,
        )

    @pytest.mark.asyncio
    async def test_answer_replaced_with_safe_refusal(self):
        """Gate fires → answer must equal the module-level _SAFE_REFUSAL text."""
        from api.schemas import RAGQueryRequest
        from application.services.rag_service import _SAFE_REFUSAL
        svc = self._make_low_grounding_service()
        req = RAGQueryRequest(query="Yargıtay kararı nedir?")
        resp = await svc.query(req)
        assert resp.answer == _SAFE_REFUSAL

    @pytest.mark.asyncio
    async def test_answer_sentences_cleared_on_hard_fail(self):
        """Gate fires → answer_sentences must be [] (no hallucinated sentences)."""
        from api.schemas import RAGQueryRequest
        svc = self._make_low_grounding_service()
        req = RAGQueryRequest(query="Yargıtay kararı nedir?")
        resp = await svc.query(req)
        assert resp.answer_sentences == []

    @pytest.mark.asyncio
    async def test_inline_citations_cleared_on_hard_fail(self):
        """Gate fires → inline_citations must be []."""
        from api.schemas import RAGQueryRequest
        svc = self._make_low_grounding_service()
        req = RAGQueryRequest(query="Yargıtay kararı nedir?")
        resp = await svc.query(req)
        assert resp.inline_citations == []

    @pytest.mark.asyncio
    async def test_disclaimer_severity_critical_on_hard_fail(self):
        """Gate fires → DUSUK_GROUNDING active → disclaimer severity must be CRITICAL."""
        from api.schemas import RAGQueryRequest
        svc = self._make_low_grounding_service()
        req = RAGQueryRequest(query="Yargıtay kararı nedir?")
        resp = await svc.query(req)
        assert resp.legal_disclaimer.severity == "CRITICAL"

    @pytest.mark.asyncio
    async def test_disclaimer_contains_dusuk_grounding_on_hard_fail(self):
        """Gate fires → DUSUK_GROUNDING must appear in disclaimer_types."""
        from api.schemas import RAGQueryRequest
        svc = self._make_low_grounding_service()
        req = RAGQueryRequest(query="Yargıtay kararı nedir?")
        resp = await svc.query(req)
        assert "DUSUK_GROUNDING" in resp.legal_disclaimer.disclaimer_types


# ============================================================================
# L — Pre-LLM NoSource Hard-Fail: HTTP 422, LLM never called
# ============================================================================

class TestPreLLMNoSourceHardFail:
    """L. Pre-LLM Hard-Fail gate: empty retrieval → HTTP 422, LLM never called."""

    def _make_empty_retrieval_service(self):
        """RAGService where RRF returns zero documents."""
        from infrastructure.llm.tiered_router import QueryTier, TierDecision
        from application.services.rag_service import RAGService

        mock_rrf = MagicMock()
        mock_rrf_result = MagicMock()
        mock_rrf_result.documents = []  # ← empty retrieval triggers Hard-Fail
        mock_rrf.search = AsyncMock(return_value=mock_rrf_result)

        mock_reranker = MagicMock()
        mock_reranker.rerank = MagicMock(return_value=[])

        mock_router = MagicMock()
        mock_router.decide = MagicMock(
            return_value=TierDecision(
                tier=QueryTier.TIER1,
                model_id="llama-3.3-70b-versatile",
                provider="groq",
                reason="test",
            )
        )
        mock_router.generate = AsyncMock(
            return_value=("Bu bir cevaptır.", "groq/llama-3.3-70b-versatile")
        )

        mock_embedder = MagicMock()
        mock_embedder._model = "text-embedding-3-small"
        mock_embedder.embed_query = AsyncMock(return_value=[0.1] * 1536)

        mock_dispatcher = MagicMock()
        mock_dispatch_result = MagicMock()
        mock_dispatch_result.was_triggered = False
        mock_dispatcher.dispatch = MagicMock(return_value=mock_dispatch_result)

        mock_graph = MagicMock()
        graph_result = MagicMock()
        graph_result.expansion_count = 0
        graph_result.all_docs = []
        mock_graph.expand = AsyncMock(return_value=graph_result)

        return RAGService(
            rrf=mock_rrf,
            reranker=mock_reranker,
            router=mock_router,
            embedder=mock_embedder,
            dispatcher=mock_dispatcher,
            graph_expander=mock_graph,
        )

    @pytest.mark.asyncio
    async def test_empty_retrieval_raises_http_422(self):
        """Zero retrieved docs must raise HTTPException with status 422."""
        from fastapi import HTTPException
        from api.schemas import RAGQueryRequest
        svc = self._make_empty_retrieval_service()
        req = RAGQueryRequest(query="Hiçbir kaynakta bulunmayan çok spesifik bir soru.")
        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)
        assert exc_info.value.status_code == 422

    @pytest.mark.asyncio
    async def test_error_code_is_no_source_hard_fail(self):
        """HTTP 422 detail must carry error_code='NO_SOURCE_HARD_FAIL'."""
        from fastapi import HTTPException
        from api.schemas import RAGQueryRequest
        svc = self._make_empty_retrieval_service()
        req = RAGQueryRequest(query="Hiçbir kaynakta bulunmayan çok spesifik bir soru.")
        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)
        assert exc_info.value.detail["error_code"] == "NO_SOURCE_HARD_FAIL"

    @pytest.mark.asyncio
    async def test_llm_never_called_on_no_source_fail(self):
        """LLM generate() must NOT be called when retrieval returns empty."""
        from fastapi import HTTPException
        from api.schemas import RAGQueryRequest
        svc = self._make_empty_retrieval_service()
        req = RAGQueryRequest(query="Hiçbir kaynakta bulunmayan çok spesifik bir soru.")
        with pytest.raises(HTTPException):
            await svc.query(req)
        svc._router.generate.assert_not_called()

    @pytest.mark.asyncio
    async def test_detail_llm_called_false(self):
        """HTTP 422 detail must report llm_called=False."""
        from fastapi import HTTPException
        from api.schemas import RAGQueryRequest
        svc = self._make_empty_retrieval_service()
        req = RAGQueryRequest(query="Hiçbir kaynakta bulunmayan çok spesifik bir soru.")
        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)
        assert exc_info.value.detail["llm_called"] is False

    @pytest.mark.asyncio
    async def test_detail_includes_guidance_actions_and_intent(self):
        """HTTP 422 detail should include user-facing recovery actions."""
        from fastapi import HTTPException
        from api.schemas import RAGQueryRequest

        svc = self._make_empty_retrieval_service()
        req = RAGQueryRequest(query="Borclar Kanunu kapsaminda cok spesifik bir durum")
        with pytest.raises(HTTPException) as exc_info:
            await svc.query(req)

        detail = exc_info.value.detail
        assert detail["intent_class"] in {
            "legal_query",
            "legal_drafting",
            "legal_analysis",
            "document_task",
        }
        assert isinstance(detail["strict_grounding"], bool)
        assert isinstance(detail["guidance_actions"], list)
        assert "Sorguyu daralt" in detail["guidance_actions"]
        assert "Case sec" in detail["guidance_actions"]
