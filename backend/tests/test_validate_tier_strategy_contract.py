"""Tier strategy contract gate tests."""

from __future__ import annotations

import pytest

from infrastructure.config import settings
from scripts.validate_tier_strategy_contract import validate_tier_strategy


@pytest.fixture(autouse=True)
def _reset_tier_strategy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "rag_v3_enforce_tier_strategy_contract", True)
    monkeypatch.setattr(settings, "ai_tier_hazir_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_hazir_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_hazir_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_hazir_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_uzman_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_uzman_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")
    monkeypatch.setattr(settings, "ai_tier_uzman_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_uzman_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_muazzam_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_muazzam_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")
    monkeypatch.setattr(settings, "ai_tier_muazzam_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_muazzam_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")


def test_validate_tier_strategy_success() -> None:
    report = validate_tier_strategy()
    assert report["valid"] is True
    assert report["errors"] == []


def test_validate_tier_strategy_detects_provider_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_tier_hazir_provider", "google")
    report = validate_tier_strategy()
    assert report["valid"] is False
    assert any(str(item).startswith("provider_mismatch:hazir:") for item in report["errors"])


def test_validate_tier_strategy_detects_model_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_tier_uzman_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    report = validate_tier_strategy()
    assert report["valid"] is False
    assert any(str(item).startswith("model_mismatch:uzman:") for item in report["errors"])


def test_validate_tier_strategy_detects_fallback_model_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_tier_dusunceli_fallback_model", "Qwen/Qwen3-14B-Instruct")
    report = validate_tier_strategy()
    assert report["valid"] is False
    assert any(str(item).startswith("fallback_model_mismatch:dusunceli:") for item in report["errors"])
