#!/usr/bin/env python3
"""Retrieval quality gate for RAG v3 release decisions."""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class RetrievalThresholds:
    recall_at_k: float = 0.80
    mrr_at_k: float = 0.60
    ndcg_at_k: float = 0.65
    citation_precision: float = 0.70

    @classmethod
    def strict(cls) -> "RetrievalThresholds":
        return cls(
            recall_at_k=0.88,
            mrr_at_k=0.72,
            ndcg_at_k=0.78,
            citation_precision=0.78,
        )


@dataclass(frozen=True)
class RetrievalCase:
    name: str
    retrieved_chunk_ids: List[str]
    cited_chunk_ids: List[str]
    gold_chunk_ids: List[str]
    k: int = 12


@dataclass
class RetrievalCaseResult:
    name: str
    recall_at_k: float
    mrr_at_k: float
    ndcg_at_k: float
    citation_precision: float


@dataclass
class RetrievalAggregate:
    recall_at_k: float
    mrr_at_k: float
    ndcg_at_k: float
    citation_precision: float
    case_count: int


@dataclass
class RetrievalGateReport:
    passed: bool
    generated_at: str
    case_count: int
    aggregate: Dict[str, float]
    thresholds: Dict[str, float]
    failures: List[str]
    exit_code: int


CANONICAL_RETRIEVAL_CASES: List[RetrievalCase] = [
    RetrievalCase(
        name="law_article_exact_match",
        retrieved_chunk_ids=["c17", "c20", "c5"],
        cited_chunk_ids=["c17"],
        gold_chunk_ids=["c17"],
    ),
    RetrievalCase(
        name="conflicting_versions",
        retrieved_chunk_ids=["v2-44", "v1-44", "misc-9"],
        cited_chunk_ids=["v2-44"],
        gold_chunk_ids=["v2-44", "v1-44"],
    ),
    RetrievalCase(
        name="unanswerable_should_not_cite_noise",
        retrieved_chunk_ids=["noise-1", "noise-2", "noise-3"],
        cited_chunk_ids=[],
        gold_chunk_ids=[],
    ),
]


def evaluate_case(case: RetrievalCase) -> RetrievalCaseResult:
    top_k = list(case.retrieved_chunk_ids[: max(1, int(case.k))])
    gold = list(dict.fromkeys(case.gold_chunk_ids))
    cited = list(dict.fromkeys(case.cited_chunk_ids))

    recall = _recall_at_k(top_k, gold)
    mrr = _mrr_at_k(top_k, gold)
    ndcg = _ndcg_at_k(top_k, gold)
    precision = _citation_precision(cited, gold)
    return RetrievalCaseResult(
        name=case.name,
        recall_at_k=recall,
        mrr_at_k=mrr,
        ndcg_at_k=ndcg,
        citation_precision=precision,
    )


def aggregate_results(results: List[RetrievalCaseResult]) -> RetrievalAggregate:
    if not results:
        return RetrievalAggregate(0.0, 0.0, 0.0, 0.0, 0)
    n = float(len(results))
    return RetrievalAggregate(
        recall_at_k=round(sum(item.recall_at_k for item in results) / n, 4),
        mrr_at_k=round(sum(item.mrr_at_k for item in results) / n, 4),
        ndcg_at_k=round(sum(item.ndcg_at_k for item in results) / n, 4),
        citation_precision=round(sum(item.citation_precision for item in results) / n, 4),
        case_count=len(results),
    )


def check_thresholds(agg: RetrievalAggregate, thresholds: RetrievalThresholds) -> List[str]:
    checks = [
        ("recall_at_k", agg.recall_at_k, thresholds.recall_at_k),
        ("mrr_at_k", agg.mrr_at_k, thresholds.mrr_at_k),
        ("ndcg_at_k", agg.ndcg_at_k, thresholds.ndcg_at_k),
        ("citation_precision", agg.citation_precision, thresholds.citation_precision),
    ]
    failures: List[str] = []
    for name, actual, minimum in checks:
        if actual < minimum:
            failures.append(f"{name}: {actual:.4f} < threshold {minimum:.4f}")
    return failures


def run_gate(
    *,
    thresholds: Optional[RetrievalThresholds] = None,
    cases: Optional[List[RetrievalCase]] = None,
    output_path: Optional[Path] = None,
) -> int:
    cfg = thresholds or RetrievalThresholds()
    active_cases = cases or CANONICAL_RETRIEVAL_CASES

    case_results = [evaluate_case(case) for case in active_cases]
    agg = aggregate_results(case_results)
    failures = check_thresholds(agg, cfg)
    report = RetrievalGateReport(
        passed=len(failures) == 0,
        generated_at=datetime.now(timezone.utc).isoformat(),
        case_count=len(active_cases),
        aggregate={
            "recall_at_k": agg.recall_at_k,
            "mrr_at_k": agg.mrr_at_k,
            "ndcg_at_k": agg.ndcg_at_k,
            "citation_precision": agg.citation_precision,
        },
        thresholds={
            "recall_at_k": cfg.recall_at_k,
            "mrr_at_k": cfg.mrr_at_k,
            "ndcg_at_k": cfg.ndcg_at_k,
            "citation_precision": cfg.citation_precision,
        },
        failures=failures,
        exit_code=0 if not failures else 1,
    )

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(asdict(report), handle, ensure_ascii=False, indent=2)

    return report.exit_code


def _recall_at_k(retrieved: List[str], gold: List[str]) -> float:
    if not gold:
        return 1.0
    hits = sum(1 for item in gold if item in retrieved)
    return round(hits / float(len(gold)), 4)


def _mrr_at_k(retrieved: List[str], gold: List[str]) -> float:
    if not gold:
        return 1.0
    for index, chunk_id in enumerate(retrieved, start=1):
        if chunk_id in gold:
            return round(1.0 / float(index), 4)
    return 0.0


def _ndcg_at_k(retrieved: List[str], gold: List[str]) -> float:
    if not gold:
        return 1.0
    dcg = 0.0
    for idx, chunk_id in enumerate(retrieved, start=1):
        rel = 1.0 if chunk_id in gold else 0.0
        if rel > 0.0:
            dcg += rel / math.log2(idx + 1.0)
    ideal_hits = min(len(gold), len(retrieved))
    idcg = sum(1.0 / math.log2(idx + 1.0) for idx in range(1, ideal_hits + 1))
    if idcg <= 0.0:
        return 0.0
    return round(dcg / idcg, 4)


def _citation_precision(cited: List[str], gold: List[str]) -> float:
    if not cited:
        return 1.0 if not gold else 0.0
    if not gold:
        return 0.0
    hits = sum(1 for item in cited if item in gold)
    return round(hits / float(len(cited)), 4)


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG v3 retrieval quality gate")
    parser.add_argument("--strict", action="store_true", help="Enable strict thresholds")
    parser.add_argument("--output", type=Path, default=None, help="Write report json")
    args = parser.parse_args()

    thresholds = RetrievalThresholds.strict() if args.strict else RetrievalThresholds()
    code = run_gate(thresholds=thresholds, output_path=args.output)
    sys.exit(code)


if __name__ == "__main__":
    main()
