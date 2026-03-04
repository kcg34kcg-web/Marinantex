"""
Apply deterministic RAG v3 migrations (step01 -> step02 -> step03 -> step04 -> step05) and verify.

Usage (from repo root):
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py

Optional:
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py --dsn "postgresql://..."
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py --skip-verify
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable

import psycopg2
from dotenv import dotenv_values


STEP_FILES = (
    "supabase/rag_v3_step01_documents_chunks.sql",
    "supabase/rag_v3_step02_hybrid_lanes.sql",
    "supabase/rag_v3_step03_governance_ops.sql",
    "supabase/rag_v3_step04_chunk_stability.sql",
    "supabase/rag_v3_step05_query_trace_contract.sql",
)


def _first_present(values: Iterable[str | None]) -> str | None:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return None


def _load_database_url(repo_root: Path) -> str | None:
    candidates = [
        repo_root / "backend" / ".env",
        repo_root / ".env.local",
        repo_root / ".env",
        repo_root / "backend" / ".env.local",
    ]
    values: list[str | None] = [os.environ.get("DATABASE_URL")]
    for path in candidates:
        if path.exists():
            env_map = dotenv_values(path)
            values.append(env_map.get("DATABASE_URL"))
    return _first_present(values)


def _must_exist_sql_files(repo_root: Path) -> list[Path]:
    paths = [(repo_root / rel).resolve() for rel in STEP_FILES]
    missing = [p for p in paths if not p.exists()]
    if missing:
        missing_text = ", ".join(str(p) for p in missing)
        raise FileNotFoundError(f"Missing SQL migration files: {missing_text}")
    return paths


def _apply_sql_file(conn: psycopg2.extensions.connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)


def _query_bool(
    conn: psycopg2.extensions.connection,
    query: str,
    params: tuple[object, ...] = (),
) -> bool:
    with conn.cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
        if not row:
            return False
        return bool(row[0])


def _verify(conn: psycopg2.extensions.connection) -> None:
    checks: list[tuple[str, bool]] = []

    checks.append(
        (
            "extension.vector",
            _query_bool(conn, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')"),
        )
    )

    for table_name in ("rag_documents", "rag_chunks", "rag_v3_query_traces"):
        checks.append(
            (
                f"table.{table_name}",
                _query_bool(conn, "SELECT to_regclass(%s) IS NOT NULL", (f"public.{table_name}",)),
            )
        )

    for func_name in (
        "rag_v3_match_chunks",
        "rag_v3_match_chunks_dense",
        "rag_v3_match_chunks_sparse",
    ):
        checks.append(
            (
                f"function.{func_name}",
                _query_bool(
                    conn,
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_proc p
                        JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public'
                          AND p.proname = %s
                    )
                    """,
                    (func_name,),
                ),
            )
        )

    for index_name in (
        "uq_rag_chunks_document_hash",
        "idx_rag_chunks_text_tsv",
        "idx_rag_chunks_embedding_cosine",
        "idx_rag_chunks_document_id",
        "idx_rag_chunks_article_clause",
        "idx_rag_documents_acl_tags",
        "idx_rag_v3_query_traces_created",
        "idx_rag_v3_query_traces_bureau_created",
        "idx_rag_v3_query_traces_contract_version",
    ):
        checks.append(
            (
                f"index.{index_name}",
                _query_bool(conn, "SELECT to_regclass(%s) IS NOT NULL", (f"public.{index_name}",)),
            )
        )

    failed = [name for name, ok in checks if not ok]
    for name, ok in checks:
        status = "OK" if ok else "MISSING"
        print(f"[verify] {status:7} {name}")

    if failed:
        raise RuntimeError("RAG v3 verification failed: " + ", ".join(failed))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply deterministic RAG v3 migrations (step01 -> step02 -> step03 -> step04 -> step05)."
    )
    parser.add_argument(
        "--dsn",
        default=None,
        help="Postgres DSN. If omitted, DATABASE_URL is resolved from env files.",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="Skip post-migration verification checks.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    sql_files = _must_exist_sql_files(repo_root)
    dsn = args.dsn or _load_database_url(repo_root)
    if not dsn:
        raise RuntimeError("DATABASE_URL not found. Provide --dsn or set env files.")

    with psycopg2.connect(dsn) as conn:
        # SQL files contain explicit BEGIN/COMMIT blocks; keep connection autocommit on.
        conn.autocommit = True
        for path in sql_files:
            print(f"[apply] {path}")
            _apply_sql_file(conn, path)

        if args.skip_verify:
            print("[verify] skipped")
        else:
            _verify(conn)

    print("RAG v3 migrations applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
