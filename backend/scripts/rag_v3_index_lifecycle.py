#!/usr/bin/env python3
"""Index lifecycle utility: register, activate, rollback for RAG v3 indices."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any

# Ensure backend root is importable regardless of CWD.
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.database.connection import get_supabase_client


def register_index(*, index_version: str, embedding_model: str, embedding_dim: int) -> None:
    client = get_supabase_client()
    payload = {
        "index_version": index_version,
        "embedding_model": embedding_model,
        "embedding_dim": int(embedding_dim),
        "status": "building",
        "notes": {"registered_at": datetime.now(timezone.utc).isoformat()},
    }
    client.table("rag_v3_index_registry").upsert(payload, on_conflict="index_version").execute()


def activate_index(*, index_version: str, note: str | None = None) -> None:
    client = get_supabase_client()
    payload: dict[str, Any] = {}
    if note:
        payload["note"] = note
    client.rpc("rag_v3_activate_index", {"p_index_version": index_version, "p_notes": payload}).execute()


def rollback_to_previous_active() -> str | None:
    client = get_supabase_client()
    rows = (
        client.table("rag_v3_index_registry")
        .select("index_version,status,created_at")
        .in_("status", ["active", "retired"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    retired = [row for row in rows if row.get("status") == "retired"]
    if not retired:
        return None
    target = str(retired[0].get("index_version") or "")
    if not target:
        return None
    activate_index(index_version=target, note="rollback")
    return target


def list_indices() -> list[dict[str, Any]]:
    client = get_supabase_client()
    return (
        client.table("rag_v3_index_registry")
        .select("*")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG v3 index lifecycle utility")
    sub = parser.add_subparsers(dest="command", required=True)

    register_cmd = sub.add_parser("register", help="Register a new index version")
    register_cmd.add_argument("--index-version", required=True)
    register_cmd.add_argument("--embedding-model", required=True)
    register_cmd.add_argument("--embedding-dim", required=True, type=int)

    activate_cmd = sub.add_parser("activate", help="Activate index version")
    activate_cmd.add_argument("--index-version", required=True)
    activate_cmd.add_argument("--note", default=None)

    sub.add_parser("rollback", help="Rollback to latest retired index")
    sub.add_parser("list", help="List index registry rows")

    args = parser.parse_args()
    if args.command == "register":
        register_index(
            index_version=args.index_version,
            embedding_model=args.embedding_model,
            embedding_dim=args.embedding_dim,
        )
        print("registered")
        return
    if args.command == "activate":
        activate_index(index_version=args.index_version, note=args.note)
        print("activated")
        return
    if args.command == "rollback":
        target = rollback_to_previous_active()
        print(target or "no_rollback_target")
        return

    if args.command == "list":
        rows = list_indices()
        print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
