#!/usr/bin/env python3
"""Reranker calibration gate for RAG v3 release checks."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class RerankerCase:
    name: str
    scores: dict[str, float]
    expected_top_id: str
    dataset_version: str = "unknown"
    review_status: str = "unknown"


@dataclass
class Thresholds:
    top1_accuracy: float = 0.88
    mean_margin: float = 0.07
    mean_spread: float = 0.05

    @classmethod
    def strict(cls) -> "Thresholds":
        return cls(top1_accuracy=0.95, mean_margin=0.11, mean_spread=0.08)


@dataclass
class CaseResult:
    name: str
    predicted_top_id: str
    expected_top_id: str
    top_correct: bool
    margin: float
    spread: float


@dataclass
class Report:
    passed: bool
    generated_at: str
    case_count: int
    aggregate: dict[str, float]
    thresholds: dict[str, float]
    failures: list[str]
    dataset_path: str | None
    strict_mode: bool
    exit_code: int


CANONICAL_SYNTHETIC_CASES: list[RerankerCase] = [
    RerankerCase(
        name="article_exact_priority",
        scores={"chunk-a": 0.18, "chunk-b": 0.88, "chunk-c": 0.24},
        expected_top_id="chunk-b",
        dataset_version="synthetic.v0",
        review_status="synthetic",
    ),
    RerankerCase(
        name="authority_preference",
        scores={"doc-low": 0.37, "doc-high": 0.74, "doc-mid": 0.61},
        expected_top_id="doc-high",
        dataset_version="synthetic.v0",
        review_status="synthetic",
    ),
    RerankerCase(
        name="citation_alignment",
        scores={"c1": 0.79, "c2": 0.28, "c3": 0.17},
        expected_top_id="c1",
        dataset_version="synthetic.v0",
        review_status="synthetic",
    ),
]


DEFAULT_DATASET_PATH = Path(__file__).resolve().parents[2] / "evals" / "rag_v3_reranker_calibration_v1.jsonl"


def _load_jsonl(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        raise FileNotFoundError(f"dataset not found: {path}")
    lines = path.read_text(encoding="utf-8").splitlines()
    rows: list[dict[str, object]] = []
    for line_no, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSONL line {line_no}: {exc.msg}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"invalid JSONL line {line_no}: row must be object")
        rows.append(row)
    if not rows:
        raise ValueError("dataset is empty")
    return rows


def load_cases_from_jsonl(path: Path) -> list[RerankerCase]:
    rows = _load_jsonl(path)
    cases: list[RerankerCase] = []

    for idx, row in enumerate(rows, start=1):
        name = str(row.get("case_id") or row.get("question_id") or f"case_{idx}").strip()
        dataset_version = str(row.get("dataset_version") or "unknown").strip()
        review = row.get("review")
        review_status = "unknown"
        if isinstance(review, dict):
            review_status = str(review.get("status") or "unknown").strip().lower()
        if review_status != "expert_verified":
            raise ValueError(f"case {name}: review.status must be expert_verified")

        raw_candidates = row.get("candidates")
        if not isinstance(raw_candidates, list) or len(raw_candidates) < 2:
            raise ValueError(f"case {name}: candidates must be a list with at least 2 items")

        scores: dict[str, float] = {}
        expected_top_id = str(row.get("expected_top_id") or "").strip()
        for raw_candidate in raw_candidates:
            if not isinstance(raw_candidate, dict):
                raise ValueError(f"case {name}: candidate rows must be objects")
            chunk_id = str(raw_candidate.get("chunk_id") or "").strip()
            if not chunk_id:
                raise ValueError(f"case {name}: candidate chunk_id is required")
            score_raw = raw_candidate.get("score")
            try:
                score = float(score_raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"case {name}: candidate score must be numeric") from exc
            scores[chunk_id] = score
            if not expected_top_id and bool(raw_candidate.get("is_gold", False)):
                expected_top_id = chunk_id

        if not expected_top_id:
            ranked = sorted(scores.items(), key=lambda item: float(item[1]), reverse=True)
            expected_top_id = str(ranked[0][0])

        if expected_top_id not in scores:
            raise ValueError(f"case {name}: expected_top_id is not in candidates")

        cases.append(
            RerankerCase(
                name=name,
                scores=scores,
                expected_top_id=expected_top_id,
                dataset_version=dataset_version,
                review_status=review_status,
            )
        )

    if len(cases) < 8:
        raise ValueError(f"dataset too small: expected >= 8 cases, got {len(cases)}")

    return cases


def evaluate_case(case: RerankerCase) -> CaseResult:
    ranked = sorted(case.scores.items(), key=lambda item: float(item[1]), reverse=True)
    top_id, top_score = ranked[0]
    second_score = float(ranked[1][1]) if len(ranked) > 1 else 0.0
    min_score = float(ranked[-1][1]) if ranked else 0.0
    return CaseResult(
        name=case.name,
        predicted_top_id=str(top_id),
        expected_top_id=case.expected_top_id,
        top_correct=(str(top_id) == case.expected_top_id),
        margin=max(0.0, float(top_score) - second_score),
        spread=max(0.0, float(top_score) - min_score),
    )


def run_gate(
    *,
    thresholds: Thresholds,
    dataset_path: Path | None = DEFAULT_DATASET_PATH,
    output_path: Path | None = None,
    strict_mode: bool = False,
    allow_synthetic_fallback: bool = False,
) -> int:
    active_dataset_path: Path | None = dataset_path
    cases: list[RerankerCase]
    try:
        if dataset_path is None:
            raise FileNotFoundError("dataset disabled")
        cases = load_cases_from_jsonl(dataset_path)
    except Exception:
        if not allow_synthetic_fallback:
            raise
        active_dataset_path = None
        cases = list(CANONICAL_SYNTHETIC_CASES)

    results = [evaluate_case(case) for case in cases]
    n = float(max(1, len(results)))
    top1_accuracy = sum(1.0 for item in results if item.top_correct) / n
    mean_margin = sum(float(item.margin) for item in results) / n
    mean_spread = sum(float(item.spread) for item in results) / n

    failures: list[str] = []
    if top1_accuracy < float(thresholds.top1_accuracy):
        failures.append(f"top1_accuracy: {top1_accuracy:.4f} < {thresholds.top1_accuracy:.4f}")
    if mean_margin < float(thresholds.mean_margin):
        failures.append(f"mean_margin: {mean_margin:.4f} < {thresholds.mean_margin:.4f}")
    if mean_spread < float(thresholds.mean_spread):
        failures.append(f"mean_spread: {mean_spread:.4f} < {thresholds.mean_spread:.4f}")

    report = Report(
        passed=(len(failures) == 0),
        generated_at=datetime.now(timezone.utc).isoformat(),
        case_count=len(results),
        aggregate={
            "top1_accuracy": round(top1_accuracy, 4),
            "mean_margin": round(mean_margin, 4),
            "mean_spread": round(mean_spread, 4),
        },
        thresholds={
            "top1_accuracy": float(thresholds.top1_accuracy),
            "mean_margin": float(thresholds.mean_margin),
            "mean_spread": float(thresholds.mean_spread),
        },
        failures=failures,
        dataset_path=str(active_dataset_path) if active_dataset_path is not None else None,
        strict_mode=bool(strict_mode),
        exit_code=0 if not failures else 1,
    )

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(asdict(report), handle, ensure_ascii=False, indent=2)

    return report.exit_code


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG v3 reranker calibration gate")
    parser.add_argument("--strict", action="store_true", help="Enable strict calibration thresholds")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET_PATH,
        help=f"JSONL dataset path (default: {DEFAULT_DATASET_PATH})",
    )
    parser.add_argument("--allow-synthetic-fallback", action="store_true", help="Allow fallback to synthetic cases")
    parser.add_argument("--output", type=Path, default=None, help="Write report json")
    args = parser.parse_args()

    thresholds = Thresholds.strict() if args.strict else Thresholds()
    try:
        code = run_gate(
            thresholds=thresholds,
            dataset_path=args.dataset,
            output_path=args.output,
            strict_mode=bool(args.strict),
            allow_synthetic_fallback=bool(args.allow_synthetic_fallback),
        )
    except Exception as exc:
        if args.output is not None:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with open(args.output, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "passed": False,
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                        "case_count": 0,
                        "aggregate": {"top1_accuracy": 0.0, "mean_margin": 0.0, "mean_spread": 0.0},
                        "thresholds": asdict(thresholds),
                        "failures": [f"dataset_error: {exc}"],
                        "dataset_path": str(args.dataset),
                        "strict_mode": bool(args.strict),
                        "exit_code": 1,
                    },
                    handle,
                    ensure_ascii=False,
                    indent=2,
                )
        print(f"reranker_calibration_gate failed: {exc}", file=sys.stderr)
        sys.exit(1)

    sys.exit(code)


if __name__ == "__main__":
    main()
