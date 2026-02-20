"""
Step 9: Query Rewriter — Unit Tests
=====================================
Tests for QueryRewriter (infrastructure/llm/query_rewriter.py).

Coverage:
    1.  rewrite — tier 1 → pass-through (LLM never called)
    2.  rewrite — query_rewrite_enabled=False → pass-through (all tiers)
    3.  rewrite — in-process cache hit → LLM not called again
    4.  rewrite — _call_llm returns empty string → fallback to original
    5.  rewrite — _call_llm returns string < 5 chars → fallback to original
    6.  rewrite — valid rewrite returned → stored in cache and returned
    7.  rewrite — asyncio.TimeoutError → fallback to original (non-fatal)
    8.  rewrite — generic Exception from LLM → fallback to original (non-fatal)
    9.  _call_llm — openai_api_key missing → returns original query unchanged
    10. rewrite — tier 2 query fires LLM and returns rewritten result
    11. rewrite — tier 3 query fires LLM (tier >= 2 threshold)
    12. rewrite — tier 4 query fires LLM (tier 4 >= 2 threshold)
    13. rewrite — second identical call uses cache (LLM called only once)
    14. rewrite — cache is per-instance (two instances don't share state)
    15. rewrite — non-fatal on unexpected exception type from LLM

All tests use AsyncMock / MagicMock / patch; no real OpenAI API calls are made.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from infrastructure.llm.query_rewriter import QueryRewriter


# ============================================================================
# Helpers
# ============================================================================

def _make_rewriter() -> QueryRewriter:
    """Creates a fresh QueryRewriter instance with its own empty cache."""
    return QueryRewriter()


# ============================================================================
# 1. tier 1 → pass-through
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_tier1_is_passthrough_no_llm_call() -> None:
    """Tier 1 queries must skip the LLM entirely and return the original query."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(return_value="should not be called")

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        result = await rewriter.rewrite("ihbar tazminatı ne kadar?", tier=1)

    assert result == "ihbar tazminatı ne kadar?"
    rewriter._call_llm.assert_not_called()


# ============================================================================
# 2. query_rewrite_enabled=False → pass-through
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_disabled_returns_original_query() -> None:
    """When query_rewrite_enabled=False, all tiers are pass-through."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(return_value="should not be called")

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = False
        result = await rewriter.rewrite("kovuldum tazminat istiyorum", tier=2)

    assert result == "kovuldum tazminat istiyorum"
    rewriter._call_llm.assert_not_called()


# ============================================================================
# 3. cache hit → LLM not called
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_cache_hit_skips_llm() -> None:
    """A previously rewritten query must be served from the in-process cache."""
    rewriter = _make_rewriter()
    cached_value = "iş akdinin haksız feshi kıdem tazminatı talep koşulları"
    rewriter._cache["kovuldum tazminat"] = cached_value
    rewriter._call_llm = AsyncMock()

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        result = await rewriter.rewrite("kovuldum tazminat", tier=2)

    assert result == cached_value
    rewriter._call_llm.assert_not_called()


# ============================================================================
# 4. empty LLM response → fallback
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_empty_llm_response_falls_back_to_original() -> None:
    """An empty LLM response must cause the original query to be returned."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(return_value="")

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("kira sorunu", tier=2)

    assert result == "kira sorunu"


# ============================================================================
# 5. short LLM response (<5 chars) → fallback
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_short_llm_response_falls_back_to_original() -> None:
    """An LLM response shorter than 5 characters must trigger the original fallback."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(return_value="kira")  # 4 chars — below minimum

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("kira sorunu var", tier=2)

    assert result == "kira sorunu var"


# ============================================================================
# 6. valid rewrite → stored in cache and returned
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_valid_response_is_stored_in_cache() -> None:
    """A successful LLM rewrite must be stored in the instance cache."""
    rewriter = _make_rewriter()
    expected = "kira borcunun ödenmemesi halinde tahliye davası hukuki sonuçları"
    rewriter._call_llm = AsyncMock(return_value=expected)

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("kira ödeyemiyorum ne olur", tier=2)

    assert result == expected
    assert rewriter._cache.get("kira ödeyemiyorum ne olur") == expected


# ============================================================================
# 7. asyncio.TimeoutError → fallback (non-fatal)
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_timeout_falls_back_to_original_non_fatal() -> None:
    """A slow LLM call that exceeds the timeout must return the original — never raise."""
    rewriter = _make_rewriter()

    async def _slow_llm(query: str) -> str:
        await asyncio.sleep(100)  # far exceeds any reasonable timeout
        return "unreachable"

    rewriter._call_llm = _slow_llm  # type: ignore[method-assign]

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 0.001  # 1 ms — forces cancellation
        result = await rewriter.rewrite("test sorgu", tier=2)

    assert result == "test sorgu"


# ============================================================================
# 8. generic Exception → fallback (non-fatal)
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_llm_exception_falls_back_to_original_non_fatal() -> None:
    """Any exception from the LLM must be swallowed; original query returned."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(side_effect=RuntimeError("API 500 Internal Server Error"))

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("test sorgu", tier=3)

    assert result == "test sorgu"


# ============================================================================
# 9. _call_llm — openai_api_key missing → returns original query unchanged
# ============================================================================

@pytest.mark.asyncio
async def test_call_llm_no_openai_key_returns_original_query() -> None:
    """_call_llm must return the original query when no OpenAI API key is set."""
    rewriter = _make_rewriter()

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.openai_api_key = ""
        result = await rewriter._call_llm("TMK 706 devir şekli")

    assert result == "TMK 706 devir şekli"


# ============================================================================
# 10. tier 2 → LLM is called
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_tier2_calls_llm_and_returns_rewritten() -> None:
    """A Tier 2 query must be sent to the LLM and the rewritten form returned."""
    rewriter = _make_rewriter()
    expected = "iş akdinin feshi nedeniyle kıdem ve ihbar tazminatı talep koşulları"
    rewriter._call_llm = AsyncMock(return_value=expected)

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("işten kovuldum ne yapabilirim", tier=2)

    assert result == expected
    rewriter._call_llm.assert_called_once_with("işten kovuldum ne yapabilirim")


# ============================================================================
# 11. tier 3 → LLM is called
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_tier3_calls_llm_and_returns_rewritten() -> None:
    """A Tier 3 query must also trigger LLM rewriting (tier >= 2 threshold)."""
    rewriter = _make_rewriter()
    expected = "Yargıtay içtihadında ihtiyaç nedeniyle kiracının tahliyesi şartları"
    rewriter._call_llm = AsyncMock(return_value=expected)

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("kiracımı evden nasıl çıkarırım", tier=3)

    assert result == expected


# ============================================================================
# 12. tier 4 → LLM is called
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_tier4_calls_llm_and_returns_rewritten() -> None:
    """Tier 4 queries also benefit from formal terminology rewriting."""
    rewriter = _make_rewriter()
    expected = "anayasa mahkemesi bireysel başvuru mülkiyet hakkı ihlali kriterleri"
    rewriter._call_llm = AsyncMock(return_value=expected)

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("AYM mülkiyet hakkı ihlali", tier=4)

    assert result == expected


# ============================================================================
# 13. second identical call → cache hit (LLM called only once)
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_second_call_with_same_query_uses_cache() -> None:
    """The LLM must be invoked exactly once for repeated identical queries."""
    rewriter = _make_rewriter()
    expected = "iş akdinin haksız feshi tazminat talep hakkı"
    rewriter._call_llm = AsyncMock(return_value=expected)

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        first = await rewriter.rewrite("kovuldum para isteyebilir miyim", tier=2)
        second = await rewriter.rewrite("kovuldum para isteyebilir miyim", tier=2)

    assert first == expected
    assert second == expected
    assert rewriter._call_llm.call_count == 1, "LLM must be called only once per unique query"


# ============================================================================
# 14. cache is per-instance (two instances don't share state)
# ============================================================================

def test_rewriter_cache_is_not_shared_between_instances() -> None:
    """Each QueryRewriter instance must have an independent, isolated cache dict."""
    r1 = _make_rewriter()
    r2 = _make_rewriter()

    r1._cache["test sorgu"] = "formal legal term"

    assert "test sorgu" not in r2._cache, (
        "Cache must be an instance-level dict, not a shared class attribute"
    )
    assert r1._cache is not r2._cache, "Each instance must own a distinct cache object"


# ============================================================================
# 15. non-fatal on unexpected exception type
# ============================================================================

@pytest.mark.asyncio
async def test_rewrite_non_fatal_on_unexpected_exception_type() -> None:
    """Any exception type — including unexpected ones — must be swallowed gracefully."""
    rewriter = _make_rewriter()
    rewriter._call_llm = AsyncMock(side_effect=ValueError("Unexpected response schema"))

    with patch("infrastructure.llm.query_rewriter.settings") as mock:
        mock.query_rewrite_enabled = True
        mock.query_rewrite_timeout_s = 5.0
        result = await rewriter.rewrite("vergi borcu ne olur", tier=2)

    assert result == "vergi borcu ne olur"
