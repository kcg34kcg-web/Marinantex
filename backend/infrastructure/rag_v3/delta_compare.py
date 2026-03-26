"""Clause-level dedup/delta comparison for legal document versions."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_DIGIT_RE = re.compile(r"\d+(?:[.,]\d+)?")

_NUMBER_WORDS = {
    "sifir",
    "bir",
    "iki",
    "uc",
    "u\u00e7",
    "dort",
    "d\u00f6rt",
    "bes",
    "be\u015f",
    "alti",
    "alt\u0131",
    "yedi",
    "sekiz",
    "dokuz",
    "on",
    "yirmi",
    "otuz",
    "kirk",
    "k\u0131rk",
    "elli",
    "altmis",
    "altm\u0131\u015f",
    "yetmis",
    "yetmi\u015f",
    "seksen",
    "doksan",
    "yuz",
    "y\u00fcz",
    "bin",
}


@dataclass(frozen=True)
class DeltaChange:
    kind: str
    identifier: str
    severity: str
    similarity: float
    old_preview: str = ""
    new_preview: str = ""


@dataclass(frozen=True)
class DeltaReport:
    total_changes: int
    critical_changes: int
    has_breaking_changes: bool
    summary: str
    changes: list[DeltaChange] = field(default_factory=list)


def compare_chunk_versions(
    *,
    previous_chunks: Iterable[dict[str, Any]],
    current_chunks: Iterable[dict[str, Any]],
) -> DeltaReport:
    prev_map = _index_by_clause(previous_chunks)
    cur_map = _index_by_clause(current_chunks)

    changes: list[DeltaChange] = []
    keys = sorted(set(prev_map.keys()) | set(cur_map.keys()))
    for key in keys:
        before = prev_map.get(key)
        after = cur_map.get(key)
        if before is None and after is not None:
            changes.append(
                DeltaChange(
                    kind="added",
                    identifier=key,
                    severity="medium",
                    similarity=0.0,
                    new_preview=_preview(after),
                )
            )
            continue
        if before is not None and after is None:
            severity = "high" if _is_structured_key(key) else "medium"
            changes.append(
                DeltaChange(
                    kind="removed",
                    identifier=key,
                    severity=severity,
                    similarity=0.0,
                    old_preview=_preview(before),
                )
            )
            continue
        if before is None or after is None:
            continue
        similarity = _token_jaccard(str(before), str(after))
        if similarity >= 0.97:
            continue
        severity = "low"
        if similarity < 0.45:
            severity = "high"
        elif similarity < 0.75:
            severity = "medium"
        if _has_numeric_shift(str(before), str(after)):
            severity = "high"
        changes.append(
            DeltaChange(
                kind="modified",
                identifier=key,
                severity=severity,
                similarity=float(similarity),
                old_preview=_preview(before),
                new_preview=_preview(after),
            )
        )

    critical_changes = sum(1 for item in changes if item.severity == "high")
    total = len(changes)
    has_breaking = critical_changes > 0
    summary = (
        f"delta_changes={total}; critical={critical_changes}; "
        f"status={'breaking' if has_breaking else 'non_breaking'}"
    )
    return DeltaReport(
        total_changes=total,
        critical_changes=critical_changes,
        has_breaking_changes=has_breaking,
        summary=summary,
        changes=changes[:50],
    )


def _index_by_clause(rows: Iterable[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _clause_key(
            article_no=row.get("article_no"),
            clause_no=row.get("clause_no"),
            subclause_no=row.get("subclause_no"),
            fallback_text=row.get("text") or row.get("chunk_text"),
        )
        text = str(row.get("text") or row.get("chunk_text") or "").strip()
        if not text:
            continue
        out[key] = text
    return out


def _clause_key(
    *,
    article_no: Optional[object],
    clause_no: Optional[object],
    subclause_no: Optional[object],
    fallback_text: Optional[object],
) -> str:
    article = str(article_no or "").strip()
    clause = str(clause_no or "").strip()
    sub = str(subclause_no or "").strip()
    if article or clause or sub:
        return f"{article or '-'}::{clause or '-'}::{sub or '-'}"
    text = str(fallback_text or "").strip()
    if not text:
        return "unknown"
    tokens = _TOKEN_RE.findall(text.lower())[:10]
    return "free::" + "-".join(tokens)


def _token_jaccard(a: str, b: str) -> float:
    a_tokens = {tok for tok in _TOKEN_RE.findall((a or "").lower()) if len(tok) >= 2}
    b_tokens = {tok for tok in _TOKEN_RE.findall((b or "").lower()) if len(tok) >= 2}
    if not a_tokens and not b_tokens:
        return 1.0
    if not a_tokens or not b_tokens:
        return 0.0
    return float(len(a_tokens & b_tokens)) / float(max(1, len(a_tokens | b_tokens)))


def _preview(text: str, limit: int = 180) -> str:
    body = " ".join((text or "").split())
    return body[:limit]


def _is_structured_key(key: str) -> bool:
    return "::" in key and not key.startswith("free::")


def _has_numeric_shift(before: str, after: str) -> bool:
    before_markers = _extract_numeric_markers(before)
    after_markers = _extract_numeric_markers(after)
    if not before_markers or not after_markers:
        return False
    return before_markers.isdisjoint(after_markers)


def _extract_numeric_markers(text: str) -> set[str]:
    body = (text or "").lower()
    out = {item.replace(",", ".") for item in _DIGIT_RE.findall(body)}
    for token in _TOKEN_RE.findall(body):
        if token in _NUMBER_WORDS:
            out.add(token)
    return out
