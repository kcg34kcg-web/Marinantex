"""Smoke tests for prompt registry validation gate script."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_validate_prompt_registry_script_passes_default_registry() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    script = backend_root / "scripts" / "validate_prompt_registry.py"
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + "\n" + result.stderr
