#!/usr/bin/env python3
"""Validate RAG v3 prompt registry contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.rag_v3.prompt_registry import PromptRegistry, PromptRegistryError


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate prompt registry")
    parser.add_argument(
        "--path",
        default="prompts/rag_v3/registry.json",
        help="Path to prompt registry JSON",
    )
    parser.add_argument("--output", default=None, help="Optional output report path")
    args = parser.parse_args()

    registry = PromptRegistry(registry_path=args.path)
    report = {
        "path": str(registry.path),
        "valid": False,
        "error": None,
        "registry_version": None,
        "scenario_count": 0,
    }

    try:
        payload = registry.load(force=True)
        report["valid"] = True
        report["registry_version"] = str(payload.get("registry_version") or "")
        report["scenario_count"] = len(dict(payload.get("scenarios") or {}))
    except PromptRegistryError as exc:
        report["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001
        report["error"] = f"unexpected_error: {exc}"

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not report["valid"]:
        print(f"[prompt-registry] FAILED: {report['error']}")
        sys.exit(1)

    print(
        "[prompt-registry] OK "
        f"version={report['registry_version']} scenarios={report['scenario_count']}"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
