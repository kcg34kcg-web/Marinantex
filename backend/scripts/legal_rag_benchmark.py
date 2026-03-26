#!/usr/bin/env python3
"""Legal RAG benchmark (retrieval quality + latency snapshot)."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from scripts.legal_rag_eval import run_eval


@dataclass
class LatencyStats:
    iterations: int
    p50_ms: float
    p95_ms: float
    avg_ms: float


@dataclass
class BenchmarkReport:
    eval_quality: dict[str, Any]
    latency: LatencyStats
    pass_all: bool


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((p / 100.0) * (len(ordered) - 1)))))
    return float(ordered[index])


def run_benchmark(*, questions: Path, iterations: int) -> BenchmarkReport:
    first = run_eval(questions)
    durations: list[float] = []
    for _ in range(max(1, iterations)):
        start = time.perf_counter()
        _ = run_eval(questions)
        elapsed = (time.perf_counter() - start) * 1000.0
        durations.append(elapsed)

    latency = LatencyStats(
        iterations=len(durations),
        p50_ms=round(_percentile(durations, 50.0), 3),
        p95_ms=round(_percentile(durations, 95.0), 3),
        avg_ms=round(float(statistics.mean(durations)), 3),
    )
    quality = asdict(first)
    improved = bool(first.hybrid_rerank.top1_accuracy > first.dense.top1_accuracy)
    pass_all = bool(first.pass_all and improved)
    return BenchmarkReport(eval_quality=quality, latency=latency, pass_all=pass_all)


def main() -> None:
    parser = argparse.ArgumentParser(description="Legal RAG benchmark")
    parser.add_argument(
        "--questions",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "evals" / "golden-questions.json",
    )
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    report = run_benchmark(questions=args.questions, iterations=max(1, int(args.iterations)))
    payload: dict[str, Any] = asdict(report)

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report.pass_all else 1)


if __name__ == "__main__":
    main()

