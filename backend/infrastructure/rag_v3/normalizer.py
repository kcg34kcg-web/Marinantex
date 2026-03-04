"""Normalization helpers for RAG v3 legal ingestion."""

from __future__ import annotations

import re
from dataclasses import dataclass

_SPACE_RE = re.compile(r"[ \t]+")
_ARTICLE_OR_CLAUSE_START_RE = re.compile(
    r"^(?:MADDE\s+\d+|GECICI\s+MADDE\s+\d+|EK\s+MADDE\s+\d+|\(\d+\)|[a-z]\))",
    re.IGNORECASE,
)
_FOOTNOTE_RE = re.compile(
    r"^(?:\[\d+\]|\*+|dipnot\s*\d*[:\-]?)\s+",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class NormalizedLegalText:
    """Normalized legal text plus extraction side-metadata."""

    text: str
    footnotes: list[str]
    warnings: list[str]


class LegalTextNormalizer:
    """Line-merge and footnote-aware normalization for legal text."""

    def normalize(self, text: str) -> NormalizedLegalText:
        payload = (text or "").replace("\r\n", "\n").replace("\r", "\n")
        if not payload.strip():
            return NormalizedLegalText(text="", footnotes=[], warnings=[])

        pages = payload.split("\f")
        normalized_pages: list[str] = []
        footnotes: list[str] = []
        hyphen_fixes = 0
        wrapped_line_joins = 0

        for page in pages:
            page_text, page_footnotes, page_hyphen, page_joins = self._normalize_page(page)
            normalized_pages.append(page_text)
            footnotes.extend(page_footnotes)
            hyphen_fixes += page_hyphen
            wrapped_line_joins += page_joins

        normalized_text = "\f".join(part.strip() for part in normalized_pages)
        normalized_text = _collapse_blank_lines(normalized_text).strip()

        warnings: list[str] = []
        if hyphen_fixes > 0:
            warnings.append(f"hyphen_join_count={hyphen_fixes}")
        if wrapped_line_joins > 0:
            warnings.append(f"line_merge_count={wrapped_line_joins}")
        if footnotes:
            warnings.append(f"footnote_count={len(footnotes)}")

        return NormalizedLegalText(
            text=normalized_text,
            footnotes=footnotes,
            warnings=warnings,
        )

    def _normalize_page(self, page: str) -> tuple[str, list[str], int, int]:
        raw_lines = page.split("\n")
        out_lines: list[str] = []
        footnotes: list[str] = []
        hyphen_fixes = 0
        wrapped_line_joins = 0

        idx = 0
        while idx < len(raw_lines):
            line = _normalize_line(raw_lines[idx])
            if not line:
                out_lines.append("")
                idx += 1
                continue

            if _FOOTNOTE_RE.match(line):
                footnotes.append(line)
                idx += 1
                continue

            current = line
            while idx + 1 < len(raw_lines):
                next_line = _normalize_line(raw_lines[idx + 1])
                if not next_line:
                    break
                if _FOOTNOTE_RE.match(next_line):
                    break
                if _is_hyphen_break(current, next_line):
                    current = current[:-1] + next_line.lstrip()
                    hyphen_fixes += 1
                    idx += 1
                    continue
                if _is_wrapped_line(current, next_line):
                    current = f"{current} {next_line.lstrip()}"
                    wrapped_line_joins += 1
                    idx += 1
                    continue
                break

            out_lines.append(current)
            idx += 1

        return _collapse_blank_lines("\n".join(out_lines)), footnotes, hyphen_fixes, wrapped_line_joins


def _normalize_line(line: str) -> str:
    return _SPACE_RE.sub(" ", (line or "").strip())


def _is_hyphen_break(current: str, next_line: str) -> bool:
    if not current or not next_line:
        return False
    if not current.endswith("-"):
        return False
    first = next_line[0]
    return first.isalpha() and first.islower()


def _is_wrapped_line(current: str, next_line: str) -> bool:
    if not current or not next_line:
        return False
    if current.startswith("[H1]") or current.startswith("[H2]") or current.startswith("[H3]"):
        return False
    if _ARTICLE_OR_CLAUSE_START_RE.match(next_line):
        return False
    if current.endswith((".", ";", ":", "!", "?", ")", "]", "\"", "'")):
        return False
    first = next_line[0]
    if first.isdigit():
        return False
    return first.islower()


def _collapse_blank_lines(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    previous_blank = False
    for line in lines:
        is_blank = not line.strip()
        if is_blank and previous_blank:
            continue
        out.append(line.rstrip())
        previous_blank = is_blank
    return "\n".join(out)


legal_text_normalizer = LegalTextNormalizer()
