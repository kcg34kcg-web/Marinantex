"""Tests for RAG v3 alert rules contract validation."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.validate_rag_v3_alert_rules import validate_alert_contract


def test_validate_alert_contract_has_no_errors_for_repo_contract() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    payload = json.loads((backend_root / "ops" / "rag_v3_alert_rules.json").read_text(encoding="utf-8"))
    errors = validate_alert_contract(payload)

    assert errors == []


def test_validate_alert_rules_script_passes() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    script = backend_root / "scripts" / "validate_rag_v3_alert_rules.py"
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + "\n" + result.stderr
