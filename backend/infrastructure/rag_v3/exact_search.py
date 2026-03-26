"""Deterministic legal exact-search scoring for RAG v3 candidates."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Iterable

from infrastructure.rag_v3.repository import RagV3ChunkMatch

_ARTICLE_RE = re.compile(r"\b(?:madde|md\.?)\s*(\d{1,4}(?:/[A-Za-z0-9]+)?)\b", re.IGNORECASE)
_CLAUSE_RE = re.compile(r"\b(?:fikra|fkr\.?)\s*(\d{1,3})\b", re.IGNORECASE)
_SOURCE_HINT_RE = re.compile(r"\bsource[_-]?id\s*:\s*([a-z0-9._/-]+)\b", re.IGNORECASE)
_CASE_NO_RE = re.compile(r"\b(?:E|K)\.\s*\d{4}/\d+\b", re.IGNORECASE)
_QUOTED_RE = re.compile(r"\"([^\"]{4,200})\"")


@dataclass(frozen=True)
class ExactQueryHints:
    source_ids: list[str]
    article_no: str | None
    clause_no: str | None
    case_tokens: list[str]
    quoted_phrases: list[str]


@dataclass(frozen=True)
class ExactSearchResult:
    matches: list[RagV3ChunkMatch]
    matched_count: int
    hints: ExactQueryHints


def parse_exact_query_hints(query: str) -> ExactQueryHints:
    text = (query or "").strip()
    source_ids = [m.group(1).strip().lower() for m in _SOURCE_HINT_RE.finditer(text)]
    article_match = _ARTICLE_RE.search(text)
    clause_match = _CLAUSE_RE.search(text)
    case_tokens = [m.group(0).strip().lower() for m in _CASE_NO_RE.finditer(text)]
    quoted_phrases = [m.group(1).strip().lower() for m in _QUOTED_RE.finditer(text)]
    return ExactQueryHints(
        source_ids=list(dict.fromkeys(source_ids)),
        article_no=(article_match.group(1).strip() if article_match else None),
        clause_no=(clause_match.group(1).strip() if clause_match else None),
        case_tokens=list(dict.fromkeys(case_tokens)),
        quoted_phrases=list(dict.fromkeys(quoted_phrases)),
    )


def apply_exact_legal_boost(
    *,
    query: str,
    matches: Iterable[RagV3ChunkMatch],
    strong_boost: float = 0.20,
    weak_boost: float = 0.08,
) -> ExactSearchResult:
    hints = parse_exact_query_hints(query)
    rows = list(matches)
    if not rows:
        return ExactSearchResult(matches=[], matched_count=0, hints=hints)

    if not _has_any_hint(hints):
        return ExactSearchResult(matches=rows, matched_count=0, hints=hints)

    rescored: list[RagV3ChunkMatch] = []
    matched_count = 0
    for row in rows:
        score = float(row.final_score)
        hit_count = 0

        if hints.source_ids and str(row.source_id or "").strip().lower() in hints.source_ids:
            score += strong_boost
            hit_count += 1
        if hints.article_no and (row.article_no or "").strip() == hints.article_no:
            score += strong_boost
            hit_count += 1
        if hints.clause_no and (row.clause_no or "").strip() == hints.clause_no:
            score += strong_boost
            hit_count += 1
        if hints.case_tokens and _contains_any_case_token(row.chunk_text, hints.case_tokens):
            score += weak_boost
            hit_count += 1
        if hints.quoted_phrases and _contains_any_phrase(row.chunk_text, hints.quoted_phrases):
            score += weak_boost
            hit_count += 1

        if hit_count > 0:
            matched_count += 1
            # Extra confidence when multiple exact constraints match same chunk.
            score += min(0.12, 0.03 * max(0, hit_count - 1))

        rescored.append(replace(row, final_score=_clamp01(score)))

    rescored.sort(key=lambda item: item.final_score, reverse=True)
    return ExactSearchResult(matches=rescored, matched_count=matched_count, hints=hints)


def _has_any_hint(hints: ExactQueryHints) -> bool:
    return bool(
        hints.source_ids
        or hints.article_no
        or hints.clause_no
        or hints.case_tokens
        or hints.quoted_phrases
    )


def _contains_any_case_token(text: str, tokens: list[str]) -> bool:
    lowered = (text or "").lower()
    return any(token in lowered for token in tokens)


def _contains_any_phrase(text: str, phrases: list[str]) -> bool:
    lowered = (text or "").lower()
    return any(phrase in lowered for phrase in phrases if phrase)


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)

