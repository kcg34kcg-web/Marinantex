"""Source parsing helpers for RAG v3 ingestion."""

from __future__ import annotations

import base64
import html
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

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
_BASE64_BLOB_RE = re.compile(r"^[A-Za-z0-9+/=\r\n]+$")
_DOCX_HEADING_LEVEL_RE = re.compile(r"(?:heading|baslik|baslık)[ _-]*(\d+)", re.IGNORECASE)
_DATA_URL_RE = re.compile(r"^data:[^;]+;base64,", re.IGNORECASE)
_DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


@dataclass(frozen=True)
class ParsedSourceContent:
    """Parsed source payload plus parser metadata."""

    text: str
    source_format: str
    page_count: int
    heading_count: int
    warnings: list[str] = field(default_factory=list)
    ocr_used: bool = False
    ocr_confidence: float | None = None
    ocr_engine: str | None = None


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


def _coerce_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if isinstance(metadata, dict):
        return metadata
    return {}


def _extract_b64_candidate(payload: str) -> str:
    value = (payload or "").strip()
    if value.lower().startswith("base64:"):
        return value[7:].strip()
    if _DATA_URL_RE.match(value):
        return value.split(",", 1)[1].strip()
    return value


def _looks_like_base64_blob(payload: str) -> bool:
    candidate = _extract_b64_candidate(payload)
    compact = re.sub(r"\s+", "", candidate)
    if len(compact) < 128:
        return False
    if len(compact) % 4 != 0:
        return False
    return bool(_BASE64_BLOB_RE.fullmatch(compact))


def _decode_base64_payload(payload: str, *, strict: bool = True) -> bytes | None:
    if not payload:
        return None
    candidate = _extract_b64_candidate(payload)
    compact = re.sub(r"\s+", "", candidate)
    if not compact:
        return None
    if strict and not _looks_like_base64_blob(payload):
        return None
    try:
        return base64.b64decode(compact, validate=True)
    except Exception:
        return None


def _decode_binary_payload(raw_text: str, metadata: dict[str, Any]) -> bytes | None:
    for key in ("binary_base64", "file_base64", "payload_base64"):
        raw_value = metadata.get(key)
        if isinstance(raw_value, str) and raw_value.strip():
            decoded = _decode_base64_payload(raw_value, strict=False)
            if decoded is not None:
                return decoded

    if _looks_like_base64_blob(raw_text):
        return _decode_base64_payload(raw_text)
    return None


def _resolve_fallback_text(raw_text: str, metadata: dict[str, Any]) -> str:
    fallback = metadata.get("fallback_text")
    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    if _looks_like_base64_blob(raw_text):
        return ""
    return (raw_text or "").strip()


def _heading_level_from_docx_style(style_name: str) -> int | None:
    value = (style_name or "").strip()
    if not value:
        return None
    match = _DOCX_HEADING_LEVEL_RE.search(value)
    if not match:
        return None
    level = int(match.group(1))
    if level < 1:
        return 1
    if level > 3:
        return 3
    return level


def _extract_docx_text(binary: bytes) -> tuple[str, int, list[str]]:
    warnings: list[str] = []
    if not binary:
        return "", 0, warnings

    try:
        with zipfile.ZipFile(BytesIO(binary)) as archive:
            if "word/document.xml" not in archive.namelist():
                warnings.append("DOCX_XML_MISSING")
                return "", 0, warnings
            document_xml = archive.read("word/document.xml")
    except Exception:
        warnings.append("DOCX_DECODE_FAILED")
        return "", 0, warnings

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        warnings.append("DOCX_XML_PARSE_FAILED")
        return "", 0, warnings

    lines: list[str] = []
    heading_count = 0

    for paragraph in root.findall(".//w:p", _DOCX_NS):
        parts = [node.text for node in paragraph.findall(".//w:t", _DOCX_NS) if node.text]
        text = "".join(parts).strip()
        if not text:
            continue

        style_name = ""
        style = paragraph.find("./w:pPr/w:pStyle", _DOCX_NS)
        if style is not None:
            style_name = (
                style.attrib.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                or ""
            )
        level = _heading_level_from_docx_style(style_name)
        if level is not None:
            lines.append(f"[H{level}] {text}")
            heading_count += 1
        else:
            lines.append(text)

    return "\n\n".join(lines).strip(), heading_count, warnings


def _extract_pdf_with_ocr(binary: bytes) -> tuple[str, int, float | None, str | None, list[str]]:
    warnings: list[str] = []
    if not binary:
        warnings.append("OCR_BINARY_PAYLOAD_EMPTY")
        return "", 0, None, None, warnings

    try:
        import pypdfium2 as pdfium  # type: ignore[import-untyped]
        import pytesseract  # type: ignore[import-untyped]
    except Exception:
        warnings.append("OCR_ENGINE_UNAVAILABLE")
        return "", 0, None, None, warnings

    try:
        pdf_doc = pdfium.PdfDocument(binary)
    except Exception:
        warnings.append("OCR_PDF_DECODE_FAILED")
        return "", 0, None, None, warnings

    page_count = len(pdf_doc)
    page_texts: list[str] = []
    confidences: list[float] = []
    engine = "pytesseract+pypdfium2"

    for page_index in range(page_count):
        page = None
        bitmap = None
        image = None
        try:
            page = pdf_doc[page_index]
            bitmap = page.render(scale=2.0)
            image = bitmap.to_pil()
            ocr_data = pytesseract.image_to_data(
                image,
                lang="tur+eng",
                config="--oem 1 --psm 6",
                output_type=pytesseract.Output.DICT,
            )
            words: list[str] = []
            conf_values = ocr_data.get("conf", [])
            text_values = ocr_data.get("text", [])
            for raw_word, raw_conf in zip(text_values, conf_values):
                word = str(raw_word or "").strip()
                if word:
                    words.append(word)
                try:
                    conf_score = float(raw_conf)
                except (TypeError, ValueError):
                    continue
                if conf_score >= 0.0:
                    confidences.append(max(0.0, min(1.0, conf_score / 100.0)))
            joined = " ".join(words).strip()
            page_texts.append(joined)
        except Exception:
            warnings.append(f"OCR_PAGE_FAILED:{page_index + 1}")
            page_texts.append("")
        finally:
            if image is not None and hasattr(image, "close"):
                try:
                    image.close()
                except Exception:
                    pass
            if bitmap is not None and hasattr(bitmap, "close"):
                try:
                    bitmap.close()
                except Exception:
                    pass
            if page is not None and hasattr(page, "close"):
                try:
                    page.close()
                except Exception:
                    pass

    if hasattr(pdf_doc, "close"):
        try:
            pdf_doc.close()
        except Exception:
            pass

    text = "\f".join(page_texts).strip()
    confidence = round(sum(confidences) / len(confidences), 4) if confidences else None
    if not text:
        warnings.append("OCR_EMPTY_TEXT")
    if confidence is not None and confidence < 0.45:
        warnings.append("LOW_OCR_CONFIDENCE")

    return text, max(1, page_count), confidence, engine, warnings


def _parse_docx_payload(raw_text: str, metadata: dict[str, Any]) -> ParsedSourceContent:
    warnings: list[str] = []
    binary = _decode_binary_payload(raw_text, metadata)
    if binary is not None:
        text, heading_count, docx_warnings = _extract_docx_text(binary)
        warnings.extend(docx_warnings)
        if text:
            return ParsedSourceContent(
                text=text,
                source_format="docx",
                page_count=1,
                heading_count=heading_count,
                warnings=list(dict.fromkeys(warnings)),
            )

        fallback = _resolve_fallback_text(raw_text, metadata)
        if fallback:
            warnings.append("DOCX_FALLBACK_TO_RAW_TEXT")
            return ParsedSourceContent(
                text=fallback,
                source_format="docx",
                page_count=1,
                heading_count=0,
                warnings=list(dict.fromkeys(warnings)),
            )

        warnings.append("DOCX_TEXT_EMPTY")
        return ParsedSourceContent(
            text="",
            source_format="docx",
            page_count=1,
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
        )

    payload = _resolve_fallback_text(raw_text, metadata)
    return ParsedSourceContent(
        text=payload,
        source_format="docx",
        page_count=max(1, payload.count("\f") + 1),
        heading_count=0,
        warnings=warnings,
    )


def _parse_pdf_payload(raw_text: str, metadata: dict[str, Any]) -> ParsedSourceContent:
    warnings: list[str] = []
    fallback_text = _resolve_fallback_text(raw_text, metadata)
    binary = _decode_binary_payload(raw_text, metadata)
    should_try_ocr = bool(metadata.get("ocr_required")) or (
        binary is not None and (not fallback_text or len(fallback_text) < 120)
    )

    if binary is not None and should_try_ocr:
        text, page_count, confidence, engine, ocr_warnings = _extract_pdf_with_ocr(binary)
        warnings.extend(ocr_warnings)
        if text.strip():
            parsed_text, normalized_page_count = _pdf_to_structured_text(text)
            return ParsedSourceContent(
                text=parsed_text,
                source_format="pdf",
                page_count=max(page_count, normalized_page_count),
                heading_count=0,
                warnings=list(dict.fromkeys(warnings)),
                ocr_used=True,
                ocr_confidence=confidence,
                ocr_engine=engine,
            )
        if fallback_text:
            warnings.append("OCR_FALLBACK_TO_EXTRACTED_TEXT")
            parsed_text, normalized_page_count = _pdf_to_structured_text(fallback_text)
            return ParsedSourceContent(
                text=parsed_text,
                source_format="pdf",
                page_count=max(1, normalized_page_count),
                heading_count=0,
                warnings=list(dict.fromkeys(warnings)),
                ocr_used=True,
                ocr_confidence=confidence,
                ocr_engine=engine,
            )
        return ParsedSourceContent(
            text="",
            source_format="pdf",
            page_count=max(1, page_count),
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
            ocr_used=True,
            ocr_confidence=confidence,
            ocr_engine=engine,
        )

    text, page_count = _pdf_to_structured_text(fallback_text)
    return ParsedSourceContent(
        text=text,
        source_format="pdf",
        page_count=page_count,
        heading_count=0,
        warnings=warnings,
    )


def parse_source_content(
    raw_text: str,
    source_format: str,
    *,
    metadata: dict[str, Any] | None = None,
) -> ParsedSourceContent:
    """
    Parse source payload into retrieval-ready text.

    Supported formats:
      - text: pass-through
      - pdf: preserve/restore page boundaries; OCR fallback for image PDFs
      - html: preserve H1/H2/H3 as explicit heading markers
      - docx: extract text from DOCX XML and preserve heading styles
    """
    fmt = (source_format or "text").strip().lower()
    payload = raw_text or ""
    meta = _coerce_metadata(metadata)

    if fmt == "html":
        text, heading_count = _html_to_structured_text(payload)
        return ParsedSourceContent(
            text=text,
            source_format="html",
            page_count=max(1, text.count("\f") + 1),
            heading_count=heading_count,
        )

    if fmt == "pdf":
        return _parse_pdf_payload(payload, meta)

    if fmt == "docx":
        return _parse_docx_payload(payload, meta)

    return ParsedSourceContent(
        text=payload,
        source_format="text",
        page_count=max(1, payload.count("\f") + 1),
        heading_count=0,
    )
