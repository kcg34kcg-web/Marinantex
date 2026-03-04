"""Tests for RAG v3 admission controller."""

from __future__ import annotations

import pytest

from infrastructure.rag_v3.admission import RagV3AdmissionController


def test_estimate_token_load_is_positive() -> None:
    controller = RagV3AdmissionController()
    value = controller.estimate_token_load(query="abc", context="def")
    assert value >= 1


def test_clamp_requested_tier_downgrades_on_high_token_load() -> None:
    controller = RagV3AdmissionController()
    tier, degraded, reason = controller.clamp_requested_tier(
        requested_tier=4,
        estimated_tokens=10_000_000,
    )
    assert tier <= 2
    assert degraded is True
    assert "token_guard" in reason


@pytest.mark.asyncio
async def test_reserve_accepts_normal_query() -> None:
    controller = RagV3AdmissionController()
    async with controller.reserve(query="kisa sorgu", requested_tier=2) as decision:
        assert decision.accepted is True
        assert decision.effective_tier in (1, 2, 3, 4)


@pytest.mark.asyncio
async def test_reserve_rejects_very_large_query() -> None:
    controller = RagV3AdmissionController()
    huge = "x" * 100_000
    async with controller.reserve(query=huge, requested_tier=2) as decision:
        assert decision.accepted is False
        assert decision.reason == "query_too_large"
