"""
Apply deterministic RAG v3 migrations (step01 -> step17) and verify.

Usage (from repo root):
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py

Optional:
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py --dsn "postgresql://..."
    .venv\\Scripts\\python.exe backend\\scripts\\apply_rag_v3_migrations.py --skip-verify
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
    "supabase/rag_v3_step06_classification_rbac_contracts.sql",
    "supabase/rag_v3_step07_snapshot_revocation_control_plane.sql",
    "supabase/rag_v3_step08_ingest_quality_review_ops.sql",
    "supabase/rag_v3_step09_legal_exact_doc_shortlist.sql",
    "supabase/rag_v3_step10_single_pipeline_rollout.sql",
    "supabase/rag_v3_step11_chunk_metadata_contract.sql",
    "supabase/rag_v3_step12_audit_trace_completeness.sql",
    "supabase/rag_v3_step13_ops_freshness_retention_logs.sql",
    "supabase/rag_v3_step14_chunk_source_span_contract.sql",
    "supabase/rag_v3_step15_chunk_source_provenance_contract.sql",
    "supabase/rag_v3_step16_document_metadata_normalization_contract.sql",
    "supabase/rag_v3_step17_operational_readiness_evidence_contract.sql",
)
MANIFEST_FILE = "supabase/rag_v3_migration_manifest.json"


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
    manifest = _load_manifest(repo_root)
    _assert_manifest_steps(manifest)
    paths = [(repo_root / rel).resolve() for rel in STEP_FILES]
    missing = [p for p in paths if not p.exists()]
    if missing:
        missing_text = ", ".join(str(p) for p in missing)
        raise FileNotFoundError(f"Missing SQL migration files: {missing_text}")
    _verify_manifest_checksums(repo_root, manifest)
    return paths


def _apply_sql_file(conn: psycopg2.extensions.connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)


def _seed_legacy_source_urls_for_step15(conn: psycopg2.extensions.connection) -> int:
    """
    Backfill metadata.source_url for legacy rows before step15 enforces NOT-empty
    chunk source_url values.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH candidate_docs AS (
                SELECT d.id,
                       d.source_type,
                       d.source_id,
                       d.metadata
                FROM public.rag_documents d
                WHERE EXISTS (
                    SELECT 1
                    FROM public.rag_chunks c
                    WHERE c.document_id = d.id
                )
            ),
            prepared AS (
                SELECT
                    id,
                    CASE
                        WHEN NULLIF(trim(COALESCE(metadata->>'source_url', '')), '') IS NOT NULL THEN NULL
                        WHEN NULLIF(trim(COALESCE(metadata->>'source', '')), '') IS NOT NULL
                            THEN trim(metadata->>'source')
                        WHEN NULLIF(trim(COALESCE(metadata->>'url', '')), '') IS NOT NULL
                            THEN trim(metadata->>'url')
                        WHEN NULLIF(trim(COALESCE(source_id, '')), '') IS NOT NULL
                            THEN format(
                                'legacy://%s/%s',
                                lower(NULLIF(trim(COALESCE(source_type, 'document')), '')),
                                trim(source_id)
                            )
                        ELSE format('legacy://document/%s', id::text)
                    END AS resolved_source_url
                FROM candidate_docs
            )
            UPDATE public.rag_documents d
            SET metadata = COALESCE(d.metadata, '{}'::jsonb)
                           || jsonb_build_object('source_url', p.resolved_source_url)
            FROM prepared p
            WHERE d.id = p.id
              AND p.resolved_source_url IS NOT NULL
            """
        )
        return int(cur.rowcount or 0)


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

    for table_name in (
        "rag_documents",
        "rag_chunks",
        "rag_v3_query_traces",
        "rag_v3_ingest_reprocess_queue",
        "rag_v3_review_queue",
        "rag_v3_source_freshness_log",
        "rag_v3_retention_deletion_log",
        "ai_feature_flags",
    ):
        checks.append(
            (
                f"table.{table_name}",
                _query_bool(conn, "SELECT to_regclass(%s) IS NOT NULL", (f"public.{table_name}",)),
            )
        )

    for column_name in (
        "chunk_order",
        "chunk_type",
        "token_count",
        "embedding_version",
        "index_version",
        "source_char_start",
        "source_char_end",
        "paragraph_start",
        "paragraph_end",
        "section_path",
        "source_url",
    ):
        checks.append(
            (
                f"column.rag_chunks.{column_name}",
                _query_bool(
                    conn,
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'rag_chunks'
                          AND column_name = %s
                    )
                    """,
                    (column_name,),
                ),
            )
        )

    for column_name in (
        "law_no",
        "article_no",
        "docket_no",
        "decision_no",
        "decision_date",
        "publish_date",
        "court",
        "chamber",
        "mulga_state",
        "topic_tags",
    ):
        checks.append(
            (
                f"column.rag_documents.{column_name}",
                _query_bool(
                    conn,
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'rag_documents'
                          AND column_name = %s
                    )
                    """,
                    (column_name,),
                ),
            )
        )

    for column_name in (
        "legal_disclaimer_ack",
        "human_responsibility_ack",
        "tier_policy_route_reason",
        "query_expansion",
        "prompt_scenario",
        "prompt_registry_version",
        "source_documents",
        "review_required",
        "review_reason_codes",
        "low_confidence",
        "low_confidence_reason",
    ):
        checks.append(
            (
                f"column.rag_v3_query_traces.{column_name}",
                _query_bool(
                    conn,
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'rag_v3_query_traces'
                          AND column_name = %s
                    )
                    """,
                    (column_name,),
                ),
            )
        )

    checks.append(
        (
            "seed.rag_v3_single_pipeline_enforced",
            _query_bool(
                conn,
                """
                SELECT CASE
                    WHEN to_regclass('public.ai_feature_flags') IS NULL THEN false
                    ELSE EXISTS (
                        SELECT 1
                        FROM public.ai_feature_flags
                        WHERE bureau_id IS NULL
                          AND flag_key = 'rag_v3_single_pipeline_enforced'
                    )
                END
                """,
            ),
        )
    )

    for func_name in (
        "rag_v3_match_chunks",
        "rag_v3_match_chunks_dense",
        "rag_v3_match_chunks_sparse",
        "rag_v3_match_chunks_legal_exact",
        "rag_v3_doc_shortlist",
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

    for table_name in (
        "rag_v3_control_plane",
        "rag_v3_ingest_reprocess_queue",
        "rag_v3_review_queue",
        "rag_v3_query_traces",
        "rag_v3_source_freshness_log",
        "rag_v3_retention_deletion_log",
        "rag_v3_backup_restore_drill_log",
        "rag_v3_rollback_drill_log",
        "rag_v3_human_eval_rubrics",
    ):
        checks.append(
            (
                f"table.{table_name}",
                _query_bool(conn, "SELECT to_regclass(%s) IS NOT NULL", (f"public.{table_name}",)),
            )
        )

    for index_name in (
        "uq_rag_chunks_document_hash",
        "idx_rag_chunks_text_tsv",
        "idx_rag_chunks_embedding_cosine",
        "idx_rag_chunks_document_id",
        "idx_rag_chunks_document_order",
        "idx_rag_chunks_chunk_type",
        "idx_rag_chunks_index_version",
        "idx_rag_chunks_source_span",
        "idx_rag_chunks_paragraph_range",
        "idx_rag_chunks_article_clause",
        "idx_rag_chunks_source_url",
        "idx_rag_chunks_section_path",
        "idx_rag_documents_acl_tags",
        "idx_rag_documents_law_article",
        "idx_rag_documents_docket_decision_no",
        "idx_rag_documents_decision_publish_date",
        "idx_rag_documents_court_chamber",
        "idx_rag_documents_mulga_state",
        "idx_rag_documents_topic_tags_gin",
        "idx_rag_v3_query_traces_created",
        "idx_rag_v3_query_traces_bureau_created",
        "idx_rag_v3_query_traces_contract_version",
        "idx_rag_v3_query_traces_review_required_created",
        "idx_rag_v3_query_traces_low_confidence_created",
        "idx_rag_v3_query_traces_prompt_scenario_created",
        "idx_rag_v3_query_traces_source_documents_gin",
        "idx_rag_v3_source_freshness_created",
        "idx_rag_v3_source_freshness_source",
        "idx_rag_v3_source_freshness_state",
        "idx_rag_v3_retention_deletion_created",
        "idx_rag_v3_retention_deletion_bureau",
        "idx_rag_v3_backup_restore_drill_created",
        "idx_rag_v3_backup_restore_drill_bureau",
        "idx_rag_v3_rollback_drill_created",
        "idx_rag_v3_rollback_drill_bureau",
        "idx_rag_v3_human_eval_rubric_unique",
        "idx_rag_v3_human_eval_rubric_status",
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


def _load_manifest(repo_root: Path) -> dict:
    manifest_path = (repo_root / MANIFEST_FILE).resolve()
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"Missing migration manifest file: {manifest_path}. "
            "Create it before applying RAG v3 migrations."
        )
    with open(manifest_path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid migration manifest: expected JSON object.")
    return payload


def _assert_manifest_steps(manifest: dict) -> None:
    raw_steps = manifest.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise RuntimeError("Invalid migration manifest: `steps` must be a non-empty list.")
    declared_paths: list[str] = []
    for entry in raw_steps:
        if not isinstance(entry, dict):
            raise RuntimeError("Invalid migration manifest: each step entry must be an object.")
        rel_path = str(entry.get("path") or "").strip()
        checksum = str(entry.get("sha256") or "").strip().lower()
        if not rel_path or not checksum:
            raise RuntimeError("Invalid migration manifest: every step needs path + sha256.")
        declared_paths.append(rel_path)

    if tuple(declared_paths) != tuple(STEP_FILES):
        raise RuntimeError(
            "Migration manifest step order mismatch. "
            f"Expected {list(STEP_FILES)}, got {declared_paths}"
        )


def _verify_manifest_checksums(repo_root: Path, manifest: dict) -> None:
    for entry in manifest.get("steps") or []:
        rel_path = str(entry["path"]).strip()
        expected = str(entry["sha256"]).strip().lower()
        target = (repo_root / rel_path).resolve()
        digest = hashlib.sha256(target.read_bytes()).hexdigest().lower()
        if digest != expected:
            raise RuntimeError(
                "Migration checksum mismatch for "
                f"{rel_path}: expected={expected} actual={digest}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply deterministic RAG v3 migrations (step01 -> step17)."
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
            if path.name == "rag_v3_step15_chunk_source_provenance_contract.sql":
                seeded = _seed_legacy_source_urls_for_step15(conn)
                if seeded > 0:
                    print(f"[pre-step15] seeded metadata.source_url for {seeded} legacy documents")
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
