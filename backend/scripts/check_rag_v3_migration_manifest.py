#!/usr/bin/env python3
"""Validate RAG v3 migration manifest order + checksums."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


EXPECTED_STEPS = (
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


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().lower()


def run_check(*, repo_root: Path, manifest_rel: str) -> int:
    manifest_path = (repo_root / manifest_rel).resolve()
    if not manifest_path.exists():
        print(f"[manifest] missing file: {manifest_path}")
        return 1

    with open(manifest_path, encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        print("[manifest] invalid json root: expected object")
        return 1

    steps = payload.get("steps")
    if not isinstance(steps, list) or not steps:
        print("[manifest] invalid steps: expected non-empty list")
        return 1

    declared_paths: list[str] = []
    for index, row in enumerate(steps, start=1):
        if not isinstance(row, dict):
            print(f"[manifest] invalid step #{index}: expected object")
            return 1
        rel = str(row.get("path") or "").strip()
        digest = str(row.get("sha256") or "").strip().lower()
        if not rel or not digest:
            print(f"[manifest] invalid step #{index}: path/sha256 required")
            return 1
        declared_paths.append(rel)

    if tuple(declared_paths) != EXPECTED_STEPS:
        print("[manifest] step order mismatch")
        print(f"  expected={list(EXPECTED_STEPS)}")
        print(f"  actual={declared_paths}")
        return 1

    failed = 0
    for row in steps:
        rel = str(row["path"]).strip()
        expected = str(row["sha256"]).strip().lower()
        target = (repo_root / rel).resolve()
        if not target.exists():
            print(f"[manifest] missing step file: {rel}")
            failed += 1
            continue
        actual = _sha256(target)
        if actual != expected:
            print(f"[manifest] checksum mismatch: {rel}")
            print(f"  expected={expected}")
            print(f"  actual={actual}")
            failed += 1
        else:
            print(f"[manifest] OK {rel}")

    return 0 if failed == 0 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate rag_v3 migration manifest")
    parser.add_argument(
        "--manifest",
        default="supabase/rag_v3_migration_manifest.json",
        help="manifest path relative to repository root",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    code = run_check(repo_root=repo_root, manifest_rel=args.manifest)
    sys.exit(code)


if __name__ == "__main__":
    main()
