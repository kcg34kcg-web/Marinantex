#!/usr/bin/env python3
"""Stage gate for rag_v3_single_pipeline_enforced rollout."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


VALID_STAGES = {"dev", "staging", "prod"}


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    token = str(raw).strip().lower()
    if token in {"1", "true", "yes", "on", "enabled"}:
        return True
    if token in {"0", "false", "no", "off", "disabled"}:
        return False
    return default


@dataclass
class RolloutCheckResult:
    stage: str
    enforced: bool
    reranker_release_gate_enabled: bool
    expected_enforced: bool
    expected_reranker_gate: bool
    passed: bool
    failures: list[str]


@dataclass
class RolloutReport:
    generated_at: str
    passed: bool
    stage: str
    result: dict[str, object]
    exit_code: int


def evaluate_rollout(
    *,
    stage: str,
    enforced: bool,
    reranker_release_gate_enabled: bool,
) -> RolloutCheckResult:
    token = stage.strip().lower()
    if token not in VALID_STAGES:
        raise ValueError(f"stage must be one of: {', '.join(sorted(VALID_STAGES))}")

    expected_enforced = token in {"staging", "prod"}
    expected_reranker_gate = token in {"staging", "prod"}

    failures: list[str] = []
    if enforced != expected_enforced:
        failures.append(
            f"rag_v3_single_pipeline_enforced expected {expected_enforced} for stage={token}, got {enforced}"
        )
    if reranker_release_gate_enabled != expected_reranker_gate:
        failures.append(
            "rag_v3_reranker_release_gate_enabled expected "
            f"{expected_reranker_gate} for stage={token}, got {reranker_release_gate_enabled}"
        )

    return RolloutCheckResult(
        stage=token,
        enforced=bool(enforced),
        reranker_release_gate_enabled=bool(reranker_release_gate_enabled),
        expected_enforced=expected_enforced,
        expected_reranker_gate=expected_reranker_gate,
        passed=(len(failures) == 0),
        failures=failures,
    )


def run_gate(
    *,
    stage: str,
    enforced: bool,
    reranker_release_gate_enabled: bool,
    output_path: Path | None = None,
) -> int:
    result = evaluate_rollout(
        stage=stage,
        enforced=enforced,
        reranker_release_gate_enabled=reranker_release_gate_enabled,
    )
    report = RolloutReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        passed=result.passed,
        stage=result.stage,
        result=asdict(result),
        exit_code=0 if result.passed else 1,
    )

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(asdict(report), handle, ensure_ascii=False, indent=2)

    return report.exit_code


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG v3 single pipeline staged rollout gate")
    parser.add_argument("--stage", required=True, choices=sorted(VALID_STAGES), help="Rollout stage: dev|staging|prod")
    parser.add_argument(
        "--enforced",
        default=None,
        help="Override RAG_V3_SINGLE_PIPELINE_ENFORCED (true/false)",
    )
    parser.add_argument(
        "--reranker-release-gate",
        default=None,
        help="Override RAG_V3_RERANKER_RELEASE_GATE_ENABLED (true/false)",
    )
    parser.add_argument("--output", type=Path, default=None, help="Write report json")
    args = parser.parse_args()

    enforced = _parse_bool(args.enforced, default=False)
    reranker_release_gate_enabled = _parse_bool(args.reranker_release_gate, default=False)

    code = run_gate(
        stage=args.stage,
        enforced=enforced,
        reranker_release_gate_enabled=reranker_release_gate_enabled,
        output_path=args.output,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
