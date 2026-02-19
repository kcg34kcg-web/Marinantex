"""
Tests — CI/CD RAGAS Quality Gate
==================================
Tests for scripts/quality_gate.py  (Step 17 CI gate).

Groups:
    A  (4): QualityThresholds — defaults, strict mode values
    B  (4): CANONICAL_CASES definitions — structural validity
    C  (6): evaluate_case() — per-case pass/fail and metric ranges
    D  (4): aggregate_results() — averaging logic, edge cases
    E  (5): check_thresholds() — pass, fail, message content
    F  (6): run_gate() — exit codes, report structure, file output
    G  (3): GateReport JSON structure — aggregate keys, per_case entries

Total: 32 tests
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import List

import pytest

from scripts.quality_gate import (
    CANONICAL_CASES,
    AggregateMetrics,
    CanonicalCase,
    CaseResult,
    GateReport,
    QualityThresholds,
    aggregate_results,
    build_report,
    check_thresholds,
    evaluate_case,
    run_gate,
)
from infrastructure.metrics.ragas_adapter import RAGASAdapter

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_case(
    name: str = "test_case",
    query: str = "İhbar süresi nedir?",
    answer: str = "İhbar süresi dört haftadır. [K:1]",
    total_sentences: int = 1,
    grounded_sentences: int = 1,
    source_scores: tuple = (0.85,),
    target_source_count: int = 3,
    min_overall_quality: float = 0.40,
) -> CanonicalCase:
    return CanonicalCase(
        name=name,
        description=f"Test case: {name}",
        query=query,
        answer=answer,
        total_sentences=total_sentences,
        grounded_sentences=grounded_sentences,
        source_scores=source_scores,
        target_source_count=target_source_count,
        min_overall_quality=min_overall_quality,
    )


def _bad_case() -> CanonicalCase:
    """A deliberately terrible case: 0 sources, 0 grounded sentences."""
    return _make_case(
        name="degenerate",
        total_sentences=10,
        grounded_sentences=0,       # faithfulness = 0.0
        source_scores=(0.0,),       # context_precision = 0.0
        target_source_count=10,     # context_recall = 1/10 = 0.1
        min_overall_quality=0.99,   # impossibly high minimum → fails per-case
    )


# ============================================================================
# Group A — QualityThresholds
# ============================================================================

class TestQualityThresholds:

    def test_A1_default_faithfulness(self):
        t = QualityThresholds()
        assert t.faithfulness == 0.70

    def test_A2_default_overall_quality(self):
        t = QualityThresholds()
        assert t.overall_quality == 0.65

    def test_A3_strict_faithfulness_exceeds_default(self):
        default = QualityThresholds()
        strict = QualityThresholds.strict()
        assert strict.faithfulness > default.faithfulness

    def test_A4_strict_overall_quality_exceeds_default(self):
        default = QualityThresholds()
        strict = QualityThresholds.strict()
        assert strict.overall_quality > default.overall_quality


# ============================================================================
# Group B — CANONICAL_CASES structural validity
# ============================================================================

class TestCanonicalCaseDefinitions:

    def test_B1_exactly_four_canonical_cases(self):
        assert len(CANONICAL_CASES) == 4

    def test_B2_grounded_never_exceeds_total_sentences(self):
        for case in CANONICAL_CASES:
            assert case.grounded_sentences <= case.total_sentences, (
                f"{case.name}: grounded={case.grounded_sentences} "
                f"> total={case.total_sentences}"
            )

    def test_B3_all_cases_have_non_empty_source_scores(self):
        for case in CANONICAL_CASES:
            assert len(case.source_scores) >= 1, (
                f"{case.name}: source_scores is empty"
            )

    def test_B4_all_case_min_quality_in_valid_range(self):
        for case in CANONICAL_CASES:
            assert 0.0 < case.min_overall_quality <= 1.0, (
                f"{case.name}: min_overall_quality={case.min_overall_quality} "
                f"out of range (0, 1]"
            )


# ============================================================================
# Group C — evaluate_case()
# ============================================================================

class TestEvaluateCase:

    def test_C1_basit_kanun_maddesi_passes(self):
        """Fully grounded case with 3 high-score sources should pass."""
        case = next(c for c in CANONICAL_CASES if c.name == "basit_kanun_maddesi")
        result = evaluate_case(case)
        assert result.passed is True, result.per_case_failure

    def test_C2_yargi_karar_analizi_passes(self):
        """Court-decision case with 4 sources should pass."""
        case = next(c for c in CANONICAL_CASES if c.name == "yargi_karar_analizi")
        result = evaluate_case(case)
        assert result.passed is True, result.per_case_failure

    def test_C3_sinirli_kaynak_passes_with_lower_minimum(self):
        """Single-source edge-case has low min (0.45) and should still pass."""
        case = next(c for c in CANONICAL_CASES if c.name == "sinirli_kaynak")
        result = evaluate_case(case)
        assert result.passed is True, result.per_case_failure

    def test_C4_aym_iptal_analizi_passes(self):
        """Partially grounded AYM case should pass its 0.60 minimum."""
        case = next(c for c in CANONICAL_CASES if c.name == "aym_iptal_analizi")
        result = evaluate_case(case)
        assert result.passed is True, result.per_case_failure

    def test_C5_all_metrics_in_unit_interval(self):
        """Every metric returned by evaluate_case() must be in [0, 1]."""
        for case in CANONICAL_CASES:
            result = evaluate_case(case)
            m = result.metrics
            for metric_name, value in [
                ("faithfulness",      m.faithfulness),
                ("answer_relevancy",  m.answer_relevancy),
                ("context_precision", m.context_precision),
                ("context_recall",    m.context_recall),
                ("overall_quality",   m.overall_quality),
            ]:
                assert 0.0 <= value <= 1.0, (
                    f"{case.name}.{metric_name}={value} out of [0, 1]"
                )

    def test_C6_zero_grounded_sentences_gives_faithfulness_zero(self):
        """A case with 0 grounded / 5 total sentences → faithfulness = 0.0."""
        case = _make_case(
            total_sentences=5,
            grounded_sentences=0,
            source_scores=(0.80, 0.75, 0.70),
            min_overall_quality=0.01,  # very low — just want the metric
        )
        result = evaluate_case(case)
        assert result.metrics.faithfulness == 0.0


# ============================================================================
# Group D — aggregate_results()
# ============================================================================

class TestAggregateResults:

    def test_D1_empty_list_returns_case_count_zero(self):
        agg = aggregate_results([])
        assert agg.case_count == 0

    def test_D2_empty_list_returns_zero_metrics(self):
        agg = aggregate_results([])
        assert agg.faithfulness == 0.0
        assert agg.overall_quality == 0.0

    def test_D3_single_case_aggregate_equals_case_metrics(self):
        case = _make_case(total_sentences=2, grounded_sentences=2,
                          source_scores=(0.90, 0.80, 0.70))
        result = evaluate_case(case)
        agg = aggregate_results([result])
        assert agg.faithfulness == result.metrics.faithfulness
        assert agg.overall_quality == result.metrics.overall_quality

    def test_D4_case_count_equals_input_length(self):
        results = [evaluate_case(c) for c in CANONICAL_CASES]
        agg = aggregate_results(results)
        assert agg.case_count == len(CANONICAL_CASES)


# ============================================================================
# Group E — check_thresholds()
# ============================================================================

class TestCheckThresholds:

    def test_E1_no_failures_when_thresholds_are_zero(self):
        """Zero thresholds → every aggregate passes."""
        results = [evaluate_case(c) for c in CANONICAL_CASES]
        agg = aggregate_results(results)
        zero = QualityThresholds(
            faithfulness=0.0,
            answer_relevancy=0.0,
            context_precision=0.0,
            context_recall=0.0,
            overall_quality=0.0,
        )
        failures = check_thresholds(agg, zero)
        assert failures == []

    def test_E2_failure_when_faithfulness_below_threshold(self):
        """Manually craft an aggregate with faithfulness = 0.10."""
        agg = AggregateMetrics(
            faithfulness=0.10,
            answer_relevancy=0.90,
            context_precision=0.90,
            context_recall=0.90,
            overall_quality=0.90,
            case_count=1,
        )
        failures = check_thresholds(agg, QualityThresholds())
        assert any("faithfulness" in f for f in failures)

    def test_E3_failure_when_overall_quality_below_threshold(self):
        """Manually craft an aggregate with overall_quality = 0.10."""
        agg = AggregateMetrics(
            faithfulness=0.90,
            answer_relevancy=0.90,
            context_precision=0.90,
            context_recall=0.90,
            overall_quality=0.10,
            case_count=1,
        )
        failures = check_thresholds(agg, QualityThresholds())
        assert any("overall_quality" in f for f in failures)

    def test_E4_failure_message_contains_metric_name(self):
        """Failure string must name the breached metric explicitly."""
        agg = AggregateMetrics(0.10, 0.90, 0.90, 0.90, 0.90, 1)
        failures = check_thresholds(agg, QualityThresholds())
        assert len(failures) >= 1
        assert "faithfulness" in failures[0]

    def test_E5_multiple_failures_for_multiple_below_threshold_metrics(self):
        """When all metrics are zero, all 5 checks should fire."""
        agg = AggregateMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 1)
        failures = check_thresholds(agg, QualityThresholds())
        assert len(failures) == 5


# ============================================================================
# Group F — run_gate()
# ============================================================================

class TestRunGate:

    def test_F1_returns_zero_for_standard_canonical_cases(self):
        """Default thresholds + canonical cases → exit code 0."""
        code = run_gate(thresholds=QualityThresholds())
        assert code == 0

    def test_F2_returns_zero_for_strict_canonical_cases(self):
        """Strict thresholds should also be met by canonical cases."""
        code = run_gate(thresholds=QualityThresholds.strict())
        assert code == 0

    def test_F3_returns_one_when_bad_case_included(self):
        """A degenerate case injected into the suite forces exit code 1."""
        bad_cases = list(CANONICAL_CASES) + [_bad_case()]
        code = run_gate(thresholds=QualityThresholds(), cases=bad_cases)
        assert code == 1

    def test_F4_report_case_count_matches_canonical_suite(self):
        """Report must show case_count = 4 for default canonical cases."""
        results = [evaluate_case(c) for c in CANONICAL_CASES]
        agg = aggregate_results(results)
        failures = check_thresholds(agg, QualityThresholds())
        report = build_report(results, agg, failures, QualityThresholds())
        assert report.case_count == 4

    def test_F5_report_passed_true_when_exit_code_zero(self):
        """When gate passes, report.passed must be True and exit_code must be 0."""
        results = [evaluate_case(c) for c in CANONICAL_CASES]
        agg = aggregate_results(results)
        failures = check_thresholds(agg, QualityThresholds())
        report = build_report(results, agg, failures, QualityThresholds())
        assert report.passed is True
        assert report.exit_code == 0

    def test_F6_json_output_file_is_written(self, tmp_path: Path):
        """run_gate(output_path=...) must write a valid JSON file."""
        report_path = tmp_path / "quality-report.json"
        run_gate(thresholds=QualityThresholds(), output_path=report_path)
        assert report_path.exists()
        with open(report_path, encoding="utf-8") as fh:
            data = json.load(fh)
        assert "passed" in data
        assert "aggregate" in data
        assert "exit_code" in data


# ============================================================================
# Group G — GateReport JSON structure
# ============================================================================

class TestGateReportStructure:

    def _build_default_report(self) -> GateReport:
        results = [evaluate_case(c) for c in CANONICAL_CASES]
        agg = aggregate_results(results)
        failures = check_thresholds(agg, QualityThresholds())
        return build_report(results, agg, failures, QualityThresholds())

    def test_G1_aggregate_dict_has_all_five_metric_keys(self):
        """aggregate dict must contain all 5 RAGAS metric keys."""
        report = self._build_default_report()
        expected = {
            "faithfulness", "answer_relevancy", "context_precision",
            "context_recall", "overall_quality",
        }
        assert expected.issubset(report.aggregate.keys())

    def test_G2_per_case_results_has_four_entries(self):
        """per_case_results must have exactly 4 entries (one per canonical case)."""
        report = self._build_default_report()
        assert len(report.per_case_results) == 4

    def test_G3_each_per_case_result_has_required_keys(self):
        """Each entry in per_case_results must have name, passed, metrics."""
        report = self._build_default_report()
        required_keys = {"name", "passed", "metrics"}
        for entry in report.per_case_results:
            assert required_keys.issubset(entry.keys()), (
                f"Missing keys in per_case_result: {required_keys - entry.keys()}"
            )
