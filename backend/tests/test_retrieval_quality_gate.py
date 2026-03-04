"""Tests for retrieval_quality_gate script."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.retrieval_quality_gate import (
    CANONICAL_RETRIEVAL_CASES,
    RetrievalCase,
    RetrievalThresholds,
    aggregate_results,
    check_thresholds,
    evaluate_case,
    run_gate,
)


def test_evaluate_case_returns_unit_interval_metrics() -> None:
    result = evaluate_case(CANONICAL_RETRIEVAL_CASES[0])
    assert 0.0 <= result.recall_at_k <= 1.0
    assert 0.0 <= result.mrr_at_k <= 1.0
    assert 0.0 <= result.ndcg_at_k <= 1.0
    assert 0.0 <= result.citation_precision <= 1.0


def test_aggregate_results_counts_cases() -> None:
    results = [evaluate_case(case) for case in CANONICAL_RETRIEVAL_CASES]
    agg = aggregate_results(results)
    assert agg.case_count == len(CANONICAL_RETRIEVAL_CASES)


def test_check_thresholds_reports_failures() -> None:
    bad_case = RetrievalCase(
        name="bad",
        retrieved_chunk_ids=["noise-1", "noise-2"],
        cited_chunk_ids=["noise-1"],
        gold_chunk_ids=["gold-1"],
    )
    agg = aggregate_results([evaluate_case(bad_case)])
    failures = check_thresholds(agg, RetrievalThresholds())
    assert failures


def test_run_gate_passes_on_canonical_suite() -> None:
    code = run_gate(thresholds=RetrievalThresholds())
    assert code == 0


def test_run_gate_writes_json_report(tmp_path: Path) -> None:
    report_file = tmp_path / "retrieval-report.json"
    run_gate(thresholds=RetrievalThresholds(), output_path=report_file)
    assert report_file.exists()
    payload = json.loads(report_file.read_text(encoding="utf-8"))
    assert "aggregate" in payload
    assert "thresholds" in payload
