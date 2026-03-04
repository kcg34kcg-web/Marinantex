"""Source parsing helpers for RAG v3 ingestion."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

_TAG_BLOCK_RE = re.compile(
    r"<(h1|h2|h3|p|li|div|section|article|td|th)[^>]*>(.*?)</\1>",
    re.IGNORECASE | re.DOTALL,
)
_TAG_STRIP_RE = re.compile(r"<[^>]+>", re.DOTALL)
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_SPACE_RE = re.compile(r"[ \t]+")
_PDF_PAGE_MARKER_RE = re.compile(
    r"^\s*(?:[-=]*)?\s*(?:page|sayfa)\s+(\d+)(?:\s*/\s*\d+)?\s*(?:[-=]*)?\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedSourceContent:
    """Parsed source payload plus parser metadata."""

    text: str
    source_format: str
    page_count: int
    heading_count: int


def _clean_html_fragment(raw: str) -> str:
    text = _TAG_STRIP_RE.sub(" ", raw or "")
    text = html.unescape(text)
    text = _SPACE_RE.sub(" ", text).strip()
    return text


def _html_to_structured_text(raw_html: str) -> tuple[str, int]:
    payload = _SCRIPT_STYLE_RE.sub(" ", raw_html or "")
    payload = _BR_RE.sub("\n", payload)

    lines: list[str] = []
    heading_count = 0
    for match in _TAG_BLOCK_RE.finditer(payload):
        tag = match.group(1).lower()
        value = _clean_html_fragment(match.group(2))
        if not value:
            continue
        if tag in {"h1", "h2", "h3"}:
            lines.append(f"[{tag.upper()}] {value}")
            heading_count += 1
        else:
            lines.append(value)

    if lines:
        return "\n\n".join(lines), heading_count

    fallback = _clean_html_fragment(payload)
    return fallback, 0


def _pdf_to_structured_text(raw_text: str) -> tuple[str, int]:
    payload = (raw_text or "").replace("\r\n", "\n").replace("\r", "\n")
    if "\f" in payload:
        page_count = payload.count("\f") + 1
        return payload, page_count

    out_lines: list[str] = []
    has_marker = False
    for line in payload.split("\n"):
        if _PDF_PAGE_MARKER_RE.match(line):
            if out_lines:
                out_lines.append("\f")
            has_marker = True
            continue
        out_lines.append(line)

    parsed = "\n".join(out_lines)
    if not has_marker:
        return parsed, 1
    return parsed, max(1, parsed.count("\f") + 1)


def parse_source_content(raw_text: str, source_format: str) -> ParsedSourceContent:
    """
    Parse source payload into retrieval-ready text.

    Supported formats:
      - text: pass-through
      - pdf: preserve/restore page boundaries with form-feed separators
      - html: preserve H1/H2/H3 as explicit heading markers
    """
    fmt = (source_format or "text").strip().lower()
    payload = raw_text or ""

    if fmt == "html":
        text, heading_count = _html_to_structured_text(payload)
        return ParsedSourceContent(
            text=text,
            source_format="html",
            page_count=max(1, text.count("\f") + 1),
            heading_count=heading_count,
        )

    if fmt == "pdf":
        text, page_count = _pdf_to_structured_text(payload)
        return ParsedSourceContent(
            text=text,
            source_format="pdf",
            page_count=page_count,
            heading_count=0,
        )

    return ParsedSourceContent(
        text=payload,
        source_format="text",
        page_count=max(1, payload.count("\f") + 1),
        heading_count=0,
    )
