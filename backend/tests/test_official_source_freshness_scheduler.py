"""Regression tests for official source freshness scheduler script."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _script_path() -> Path:
    return Path(__file__).resolve().parents[1] / "scripts" / "official_source_freshness_scheduler.py"


def test_freshness_scheduler_dry_run_writes_report(tmp_path) -> None:
    registry = tmp_path / "official-source-registry.json"
    output = tmp_path / "freshness-report.json"
    registry.write_text(
        json.dumps(
            {
                "registry_version": "official.scheduler.vtest",
                "sources": [
                    {
                        "source_registry_id": "resmi_gazete",
                        "source_url": "https://www.resmigazete.gov.tr",
                        "expected_update_interval_hours": 24,
                        "latest_remote_at": "2026-03-10T10:00:00Z",
                        "ingested_latest_at": "2026-03-10T11:00:00Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(_script_path()),
            "--registry",
            str(registry),
            "--dry-run",
            "--output",
            str(output),
            "--fail-on-error",
            "--fail-on-stale",
        ],
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + "\n" + result.stderr
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["state_counts"]["fresh"] == 1


def test_freshness_scheduler_returns_code_2_when_stale_and_fail_on_stale(tmp_path) -> None:
    registry = tmp_path / "official-source-registry.json"
    registry.write_text(
        json.dumps(
            {
                "registry_version": "official.scheduler.vtest",
                "sources": [
                    {
                        "source_registry_id": "resmi_gazete",
                        "source_url": "https://www.resmigazete.gov.tr",
                        "expected_update_interval_hours": 24,
                        "latest_remote_at": "2026-03-10T11:00:00Z",
                        "ingested_latest_at": "2026-03-09T08:00:00Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(_script_path()),
            "--registry",
            str(registry),
            "--dry-run",
            "--fail-on-stale",
        ],
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
