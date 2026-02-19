"""
Tests — Gap 3: Multi-Agent Chain (Researcher → Critic → Synthesizer)
=====================================================================
Covers:
    A (5):  Config defaults + MultiAgentChain init
    B (4):  ResearchResult dataclass
    C (4):  CriticResult dataclass
    D (5):  _strip_code_fences() pure helper
    E (6):  _run_researcher() — JSON parsing and LLM call
    F (6):  _run_critic() — validation logic and LLM call
    G (6):  _run_synthesizer() — synthesis with/without critic warnings
    H (6):  router generate() integration with multi-agent dispatch

Total: 42 tests
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from infrastructure.agents.multi_agent_chain import (
    CriticResult,
    MultiAgentChain,
    ResearchResult,
    _CRITIC_SYSTEM,
    _RESEARCHER_SYSTEM,
    _SYNTHESIZER_SYSTEM,
    _strip_code_fences,
)
from infrastructure.llm.tiered_router import (
    LLMTieredRouter,
    QueryTier,
    TierDecision,
)


# ============================================================================
# Helpers
# ============================================================================

def _claude_decision() -> TierDecision:
    return TierDecision(
        tier=QueryTier.TIER4,
        model_id="claude-3-5-sonnet-20241022",
        provider="anthropic",
        reason="tier=4 test",
        is_reasoning_model=False,
    )


def _reasoning_decision() -> TierDecision:
    return TierDecision(
        tier=QueryTier.TIER4,
        model_id="o3-mini",
        provider="openai",
        reason="REASONING/o3-mini",
        is_reasoning_model=True,
    )


def _researcher_json(**overrides) -> str:
    data = {
        "summary": "TMK 706 taşınmaz devri zorunlu resmi şekli öngörür.",
        "key_findings": ["Resmi şekil zorunludur", "Noter tasdiki gereklidir"],
        "relevant_source_indices": [0, 1],
        "legal_principles": ["Resmiyet ilkesi — TMK 706"],
        "contradictions": [],
    }
    data.update(overrides)
    return json.dumps(data, ensure_ascii=False)


def _critic_json(**overrides) -> str:
    data = {
        "passed": True,
        "confidence": 0.92,
        "issues": [],
        "verified_findings": ["Resmi şekil zorunludur"],
        "notes": "Bulgular kaynaklarla uyumlu.",
    }
    data.update(overrides)
    return json.dumps(data, ensure_ascii=False)


# ============================================================================
# Group A — Config defaults + MultiAgentChain init
# ============================================================================

class TestConfigAndInit:

    def test_A1_multi_agent_enabled_default_is_false(self):
        """settings.llm_tier4_multi_agent_enabled must default to False."""
        from infrastructure.config import settings
        assert settings.llm_tier4_multi_agent_enabled is False

    def test_A2_can_instantiate_with_claude_decision(self):
        """MultiAgentChain must accept an anthropic TierDecision."""
        chain = MultiAgentChain(decision=_claude_decision())
        assert chain.decision.provider == "anthropic"

    def test_A3_can_instantiate_with_reasoning_decision(self):
        """MultiAgentChain must accept a reasoning-model TierDecision."""
        chain = MultiAgentChain(decision=_reasoning_decision())
        assert chain.decision.is_reasoning_model is True

    def test_A4_researcher_system_prompt_contains_turkish_legal_keywords(self):
        """Researcher system prompt must contain domain-specific Turkish keywords."""
        assert "araştırma" in _RESEARCHER_SYSTEM.lower()
        assert "kaynak" in _RESEARCHER_SYSTEM.lower()

    def test_A5_system_prompts_are_distinct(self):
        """All three system prompts must be distinct strings."""
        assert _RESEARCHER_SYSTEM != _CRITIC_SYSTEM
        assert _CRITIC_SYSTEM != _SYNTHESIZER_SYSTEM
        assert _RESEARCHER_SYSTEM != _SYNTHESIZER_SYSTEM


# ============================================================================
# Group B — ResearchResult dataclass
# ============================================================================

class TestResearchResult:

    def test_B1_default_summary_is_empty_string(self):
        assert ResearchResult().summary == ""

    def test_B2_default_lists_are_empty(self):
        r = ResearchResult()
        assert r.key_findings == []
        assert r.relevant_source_indices == []
        assert r.legal_principles == []
        assert r.contradictions == []

    def test_B3_can_construct_with_data(self):
        r = ResearchResult(
            summary="Özet",
            key_findings=["Bulgu"],
            relevant_source_indices=[0],
        )
        assert r.summary == "Özet"
        assert r.key_findings == ["Bulgu"]

    def test_B4_raw_response_defaults_to_empty_string(self):
        assert ResearchResult().raw_response == ""


# ============================================================================
# Group C — CriticResult dataclass
# ============================================================================

class TestCriticResult:

    def test_C1_default_passed_is_true(self):
        assert CriticResult().passed is True

    def test_C2_default_confidence_is_one(self):
        assert CriticResult().confidence == pytest.approx(1.0)

    def test_C3_default_issues_is_empty(self):
        assert CriticResult().issues == []

    def test_C4_can_construct_failed_result(self):
        r = CriticResult(
            passed=False,
            confidence=0.3,
            issues=["Madde numarası kaynakta yok"],
        )
        assert r.passed is False
        assert r.issues == ["Madde numarası kaynakta yok"]


# ============================================================================
# Group D — _strip_code_fences() pure helper
# ============================================================================

class TestStripCodeFences:

    def test_D1_plain_json_unchanged(self):
        s = '{"key": "value"}'
        assert _strip_code_fences(s) == s

    def test_D2_json_fences_removed(self):
        s = '```json\n{"key": "value"}\n```'
        result = _strip_code_fences(s)
        assert result == '{"key": "value"}'

    def test_D3_bare_backtick_fences_removed(self):
        s = '```\n{"key": "value"}\n```'
        result = _strip_code_fences(s)
        assert result == '{"key": "value"}'

    def test_D4_result_is_valid_json_after_stripping(self):
        s = '```json\n{"summary": "test", "findings": []}\n```'
        result = _strip_code_fences(s)
        data = json.loads(result)
        assert data["summary"] == "test"

    def test_D5_empty_string_stays_empty(self):
        assert _strip_code_fences("") == ""


# ============================================================================
# Group E — _run_researcher() with mocked _call_llm
# ============================================================================

class TestRunResearcher:

    @pytest.mark.asyncio
    async def test_E1_returns_research_result_instance(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_researcher_json())
        result = await chain._run_researcher("TMK 706 nedir?", "K:1 — TMK 706 metni.")
        assert isinstance(result, ResearchResult)

    @pytest.mark.asyncio
    async def test_E2_json_summary_parsed_correctly(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_researcher_json())
        result = await chain._run_researcher("TMK 706 nedir?", "K:1 — ...")
        assert "TMK 706" in result.summary

    @pytest.mark.asyncio
    async def test_E3_key_findings_list_populated(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_researcher_json())
        result = await chain._run_researcher("soru", "bağlam")
        assert len(result.key_findings) == 2
        assert "Resmi şekil zorunludur" in result.key_findings

    @pytest.mark.asyncio
    async def test_E4_non_json_response_falls_back_to_raw_summary(self):
        """When the LLM returns plain text, summary = raw and lists stay empty."""
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value="Bu bir düz metin yanıtıdır.")
        result = await chain._run_researcher("soru", "bağlam")
        assert result.summary == "Bu bir düz metin yanıtıdır."
        assert result.key_findings == []

    @pytest.mark.asyncio
    async def test_E5_code_fenced_json_parsed_correctly(self):
        """JSON wrapped in ``` code fences must still be parsed."""
        fenced = f"```json\n{_researcher_json()}\n```"
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=fenced)
        result = await chain._run_researcher("soru", "bağlam")
        assert result.key_findings != []

    @pytest.mark.asyncio
    async def test_E6_raw_response_always_stored(self):
        """raw_response must contain the verbatim LLM output."""
        raw = _researcher_json()
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=raw)
        result = await chain._run_researcher("soru", "bağlam")
        assert result.raw_response == raw


# ============================================================================
# Group F — _run_critic() with mocked _call_llm
# ============================================================================

class TestRunCritic:

    def _make_research(self) -> ResearchResult:
        return ResearchResult(
            summary="TMK 706 resmi şekil gerektiriyor.",
            key_findings=["Resmi şekil zorunlu"],
            legal_principles=["TMK 706"],
        )

    @pytest.mark.asyncio
    async def test_F1_returns_critic_result_instance(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_critic_json())
        result = await chain._run_critic("soru", "bağlam", self._make_research())
        assert isinstance(result, CriticResult)

    @pytest.mark.asyncio
    async def test_F2_passed_true_when_json_passed_true(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_critic_json(passed=True))
        result = await chain._run_critic("soru", "bağlam", self._make_research())
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_F3_passed_false_when_json_passed_false(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(
            return_value=_critic_json(
                passed=False,
                issues=["Madde 706a kaynakta bulunmuyor"],
                confidence=0.3,
            )
        )
        result = await chain._run_critic("soru", "bağlam", self._make_research())
        assert result.passed is False
        assert len(result.issues) == 1

    @pytest.mark.asyncio
    async def test_F4_non_json_falls_back_to_passed_true(self):
        """Unparseable critic output defaults to passed=True (safe fallback)."""
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value="Anlaşılır bir metin.")
        result = await chain._run_critic("soru", "bağlam", self._make_research())
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_F5_confidence_score_parsed(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value=_critic_json(confidence=0.75))
        result = await chain._run_critic("soru", "bağlam", self._make_research())
        assert result.confidence == pytest.approx(0.75)

    @pytest.mark.asyncio
    async def test_F6_research_summary_included_in_user_content(self):
        """Critic user content must reference the research summary."""
        chain = MultiAgentChain(decision=_claude_decision())
        captured_user_contents = []

        async def _spy_call_llm(system_prompt: str, user_content: str) -> str:
            captured_user_contents.append(user_content)
            return _critic_json()

        chain._call_llm = _spy_call_llm
        research = self._make_research()
        await chain._run_critic("soru", "bağlam", research)
        assert research.summary in captured_user_contents[0]


# ============================================================================
# Group G — _run_synthesizer() with mocked _call_llm
# ============================================================================

class TestRunSynthesizer:

    def _make_research(self) -> ResearchResult:
        return ResearchResult(
            summary="Özet bilgi.",
            key_findings=["Bulgu A"],
            legal_principles=["TMK 706"],
        )

    @pytest.mark.asyncio
    async def test_G1_returns_string(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value="Hukuki yanıt metni [K:1].")
        result = await chain._run_synthesizer(
            "soru", "bağlam", self._make_research(), CriticResult()
        )
        assert isinstance(result, str)

    @pytest.mark.asyncio
    async def test_G2_returns_non_empty_string(self):
        chain = MultiAgentChain(decision=_claude_decision())
        chain._call_llm = AsyncMock(return_value="Yanıt.")
        result = await chain._run_synthesizer(
            "soru", "bağlam", self._make_research(), CriticResult()
        )
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_G3_no_warning_block_when_critique_passed(self):
        """When critique.passed=True, DENETİM UYARILARI block must NOT appear."""
        chain = MultiAgentChain(decision=_claude_decision())
        captured = []

        async def _spy(system_prompt, user_content):
            captured.append(user_content)
            return "Yanıt."

        chain._call_llm = _spy
        await chain._run_synthesizer(
            "soru", "bağlam", self._make_research(), CriticResult(passed=True)
        )
        assert "DENETİM UYARILARI" not in captured[0]

    @pytest.mark.asyncio
    async def test_G4_warning_block_present_when_critique_failed(self):
        """When critique.passed=False with issues, DENETİM UYARILARI must appear."""
        chain = MultiAgentChain(decision=_claude_decision())
        captured = []

        async def _spy(system_prompt, user_content):
            captured.append(user_content)
            return "Yanıt."

        chain._call_llm = _spy
        critique = CriticResult(passed=False, issues=["Madde numarası hatalı"])
        await chain._run_synthesizer("soru", "bağlam", self._make_research(), critique)
        assert "DENETİM UYARILARI" in captured[0]
        assert "Madde numarası hatalı" in captured[0]

    @pytest.mark.asyncio
    async def test_G5_research_summary_in_synthesizer_user_content(self):
        """Synthesizer must receive the research summary."""
        chain = MultiAgentChain(decision=_claude_decision())
        captured = []

        async def _spy(system_prompt, user_content):
            captured.append(user_content)
            return "ok"

        chain._call_llm = _spy
        research = self._make_research()
        await chain._run_synthesizer("soru", "bağlam", research, CriticResult())
        assert research.summary in captured[0]

    @pytest.mark.asyncio
    async def test_G6_query_in_synthesizer_user_content(self):
        """The original query must appear in the synthesizer's user content."""
        chain = MultiAgentChain(decision=_claude_decision())
        captured = []

        async def _spy(system_prompt, user_content):
            captured.append(user_content)
            return "ok"

        chain._call_llm = _spy
        await chain._run_synthesizer(
            "Miras hukuku nedir?", "bağlam", self._make_research(), CriticResult()
        )
        assert "Miras hukuku nedir?" in captured[0]


# ============================================================================
# Group H — Router generate() integration with multi-agent dispatch
# ============================================================================

def _make_router_with_multi_agent(
    enabled: bool = True,
    anthropic_key: str = "sk-anthropic",
) -> LLMTieredRouter:
    """Creates a router with multi-agent settings controlled by 'enabled'."""
    with patch("infrastructure.llm.tiered_router.settings") as m:
        m.openai_api_key = "sk-openai"
        m.groq_api_key = "gsk_test"
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
        m.llm_tier4_multi_agent_enabled = enabled
        return LLMTieredRouter()


def _decide_mock_h(enabled: bool = True) -> MagicMock:
    m = MagicMock()
    m.llm_tier1_max_context_tokens = 800
    m.llm_tier2_max_context_tokens = 2500
    m.llm_tier3_max_context_tokens = 5000
    m.llm_tier1_model = "llama-3.3-70b-versatile"
    m.llm_tier2_model = "gpt-4o-mini"
    m.llm_tier3_model = "gpt-4o"
    m.llm_tier4_model = "claude-3-5-sonnet-20241022"
    m.llm_tier4_use_reasoning = False
    m.llm_tier4_reasoning_model = "o3-mini"
    m.llm_tier4_reasoning_effort = "medium"
    m.llm_tier4_multi_agent_enabled = enabled
    m.llm_max_response_tokens = 2048
    return m


class TestRouterMultiAgentIntegration:

    @pytest.mark.asyncio
    async def test_H1_generate_calls_invoke_multi_agent_when_tier4_enabled(self):
        """generate() must delegate to _invoke_multi_agent for Tier4+enabled."""
        router = _make_router_with_multi_agent(enabled=True)
        router._invoke_multi_agent = AsyncMock(return_value="Multi-agent yanıtı.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock_h(enabled=True)):
            answer, label = await router.generate(
                query="AYM bireysel başvuru analizi",
                context="K:1 — AYM kararı.",
                source_count=1,
            )

        router._invoke_multi_agent.assert_called_once()
        assert answer == "Multi-agent yanıtı."

    @pytest.mark.asyncio
    async def test_H2_model_label_contains_multi_agent_suffix(self):
        """model_label must end with '+multi-agent' when multi-agent runs."""
        router = _make_router_with_multi_agent(enabled=True)
        router._invoke_multi_agent = AsyncMock(return_value="Yanıt.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock_h(enabled=True)):
            _, label = await router.generate(
                query="AYM iptal kararı",
                context="K:1 — kaynak.",
                source_count=1,
            )

        assert "+multi-agent" in label

    @pytest.mark.asyncio
    async def test_H3_generate_does_not_use_multi_agent_when_disabled(self):
        """generate() must NOT call _invoke_multi_agent when flag is False."""
        router = _make_router_with_multi_agent(enabled=False, anthropic_key="")
        # Tier4 unavailable (no anthropic key + no reasoning), falls back to Tier3
        router._invoke_multi_agent = AsyncMock(return_value="Should not be called")
        router._invoke = AsyncMock(return_value="Standard yanıtı.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock_h(enabled=False)):
            await router.generate(
                query="AYM bireysel başvuru",
                context="K:1 — kaynak.",
                source_count=1,
            )

        router._invoke_multi_agent.assert_not_called()

    @pytest.mark.asyncio
    async def test_H4_tier1_query_does_not_use_multi_agent_even_if_enabled(self):
        """Multi-agent must NOT fire for non-Tier4 decisions even if flag=True."""
        router = _make_router_with_multi_agent(enabled=True)
        router._invoke_multi_agent = AsyncMock(return_value="Should not be called")
        router._invoke = AsyncMock(return_value="Tier1 yanıtı.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock_h(enabled=True)):
            await router.generate(
                query="İhbar tazminatı nedir?",  # → Tier1
                context="K:1 — kaynak.",
                source_count=1,
            )

        router._invoke_multi_agent.assert_not_called()

    @pytest.mark.asyncio
    async def test_H5_invoke_multi_agent_creates_chain_and_calls_run(self):
        """_invoke_multi_agent() must instantiate MultiAgentChain and call run()."""
        router = _make_router_with_multi_agent(enabled=True)
        decision = _claude_decision()

        mock_chain_instance = MagicMock()
        mock_chain_instance.run = AsyncMock(return_value="Zincir yanıtı.")

        # Patch inside the agents module (where the lazy import resolves)
        with patch(
            "infrastructure.agents.multi_agent_chain.MultiAgentChain",
            return_value=mock_chain_instance,
        ):
            with patch("infrastructure.llm.tiered_router.settings",
                       _decide_mock_h()):
                result = await router._invoke_multi_agent(
                    decision, "soru", "bağlam"
                )

        assert result == "Zincir yanıtı."
        mock_chain_instance.run.assert_called_once_with("soru", "bağlam")

    @pytest.mark.asyncio
    async def test_H6_label_has_no_multi_agent_suffix_for_tier3(self):
        """model_label must NOT contain '+multi-agent' for non-Tier4 decisions."""
        router = _make_router_with_multi_agent(enabled=True)
        router._invoke = AsyncMock(return_value="Tier3 yanıtı.")

        with patch("infrastructure.llm.tiered_router.settings",
                   _decide_mock_h(enabled=True)):
            _, label = await router.generate(
                query="Bu sözleşmeyi analiz et",  # Tier3 keyword, no Tier4
                context="K:1 — sözleşme metni.",
                source_count=1,
            )

        assert "+multi-agent" not in label
