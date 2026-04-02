#!/usr/bin/env python3
"""
Apply key=value overrides from a profile file into an env file.

Usage:
    python3 backend/scripts/apply_env_profile.py \
      --env backend/.env \
      --profile backend/env-profiles/dev-safe.env
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ENV_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _load_profile(path: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ENV_LINE_RE.match(line)
        if not match:
            continue
        rows.append((match.group(1), match.group(2)))
    return rows


def _apply(env_path: Path, profile_rows: list[tuple[str, str]]) -> tuple[int, int, int]:
    original_lines = env_path.read_text(encoding="utf-8").splitlines()
    updated_lines: list[str | None] = list(original_lines)
    indices_by_key: dict[str, list[int]] = {}
    for idx, line in enumerate(original_lines):
        match = ENV_LINE_RE.match(line)
        if not match:
            continue
        key = match.group(1)
        indices_by_key.setdefault(key, []).append(idx)

    replaced = 0
    added = 0
    deduped = 0
    for key, value in profile_rows:
        new_line = f"{key}={value}"
        key_indices = indices_by_key.get(key, [])
        if key_indices:
            updated_lines[key_indices[0]] = new_line
            for dup_idx in key_indices[1:]:
                if updated_lines[dup_idx] is not None:
                    updated_lines[dup_idx] = None
                    deduped += 1
            replaced += 1
        else:
            updated_lines.append(new_line)
            added += 1

    final_lines = [line for line in updated_lines if line is not None]
    env_path.write_text("\n".join(final_lines) + "\n", encoding="utf-8")
    return replaced, added, deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply env profile overrides.")
    parser.add_argument("--env", required=True, help="Target env file path (e.g. backend/.env).")
    parser.add_argument("--profile", required=True, help="Profile env file path.")
    args = parser.parse_args()

    env_path = Path(args.env).resolve()
    profile_path = Path(args.profile).resolve()

    if not env_path.exists():
        raise FileNotFoundError(f"Env file not found: {env_path}")
    if not profile_path.exists():
        raise FileNotFoundError(f"Profile file not found: {profile_path}")

    rows = _load_profile(profile_path)
    if not rows:
        raise RuntimeError(f"Profile has no key=value pairs: {profile_path}")

    replaced, added, deduped = _apply(env_path, rows)
    print(
        f"Applied profile {profile_path.name} -> {env_path} | "
        f"keys={len(rows)} replaced={replaced} added={added} deduped={deduped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
