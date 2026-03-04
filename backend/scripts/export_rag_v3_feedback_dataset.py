#!/usr/bin/env python3
"""Export auto-captured RAG v3 feedback rows into JSONL training/eval dataset."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure backend root is importable regardless of CWD.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.database.connection import get_supabase_client


def _row_to_jsonl(row: dict[str, Any]) -> dict[str, Any]:
    citations = row.get("citations") or []
    reasons = row.get("reasons") or []
    metadata = row.get("metadata") or {}
    fingerprint = row.get("fingerprint") or {}
    query = str(row.get("query_text") or "").strip()
    answer = str(row.get("answer_text") or "").strip()
    return {
        "id": row.get("id"),
        "created_at": row.get("created_at"),
        "messages": [
            {"role": "system", "content": "Grounded legal assistant. Cite evidence. Abstain when uncertain."},
            {"role": "user", "content": query},
            {"role": "assistant", "content": answer},
        ],
        "labels": {
            "response_status": row.get("response_status"),
            "reasons": reasons,
            "citations": citations,
            "fingerprint": fingerprint,
            "metadata": metadata,
        },
    }


def export_dataset(*, output_path: Path, limit: int, mark_exported: bool) -> int:
    client = get_supabase_client()
    response = (
        client.table("rag_v3_feedback_examples")
        .select("*")
        .is_("exported_at", "null")
        .order("created_at", desc=False)
        .limit(max(1, int(limit)))
        .execute()
    )
    rows = list(response.data or [])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as handle:
        for row in rows:
            payload = _row_to_jsonl(row)
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    if mark_exported and rows:
        now_iso = datetime.now(timezone.utc).isoformat()
        ids = [row.get("id") for row in rows if row.get("id")]
        if ids:
            (
                client.table("rag_v3_feedback_examples")
                .update({"exported_at": now_iso})
                .in_("id", ids)
                .execute()
            )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export rag_v3 feedback examples to JSONL")
    parser.add_argument("--output", type=Path, required=True, help="Output jsonl file")
    parser.add_argument("--limit", type=int, default=500, help="Maximum rows to export")
    parser.add_argument(
        "--mark-exported",
        action="store_true",
        help="Set exported_at on exported rows",
    )
    args = parser.parse_args()

    count = export_dataset(
        output_path=args.output,
        limit=args.limit,
        mark_exported=args.mark_exported,
    )
    print(f"exported_rows={count}")


if __name__ == "__main__":
    main()
