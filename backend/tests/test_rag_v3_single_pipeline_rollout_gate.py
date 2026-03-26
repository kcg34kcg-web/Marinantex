"""Tests for rag_v3_single_pipeline_rollout_gate script."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.rag_v3_single_pipeline_rollout_gate import evaluate_rollout, run_gate


def test_dev_stage_requires_pipeline_flag_off() -> None:
    result = evaluate_rollout(stage="dev", enforced=False, reranker_release_gate_enabled=False)
    assert result.passed is True


def test_staging_stage_requires_pipeline_flag_and_reranker_gate_on() -> None:
    result = evaluate_rollout(stage="staging", enforced=True, reranker_release_gate_enabled=True)
    assert result.passed is True


def test_prod_stage_fails_when_pipeline_flag_off() -> None:
    result = evaluate_rollout(stage="prod", enforced=False, reranker_release_gate_enabled=True)
    assert result.passed is False
    assert result.failures


def test_run_gate_writes_report(tmp_path: Path) -> None:
    output = tmp_path / "rollout-gate-report.json"
    code = run_gate(
        stage="staging",
        enforced=True,
        reranker_release_gate_enabled=True,
        output_path=output,
    )
    assert code == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["stage"] == "staging"
    assert payload["passed"] is True
