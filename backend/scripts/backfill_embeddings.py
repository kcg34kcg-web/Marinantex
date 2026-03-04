"""
Backfill embeddings for existing public.documents rows with NULL embedding.

Usage examples:
  python backend/scripts/backfill_embeddings.py
  python backend/scripts/backfill_embeddings.py --batch-size 32 --max-docs 500
  python backend/scripts/backfill_embeddings.py --public-only
  python backend/scripts/backfill_embeddings.py --bureau-id <uuid>
  python backend/scripts/backfill_embeddings.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

# Ensure backend root is importable regardless of invocation cwd.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infrastructure.database.connection import get_supabase_client
from infrastructure.embeddings.embedder import query_embedder

logger = logging.getLogger("babylexit.scripts.backfill_embeddings")

_EMBED_MAX_TOKENS = 8191
_DEFAULT_BATCH_SIZE = 24


@dataclass
class BatchStats:
    scanned: int = 0
    embedded: int = 0
    skipped_empty: int = 0
    failed: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill NULL embeddings in public.documents",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=_DEFAULT_BATCH_SIZE,
        help="Rows per fetch/embed batch (default: 24)",
    )
    parser.add_argument(
        "--max-docs",
        type=int,
        default=0,
        help="Stop after this many scanned rows (0 = unlimited)",
    )
    parser.add_argument(
        "--bureau-id",
        type=str,
        default="",
        help="Only process this bureau_id (optional)",
    )
    parser.add_argument(
        "--case-id",
        type=str,
        default="",
        help="Only process this case_id (optional)",
    )
    parser.add_argument(
        "--public-only",
        action="store_true",
        help="Only process rows where bureau_id IS NULL",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write embeddings, only report candidate counts",
    )
    return parser.parse_args()


def truncate_to_token_limit(
    text: str,
    max_tokens: int = _EMBED_MAX_TOKENS,
) -> str:
    """
    Trim text to embedding token budget.
    Falls back to a conservative char heuristic when tiktoken is unavailable.
    """
    try:
        import tiktoken  # type: ignore

        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return enc.decode(tokens[:max_tokens])
    except Exception:
        # Conservative fallback: Turkish legal text ~3-4 chars/token.
        return text[: max_tokens * 3]


def prepare_text(value: Any) -> Optional[str]:
    raw = str(value or "").replace("\x00", " ").strip()
    if not raw:
        return None
    trimmed = truncate_to_token_limit(raw)
    trimmed = trimmed.strip()
    return trimmed if trimmed else None


def fetch_null_embedding_batch(
    *,
    batch_size: int,
    bureau_id: str,
    case_id: str,
    public_only: bool,
) -> List[Dict[str, Any]]:
    client = get_supabase_client()
    query = (
        client.table("documents")
        .select("id, content, bureau_id, case_id, created_at")
        .is_("embedding", "null")
        .or_("is_deleted.is.null,is_deleted.eq.false")
        .order("created_at", desc=False)
        .limit(batch_size)
    )
    if public_only:
        query = query.is_("bureau_id", "null")
    elif bureau_id:
        query = query.eq("bureau_id", bureau_id)
    if case_id:
        query = query.eq("case_id", case_id)

    result = query.execute()
    return list(result.data or [])


def persist_embeddings(updates: List[Dict[str, Any]]) -> None:
    if not updates:
        return
    client = get_supabase_client()
    client.table("documents").upsert(updates, on_conflict="id").execute()


async def embed_batch(
    rows: List[Dict[str, Any]],
    *,
    dry_run: bool,
) -> BatchStats:
    stats = BatchStats(scanned=len(rows))

    prepared: List[Tuple[Dict[str, Any], str]] = []
    for row in rows:
        txt = prepare_text(row.get("content"))
        if txt is None:
            stats.skipped_empty += 1
            continue
        prepared.append((row, txt))

    if not prepared:
        return stats

    if dry_run:
        stats.embedded += len(prepared)
        return stats

    updates: List[Dict[str, Any]] = []
    texts = [txt for _, txt in prepared]
    try:
        vectors = await query_embedder.embed_texts(texts)
        if len(vectors) != len(prepared):
            raise RuntimeError(
                f"Embedding count mismatch: vectors={len(vectors)} rows={len(prepared)}"
            )
        for (row, _), vec in zip(prepared, vectors):
            updates.append({"id": row["id"], "embedding": vec})
            stats.embedded += 1
    except Exception as batch_exc:
        logger.warning("Batch embedding failed, falling back to per-row: %s", batch_exc)
        for row, txt in prepared:
            try:
                vec = await query_embedder.embed_query(txt)
                updates.append({"id": row["id"], "embedding": vec})
                stats.embedded += 1
            except HTTPException as http_exc:
                stats.failed += 1
                logger.error(
                    "Embed failed | doc_id=%s | status=%s | detail=%s",
                    row.get("id"),
                    http_exc.status_code,
                    http_exc.detail,
                )
            except Exception as exc:
                stats.failed += 1
                logger.error("Embed failed | doc_id=%s | err=%s", row.get("id"), exc)

    if updates:
        persist_embeddings(updates)

    return stats


async def run(args: argparse.Namespace) -> BatchStats:
    if args.batch_size < 1:
        raise ValueError("--batch-size must be >= 1")
    if args.max_docs < 0:
        raise ValueError("--max-docs must be >= 0")
    if args.public_only and args.bureau_id:
        raise ValueError("--public-only and --bureau-id cannot be used together")

    total = BatchStats()
    max_docs = int(args.max_docs or 0)

    logger.info(
        "Embedding backfill started | batch_size=%d | max_docs=%d | bureau_id=%s | case_id=%s | public_only=%s | dry_run=%s",
        args.batch_size,
        max_docs,
        args.bureau_id or "-",
        args.case_id or "-",
        bool(args.public_only),
        bool(args.dry_run),
    )

    while True:
        remaining = 0 if max_docs == 0 else max_docs - total.scanned
        if max_docs and remaining <= 0:
            break

        batch_size = args.batch_size if not max_docs else min(args.batch_size, remaining)
        rows = fetch_null_embedding_batch(
            batch_size=batch_size,
            bureau_id=args.bureau_id,
            case_id=args.case_id,
            public_only=bool(args.public_only),
        )
        if not rows:
            break

        stats = await embed_batch(rows, dry_run=bool(args.dry_run))
        total.scanned += stats.scanned
        total.embedded += stats.embedded
        total.skipped_empty += stats.skipped_empty
        total.failed += stats.failed

        logger.info(
            "Backfill progress | scanned=%d | embedded=%d | skipped_empty=%d | failed=%d",
            total.scanned,
            total.embedded,
            total.skipped_empty,
            total.failed,
        )

    logger.info(
        "Embedding backfill finished | scanned=%d | embedded=%d | skipped_empty=%d | failed=%d",
        total.scanned,
        total.embedded,
        total.skipped_empty,
        total.failed,
    )
    return total


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    args = parse_args()
    total = asyncio.run(run(args))
    if not args.dry_run and total.failed > 0:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
