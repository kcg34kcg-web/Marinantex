"""Tests for V1/V1.5 tier policy routing rules."""

from __future__ import annotations

from infrastructure.rag_v3.tier_policy import (
    is_safe_operational_intent,
    resolve_tier_policy,
)


def test_tier1_safe_intent_routes_to_no_rag() -> None:
    decision = resolve_tier_policy(
        requested_tier=1,
        query="api anahtari nasil yenilenir",
        retrieval_confidence=0.95,
        has_conflicting_case_law=False,
        max_chunk_chars=1000,
        task_type="qa",
    )

    assert is_safe_operational_intent("api anahtari nasil yenilenir") is True
    assert decision.effective_tier == 1
    assert decision.bypass_rag is True
    assert decision.route_reason == "tier1_safe_intent_no_rag"


def test_tier1_legal_query_auto_upgrades_to_tier2() -> None:
    decision = resolve_tier_policy(
        requested_tier=1,
        query="4857 sayili kanun madde 17 ihbar suresi",
        retrieval_confidence=0.8,
        has_conflicting_case_law=False,
        max_chunk_chars=1200,
        task_type="qa",
    )

    assert decision.effective_tier == 2
    assert decision.bypass_rag is False
    assert "tier1_safe_intent_only_auto_upgrade_tier2" in decision.warnings


def test_tier2_auto_upgrades_to_tier3_when_triggers_exist() -> None:
    decision = resolve_tier_policy(
        requested_tier=2,
        query="celiskili ictihatlari adim adim strateji ile karsi goruslu analiz et",
        retrieval_confidence=0.31,
        has_conflicting_case_law=True,
        max_chunk_chars=8000,
        task_type="comparison",
    )

    assert decision.effective_tier == 3
    assert decision.route_reason == "deep_thinking_triggered"
    assert "tier2_auto_upgraded_to_tier3" in decision.warnings
    assert "conflicting_case_law" in decision.tier3_triggers
