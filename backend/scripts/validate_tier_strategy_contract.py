#!/usr/bin/env python3
"""Validate V1/V1.5 tier-routing model strategy contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.config import settings


def _contains_all(value: str, tokens: tuple[str, ...]) -> bool:
    payload = str(value or "").strip().lower()
    if not payload:
        return False
    return all(token in payload for token in tokens)


def validate_tier_strategy() -> dict[str, Any]:
    expected = {
        "hazir": {
            "provider": "openai",
            "model_tokens": ("qwen3-next-80b-a3b", "instruct"),
            "fallback_provider": "openai",
            "fallback_model_tokens": ("qwen3-next-80b-a3b", "instruct"),
        },
        "dusunceli": {
            "provider": "openai",
            "model_tokens": ("qwen3-next-80b-a3b", "instruct"),
            "fallback_provider": "openai",
            "fallback_model_tokens": ("qwen3-next-80b-a3b", "instruct"),
        },
        "uzman": {
            "provider": "openai",
            "model_tokens": ("qwen3-next-80b-a3b", "thinking"),
            "fallback_provider": "openai",
            "fallback_model_tokens": ("qwen3-next-80b-a3b", "instruct"),
        },
        "muazzam": {
            "provider": "openai",
            "model_tokens": ("qwen3-next-80b-a3b", "thinking"),
            "fallback_provider": "openai",
            "fallback_model_tokens": ("qwen3-next-80b-a3b", "thinking"),
        },
    }

    actual = {
        "hazir": {
            "provider": str(getattr(settings, "ai_tier_hazir_provider", "") or "").strip().lower(),
            "model": str(getattr(settings, "ai_tier_hazir_model", "") or "").strip(),
            "fallback_provider": str(getattr(settings, "ai_tier_hazir_fallback_provider", "") or "").strip().lower(),
            "fallback_model": str(getattr(settings, "ai_tier_hazir_fallback_model", "") or "").strip(),
        },
        "dusunceli": {
            "provider": str(getattr(settings, "ai_tier_dusunceli_provider", "") or "").strip().lower(),
            "model": str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip(),
            "fallback_provider": str(getattr(settings, "ai_tier_dusunceli_fallback_provider", "") or "").strip().lower(),
            "fallback_model": str(getattr(settings, "ai_tier_dusunceli_fallback_model", "") or "").strip(),
        },
        "uzman": {
            "provider": str(getattr(settings, "ai_tier_uzman_provider", "") or "").strip().lower(),
            "model": str(getattr(settings, "ai_tier_uzman_model", "") or "").strip(),
            "fallback_provider": str(getattr(settings, "ai_tier_uzman_fallback_provider", "") or "").strip().lower(),
            "fallback_model": str(getattr(settings, "ai_tier_uzman_fallback_model", "") or "").strip(),
        },
        "muazzam": {
            "provider": str(getattr(settings, "ai_tier_muazzam_provider", "") or "").strip().lower(),
            "model": str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip(),
            "fallback_provider": str(getattr(settings, "ai_tier_muazzam_fallback_provider", "") or "").strip().lower(),
            "fallback_model": str(getattr(settings, "ai_tier_muazzam_fallback_model", "") or "").strip(),
        },
    }

    errors: list[str] = []
    for lane, lane_expected in expected.items():
        lane_actual = actual[lane]
        if lane_actual["provider"] != lane_expected["provider"]:
            errors.append(
                f"provider_mismatch:{lane}:{lane_actual['provider'] or 'missing'}!={lane_expected['provider']}"
            )
        if not _contains_all(str(lane_actual["model"]), tuple(lane_expected["model_tokens"])):
            errors.append(
                "model_mismatch:"
                f"{lane}:{str(lane_actual['model'] or 'missing').lower()}!~{'+'.join(lane_expected['model_tokens'])}"
            )
        if lane_actual["fallback_provider"] != lane_expected["fallback_provider"]:
            errors.append(
                "fallback_provider_mismatch:"
                f"{lane}:{lane_actual['fallback_provider'] or 'missing'}!={lane_expected['fallback_provider']}"
            )
        fallback_model_tokens = tuple(lane_expected.get("fallback_model_tokens", ()))
        if fallback_model_tokens and not _contains_all(str(lane_actual.get("fallback_model", "")), fallback_model_tokens):
            errors.append(
                "fallback_model_mismatch:"
                f"{lane}:{str(lane_actual.get('fallback_model') or 'missing').lower()}!~{'+'.join(fallback_model_tokens)}"
            )

    return {
        "contract": "rag_v3.tier_strategy.v1_5",
        "enforced": bool(getattr(settings, "rag_v3_enforce_tier_strategy_contract", True)),
        "valid": len(errors) == 0,
        "errors": errors,
        "expected": expected,
        "actual": actual,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate RAG v3 tier strategy contract")
    parser.add_argument("--output", default=None, help="Optional output JSON report path")
    args = parser.parse_args()

    report = validate_tier_strategy()
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if report["valid"]:
        print("[tier-strategy] OK")
        sys.exit(0)

    print("[tier-strategy] FAILED")
    for item in report["errors"]:
        print(f"- {item}")
    sys.exit(1)


if __name__ == "__main__":
    main()
