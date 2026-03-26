#!/usr/bin/env python3
"""Backfill missing temporal/topic metadata for rag_documents."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infrastructure.database.connection import get_supabase_client

_TOPIC_KEYWORD_MAP: tuple[tuple[str, str], ...] = (
    ("kidem", "is_hukuku"),
    ("ihbar", "is_hukuku"),
    ("isci", "is_hukuku"),
    ("is kanunu", "is_hukuku"),
    ("sozlesme", "sozlesme_hukuku"),
    ("kira", "borclar_hukuku"),
    ("tazminat", "borclar_hukuku"),
    ("icra", "icra_iflas_hukuku"),
    ("haciz", "icra_iflas_hukuku"),
    ("ceza", "ceza_hukuku"),
    ("anayasa", "anayasa_hukuku"),
    ("idari", "idare_hukuku"),
    ("vergi", "vergi_hukuku"),
    ("ticaret", "ticaret_hukuku"),
    ("sirket", "ticaret_hukuku"),
)


def _token(value: Any) -> str:
    return str(value or "").strip().lower()


def _metadata(obj: dict[str, Any]) -> dict[str, Any]:
    payload = obj.get("metadata")
    return dict(payload) if isinstance(payload, dict) else {}


def _law_key(source_id: str) -> str:
    match = re.search(r"\b(\d{3,5})\b", source_id or "")
    return match.group(1) if match else ""


def _coerce_iso_date(value: Any) -> str | None:
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) >= 10:
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            return None
    return None


def _topic_tags_from_metadata(md: dict[str, Any]) -> list[str]:
    for key in ("topic_tags", "topics", "subject_tags", "konu_etiketleri", "labels"):
        value = md.get(key)
        if isinstance(value, list):
            tags = [str(item).strip().lower() for item in value if str(item).strip()]
            if tags:
                return list(dict.fromkeys(tags))[:20]
        if isinstance(value, str) and value.strip():
            tags = [item.strip().lower() for item in re.split(r"[,;|]", value) if item.strip()]
            if tags:
                return list(dict.fromkeys(tags))[:20]
    return []


def _infer_topic_tags(*, title: str, text: str) -> list[str]:
    blob = f"{title or ''} {text or ''}".lower()
    tags: list[str] = []
    for keyword, topic in _TOPIC_KEYWORD_MAP:
        if keyword in blob:
            tags.append(topic)
    return list(dict.fromkeys(tags))[:20]


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill rag_documents metadata quality fields.")
    parser.add_argument("--dry-run", action="store_true", help="Calculate changes without writing updates.")
    args = parser.parse_args()

    client = get_supabase_client()
    docs = list(
        client.table("rag_documents")
        .select("id,title,source_type,source_id,effective_from,metadata")
        .execute()
        .data
        or []
    )
    if not docs:
        print("[metadata-backfill] no rag_documents rows found.")
        return 0

    chunks = list(
        client.table("rag_chunks")
        .select("document_id,text")
        .execute()
        .data
        or []
    )
    text_by_doc: dict[str, list[str]] = defaultdict(list)
    for row in chunks:
        doc_id = str(row.get("document_id") or "").strip()
        text = str(row.get("text") or "").strip()
        if doc_id and text:
            text_by_doc[doc_id].append(text)

    law_date_candidates: dict[str, list[str]] = defaultdict(list)
    for row in docs:
        source_key = _law_key(str(row.get("source_id") or ""))
        if not source_key:
            continue
        md = _metadata(row)
        publish_date = _coerce_iso_date(md.get("publish_date"))
        eff = _coerce_iso_date(row.get("effective_from"))
        if publish_date:
            law_date_candidates[source_key].append(publish_date)
        elif eff:
            law_date_candidates[source_key].append(eff)

    updated_count = 0
    dry_updates = 0
    for row in docs:
        doc_id = str(row.get("id") or "").strip()
        if not doc_id:
            continue
        title = str(row.get("title") or "").strip()
        source_id = str(row.get("source_id") or "").strip()
        source_key = _law_key(source_id)
        md = _metadata(row)
        next_md = dict(md)
        changed = False

        current_topics = _topic_tags_from_metadata(next_md)
        if not current_topics:
            inferred_topics = _infer_topic_tags(
                title=title,
                text=" ".join(text_by_doc.get(doc_id, []))[:16000],
            )
            if inferred_topics:
                next_md["topic_tags"] = inferred_topics
                changed = True

        current_publish = _coerce_iso_date(next_md.get("publish_date"))
        if not current_publish:
            effective = _coerce_iso_date(row.get("effective_from"))
            inferred_publish = effective
            if not inferred_publish and source_key and law_date_candidates.get(source_key):
                inferred_publish = sorted(law_date_candidates[source_key])[0]
            if inferred_publish:
                next_md["publish_date"] = inferred_publish
                changed = True

        if not changed:
            continue
        if args.dry_run:
            dry_updates += 1
            continue

        client.table("rag_documents").update({"metadata": next_md}).eq("id", doc_id).execute()
        updated_count += 1

    if args.dry_run:
        print(f"[metadata-backfill] dry_run_updates={dry_updates}")
    else:
        print(f"[metadata-backfill] updated_docs={updated_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
