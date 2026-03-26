"""Smoke tests for migration manifest integrity gate."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_migration_manifest_gate_passes_for_current_repo() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    script = backend_root / "scripts" / "check_rag_v3_migration_manifest.py"
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + "\n" + result.stderr
