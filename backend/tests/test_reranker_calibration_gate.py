"""Tests for reranker_calibration_gate script."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.reranker_calibration_gate import (
    DEFAULT_DATASET_PATH,
    Thresholds,
    load_cases_from_jsonl,
    run_gate,
)


def test_load_cases_from_real_legal_dataset() -> None:
    cases = load_cases_from_jsonl(DEFAULT_DATASET_PATH)
    assert len(cases) >= 8
    assert all(case.review_status == "expert_verified" for case in cases)


def test_run_gate_strict_passes_on_real_legal_dataset() -> None:
    code = run_gate(
        thresholds=Thresholds.strict(),
        dataset_path=DEFAULT_DATASET_PATH,
        strict_mode=True,
    )
    assert code == 0


def test_run_gate_fails_when_thresholds_are_too_high() -> None:
    code = run_gate(
        thresholds=Thresholds(top1_accuracy=1.01, mean_margin=0.5, mean_spread=0.5),
        dataset_path=DEFAULT_DATASET_PATH,
    )
    assert code == 1


def test_run_gate_writes_report_json(tmp_path: Path) -> None:
    output = tmp_path / "reranker-calibration-report.json"
    code = run_gate(
        thresholds=Thresholds(),
        dataset_path=DEFAULT_DATASET_PATH,
        output_path=output,
        strict_mode=False,
    )

    assert code == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["dataset_path"]
    assert payload["case_count"] >= 8
    assert "aggregate" in payload
    assert "thresholds" in payload
