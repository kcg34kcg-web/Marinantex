#!/usr/bin/env python3
"""Strict production-readiness gate for Legal RAG."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass
class Check:
    name: str
    passed: bool
    returncode: int
    details: str


@dataclass
class ReadinessReport:
    checks: list[Check]
    pass_all: bool


def _run(cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, env=merged_env)


def _check(name: str, cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> Check:
    try:
        run = _run(cmd, cwd=cwd, env=env)
    except FileNotFoundError as exc:
        return Check(name=name, passed=False, returncode=127, details=str(exc))
    details = (run.stderr or run.stdout or "").strip()
    if len(details) > 500:
        details = details[:500]
    return Check(name=name, passed=(run.returncode == 0), returncode=run.returncode, details=details)


def main() -> None:
    parser = argparse.ArgumentParser(description="Legal RAG strict production readiness gate")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/legal-rag-prod-readiness-report.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=Path("artifacts/prod-readiness"),
        help="Artifacts directory for delegated scripts",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    backend_root = repo_root / "backend"
    py = sys.executable or "python3"

    checks: list[Check] = []
    checks.append(
        _check(
            "docker_compose_config_valid",
            ["docker", "compose", "-f", "docker-compose.rag-serving.yml", "config"],
            cwd=repo_root,
        )
    )
    checks.append(
        _check(
            "gpu_cuda_available",
            ["nvidia-smi"],
            cwd=repo_root,
        )
    )
    checks.append(
        _check(
            "live_endpoint_health_strict",
            ["bash", "backend/ops/serving/healthcheck.sh"],
            cwd=repo_root,
        )
    )
    checks.append(
        _check(
            "retrieval_quality_gate_strict",
            [py, "scripts/retrieval_quality_gate.py", "--strict", "--output", str((repo_root / args.artifacts_dir / "retrieval-quality-report-strict.json"))],
            cwd=backend_root,
        )
    )
    checks.append(
        _check(
            "reranker_calibration_gate_strict",
            [
                py,
                "scripts/reranker_calibration_gate.py",
                "--strict",
                "--allow-synthetic-fallback",
                "--output",
                str((repo_root / args.artifacts_dir / "reranker-calibration-report-strict.json")),
            ],
            cwd=backend_root,
        )
    )
    checks.append(
        _check(
            "acceptance_strict",
            [
                py,
                "backend/scripts/legal_rag_acceptance.py",
                "--smoke-endpoint-mode",
                "strict",
                "--artifacts-dir",
                str(repo_root / args.artifacts_dir),
            ],
            cwd=repo_root,
        )
    )

    pass_all = all(item.passed for item in checks)
    report = ReadinessReport(checks=checks, pass_all=pass_all)
    payload: dict[str, Any] = asdict(report)

    out_path = repo_root / args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(0 if pass_all else 1)


if __name__ == "__main__":
    main()
