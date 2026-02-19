"""
Tests — Gap 2: Tier 4 Reasoning Model (o1 / o3-mini) Support
==============================================================
Tests for the reasoning-model extension added to infrastructure/llm/tiered_router.py
and infrastructure/audit/cost_tracker.py.

Groups:
    A  (5): is_reasoning_model() pure function
    B  (4): _build_reasoning_messages() pure function
    C  (3): TierDecision.is_reasoning_model field
    D  (7): _resolve() reasoning override — tier routing decisions
    E  (5): _discover_available_tiers() reasoning mode provider discovery
    F  (4): CostTracker — o3-mini and o1 model rates
    G  (6): generate() / _invoke() integration (mocked API calls)

Total: 34 tests
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from infrastructure.llm.tiered_router import (
    LLMTieredRouter,
    QueryTier,
    TierDecision,
    _build_reasoning_messages,
    _REASONING_MODELS,
    is_reasoning_model,
)
from infrastructure.audit.cost_tracker import (
    CostTracker,
    estimate_cost,
    _MODEL_RATES,
    _strip_model_prefix,
)
from langchain_core.messages import HumanMessage, SystemMessage


# ============================================================================
# Helpers
# ============================================================================

def _text_of_tokens(n: int) -> str:
    """Generates a string that estimates to approximately n tokens (×4 chars)."""
    return "a" * (n * 4)


def _make_router_standard(
    openai_key: str = "sk-test",
    groq_key: str = "gsk_test",
    anthropic_key: str = "",
) -> LLMTieredRouter:
    """Standard router — use_reasoning=False, no Tier 4 unless anthropic_key given."""
    with patch("infrastructure.llm.tiered_router.settings") as m:
        m.openai_api_key = openai_key
        m.groq_api_key = groq_key
        m.anthropic_api_key = anthropic_key
        m.llm_tier1_model = "llama-3.3-70b-versatile"
        m.llm_tier2_model = "gpt-4o-mini"
        m.llm_tier3_model = "gpt-4o"
        m.llm_tier4_model = "claude-3-5-sonnet-20241022"
        m.llm_tier1_max_context_tokens = 800
        m.llm_tier2_max_context_tokens = 2500
        m.llm_tier3_max_context_tokens = 5000
        m.llm_max_response_tokens = 2048
        m.llm_tier4_use_reasoning = False
        m.llm_tier4_reasoning_model = "o3-mini"
        m.llm_tier4_reasoning_effort = "medium"
        return LLMTieredRouter()


def _make_router_reasoning(
    openai_key: str = "sk-test",
    groq_key: str = "gsk_test",
    reasoning_model: str = "o3-mini",
    reasoning_effort: str = "medium",
) -> LLMTieredRouter:
    """Reasoning router — use_reasoning=True, Tier 4 via OpenAI o3-mini/o1."""
    with patch("infrastructure.llm.tiered_router.settings") as m:
        m.openai_api_key = openai_key
        m.groq_api_key = groq_key
        m.anthropic_api_key = ""
        m.llm_tier1_model = "llama-3.3-70b-versatile"
        m.llm_tier2_model = "gpt-4o-mini"
        m.llm_tier3_model = "gpt-4o"
        m.llm_tier4_model = "claude-3-5-sonnet-20241022"
        m.llm_tier1_max_context_tokens = 800
        m.llm_tier2_max_context_tokens = 2500
        m.llm_tier3_max_context_tokens = 5000
        m.llm_max_response_tokens = 2048
        m.llm_tier4_use_reasoning = True
        m.llm_tier4_reasoning_model = reasoning_model
        m.llm_tier4_reasoning_effort = reasoning_effort
        return LLMTieredRouter()


def _decide_mock(
    use_reasoning: bool = True,
    model: str = "o3-mini",
    effort: str = "medium",
) -> MagicMock:
    """Returns a pre-configured MagicMock for settings used inside decide() calls."""
    m = MagicMock()
    m.llm_tier1_max_context_tokens = 800
    m.llm_tier2_max_context_tokens = 2500
    m.llm_tier3_max_context_tokens = 5000
    m.llm_tier1_model = "llama-3.3-70b-versatile"
    m.llm_tier2_model = "gpt-4o-mini"
    m.llm_tier3_model = "gpt-4o"
    m.llm_tier4_model = "claude-3-5-sonnet-20241022"
    m.llm_tier4_use_reasoning = use_reasoning
    m.llm_tier4_reasoning_model = model
    m.llm_tier4_reasoning_effort = effort
    m.llm_tier4_multi_agent_enabled = False   # Gap 3: explicit False prevents MagicMock truthy
    m.llm_max_response_tokens = 2048
    return m


# ============================================================================
# Group A — is_reasoning_model() pure function
# ============================================================================

class TestIsReasoningModel:

    def test_A1_o3_mini_is_reasoning(self):
        assert is_reasoning_model("o3-mini") is True

    def test_A2_o1_is_reasoning(self):
        assert is_reasoning_model("o1") is True

    def test_A3_o1_mini_is_reasoning(self):
        assert is_reasoning_model("o1-mini") is True

    def test_A4_gpt4o_is_not_reasoning(self):
        assert is_reasoning_model("gpt-4o") is False

    def test_A5_provider_prefix_stripped_before_lookup(self):
        """'openai/o3-mini' should still return True after stripping prefix."""
        assert is_reasoning_model("openai/o3-mini") is True

    def test_A6_fallback_suffix_stripped_before_lookup(self):
        """'o3-mini+fallback' should still return True."""
        assert is_reasoning_model("o3-mini+fallback") is True

    def test_A7_claude_is_not_reasoning(self):
        assert is_reasoning_model("claude-3-5-sonnet-20241022") is False


# ============================================================================
# Group B — _build_reasoning_messages() pure function
# ============================================================================

class TestBuildReasoningMessages:

    def test_B1_returns_single_human_message(self):
        """Must return exactly one HumanMessage."""
        msgs = [
            SystemMessage(content="System instructions here."),
            HumanMessage(content="User query here."),
        ]
        result = _build_reasoning_messages(msgs)
        assert len(result) == 1
        assert isinstance(result[0], HumanMessage)

    def test_B2_system_instructions_header_present(self):
        """Merged message must start with [SYSTEM INSTRUCTIONS] header."""
        msgs = [
            SystemMessage(content="You are a legal assistant."),
            HumanMessage(content="What is TMK 706?"),
        ]
        result = _build_reasoning_messages(msgs)
        content = str(result[0].content)
        assert "[SYSTEM INSTRUCTIONS]" in content

    def test_B3_system_content_and_user_content_both_preserved(self):
        """Both the system prompt text and the user query must appear in merged message."""
        sys_text = "Sadece kaynaklara dayan."
        user_text = "AYM kararı nedir?"
        msgs = [SystemMessage(content=sys_text), HumanMessage(content=user_text)]
        result = _build_reasoning_messages(msgs)
        content = str(result[0].content)
        assert sys_text in content
        assert user_text in content

    def test_B4_no_system_message_returns_user_content_unchanged(self):
        """When no SystemMessage is present, user content is returned as-is."""
        user_text = "Sadece kullanıcı mesajı."
        msgs = [HumanMessage(content=user_text)]
        result = _build_reasoning_messages(msgs)
        assert len(result) == 1
        assert str(result[0].content) == user_text


# ============================================================================
# Group C — TierDecision.is_reasoning_model field
# ============================================================================

class TestTierDecisionReasoningField:

    def test_C1_default_is_reasoning_model_is_false(self):
        """Default TierDecision should have is_reasoning_model=False."""
        d = TierDecision(
            tier=QueryTier.TIER2,
            model_id="gpt-4o-mini",
            provider="openai",
            reason="test",
        )
        assert d.is_reasoning_model is False

    def test_C2_can_construct_with_is_reasoning_model_true(self):
        """Should be possible to create a TierDecision with is_reasoning_model=True."""
        d = TierDecision(
            tier=QueryTier.TIER4,
            model_id="o3-mini",
            provider="openai",
            reason="REASONING/o3-mini",
            is_reasoning_model=True,
        )
        assert d.is_reasoning_model is True

    def test_C3_standard_router_decide_returns_false_for_tier1(self):
        """Standard (non-reasoning) router's decide() must return is_reasoning_model=False."""
        router = _make_router_standard()
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock(use_reasoning=False)):
            decision = router.decide(
                query="İhbar tazminatı nedir?",
                context=_text_of_tokens(100),
                source_count=1,
            )
        assert decision.is_reasoning_model is False


# ============================================================================
# Group D — _resolve() reasoning override routing decisions
# ============================================================================

class TestResolveReasoningOverride:

    def test_D1_tier4_query_sets_is_reasoning_model_true(self):
        """When use_reasoning=True + Tier4 desired + Tier4 available → is_reasoning_model=True."""
        router = _make_router_reasoning()
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock(use_reasoning=True)):
            decision = router.decide(
                query="AYM iptal kararı analizi istiyorum",  # → Tier4
                context=_text_of_tokens(100),
                source_count=2,
            )
        assert decision.is_reasoning_model is True

    def test_D2_model_id_equals_reasoning_model_setting(self):
        """Decision model_id must be llm_tier4_reasoning_model."""
        router = _make_router_reasoning(reasoning_model="o3-mini")
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock(model="o3-mini")):
            decision = router.decide(
                query="AYM bireysel başvuru hakkı",
                context=_text_of_tokens(100),
                source_count=2,
            )
        assert decision.model_id == "o3-mini"

    def test_D3_provider_is_openai_for_reasoning(self):
        """Reasoning path must use 'openai' as provider (not 'anthropic')."""
        router = _make_router_reasoning()
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock()):
            decision = router.decide(
                query="AYM iptal kararı",
                context=_text_of_tokens(100),
                source_count=2,
            )
        assert decision.provider == "openai"

    def test_D4_reason_contains_reasoning_keyword(self):
        """Decision reason string must contain 'REASONING' for audit traceability."""
        router = _make_router_reasoning()
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock()):
            decision = router.decide(
                query="AYM anayasaya aykırılık",
                context=_text_of_tokens(100),
                source_count=2,
            )
        assert "REASONING" in decision.reason

    def test_D5_tier1_query_does_not_trigger_reasoning_override(self):
        """Reasoning override only applies to Tier 4; simple Tier 1 queries must use Groq."""
        router = _make_router_reasoning()
        with patch("infrastructure.llm.tiered_router.settings", _decide_mock()):
            decision = router.decide(
                query="İhbar tazminatı nedir?",  # simple → Tier1
                context=_text_of_tokens(100),
                source_count=1,
            )
        assert decision.is_reasoning_model is False
        assert decision.tier == QueryTier.TIER1

    def test_D6_use_reasoning_false_standard_tier4_path(self):
        """When use_reasoning=False, Tier4 path is NOT triggered even for AYM keywords."""
        router = _make_router_standard(anthropic_key="sk-anthropic")
        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=False)):
            decision = router.decide(
                query="AYM bireysel başvuru",
                context=_text_of_tokens(100),
                source_count=2,
            )
        assert decision.is_reasoning_model is False

    def test_D7_tier3_query_in_reasoning_mode_does_not_trigger_reasoning(self):
        """Reasoning override only triggers for TIER4 — Tier3 queries must skip it."""
        router = _make_router_reasoning()
        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True)):
            # "analiz et" keyword → Tier3; small context → no higher promotion
            decision = router.decide(
                query="Bu hukuki sözleşmeyi analiz et",  # → Tier3 keyword
                context=_text_of_tokens(100),
                source_count=1,
            )
        # Tier3 decision must NOT be a reasoning model
        assert decision.is_reasoning_model is False
        assert decision.tier == QueryTier.TIER3


# ============================================================================
# Group E — _discover_available_tiers() reasoning mode provider discovery
# ============================================================================

class TestDiscoverAvailableTiersReasoning:

    def test_E1_use_reasoning_true_openai_key_adds_tier4(self):
        """use_reasoning=True + openai_api_key → Tier 4 must be in available."""
        router = _make_router_reasoning(openai_key="sk-test")
        assert QueryTier.TIER4 in router._available

    def test_E2_use_reasoning_true_no_openai_key_tier4_unavailable(self):
        """use_reasoning=True + no openai_api_key → Tier 4 NOT in available."""
        with patch("infrastructure.llm.tiered_router.settings") as m:
            m.openai_api_key = ""   # No OpenAI key — both Tier2/3 and reasoning Tier4 blocked
            m.groq_api_key = "gsk_test"  # Only Groq → Tier1 available
            m.anthropic_api_key = ""
            m.llm_tier1_model = "llama-3.3-70b-versatile"
            m.llm_tier2_model = "gpt-4o-mini"
            m.llm_tier3_model = "gpt-4o"
            m.llm_tier4_model = "claude-3-5-sonnet-20241022"
            m.llm_tier1_max_context_tokens = 800
            m.llm_tier2_max_context_tokens = 2500
            m.llm_tier3_max_context_tokens = 5000
            m.llm_max_response_tokens = 2048
            m.llm_tier4_use_reasoning = True
            m.llm_tier4_reasoning_model = "o3-mini"
            m.llm_tier4_reasoning_effort = "medium"
            router = LLMTieredRouter()  # Tier1 only — succeeds

        assert QueryTier.TIER4 not in router._available

    def test_E3_use_reasoning_false_anthropic_key_adds_tier4(self):
        """use_reasoning=False + anthropic_api_key → Tier4 available via standard path."""
        router = _make_router_standard(anthropic_key="sk-anthropic")
        assert QueryTier.TIER4 in router._available

    def test_E4_use_reasoning_false_no_anthropic_key_tier4_unavailable(self):
        """use_reasoning=False + no anthropic_api_key → Tier4 NOT available."""
        router = _make_router_standard(anthropic_key="")
        assert QueryTier.TIER4 not in router._available

    def test_E5_reasoning_mode_tier4_does_not_need_anthropic_key(self):
        """When use_reasoning=True, Tier4 is added with openai_key even without anthropic."""
        router = _make_router_reasoning(openai_key="sk-test")
        # Tier4 in available despite anthropic_key="" (set in _make_router_reasoning)
        assert QueryTier.TIER4 in router._available


# ============================================================================
# Group F — CostTracker with reasoning model rates
# ============================================================================

class TestCostTrackerReasoningRates:

    def test_F1_o3_mini_rate_in_pricing_table(self):
        """o3-mini must be in _MODEL_RATES with correct rates."""
        assert "o3-mini" in _MODEL_RATES
        rate_in, rate_out = _MODEL_RATES["o3-mini"]
        assert rate_in == pytest.approx(1.10)
        assert rate_out == pytest.approx(4.40)

    def test_F2_o1_rate_in_pricing_table(self):
        """o1 must be in _MODEL_RATES with correct rates."""
        assert "o1" in _MODEL_RATES
        rate_in, rate_out = _MODEL_RATES["o1"]
        assert rate_in == pytest.approx(15.00)
        assert rate_out == pytest.approx(60.00)

    def test_F3_o1_mini_rate_in_pricing_table(self):
        """o1-mini must be in _MODEL_RATES with correct rates."""
        assert "o1-mini" in _MODEL_RATES
        rate_in, rate_out = _MODEL_RATES["o1-mini"]
        assert rate_in == pytest.approx(3.00)
        assert rate_out == pytest.approx(12.00)

    def test_F4_openai_prefix_stripped_for_o3_mini_cost(self):
        """'openai/o3-mini' label must resolve to o3-mini rates (not _default)."""
        est = estimate_cost(
            model_id="openai/o3-mini",
            tier=4,
            query="AYM kararı nedir?",
            context="Kaynak 1: AYM kararı metni.",
            answer="AYM kararı açıklaması.",
        )
        assert est.rate_per_1m_in == pytest.approx(1.10)
        assert est.rate_per_1m_out == pytest.approx(4.40)
        assert est.total_cost_usd > 0.0


# ============================================================================
# Group G — generate() / _invoke() integration (mocked API calls)
# ============================================================================

class TestGenerateReasoningIntegration:

    @pytest.mark.asyncio
    async def test_G1_model_label_contains_reasoning_model_id(self):
        """generate() model_label must include 'o3-mini' when reasoning mode is on."""
        router = _make_router_reasoning(reasoning_model="o3-mini")
        router._invoke = AsyncMock(return_value="Hukuki yanıt.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True, model="o3-mini")):
            answer, model_label = await router.generate(
                query="AYM bireysel başvuru",  # → Tier4
                context=_text_of_tokens(100),
                source_count=2,
            )

        assert "o3-mini" in model_label
        assert answer == "Hukuki yanıt."

    @pytest.mark.asyncio
    async def test_G2_no_fallback_suffix_for_direct_reasoning_hit(self):
        """When reasoning Tier4 is directly available, '+fallback' must NOT appear."""
        router = _make_router_reasoning()
        router._invoke = AsyncMock(return_value="Yanıt.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True)):
            _, model_label = await router.generate(
                query="AYM anayasaya aykırılık",
                context=_text_of_tokens(100),
                source_count=2,
            )

        assert "+fallback" not in model_label

    @pytest.mark.asyncio
    async def test_G3_invoke_routing_calls_invoke_reasoning_for_reasoning_decision(self):
        """_invoke() must call _invoke_reasoning when decision.is_reasoning_model=True."""
        router = _make_router_reasoning()
        router._invoke_reasoning = AsyncMock(return_value="Reasoning yanıtı.")

        decision = TierDecision(
            tier=QueryTier.TIER4,
            model_id="o3-mini",
            provider="openai",
            reason="REASONING/o3-mini",
            is_reasoning_model=True,
        )
        messages = [
            SystemMessage(content="Türk hukuku asistanısın."),
            HumanMessage(content="AYM kararı nedir?"),
        ]

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True)):
            result = await router._invoke(decision, messages)

        assert result == "Reasoning yanıtı."
        router._invoke_reasoning.assert_called_once()

    @pytest.mark.asyncio
    async def test_G4_invoke_reasoning_receives_merged_single_human_message(self):
        """_invoke() must pass a single merged HumanMessage to _invoke_reasoning."""
        router = _make_router_reasoning()

        captured_messages = []

        async def _capture(decision, msgs):
            captured_messages.extend(msgs)
            return "ok"

        router._invoke_reasoning = _capture

        decision = TierDecision(
            tier=QueryTier.TIER4,
            model_id="o3-mini",
            provider="openai",
            reason="test",
            is_reasoning_model=True,
        )
        messages = [
            SystemMessage(content="System instructions."),
            HumanMessage(content="User question."),
        ]

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True)):
            await router._invoke(decision, messages)

        assert len(captured_messages) == 1
        assert isinstance(captured_messages[0], HumanMessage)

    @pytest.mark.asyncio
    async def test_G5_standard_tier1_still_uses_normal_invoke_path(self):
        """Non-reasoning decision (Tier1) must not call _invoke_reasoning."""
        router = _make_router_reasoning()
        router._invoke_reasoning = AsyncMock(return_value="should not be called")

        decision = TierDecision(
            tier=QueryTier.TIER1,
            model_id="llama-3.3-70b-versatile",
            provider="groq",
            reason="tier=1",
            is_reasoning_model=False,  # Standard path
        )
        messages = [
            SystemMessage(content="sys"),
            HumanMessage(content="İhbar nedir?"),
        ]

        # Mock the Groq call so no real API is hit
        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=False)):
            with patch("langchain_groq.ChatGroq") as mock_groq_cls:
                mock_instance = MagicMock()
                mock_instance.ainvoke = AsyncMock(return_value=MagicMock(content="Groq yanıtı."))
                mock_groq_cls.return_value = mock_instance
                try:
                    await router._invoke(decision, messages)
                except Exception:
                    pass  # We only care that _invoke_reasoning was NOT called

        router._invoke_reasoning.assert_not_called()

    @pytest.mark.asyncio
    async def test_G6_o1_model_generates_correct_model_label(self):
        """When reasoning_model='o1', model_label must be 'openai/o1'."""
        router = _make_router_reasoning(reasoning_model="o1")
        router._invoke = AsyncMock(return_value="O1 yanıtı.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock(use_reasoning=True, model="o1")):
            _, model_label = await router.generate(
                query="AYM bireysel başvuru hakkı ihlali",
                context=_text_of_tokens(100),
                source_count=2,
            )

        assert "openai/o1" in model_label
