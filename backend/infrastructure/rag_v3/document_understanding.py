"""Document understanding quality gates for RAG v3 ingest."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from infrastructure.config import settings
from infrastructure.rag_v3.chunker import LegalChunkDraft
from infrastructure.rag_v3.source_parser import ParsedSourceContent

_ARTICLE_RE = re.compile(r"\b(?:madde|m\.)\s*\d+[a-z0-9/.-]*", re.IGNORECASE)
_CLAUSE_RE = re.compile(r"\(\d+\)")
_TABLE_LINE_RE = re.compile(r"\s{3,}|\||;")
_DECISION_HEADER_RE = re.compile(
    r"(?:\besas\s*no\b|\bkarar\s*no\b|\be\.\s*\d{4}/\d+|\bk\.\s*\d{4}/\d+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DocumentUnderstandingReport:
    quality_score: float
    parser_confidence: float
    layout_confidence: float
    ocr_confidence: float
    pass_gate: bool
    requires_human_review: bool
    reason_codes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)


def evaluate_document_understanding(
    *,
    parsed: ParsedSourceContent,
    normalized_text: str,
    chunks: list[LegalChunkDraft],
    metadata: dict[str, Any] | None = None,
) -> DocumentUnderstandingReport:
    payload = normalized_text or ""
    warnings: list[str] = list(dict.fromkeys([str(item) for item in parsed.warnings if str(item).strip()]))

    line_count = max(1, len(payload.splitlines()))
    non_empty_lines = [line for line in payload.splitlines() if line.strip()]
    non_empty_line_count = max(1, len(non_empty_lines))
    char_count = len(payload)
    chunk_count = len(chunks)
    article_count = len(_ARTICLE_RE.findall(payload))
    clause_count = len(_CLAUSE_RE.findall(payload))
    table_like_lines = sum(1 for line in non_empty_lines if _TABLE_LINE_RE.search(line))
    decision_header_hits = len(_DECISION_HEADER_RE.findall(payload[:4000]))
    heading_count = int(max(0, parsed.heading_count))

    parser_conf = 0.46
    if char_count >= 300:
        parser_conf += 0.10
    if chunk_count >= 2:
        parser_conf += 0.14
    if chunk_count >= 6:
        parser_conf += 0.08
    if article_count >= 1:
        parser_conf += 0.10
    if clause_count >= 2:
        parser_conf += 0.06
    if decision_header_hits >= 1:
        parser_conf += 0.05
    if heading_count >= 2:
        parser_conf += 0.05

    parser_conf -= _warning_penalty(warnings)
    parser_conf = _clamp01(parser_conf)

    short_lines = sum(1 for line in non_empty_lines if len(line.strip()) <= 32)
    short_line_ratio = short_lines / float(non_empty_line_count)
    table_line_ratio = table_like_lines / float(non_empty_line_count)

    layout_conf = 0.55
    if table_line_ratio >= 0.10:
        layout_conf -= 0.08
    if table_line_ratio >= 0.25 and clause_count <= 1:
        layout_conf -= 0.10
    if short_line_ratio >= 0.35:
        layout_conf -= 0.09
    if short_line_ratio >= 0.50:
        layout_conf -= 0.08
    if parsed.page_count >= 5 and chunk_count <= 2:
        layout_conf -= 0.10
    if article_count >= 2 or decision_header_hits >= 1:
        layout_conf += 0.10
    if heading_count >= 2:
        layout_conf += 0.07
    if chunk_count >= 8:
        layout_conf += 0.06

    layout_conf = _clamp01(layout_conf)

    if parsed.ocr_used:
        if parsed.ocr_confidence is None:
            ocr_conf = 0.35
            warnings.append("OCR_CONFIDENCE_UNAVAILABLE")
        else:
            ocr_conf = _clamp01(float(parsed.ocr_confidence))
    else:
        ocr_conf = 1.0

    if "LOW_OCR_CONFIDENCE" in warnings:
        ocr_conf = min(ocr_conf, 0.44)
    if "OCR_EMPTY_TEXT" in warnings:
        ocr_conf = min(ocr_conf, 0.30)

    score = _clamp01((0.45 * parser_conf) + (0.35 * layout_conf) + (0.20 * ocr_conf))

    min_quality = _clamp01(float(getattr(settings, "rag_v3_ingest_min_quality_score", 0.62) or 0.62))
    min_parser = _clamp01(float(getattr(settings, "rag_v3_ingest_min_parser_confidence", 0.55) or 0.55))
    min_ocr = _clamp01(float(getattr(settings, "rag_v3_ingest_min_ocr_confidence", 0.45) or 0.45))

    reason_codes: list[str] = []
    if score < min_quality:
        reason_codes.append("quality_score_below_threshold")
    if parser_conf < min_parser:
        reason_codes.append("parser_confidence_below_threshold")
    if parsed.ocr_used and ocr_conf < min_ocr:
        reason_codes.append("ocr_confidence_below_threshold")
    if chunk_count <= 0:
        reason_codes.append("chunk_count_zero")

    pass_gate = not reason_codes
    requires_human_review = bool(
        reason_codes
        or (parsed.ocr_used and ocr_conf < 0.60)
        or (table_line_ratio > 0.35)
        or (short_line_ratio > 0.55)
    )

    return DocumentUnderstandingReport(
        quality_score=score,
        parser_confidence=parser_conf,
        layout_confidence=layout_conf,
        ocr_confidence=ocr_conf,
        pass_gate=pass_gate,
        requires_human_review=requires_human_review,
        reason_codes=reason_codes,
        warnings=list(dict.fromkeys(warnings)),
        metrics={
            "char_count": int(char_count),
            "line_count": int(line_count),
            "chunk_count": int(chunk_count),
            "article_count": int(article_count),
            "clause_count": int(clause_count),
            "heading_count": int(heading_count),
            "decision_header_hits": int(decision_header_hits),
            "table_line_ratio": round(table_line_ratio, 4),
            "short_line_ratio": round(short_line_ratio, 4),
            "page_count": int(parsed.page_count),
        },
    )


def _warning_penalty(warnings: list[str]) -> float:
    penalty = 0.0
    for code in warnings:
        token = str(code).strip().upper()
        if token in {
            "OCR_ENGINE_UNAVAILABLE",
            "OCR_PDF_DECODE_FAILED",
            "DOCX_XML_PARSE_FAILED",
            "DOCX_DECODE_FAILED",
            "DOCX_TEXT_EMPTY",
            "OCR_EMPTY_TEXT",
        }:
            penalty += 0.22
            continue
        if token.startswith("OCR_PAGE_FAILED"):
            penalty += 0.07
            continue
        if token in {"LOW_OCR_CONFIDENCE", "DOCX_FALLBACK_TO_RAW_TEXT", "OCR_FALLBACK_TO_EXTRACTED_TEXT"}:
            penalty += 0.08
            continue
    return penalty


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value
