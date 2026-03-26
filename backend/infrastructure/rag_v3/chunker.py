"""Legal article/clause chunker for RAG v3."""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass, replace
from typing import Optional

_TR_FOLD_TABLE = str.maketrans(
    {
        "c": "c",
        "g": "g",
        "i": "i",
        "o": "o",
        "s": "s",
        "u": "u",
        "C": "C",
        "G": "G",
        "I": "I",
        "O": "O",
        "S": "S",
        "U": "U",
        "\u00e7": "c",
        "\u011f": "g",
        "\u0131": "i",
        "\u00f6": "o",
        "\u015f": "s",
        "\u00fc": "u",
        "\u00c7": "C",
        "\u011e": "G",
        "\u0130": "I",
        "\u00d6": "O",
        "\u015e": "S",
        "\u00dc": "U",
    }
)

_ARTICLE_BOUNDARY_RE = re.compile(
    r"^(?:"
    r"MADDE\s+(?P<madde>[0-9]+(?:/[A-Z0-9]+)?)"
    r"|GECICI\s+MADDE\s+(?P<gecici>[0-9]+(?:/[A-Z0-9]+)?)"
    r"|EK\s+MADDE\s+(?P<ek>[0-9]+(?:/[A-Z0-9]+)?)"
    r")\b",
    re.MULTILINE,
)

_CLAUSE_RE = re.compile(r"^\((\d+)\)\s+", re.MULTILINE)
_SUBCLAUSE_RE = re.compile(r"^([a-z])\)\s+", re.MULTILINE)
_HEADING_MARKER_RE = re.compile(r"^\[(H1|H2|H3)\]\s+(.+)$", re.IGNORECASE)
_PUNCT_RE = re.compile(r"[.;:,!?]")
_LINE_RE = re.compile(r"^.*$", re.MULTILINE)
_TOKEN_SPAN_RE = re.compile(r"\S+")
_PARAGRAPH_BREAK_RE = re.compile(r"\n\s*\n+")


@dataclass(frozen=True)
class LegalChunkDraft:
    """Chunk draft before DB persistence."""

    article_no: Optional[str]
    clause_no: Optional[str]
    subclause_no: Optional[str]
    heading_path: Optional[str]
    text: str
    page_range: Optional[str]
    char_start: int
    char_end: int
    paragraph_start: Optional[int] = None
    paragraph_end: Optional[int] = None


class LegalStructuredChunker:
    """
    Splits legal text by article/clause integrity.

    Primary boundary: article and clause structure.
    Secondary boundary: approximate token budget.
    """

    def __init__(
        self,
        target_min_tokens: int = 400,
        target_max_tokens: int = 900,
        overlap_tokens: int = 80,
    ) -> None:
        self._target_min_tokens = max(50, int(target_min_tokens))
        self._target_max_tokens = max(self._target_min_tokens, int(target_max_tokens))
        self._overlap_tokens = max(0, int(overlap_tokens))

    def chunk(self, text: str) -> list[LegalChunkDraft]:
        """Create structured chunks from normalized legal text."""
        payload = (text or "").strip()
        if not payload:
            return []

        folded = _fold_tr(payload).upper()
        page_starts = _page_starts(payload)
        paragraph_starts = _paragraph_starts(payload)
        heading_map = self._build_heading_map(payload)

        article_matches = list(_ARTICLE_BOUNDARY_RE.finditer(folded))
        if not article_matches:
            heading_chunks = self._chunk_by_headings(payload, page_starts, paragraph_starts)
            if heading_chunks:
                return heading_chunks
            return [
                self._make_chunk(
                    article_no=None,
                    clause_no=None,
                    subclause_no=None,
                    heading_path=None,
                    raw_text=payload,
                    raw_start=0,
                    raw_end=len(payload),
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            ]

        chunks: list[LegalChunkDraft] = []
        for idx, match in enumerate(article_matches):
            article_start = match.start()
            article_end = article_matches[idx + 1].start() if idx + 1 < len(article_matches) else len(payload)
            article_no = _article_no_from_match(match)
            heading_path = heading_map.get(article_start)
            chunks.extend(
                self._chunk_article(
                    text=payload,
                    article_start=article_start,
                    article_end=article_end,
                    article_no=article_no,
                    heading_path=heading_path,
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            )

        return self._apply_overlap(chunks)

    def _chunk_article(
        self,
        text: str,
        article_start: int,
        article_end: int,
        article_no: str,
        heading_path: Optional[str],
        page_starts: list[int],
        paragraph_starts: list[int],
    ) -> list[LegalChunkDraft]:
        article_text = text[article_start:article_end]
        clause_matches = list(_CLAUSE_RE.finditer(article_text))
        if not clause_matches:
            return [
                self._make_chunk(
                    article_no=article_no,
                    clause_no=None,
                    subclause_no=None,
                    heading_path=heading_path,
                    raw_text=article_text,
                    raw_start=article_start,
                    raw_end=article_end,
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            ]

        chunks: list[LegalChunkDraft] = []
        for idx, clause_match in enumerate(clause_matches):
            clause_no = clause_match.group(1)
            clause_start = article_start + clause_match.start()
            clause_end = (
                article_start + clause_matches[idx + 1].start()
                if idx + 1 < len(clause_matches)
                else article_end
            )
            clause_text = text[clause_start:clause_end].strip()
            if not clause_text:
                continue

            token_estimate = _estimate_tokens(clause_text)
            subchunks = self._split_subclauses(
                article_no=article_no,
                clause_no=clause_no,
                heading_path=heading_path,
                text=text,
                clause_start=clause_start,
                clause_end=clause_end,
                page_starts=page_starts,
                paragraph_starts=paragraph_starts,
                enable_split=token_estimate > self._target_max_tokens,
            )
            if subchunks:
                chunks.extend(subchunks)
                continue

            chunks.append(
                self._make_chunk(
                    article_no=article_no,
                    clause_no=clause_no,
                    subclause_no=None,
                    heading_path=heading_path,
                    raw_text=text[clause_start:clause_end],
                    raw_start=clause_start,
                    raw_end=clause_end,
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            )

        return chunks

    def _chunk_by_headings(
        self,
        text: str,
        page_starts: list[int],
        paragraph_starts: list[int],
    ) -> list[LegalChunkDraft]:
        heading_points: list[tuple[int, str]] = []
        active: list[str] = []

        for match in _LINE_RE.finditer(text):
            line = (match.group(0) or "").strip()
            if not line:
                continue
            marker = _HEADING_MARKER_RE.match(line)
            if not marker:
                continue

            level = int(marker.group(1)[1])
            title = marker.group(2).strip()
            if not title:
                continue

            if level == 1:
                active = [title]
            elif level == 2:
                active = [active[0], title] if active else [title]
            else:
                if len(active) >= 2:
                    active = [active[0], active[1], title]
                elif active:
                    active = [active[0], title]
                else:
                    active = [title]

            heading_points.append((match.start(), " > ".join(active)))

        if len(heading_points) < 2:
            return []

        chunks: list[LegalChunkDraft] = []
        for idx, (start, heading_path) in enumerate(heading_points):
            end = heading_points[idx + 1][0] if idx + 1 < len(heading_points) else len(text)
            raw = text[start:end]
            if len(raw.strip()) < 40:
                continue
            chunks.append(
                self._make_chunk(
                    article_no=None,
                    clause_no=None,
                    subclause_no=None,
                    heading_path=heading_path or None,
                    raw_text=raw,
                    raw_start=start,
                    raw_end=end,
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            )

        return chunks

    def _split_subclauses(
        self,
        article_no: str,
        clause_no: str,
        heading_path: Optional[str],
        text: str,
        clause_start: int,
        clause_end: int,
        page_starts: list[int],
        paragraph_starts: list[int],
        enable_split: bool,
    ) -> list[LegalChunkDraft]:
        if not enable_split:
            return []

        clause_text = text[clause_start:clause_end]
        folded_clause = _fold_tr(clause_text).lower()
        matches = list(_SUBCLAUSE_RE.finditer(folded_clause))
        if len(matches) < 2:
            return []

        chunks: list[LegalChunkDraft] = []
        for idx, match in enumerate(matches):
            subclause_no = match.group(1)
            start = clause_start + match.start()
            end = clause_start + (matches[idx + 1].start() if idx + 1 < len(matches) else len(clause_text))
            raw = text[start:end]
            cleaned = raw.replace("\f", "\n").strip()
            if len(cleaned) < 40:
                continue
            chunks.append(
                self._make_chunk(
                    article_no=article_no,
                    clause_no=clause_no,
                    subclause_no=subclause_no,
                    heading_path=heading_path,
                    raw_text=raw,
                    raw_start=start,
                    raw_end=end,
                    page_starts=page_starts,
                    paragraph_starts=paragraph_starts,
                )
            )

        return chunks

    def _make_chunk(
        self,
        article_no: Optional[str],
        clause_no: Optional[str],
        subclause_no: Optional[str],
        heading_path: Optional[str],
        raw_text: str,
        raw_start: int,
        raw_end: int,
        page_starts: list[int],
        paragraph_starts: list[int],
    ) -> LegalChunkDraft:
        text = raw_text.replace("\f", "\n").strip()
        paragraph_start, paragraph_end = _paragraph_range(raw_start, raw_end, paragraph_starts)
        return LegalChunkDraft(
            article_no=article_no,
            clause_no=clause_no,
            subclause_no=subclause_no,
            heading_path=heading_path,
            text=text,
            page_range=_page_range(raw_start, raw_end, page_starts),
            char_start=raw_start,
            char_end=raw_end,
            paragraph_start=paragraph_start,
            paragraph_end=paragraph_end,
        )

    def _build_heading_map(self, text: str) -> dict[int, str]:
        heading_map: dict[int, str] = {}
        active: list[str] = []

        for match in _LINE_RE.finditer(text):
            line = (match.group(0) or "").strip()
            if not line:
                continue
            line_start = match.start()
            folded_line = _fold_tr(line)
            upper_folded = folded_line.upper()

            marker_match = _HEADING_MARKER_RE.match(line)
            if marker_match:
                level = int(marker_match.group(1)[1])
                title = marker_match.group(2).strip()
                if level == 1:
                    active = [title]
                elif level == 2:
                    active = [active[0], title] if active else [title]
                else:
                    if len(active) >= 2:
                        active = [active[0], active[1], title]
                    else:
                        active = (active + [title])[-3:]
                continue

            if _ARTICLE_BOUNDARY_RE.match(upper_folded):
                if active:
                    heading_map[line_start] = " > ".join(active)
                continue

            if _is_heading_candidate(line=line, folded_line=folded_line):
                if not active or active[-1] != line:
                    active.append(line)
                    active = active[-3:]

        return heading_map

    def _apply_overlap(self, chunks: list[LegalChunkDraft]) -> list[LegalChunkDraft]:
        if self._overlap_tokens <= 0 or len(chunks) < 2:
            return chunks

        overlapped: list[LegalChunkDraft] = [chunks[0]]
        for idx in range(1, len(chunks)):
            prev = chunks[idx - 1]
            current = chunks[idx]
            if prev.article_no != current.article_no:
                overlapped.append(current)
                continue

            overlap_prefix = _tail_tokens(prev.text, self._overlap_tokens)
            if not overlap_prefix:
                overlapped.append(current)
                continue

            current_text = current.text.strip()
            if current_text.startswith(overlap_prefix):
                overlapped.append(current)
                continue

            overlapped.append(
                replace(
                    current,
                    text=f"{overlap_prefix}\n{current_text}".strip(),
                )
            )
        return overlapped


def _fold_tr(text: str) -> str:
    return (text or "").translate(_TR_FOLD_TABLE)


def _estimate_tokens(text: str) -> int:
    words = len(re.findall(r"\S+", text or ""))
    return int(words * 1.3)


def _tail_tokens(text: str, count: int) -> str:
    if count <= 0:
        return ""
    payload = (text or "").strip()
    if not payload:
        return ""

    spans = list(_TOKEN_SPAN_RE.finditer(payload))
    if not spans:
        return ""
    if len(spans) <= count:
        return payload

    start = spans[-count].start()
    return payload[start:].strip()


def _article_no_from_match(match: re.Match[str]) -> str:
    if match.group("madde"):
        return match.group("madde")
    if match.group("gecici"):
        return f"GECICI {match.group('gecici')}"
    return f"EK {match.group('ek')}"


def _is_heading_candidate(line: str, folded_line: str) -> bool:
    if not line:
        return False
    if len(line) < 3 or len(line) > 100:
        return False
    if line.startswith("("):
        return False

    upper = folded_line.upper().strip()
    if upper.startswith("MADDE ") or upper.startswith("GECICI MADDE") or upper.startswith("EK MADDE"):
        return False

    words = [w for w in line.split() if w]
    if len(words) > 12:
        return False

    letters = [ch for ch in line if ch.isalpha()]
    if not letters:
        return False

    uppercase_ratio = sum(1 for ch in letters if ch == ch.upper()) / len(letters)
    if uppercase_ratio >= 0.75 and len(_PUNCT_RE.findall(line)) <= 1:
        return True

    if upper.startswith(("BOLUM", "KISIM", "KITAP", "BASLIK")):
        return True

    return False


def _page_starts(text: str) -> list[int]:
    starts = [0]
    for idx, char in enumerate(text):
        if char == "\f":
            starts.append(idx + 1)
    return starts


def _page_for_offset(offset: int, starts: list[int]) -> int:
    return max(1, bisect.bisect_right(starts, max(0, offset)))


def _page_range(start: int, end: int, starts: list[int]) -> str:
    first = _page_for_offset(start, starts)
    last = _page_for_offset(max(start, end - 1), starts)
    if first == last:
        return str(first)
    return f"{first}-{last}"


def _paragraph_starts(text: str) -> list[int]:
    starts = [0]
    for match in _PARAGRAPH_BREAK_RE.finditer(text or ""):
        next_start = match.end()
        if next_start < len(text):
            starts.append(next_start)
    return starts


def _paragraph_for_offset(offset: int, starts: list[int]) -> int:
    return max(1, bisect.bisect_right(starts, max(0, offset)))


def _paragraph_range(start: int, end: int, starts: list[int]) -> tuple[int, int]:
    first = _paragraph_for_offset(start, starts)
    last = _paragraph_for_offset(max(start, end - 1), starts)
    return (first, last)
