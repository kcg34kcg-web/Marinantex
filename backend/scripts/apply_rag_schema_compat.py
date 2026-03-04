"""
Applies Step 28 retrieval schema compatibility migration.

Usage (from repo root):
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_schema_compat.py

Optional:
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_schema_compat.py --dsn "postgresql://..."
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_schema_compat.py --sql supabase/rag_v2_step28_schema_compat.sql
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
from typing import Iterable

import asyncpg
from dotenv import dotenv_values


def _first_present(values: Iterable[str | None]) -> str | None:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return None


def _load_database_url(repo_root: Path) -> str | None:
    # Prefer backend/.env first because this environment was verified to have
    # a reachable DATABASE_URL in local development.
    candidates = [
        repo_root / "backend" / ".env",
        repo_root / ".env.local",
        repo_root / ".env",
        repo_root / "backend" / ".env.local",
    ]
    values = []
    for path in candidates:
        if path.exists():
            env_map = dotenv_values(path)
            values.append(env_map.get("DATABASE_URL"))
    return _first_present(values)


async def _apply(sql: str, dsn: str) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction():
            await conn.execute(sql)
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply Step 28 schema compatibility migration.")
    parser.add_argument(
        "--dsn",
        default=None,
        help="Postgres DSN. If omitted, DATABASE_URL is resolved from env files.",
    )
    parser.add_argument(
        "--sql",
        default="supabase/rag_v2_step28_schema_compat.sql",
        help="Path to SQL migration file.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    sql_path = (repo_root / args.sql).resolve()
    if not sql_path.exists():
        raise FileNotFoundError(f"SQL file not found: {sql_path}")

    dsn = args.dsn or _load_database_url(repo_root)
    if not dsn:
        raise RuntimeError("DATABASE_URL not found. Provide --dsn or set env files.")

    sql = sql_path.read_text(encoding="utf-8")
    asyncio.run(_apply(sql=sql, dsn=dsn))

    print(f"Applied migration successfully: {sql_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

