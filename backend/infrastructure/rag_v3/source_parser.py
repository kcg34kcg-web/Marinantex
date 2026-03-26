"""Source parsing helpers for RAG v3 ingestion."""

from __future__ import annotations

import base64
import html
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field, replace
from email import policy
from email.parser import BytesParser
from io import BytesIO
from pathlib import Path
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
_CASE_LAW_E_NO_RE = re.compile(r"\bE\.\s*\d{4}/\d+\b", re.IGNORECASE)
_CASE_LAW_K_NO_RE = re.compile(r"\bK\.\s*\d{4}/\d+\b", re.IGNORECASE)
_CASE_LAW_ESAS_NO_RE = re.compile(r"\bESAS\s+NO\b", re.IGNORECASE)
_CASE_LAW_KARAR_NO_RE = re.compile(r"\bKARAR\s+NO\b", re.IGNORECASE)

_TR_CASELAW_FOLD = str.maketrans(
    {
        "ç": "c",
        "ğ": "g",
        "ı": "i",
        "ö": "o",
        "ş": "s",
        "ü": "u",
        "Ç": "C",
        "Ğ": "G",
        "İ": "I",
        "Ö": "O",
        "Ş": "S",
        "Ü": "U",
    }
)

_CASE_LAW_SECTION_ALIASES: dict[str, str] = {
    "OLAY": "OLAY",
    "OLAYIN OZETI": "OLAY",
    "GEREKCE": "GEREKCE",
    "GEREKCESI": "GEREKCE",
    "HUKUM": "HUKUM",
    "SONUC": "SONUC",
    "KARSI OY": "KARSI OY",
    "MUHALEFET SERHI": "KARSI OY",
}
_CASE_LAW_CONTEXT_HINTS = (
    "ictihat",
    "içtihat",
    "karar",
    "case_law",
    "yargitay",
    "yargıtay",
    "danistay",
    "danıştay",
    "mahkeme",
    "aym",
)

_ZIP_TEXT_EXTENSIONS = frozenset({
    ".txt",
    ".md",
    ".json",
    ".xml",
    ".html",
    ".htm",
    ".csv",
    ".eml",
})


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


def _fold_case_law_text(value: str) -> str:
    token = str(value or "").translate(_TR_CASELAW_FOLD).upper()
    token = re.sub(r"\s+", " ", token).strip()
    return token


def _canonical_case_law_section(line: str) -> str | None:
    raw = str(line or "").strip()
    if not raw or raw.startswith("[H"):
        return None
    if len(raw) > 64:
        return None

    folded = _fold_case_law_text(raw).strip(":- ")
    folded = re.sub(r"\s+", " ", folded).strip()
    if not folded:
        return None

    for alias, canonical in _CASE_LAW_SECTION_ALIASES.items():
        if folded == alias:
            return canonical
    return None


def _looks_like_case_law_context(text: str, metadata: dict[str, Any]) -> bool:
    head = str(text or "")[:4000]
    if not head.strip():
        return False

    metadata_blob = " ".join(
        str(metadata.get(key) or "")
        for key in (
            "source_type",
            "doc_type",
            "authority_type",
            "authority_rank",
            "title",
            "canonical_citation",
        )
    ).lower()
    if any(hint in metadata_blob for hint in _CASE_LAW_CONTEXT_HINTS):
        return True

    has_short_ref = bool(_CASE_LAW_E_NO_RE.search(head) and _CASE_LAW_K_NO_RE.search(head))
    has_long_ref = bool(_CASE_LAW_ESAS_NO_RE.search(head) and _CASE_LAW_KARAR_NO_RE.search(head))
    return has_short_ref or has_long_ref


def _apply_case_law_section_markers(
    *,
    text: str,
    heading_count: int,
    metadata: dict[str, Any],
) -> tuple[str, int]:
    payload = str(text or "")
    if not payload:
        return payload, heading_count
    if not _looks_like_case_law_context(payload, metadata):
        return payload, heading_count

    lines = payload.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out_lines: list[str] = []
    inserted = 0
    for line in lines:
        section = _canonical_case_law_section(line)
        if section:
            out_lines.append(f"[H2] {section}")
            inserted += 1
            continue
        out_lines.append(line)

    if inserted <= 0:
        return payload, heading_count
    return "\n".join(out_lines), heading_count + inserted


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


def _append_structured_line(
    lines: list[str],
    value: str,
    *,
    warnings: list[str],
    max_lines: int,
    truncation_code: str,
) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if len(lines) >= max_lines:
        if truncation_code not in warnings:
            warnings.append(truncation_code)
        return False
    lines.append(text)
    return True


def _scalar_text(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    return _SPACE_RE.sub(" ", text).strip()


def _json_to_structured_text(raw_json: str) -> tuple[str, int, list[str]]:
    payload = (raw_json or "").strip()
    warnings: list[str] = []
    if not payload:
        return "", 0, warnings

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        warnings.append("JSON_PARSE_FAILED")
        fallback = _SPACE_RE.sub(" ", payload.replace("\r", "\n")).strip()
        return fallback, 0, warnings

    lines: list[str] = []
    heading_count = 0
    max_lines = 4000

    def walk(node: Any, path: list[str]) -> None:
        nonlocal heading_count
        if len(lines) >= max_lines:
            return

        if isinstance(node, dict):
            for key, child in node.items():
                key_text = str(key).strip() or "<key>"
                next_path = path + [key_text]
                label = " > ".join(next_path)
                if isinstance(child, (dict, list)):
                    level = min(3, max(1, len(next_path)))
                    ok = _append_structured_line(
                        lines,
                        f"[H{level}] {label}",
                        warnings=warnings,
                        max_lines=max_lines,
                        truncation_code="JSON_PARSE_TRUNCATED",
                    )
                    if ok:
                        heading_count += 1
                    walk(child, next_path)
                else:
                    _append_structured_line(
                        lines,
                        f"{label}: {_scalar_text(child)}",
                        warnings=warnings,
                        max_lines=max_lines,
                        truncation_code="JSON_PARSE_TRUNCATED",
                    )
            return

        if isinstance(node, list):
            for index, child in enumerate(node, start=1):
                prefix = " > ".join(path) if path else "item"
                label = f"{prefix}[{index}]"
                if isinstance(child, (dict, list)):
                    level = min(3, max(1, len(path) + 1))
                    ok = _append_structured_line(
                        lines,
                        f"[H{level}] {label}",
                        warnings=warnings,
                        max_lines=max_lines,
                        truncation_code="JSON_PARSE_TRUNCATED",
                    )
                    if ok:
                        heading_count += 1
                    walk(child, path + [f"#{index}"])
                else:
                    _append_structured_line(
                        lines,
                        f"{label}: {_scalar_text(child)}",
                        warnings=warnings,
                        max_lines=max_lines,
                        truncation_code="JSON_PARSE_TRUNCATED",
                    )
            return

        label = " > ".join(path) if path else "value"
        _append_structured_line(
            lines,
            f"{label}: {_scalar_text(node)}",
            warnings=warnings,
            max_lines=max_lines,
            truncation_code="JSON_PARSE_TRUNCATED",
        )

    walk(parsed, [])
    if not lines:
        return json.dumps(parsed, ensure_ascii=False), 0, warnings
    return "\n\n".join(lines), heading_count, warnings


def _xml_local_name(token: str) -> str:
    value = str(token or "").strip()
    if "}" in value:
        value = value.rsplit("}", 1)[-1]
    if ":" in value:
        value = value.split(":", 1)[-1]
    return value or "node"


def _xml_inline_text(node: ET.Element) -> str:
    parts: list[str] = []
    if node.text and node.text.strip():
        parts.append(node.text.strip())
    for child in list(node):
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    text = " ".join(parts).strip()
    return _SPACE_RE.sub(" ", text)


def _xml_to_structured_text(raw_xml: str) -> tuple[str, int, list[str]]:
    payload = (raw_xml or "").strip()
    warnings: list[str] = []
    if not payload:
        return "", 0, warnings

    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        warnings.append("XML_PARSE_FAILED")
        fallback = _clean_html_fragment(payload)
        return fallback, 0, warnings

    lines: list[str] = []
    heading_count = 0
    max_lines = 4000

    def walk(node: ET.Element, path: list[str]) -> None:
        nonlocal heading_count
        if len(lines) >= max_lines:
            return

        tag = _xml_local_name(node.tag)
        next_path = path + [tag]
        label = " > ".join(next_path)
        children = [child for child in list(node) if isinstance(child.tag, str)]

        if children:
            level = min(3, max(1, len(next_path)))
            ok = _append_structured_line(
                lines,
                f"[H{level}] {label}",
                warnings=warnings,
                max_lines=max_lines,
                truncation_code="XML_PARSE_TRUNCATED",
            )
            if ok:
                heading_count += 1

        text = _xml_inline_text(node)
        if text:
            _append_structured_line(
                lines,
                f"{label}: {text}",
                warnings=warnings,
                max_lines=max_lines,
                truncation_code="XML_PARSE_TRUNCATED",
            )

        for attr_key, attr_value in (node.attrib or {}).items():
            attr_name = _xml_local_name(attr_key)
            _append_structured_line(
                lines,
                f"{label} @{attr_name}: {_scalar_text(attr_value)}",
                warnings=warnings,
                max_lines=max_lines,
                truncation_code="XML_PARSE_TRUNCATED",
            )

        for child in children:
            walk(child, next_path)

    walk(root, [])
    if not lines:
        return _clean_html_fragment(payload), 0, warnings
    return "\n\n".join(lines), heading_count, warnings


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


def _extract_image_with_ocr(binary: bytes) -> tuple[str, float | None, str | None, list[str]]:
    warnings: list[str] = []
    if not binary:
        warnings.append("OCR_IMAGE_BINARY_EMPTY")
        return "", None, None, warnings
    try:
        from PIL import Image  # type: ignore[import-untyped]
        import pytesseract  # type: ignore[import-untyped]
    except Exception:
        warnings.append("OCR_ENGINE_UNAVAILABLE")
        return "", None, None, warnings

    image = None
    try:
        image = Image.open(BytesIO(binary))
        ocr_data = pytesseract.image_to_data(
            image,
            lang="tur+eng",
            config="--oem 1 --psm 6",
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        warnings.append("OCR_IMAGE_DECODE_FAILED")
        return "", None, None, warnings
    finally:
        if image is not None and hasattr(image, "close"):
            try:
                image.close()
            except Exception:
                pass

    words: list[str] = []
    confidences: list[float] = []
    for raw_word, raw_conf in zip(ocr_data.get("text", []), ocr_data.get("conf", [])):
        word = str(raw_word or "").strip()
        if word:
            words.append(word)
        try:
            conf_score = float(raw_conf)
        except (TypeError, ValueError):
            continue
        if conf_score >= 0:
            confidences.append(max(0.0, min(1.0, conf_score / 100.0)))

    text = " ".join(words).strip()
    confidence = round(sum(confidences) / len(confidences), 4) if confidences else None
    if not text:
        warnings.append("OCR_EMPTY_TEXT")
    if confidence is not None and confidence < 0.45:
        warnings.append("LOW_OCR_CONFIDENCE")
    return text, confidence, "pytesseract+pil", warnings


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


def _parse_image_payload(raw_text: str, metadata: dict[str, Any], *, source_format: str) -> ParsedSourceContent:
    warnings: list[str] = []
    fallback_text = _resolve_fallback_text(raw_text, metadata)
    binary = _decode_binary_payload(raw_text, metadata)
    should_try_ocr = bool(metadata.get("ocr_required")) or bool(binary and not fallback_text)

    if binary is not None and should_try_ocr:
        text, confidence, engine, ocr_warnings = _extract_image_with_ocr(binary)
        warnings.extend(ocr_warnings)
        if text:
            return ParsedSourceContent(
                text=text,
                source_format=source_format,
                page_count=1,
                heading_count=0,
                warnings=list(dict.fromkeys(warnings)),
                ocr_used=True,
                ocr_confidence=confidence,
                ocr_engine=engine,
            )
    if fallback_text:
        if binary is not None and should_try_ocr:
            warnings.append("OCR_FALLBACK_TO_EXTRACTED_TEXT")
        return ParsedSourceContent(
            text=fallback_text,
            source_format=source_format,
            page_count=1,
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
            ocr_used=bool(binary and should_try_ocr),
        )
    return ParsedSourceContent(
        text="",
        source_format=source_format,
        page_count=1,
        heading_count=0,
        warnings=list(dict.fromkeys(warnings)),
        ocr_used=bool(binary and should_try_ocr),
    )


def _parse_eml_payload(raw_text: str, metadata: dict[str, Any]) -> ParsedSourceContent:
    warnings: list[str] = []
    binary = _decode_binary_payload(raw_text, metadata)
    payload_bytes = binary if binary is not None else (raw_text or "").encode("utf-8", errors="ignore")
    if not payload_bytes:
        return ParsedSourceContent(
            text="",
            source_format="eml",
            page_count=1,
            heading_count=0,
            warnings=["EML_EMPTY_PAYLOAD"],
        )

    try:
        msg = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    except Exception:
        warnings.append("EML_PARSE_FAILED")
        fallback = _resolve_fallback_text(raw_text, metadata)
        return ParsedSourceContent(
            text=fallback,
            source_format="eml",
            page_count=1,
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
        )

    lines: list[str] = []
    heading_count = 0

    subject = str(msg.get("subject") or "").strip()
    sender = str(msg.get("from") or "").strip()
    recipient = str(msg.get("to") or "").strip()
    sent_at = str(msg.get("date") or "").strip()

    if subject:
        lines.append(f"[H1] Subject: {subject}")
        heading_count += 1
    if sender:
        lines.append(f"From: {sender}")
    if recipient:
        lines.append(f"To: {recipient}")
    if sent_at:
        lines.append(f"Date: {sent_at}")

    body_segments: list[str] = []
    attachment_names: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            content_disposition = str(part.get_content_disposition() or "").strip().lower()
            filename = str(part.get_filename() or "").strip()
            if content_disposition == "attachment":
                if filename:
                    attachment_names.append(filename)
                continue
            if part.get_content_maintype() != "text":
                continue
            try:
                content = part.get_content()
            except Exception:
                continue
            text = str(content or "").strip()
            if text:
                body_segments.append(text)
    else:
        try:
            content = msg.get_content()
            text = str(content or "").strip()
            if text:
                body_segments.append(text)
        except Exception:
            warnings.append("EML_BODY_DECODE_FAILED")

    if body_segments:
        lines.append("[H2] Body")
        heading_count += 1
        lines.append("\n\n".join(body_segments))

    if attachment_names:
        lines.append("[H2] Attachments")
        heading_count += 1
        lines.extend(f"- {name}" for name in attachment_names[:50])
        if len(attachment_names) > 50:
            warnings.append("EML_ATTACHMENTS_TRUNCATED")

    return ParsedSourceContent(
        text="\n\n".join(lines).strip(),
        source_format="eml",
        page_count=1,
        heading_count=heading_count,
        warnings=list(dict.fromkeys(warnings)),
    )


def _parse_zip_payload(raw_text: str, metadata: dict[str, Any]) -> ParsedSourceContent:
    warnings: list[str] = []
    binary = _decode_binary_payload(raw_text, metadata)
    if binary is None:
        warnings.append("ZIP_BINARY_MISSING")
        return ParsedSourceContent(
            text=_resolve_fallback_text(raw_text, metadata),
            source_format="zip",
            page_count=1,
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
        )

    lines: list[str] = []
    heading_count = 0
    file_count = 0
    try:
        with zipfile.ZipFile(BytesIO(binary)) as archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            for info in entries[:80]:
                file_count += 1
                filename = str(info.filename or "").strip()
                suffix = Path(filename).suffix.lower()
                if suffix not in _ZIP_TEXT_EXTENSIONS:
                    warnings.append(f"ZIP_SKIPPED_NON_TEXT:{filename[:80]}")
                    continue
                try:
                    data = archive.read(info)
                except Exception:
                    warnings.append(f"ZIP_READ_FAILED:{filename[:80]}")
                    continue

                text = data.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue
                lines.append(f"[H1] ANNEX: {filename}")
                heading_count += 1
                if suffix in {".html", ".htm"}:
                    parsed_text, nested_heading = _html_to_structured_text(text)
                    heading_count += nested_heading
                    lines.append(parsed_text)
                elif suffix == ".json":
                    parsed_text, nested_heading, nested_warnings = _json_to_structured_text(text)
                    heading_count += nested_heading
                    warnings.extend(nested_warnings)
                    lines.append(parsed_text)
                elif suffix == ".xml":
                    parsed_text, nested_heading, nested_warnings = _xml_to_structured_text(text)
                    heading_count += nested_heading
                    warnings.extend(nested_warnings)
                    lines.append(parsed_text)
                elif suffix == ".eml":
                    nested = _parse_eml_payload(text, {})
                    heading_count += nested.heading_count
                    warnings.extend(nested.warnings)
                    lines.append(nested.text)
                else:
                    lines.append(text)
            if len(entries) > 80:
                warnings.append("ZIP_ENTRY_TRUNCATED")
    except Exception:
        warnings.append("ZIP_DECODE_FAILED")
        return ParsedSourceContent(
            text=_resolve_fallback_text(raw_text, metadata),
            source_format="zip",
            page_count=1,
            heading_count=0,
            warnings=list(dict.fromkeys(warnings)),
        )

    if not lines:
        warnings.append("ZIP_NO_TEXT_ENTRIES")
    lines.insert(0, f"[H1] ZIP_ANNEX_COUNT: {file_count}")
    heading_count += 1
    return ParsedSourceContent(
        text="\n\n".join(lines).strip(),
        source_format="zip",
        page_count=1,
        heading_count=heading_count,
        warnings=list(dict.fromkeys(warnings)),
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
      - png/jpg/jpeg/tiff/bmp/webp: OCR-first image parsing
      - html: preserve H1/H2/H3 as explicit heading markers
      - docx: extract text from DOCX XML and preserve heading styles
      - eml: parse headers/body/attachments into structured text
      - zip: parse text annex entries into structured sections
      - xml: convert nested XML into path-oriented structured text
      - json: convert nested JSON into path-oriented structured text
    """
    fmt = (source_format or "text").strip().lower()
    payload = raw_text or ""
    meta = _coerce_metadata(metadata)

    if fmt == "html":
        text, heading_count = _html_to_structured_text(payload)
        text, heading_count = _apply_case_law_section_markers(
            text=text,
            heading_count=heading_count,
            metadata=meta,
        )
        return ParsedSourceContent(
            text=text,
            source_format="html",
            page_count=max(1, text.count("\f") + 1),
            heading_count=heading_count,
        )

    if fmt == "pdf":
        parsed = _parse_pdf_payload(payload, meta)
        text, heading_count = _apply_case_law_section_markers(
            text=parsed.text,
            heading_count=parsed.heading_count,
            metadata=meta,
        )
        return replace(parsed, text=text, heading_count=heading_count)

    if fmt == "docx":
        parsed = _parse_docx_payload(payload, meta)
        text, heading_count = _apply_case_law_section_markers(
            text=parsed.text,
            heading_count=parsed.heading_count,
            metadata=meta,
        )
        return replace(parsed, text=text, heading_count=heading_count)

    if fmt == "xml":
        text, heading_count, warnings = _xml_to_structured_text(payload)
        text, heading_count = _apply_case_law_section_markers(
            text=text,
            heading_count=heading_count,
            metadata=meta,
        )
        return ParsedSourceContent(
            text=text,
            source_format="xml",
            page_count=max(1, text.count("\f") + 1),
            heading_count=heading_count,
            warnings=warnings,
        )

    if fmt == "json":
        text, heading_count, warnings = _json_to_structured_text(payload)
        text, heading_count = _apply_case_law_section_markers(
            text=text,
            heading_count=heading_count,
            metadata=meta,
        )
        return ParsedSourceContent(
            text=text,
            source_format="json",
            page_count=max(1, text.count("\f") + 1),
            heading_count=heading_count,
            warnings=warnings,
        )

    if fmt == "eml":
        parsed = _parse_eml_payload(payload, meta)
        text, heading_count = _apply_case_law_section_markers(
            text=parsed.text,
            heading_count=parsed.heading_count,
            metadata=meta,
        )
        return replace(parsed, text=text, heading_count=heading_count)

    if fmt == "zip":
        parsed = _parse_zip_payload(payload, meta)
        text, heading_count = _apply_case_law_section_markers(
            text=parsed.text,
            heading_count=parsed.heading_count,
            metadata=meta,
        )
        return replace(parsed, text=text, heading_count=heading_count)

    if fmt in {"png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"}:
        parsed = _parse_image_payload(payload, meta, source_format=fmt)
        text, heading_count = _apply_case_law_section_markers(
            text=parsed.text,
            heading_count=parsed.heading_count,
            metadata=meta,
        )
        return replace(parsed, text=text, heading_count=heading_count)

    text, heading_count = _apply_case_law_section_markers(
        text=payload,
        heading_count=0,
        metadata=meta,
    )
    return ParsedSourceContent(
        text=text,
        source_format="text",
        page_count=max(1, text.count("\f") + 1),
        heading_count=heading_count,
    )
