"""
Step 4: Tiered LLM Router — Unit Tests
=========================================
All pure functions are tested without any mocking.
LLM invocation (generate / _invoke) tests use unittest.mock to avoid
real API calls.

Test coverage:
    1.  estimate_tokens               — short text
    2.  estimate_tokens               — proportional to length
    3.  has_tier4_keywords            — positive + negative
    4.  has_tier3_keywords            — positive + negative
    5.  classify_query_tier           — Tier 1: short simple query
    6.  classify_query_tier           — Tier 2: medium context promotion
    7.  classify_query_tier           — Tier 3: high source count
    8.  classify_query_tier           — Tier 4: AYM keyword
    9.  classify_query_tier           — Tier 4: large context override
    10. LLMTieredRouter.decide        — Tier 4 fallback when Anthropic missing
    11. LLMTieredRouter.decide        — Tier 1 fallback when Groq missing
    12. LLMTieredRouter               — RuntimeError when all keys missing
    13. TierDecision.fallback_used    — flag is True after fallback
    14. LLMTieredRouter.generate      — correct model_label format (mocked)
    15. LLMTieredRouter._build_messages — system prompt + user content structure
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from infrastructure.llm.tiered_router import (
    LLMTieredRouter,
    QueryTier,
    classify_query_tier,
    estimate_tokens,
    has_tier3_keywords,
    has_tier4_keywords,
)


# ============================================================================
# Helpers
# ============================================================================

def _make_router(
    openai_key: str = "sk-test",
    groq_key: str = "gsk_test",
    anthropic_key: str = "",
) -> LLMTieredRouter:
    """
    Builds a LLMTieredRouter with patched settings so no real env vars needed.
    """
    with patch("infrastructure.llm.tiered_router.settings") as mock_settings:
        mock_settings.openai_api_key = openai_key
        mock_settings.groq_api_key = groq_key
        mock_settings.anthropic_api_key = anthropic_key
        mock_settings.llm_tier1_model = "llama-3.3-70b-versatile"
        mock_settings.llm_tier2_model = "gpt-4o-mini"
        mock_settings.llm_tier3_model = "gpt-4o"
        mock_settings.llm_tier4_model = "claude-3-5-sonnet-20241022"
        mock_settings.llm_tier1_max_context_tokens = 800
        mock_settings.llm_tier2_max_context_tokens = 2500
        mock_settings.llm_tier3_max_context_tokens = 5000
        mock_settings.llm_max_response_tokens = 2048
        mock_settings.llm_tier4_use_reasoning = False      # Gap 2: explicit False prevents MagicMock truthy
        mock_settings.llm_tier4_reasoning_model = "o3-mini"
        mock_settings.llm_tier4_reasoning_effort = "medium"
        return LLMTieredRouter()


def _text_of_tokens(n: int) -> str:
    """Generates a string that estimates to approximately n tokens (×4 chars)."""
    return "a" * (n * 4)


# ============================================================================
# 1–2. estimate_tokens
# ============================================================================

def test_estimate_tokens_short_text() -> None:
    assert estimate_tokens("test") == 1  # 4 chars // 4 = 1


def test_estimate_tokens_proportional_to_length() -> None:
    text = "a" * 400
    assert estimate_tokens(text) == 100


def test_estimate_tokens_empty_string_returns_one() -> None:
    # Guard: never return 0 (used in comparisons)
    assert estimate_tokens("") == 1


# ============================================================================
# 3–4. has_tier4_keywords / has_tier3_keywords
# ============================================================================

def test_has_tier4_keywords_positive() -> None:
    assert has_tier4_keywords("Bu dava AYM kararına tabidir") is True
    assert has_tier4_keywords("Anayasa Mahkemesi iptal kararı") is True
    # Use lowercase ı to match the keyword constant (Python .lower() is not Turkish-locale aware)
    assert has_tier4_keywords("içtihadı birleştirme kararı") is True
    assert has_tier4_keywords("IBK bağlayıcı karar") is True


def test_has_tier4_keywords_negative() -> None:
    assert has_tier4_keywords("TMK 706 tapu devir") is False
    assert has_tier4_keywords("kira sözleşmesi feshi") is False


def test_has_tier3_keywords_positive() -> None:
    assert has_tier3_keywords("Lütfen bu kararı analiz et") is True
    assert has_tier3_keywords("emsal karar var mı?") is True
    assert has_tier3_keywords("hukuki görüş istiyorum") is True


def test_has_tier3_keywords_negative() -> None:
    assert has_tier3_keywords("ihbar tazminatı ne kadar?") is False


# ============================================================================
# 5–9. classify_query_tier (pure function — no router instance needed)
# ============================================================================

def test_classify_tier1_short_simple_query() -> None:
    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000

        tier = classify_query_tier(
            query="İhbar tazminatı nedir?",
            context=_text_of_tokens(100),  # 100 tokens — well under Tier 1 max
            source_count=1,
        )
    assert tier == QueryTier.TIER1


def test_classify_tier2_medium_context_promotion() -> None:
    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000

        tier = classify_query_tier(
            query="İş akdinin feshi şartları nelerdir?",
            context=_text_of_tokens(1200),  # 1200 tokens > 800 → Tier 2
            source_count=3,
        )
    assert tier == QueryTier.TIER2


def test_classify_tier3_high_source_count() -> None:
    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000

        tier = classify_query_tier(
            query="Kira hukuku inceleme",
            context=_text_of_tokens(200),   # short context
            source_count=11,                # > 10 → at least Tier 3
        )
    assert tier == QueryTier.TIER3


def test_classify_tier4_aym_keyword() -> None:
    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000

        tier = classify_query_tier(
            query="AYM kararına göre mülkiyet hakkı ihlali var mı?",
            context=_text_of_tokens(100),   # short context
            source_count=2,
        )
    assert tier == QueryTier.TIER4


def test_classify_tier4_large_context_override() -> None:
    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000

        tier = classify_query_tier(
            query="Basit soru",
            context=_text_of_tokens(6000),  # 6000 tokens > 5000 → Tier 4
            source_count=2,
        )
    assert tier == QueryTier.TIER4


# ============================================================================
# 10–11. Fallback logic
# ============================================================================

def test_decide_tier4_falls_back_to_tier3_when_anthropic_missing() -> None:
    """
    When Anthropic key is absent but OpenAI is present:
    A Tier-4 classified query must resolve to Tier 3 (gpt-4o).
    """
    router = _make_router(openai_key="sk-test", groq_key="gsk_test", anthropic_key="")

    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000
        mock.llm_tier1_model = "llama-3.3-70b-versatile"
        mock.llm_tier2_model = "gpt-4o-mini"
        mock.llm_tier3_model = "gpt-4o"
        mock.llm_tier4_model = "claude-3-5-sonnet-20241022"

        # Force Tier-4 query (AYM keyword)
        decision = router.decide(
            query="AYM bireysel başvuru hakkı ihlali",
            context=_text_of_tokens(100),
            source_count=2,
        )

    assert decision.tier == QueryTier.TIER3
    assert decision.fallback_used is True
    assert decision.original_tier == QueryTier.TIER4
    assert decision.model_id == "gpt-4o"


def test_decide_tier1_falls_back_to_tier2_when_groq_missing() -> None:
    """
    When Groq key is absent but OpenAI is present:
    A Tier-1 classified query must resolve to Tier 2 (gpt-4o-mini).
    """
    router = _make_router(openai_key="sk-test", groq_key="", anthropic_key="")

    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000
        mock.llm_tier1_model = "llama-3.3-70b-versatile"
        mock.llm_tier2_model = "gpt-4o-mini"
        mock.llm_tier3_model = "gpt-4o"
        mock.llm_tier4_model = "claude-3-5-sonnet-20241022"

        decision = router.decide(
            query="İhbar tazminatı nedir?",
            context=_text_of_tokens(100),
            source_count=1,
        )

    assert decision.tier == QueryTier.TIER2
    assert decision.fallback_used is True
    assert decision.original_tier == QueryTier.TIER1
    assert decision.model_id == "gpt-4o-mini"


# ============================================================================
# 12. RuntimeError when all keys missing
# ============================================================================

def test_router_raises_runtime_error_when_all_keys_missing() -> None:
    with pytest.raises(RuntimeError, match="No LLM provider keys configured"):
        _make_router(openai_key="", groq_key="", anthropic_key="")


# ============================================================================
# 13. TierDecision.fallback_used flag
# ============================================================================

def test_tier_decision_fallback_used_false_for_direct_hit() -> None:
    """When the desired tier is available, fallback_used must be False."""
    router = _make_router(openai_key="sk-test", groq_key="gsk_test", anthropic_key="")

    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000
        mock.llm_tier1_model = "llama-3.3-70b-versatile"
        mock.llm_tier2_model = "gpt-4o-mini"
        mock.llm_tier3_model = "gpt-4o"
        mock.llm_tier4_model = "claude-3-5-sonnet-20241022"

        decision = router.decide(
            query="Basit soru",
            context=_text_of_tokens(100),
            source_count=1,
        )

    assert decision.fallback_used is False
    assert decision.original_tier is None  # no fallback → None


# ============================================================================
# 14. generate — correct model_label format (mocked LLM call)
# ============================================================================

@pytest.mark.asyncio
async def test_generate_returns_correct_model_label_with_fallback() -> None:
    """
    generate() must return model_label as '{provider}/{model_id}+fallback'
    when a fallback was applied.
    """
    router = _make_router(openai_key="sk-test", groq_key="gsk_test", anthropic_key="")

    # Mock the actual LLM invocation so no real API call is made
    router._invoke = AsyncMock(return_value="Mocked LLM yanıtı")

    with patch("infrastructure.llm.tiered_router.settings") as mock:
        mock.llm_tier1_max_context_tokens = 800
        mock.llm_tier2_max_context_tokens = 2500
        mock.llm_tier3_max_context_tokens = 5000
        mock.llm_tier1_model = "llama-3.3-70b-versatile"
        mock.llm_tier2_model = "gpt-4o-mini"
        mock.llm_tier3_model = "gpt-4o"
        mock.llm_tier4_model = "claude-3-5-sonnet-20241022"

        answer, model_label = await router.generate(
            query="AYM bireysel başvuru",     # → Tier 4 desired → fallback Tier 3
            context=_text_of_tokens(100),
            source_count=2,
        )

    assert answer == "Mocked LLM yanıtı"
    assert model_label == "openai/gpt-4o+fallback"


# ============================================================================
# 15. _build_messages — system prompt + user content structure
# ============================================================================

def test_build_messages_contains_system_prompt_and_user_query() -> None:
    router = _make_router()

    messages = router._build_messages(
        query="Tapu devir işlemi nasıl yapılır?",
        context="--- Kaynak 1: TMK 706 ---\nTaşınmaz mülkiyetinin devri...",
    )

    assert len(messages) == 2

    system_content: str = messages[0].content  # type: ignore[assignment]
    user_content: str = messages[1].content    # type: ignore[assignment]

    assert "Türk hukuku" in system_content
    assert "YALNIZCA" in system_content           # Hard-Fail prompt rule
    assert "HUKUK KAYNAKLARI" in user_content
    assert "Tapu devir işlemi nasıl yapılır?" in user_content
    assert "TMK 706" in user_content
