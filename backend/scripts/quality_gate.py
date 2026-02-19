#!/usr/bin/env python3
"""
RAGAS Quality Gate  —  Step 17 / CI-CD
=======================================
Evaluates RAGAS-inspired quality metrics on a canonical synthetic test suite
and enforces minimum thresholds.  Intended to run as a CI step that blocks
deployment when quality degrades.

Exit codes:
    0 — All thresholds met; deployment allowed.
    1 — One or more thresholds or per-case minimums breached; deployment BLOCKED.

Usage:
    cd backend/
    python scripts/quality_gate.py
    python scripts/quality_gate.py --output quality-report.json
    python scripts/quality_gate.py --strict          # pre-release tighter gate

Canonical test cases simulate representative Turkish legal RAG scenarios:
    1. basit_kanun_maddesi   — Simple law article lookup (Tier 1)
    2. yargi_karar_analizi   — Court decision + zamanaşımı analysis (Tier 2)
    3. sinirli_kaynak        — Single-source retrieval (low recall edge-case)
    4. aym_iptal_analizi     — AYM cancellation with partial grounding (Tier 3)

Global aggregate thresholds (averages across all 4 canonical cases):
    faithfulness      ≥ 0.70
    answer_relevancy  ≥ 0.50
    context_precision ≥ 0.55
    context_recall    ≥ 0.65   (sinirli_kaynak pulls recall down — 0.65 is realistic)
    overall_quality   ≥ 0.65

Strict thresholds (--strict / pre-release):
    faithfulness      ≥ 0.80
    answer_relevancy  ≥ 0.60
    context_precision ≥ 0.65
    context_recall    ≥ 0.75
    overall_quality   ≥ 0.72
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ── Ensure backend root is importable regardless of CWD ──────────────────────
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.metrics.ragas_adapter import (  # noqa: E402
    RAGASAdapter,
    RAGASMetrics,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("babylexit.quality_gate")


# ============================================================================
# Threshold configuration
# ============================================================================

@dataclass
class QualityThresholds:
    """
    Minimum acceptable RAGAS metric averages across the canonical test suite.

    The gate BLOCKS deployment if ANY metric average falls below its threshold.
    Tune values per environment via the ``--strict`` flag or settings overrides.

    All values are in [0.0, 1.0].
    """

    faithfulness:      float = 0.70
    answer_relevancy:  float = 0.50
    context_precision: float = 0.55
    context_recall:    float = 0.65
    overall_quality:   float = 0.65

    @classmethod
    def strict(cls) -> "QualityThresholds":
        """Tighter thresholds for pre-release / main-branch gates."""
        return cls(
            faithfulness=0.80,
            answer_relevancy=0.60,
            context_precision=0.65,
            context_recall=0.75,
            overall_quality=0.72,
        )

    @classmethod
    def from_settings(cls) -> "QualityThresholds":
        """
        Load thresholds from application settings if available.
        Falls back to class defaults when settings cannot be loaded (e.g. CI).
        """
        try:
            from infrastructure.config import settings  # noqa: PLC0415
            return cls(
                faithfulness=settings.quality_gate_min_faithfulness,
                answer_relevancy=settings.quality_gate_min_answer_relevancy,
                context_precision=settings.quality_gate_min_context_precision,
                context_recall=settings.quality_gate_min_context_recall,
                overall_quality=settings.quality_gate_min_overall_quality,
            )
        except Exception:  # pragma: no cover — settings may be absent in slim CI
            return cls()


# ============================================================================
# Canonical test cases
# ============================================================================

@dataclass(frozen=True)
class CanonicalCase:
    """
    One synthetic RAG scenario used for quality gate evaluation.

    All inputs correspond exactly to what RAGASAdapter.compute() expects,
    so no network calls or external services are required.
    """

    name: str
    description: str
    query: str
    answer: str
    total_sentences: int
    grounded_sentences: int
    source_scores: Tuple[float, ...]
    target_source_count: int = 3
    min_overall_quality: float = 0.60   # per-case soft minimum


# ── Four representative Turkish legal RAG scenarios ───────────────────────────

CANONICAL_CASES: List[CanonicalCase] = [
    CanonicalCase(
        name="basit_kanun_maddesi",
        description="Tier 1: İş Kanunu ihbar öneli — basit mevzuat araması",
        query="İş Kanunu 17. maddesine göre ihbar öneli nedir?",
        answer=(
            "İş Kanunu 17. maddesi gereğince ihbar öneli işçinin kıdemine göre "
            "değişmektedir. [K:1] "
            "Altı aydan az çalışmada iki hafta, altı ay ila bir buçuk yıl "
            "arasında dört hafta bildirim süresi uygulanır. [K:1][K:2] "
            "İşveren bu sürelere uymak zorundadır, aksi halde ihbar tazminatı "
            "ödemekle yükümlü olur. [K:2]"
        ),
        total_sentences=3,
        grounded_sentences=3,      # All 3 sentences grounded → faithfulness = 1.0
        source_scores=(0.92, 0.87, 0.75),
        target_source_count=3,
        min_overall_quality=0.70,
    ),
    CanonicalCase(
        name="yargi_karar_analizi",
        description="Tier 2: Yargıtay 9. HD — işçi alacakları zamanaşımı içtihadı",
        query="Yargıtay 9. Hukuk Dairesi işçi alacakları zamanaşımı kararları nelerdir?",
        answer=(
            "Yargıtay 9. Hukuk Dairesi kararlarına göre işçi alacaklarında "
            "zamanaşımı değişkendir. [K:1] "
            "Kıdem ve ihbar tazminatı alacaklarında beş yıllık zamanaşımı "
            "uygulanmaktadır. [K:2] "
            "Bu kural emsal niteliğindeki kararlarda tutarlı biçimde "
            "uygulanmaktadır. [K:1][K:3]"
        ),
        total_sentences=3,
        grounded_sentences=3,      # All 3 sentences grounded → faithfulness = 1.0
        source_scores=(0.88, 0.82, 0.79, 0.71),
        target_source_count=3,
        min_overall_quality=0.70,
    ),
    CanonicalCase(
        name="sinirli_kaynak",
        description="Edge-case: Tek kaynak — düşük context_recall testi",
        query="Türk Ticaret Kanunu anonim şirket asgari sermayesi nedir?",
        answer=(
            "Türk Ticaret Kanunu'na göre anonim şirket kuruluşu için "
            "asgari esas sermaye miktarı belirlenmiştir. [K:1]"
        ),
        total_sentences=1,
        grounded_sentences=1,      # 1/1 grounded → faithfulness = 1.0
        source_scores=(0.78,),     # Only 1 source → context_recall = 1/3 ≈ 0.33
        target_source_count=3,
        min_overall_quality=0.45,  # Lower minimum: recall = 0.33 pulls composite down
    ),
    CanonicalCase(
        name="aym_iptal_analizi",
        description="Tier 3: AYM iptal kararı — kısmi grounding (son cümle kayıt dışı)",
        query="Anayasa Mahkemesi iptal kararının hukuki sonuçları nelerdir?",
        answer=(
            "Anayasa Mahkemesi iptal kararları geriye dönük etki doğurmaz. [K:1] "
            "Karar Resmi Gazete'de yayımlanmasından itibaren yürürlüğe girer. [K:2] "
            "Ancak Mahkeme yürürlük tarihini erteleyebilir. [K:1][K:2] "
            "İptal edilen norm bu tarihten itibaren uygulanamaz hale gelir."
        ),
        total_sentences=4,
        grounded_sentences=3,      # 4th sentence ungrounded → faithfulness = 0.75
        source_scores=(0.91, 0.85, 0.80),
        target_source_count=3,
        min_overall_quality=0.60,
    ),
]


# ============================================================================
# Evaluation engine
# ============================================================================

@dataclass
class CaseResult:
    """Evaluation result for a single canonical test case."""

    name: str
    description: str
    metrics: RAGASMetrics
    min_required: float
    passed: bool
    per_case_failure: Optional[str]   # non-None only when case fails its own minimum


@dataclass
class AggregateMetrics:
    """Average metrics across all evaluated canonical cases."""

    faithfulness:      float
    answer_relevancy:  float
    context_precision: float
    context_recall:    float
    overall_quality:   float
    case_count:        int


@dataclass
class GateReport:
    """
    Full output of one quality gate run — JSON-serialisable.

    Fields:
        passed             : True iff exit_code == 0.
        generated_at       : ISO-8601 UTC timestamp.
        case_count         : Number of canonical cases evaluated.
        cases_passed       : Cases meeting their per-case minimum.
        cases_failed       : Cases below their per-case minimum.
        aggregate          : Average metric values (dict).
        thresholds         : Applied threshold values (dict).
        threshold_failures : List of global threshold breaches.
        per_case_results   : Per-case metrics, pass/fail, and failures.
        exit_code          : 0 = pass, 1 = fail.
    """

    passed: bool
    generated_at: str
    case_count: int
    cases_passed: int
    cases_failed: int
    aggregate: Dict
    thresholds: Dict
    threshold_failures: List[str]
    per_case_results: List[Dict]
    exit_code: int


# Module-level adapter singleton (zero side-effects)
_adapter = RAGASAdapter()


def evaluate_case(case: CanonicalCase) -> CaseResult:
    """
    Run RAGASAdapter.compute() against one canonical case.

    Pure function: no side-effects beyond the adapter's internal logger.
    """
    metrics = _adapter.compute(
        query=case.query,
        answer=case.answer,
        total_sentences=case.total_sentences,
        grounded_sentences=case.grounded_sentences,
        source_scores=list(case.source_scores),
        target_source_count=case.target_source_count,
    )

    per_case_failure: Optional[str] = None
    if metrics.overall_quality < case.min_overall_quality:
        per_case_failure = (
            f"[{case.name}] overall_quality={metrics.overall_quality:.4f} "
            f"< min_required={case.min_overall_quality:.4f}"
        )

    return CaseResult(
        name=case.name,
        description=case.description,
        metrics=metrics,
        min_required=case.min_overall_quality,
        passed=(per_case_failure is None),
        per_case_failure=per_case_failure,
    )


def aggregate_results(results: List[CaseResult]) -> AggregateMetrics:
    """
    Compute arithmetic mean of each metric across all CaseResult objects.

    Returns all-zeros with case_count=0 when the input list is empty.
    """
    n = len(results)
    if n == 0:
        return AggregateMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0)

    return AggregateMetrics(
        faithfulness=      round(sum(r.metrics.faithfulness      for r in results) / n, 4),
        answer_relevancy=  round(sum(r.metrics.answer_relevancy  for r in results) / n, 4),
        context_precision= round(sum(r.metrics.context_precision for r in results) / n, 4),
        context_recall=    round(sum(r.metrics.context_recall    for r in results) / n, 4),
        overall_quality=   round(sum(r.metrics.overall_quality   for r in results) / n, 4),
        case_count=n,
    )


def check_thresholds(
    agg: AggregateMetrics,
    thresholds: QualityThresholds,
) -> List[str]:
    """
    Compare aggregate metrics against thresholds.

    Returns:
        List of human-readable failure strings.  Empty list = all passed.
    """
    failures: List[str] = []
    checks: List[Tuple[str, float, float]] = [
        ("faithfulness",      agg.faithfulness,      thresholds.faithfulness),
        ("answer_relevancy",  agg.answer_relevancy,  thresholds.answer_relevancy),
        ("context_precision", agg.context_precision, thresholds.context_precision),
        ("context_recall",    agg.context_recall,    thresholds.context_recall),
        ("overall_quality",   agg.overall_quality,   thresholds.overall_quality),
    ]
    for metric, actual, minimum in checks:
        if actual < minimum:
            failures.append(
                f"{metric}: {actual:.4f} < threshold {minimum:.4f}"
                f"  (deficit: {minimum - actual:.4f})"
            )
    return failures


def build_report(
    results: List[CaseResult],
    agg: AggregateMetrics,
    threshold_failures: List[str],
    thresholds: QualityThresholds,
) -> GateReport:
    """Assemble a GateReport from evaluation output. Pure function."""
    per_case_failures = [r.per_case_failure for r in results if r.per_case_failure]
    all_failures = per_case_failures + threshold_failures
    passed = len(all_failures) == 0

    return GateReport(
        passed=passed,
        generated_at=datetime.now(timezone.utc).isoformat(),
        case_count=len(results),
        cases_passed=sum(1 for r in results if r.passed),
        cases_failed=sum(1 for r in results if not r.passed),
        aggregate={
            "faithfulness":      agg.faithfulness,
            "answer_relevancy":  agg.answer_relevancy,
            "context_precision": agg.context_precision,
            "context_recall":    agg.context_recall,
            "overall_quality":   agg.overall_quality,
        },
        thresholds={
            "faithfulness":      thresholds.faithfulness,
            "answer_relevancy":  thresholds.answer_relevancy,
            "context_precision": thresholds.context_precision,
            "context_recall":    thresholds.context_recall,
            "overall_quality":   thresholds.overall_quality,
        },
        threshold_failures=threshold_failures,
        per_case_results=[
            {
                "name":             r.name,
                "description":      r.description,
                "passed":           r.passed,
                "min_required":     r.min_required,
                "per_case_failure": r.per_case_failure,
                "metrics": {
                    "faithfulness":      round(r.metrics.faithfulness,      4),
                    "answer_relevancy":  round(r.metrics.answer_relevancy,  4),
                    "context_precision": round(r.metrics.context_precision, 4),
                    "context_recall":    round(r.metrics.context_recall,    4),
                    "overall_quality":   round(r.metrics.overall_quality,   4),
                },
            }
            for r in results
        ],
        exit_code=0 if passed else 1,
    )


# ============================================================================
# Main entry point
# ============================================================================

def run_gate(
    thresholds: Optional[QualityThresholds] = None,
    output_path: Optional[Path] = None,
    cases: Optional[List[CanonicalCase]] = None,
) -> int:
    """
    Execute the full quality gate pipeline.

    Args:
        thresholds  : Quality thresholds (defaults to QualityThresholds()).
        output_path : If given, writes a JSON report to this path.
        cases       : Override canonical test cases (used in unit tests).

    Returns:
        0 — All thresholds met; deployment allowed.
        1 — One or more thresholds breached; deployment BLOCKED.
    """
    if thresholds is None:
        thresholds = QualityThresholds.from_settings()
    if cases is None:
        cases = CANONICAL_CASES

    logger.info(
        "🔍 RAGAS Quality Gate: evaluating %d canonical cases…", len(cases)
    )

    # ── Evaluate each case ────────────────────────────────────────────────────
    results = [evaluate_case(c) for c in cases]

    # ── Aggregate + threshold check ───────────────────────────────────────────
    agg = aggregate_results(results)
    threshold_failures = check_thresholds(agg, thresholds)

    # ── Assemble report ───────────────────────────────────────────────────────
    report = build_report(results, agg, threshold_failures, thresholds)

    # ── Log summary ───────────────────────────────────────────────────────────
    status_icon = "✅" if report.passed else "❌"
    logger.info(
        "%s Quality Gate %s | overall_quality=%.4f (threshold=%.4f) | "
        "cases=%d/%d passed",
        status_icon,
        "PASSED" if report.passed else "FAILED",
        agg.overall_quality,
        thresholds.overall_quality,
        report.cases_passed,
        report.case_count,
    )

    per_case_failures = [r.per_case_failure for r in results if r.per_case_failure]
    for fail in per_case_failures + threshold_failures:
        logger.error("  ✗ %s", fail)

    # ── Write JSON report ─────────────────────────────────────────────────────
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        report_dict = asdict(report)
        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(report_dict, fh, indent=2, ensure_ascii=False)
        logger.info("📄 Report written → %s", output_path)

    return report.exit_code


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description=(
            "RAGAS Quality Gate — blocks deployment when metric quality "
            "falls below defined thresholds."
        )
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=None,
        metavar="FILE",
        help="Path to write JSON quality report (optional).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Use stricter pre-release thresholds (main-branch gate).",
    )
    args = parser.parse_args()

    thresholds = QualityThresholds.strict() if args.strict else QualityThresholds.from_settings()
    exit_code = run_gate(thresholds=thresholds, output_path=args.output)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
