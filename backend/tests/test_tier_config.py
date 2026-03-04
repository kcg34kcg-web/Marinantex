from __future__ import annotations

from infrastructure.config import TierRuntimeConfig, settings


def test_get_tier_policy_maps_numeric_and_label() -> None:
    tier1 = settings.get_tier_policy(1)
    tier2 = settings.get_tier_policy("dusunceli")
    tier4 = settings.get_tier_policy("tier4")

    assert isinstance(tier1, TierRuntimeConfig)
    assert isinstance(tier2, TierRuntimeConfig)
    assert isinstance(tier4, TierRuntimeConfig)
    assert tier1.context_budget > 0
    assert tier2.context_budget >= tier1.context_budget
    assert tier4.context_budget >= tier2.context_budget


def test_get_tier_policy_unknown_falls_back_to_tier1() -> None:
    unknown = settings.get_tier_policy("not-a-tier")
    fallback = settings.get_tier_policy("hazir_cevap")

    assert isinstance(unknown, TierRuntimeConfig)
    assert unknown.max_sources == fallback.max_sources
    assert unknown.rerank_depth == fallback.rerank_depth
