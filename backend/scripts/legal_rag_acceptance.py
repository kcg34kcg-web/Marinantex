#!/usr/bin/env python3
"""One-shot legal RAG acceptance runner."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


@dataclass
class CommandResult:
    name: str
    returncode: int
    passed: bool
    output_file: str | None
    stderr: str


@dataclass
class AcceptanceReport:
    evaluation: CommandResult
    smoke: CommandResult
    benchmark: CommandResult
    pass_all: bool


def _run(cmd: list[str], *, name: str, output_file: Path | None = None) -> CommandResult:
    run = subprocess.run(cmd, capture_output=True, text=True)
    return CommandResult(
        name=name,
        returncode=run.returncode,
        passed=(run.returncode == 0),
        output_file=str(output_file) if output_file is not None else None,
        stderr=(run.stderr or "").strip()[:600],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Legal RAG acceptance runner")
    parser.add_argument("--artifacts-dir", type=Path, default=Path(__file__).resolve().parents[2] / "artifacts")
    parser.add_argument("--questions", type=Path, default=Path(__file__).resolve().parents[2] / "evals" / "golden-questions.json")
    parser.add_argument(
        "--smoke-endpoint-mode",
        default=os.getenv("LEGAL_RAG_SMOKE_ENDPOINT_MODE", "strict"),
        choices=["strict", "auto", "mock"],
        help="Forwarded to legal_rag_smoke.py --endpoint-mode",
    )
    args = parser.parse_args()

    artifacts = args.artifacts_dir
    artifacts.mkdir(parents=True, exist_ok=True)

    eval_out = artifacts / "legal-rag-eval-report.json"
    smoke_out = artifacts / "legal-rag-smoke-report.json"
    bench_out = artifacts / "legal-rag-benchmark-report.json"

    py = sys.executable or "python3"
    evaluation = _run(
        [py, "backend/scripts/legal_rag_eval.py", "--questions", str(args.questions), "--output", str(eval_out)],
        name="evaluation",
        output_file=eval_out,
    )
    smoke = _run(
        [
            py,
            "backend/scripts/legal_rag_smoke.py",
            "--endpoint-mode",
            str(args.smoke_endpoint_mode),
            "--output",
            str(smoke_out),
        ],
        name="smoke",
        output_file=smoke_out,
    )
    benchmark = _run(
        [
            py,
            "backend/scripts/legal_rag_benchmark.py",
            "--questions",
            str(args.questions),
            "--iterations",
            "30",
            "--output",
            str(bench_out),
        ],
        name="benchmark",
        output_file=bench_out,
    )

    pass_all = bool(evaluation.passed and smoke.passed and benchmark.passed)
    report = AcceptanceReport(
        evaluation=evaluation,
        smoke=smoke,
        benchmark=benchmark,
        pass_all=pass_all,
    )
    payload: dict[str, Any] = asdict(report)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    report_out = artifacts / "legal-rag-acceptance-report.json"
    report_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    raise SystemExit(0 if pass_all else 1)


if __name__ == "__main__":
    main()
