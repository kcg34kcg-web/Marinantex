"""Parser orchestration layer with optional Docling/MinerU/PaddleOCR-VL engines."""

from __future__ import annotations

import base64
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from infrastructure.config import settings
from infrastructure.rag_v3.source_parser import ParsedSourceContent, parse_source_content

_B64_COMPACT_RE = re.compile(r"[ \t\r\n]+")
_IMAGE_FORMATS = frozenset({"png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"})


@dataclass(frozen=True)
class ParserAttemptResult:
    parsed: Optional[ParsedSourceContent]
    warning: Optional[str] = None


class RagV3ParserOrchestrator:
    """Dispatches parse requests across optional parser engines with safe fallback."""

    def parse(
        self,
        *,
        raw_text: str,
        source_format: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ParsedSourceContent:
        fmt = str(source_format or "text").strip().lower()
        meta = dict(metadata or {})
        if not bool(getattr(settings, "rag_v3_parser_orchestration_enabled", True)):
            parsed = parse_source_content(raw_text, fmt, metadata=meta)
            return self._attach_engine_warning(parsed, "builtin")

        engine_order = self._resolve_engine_order(fmt)
        warnings: list[str] = []
        for engine in engine_order:
            attempt = self._attempt_with_engine(
                engine=engine,
                raw_text=raw_text,
                source_format=fmt,
                metadata=meta,
            )
            if attempt.warning:
                warnings.append(attempt.warning)
            parsed = attempt.parsed
            if parsed is None or not str(parsed.text or "").strip():
                continue
            return self._attach_engine_warning(parsed, engine, extra_warnings=warnings)

        fallback = parse_source_content(raw_text, fmt, metadata=meta)
        warnings.append("PARSER_ORCHESTRATION_FALLBACK")
        return self._attach_engine_warning(fallback, "builtin", extra_warnings=warnings)

    def _resolve_engine_order(self, source_format: str) -> list[str]:
        configured = str(getattr(settings, "rag_v3_parser_engine_order", "") or "").strip().lower()
        base = [item.strip() for item in configured.split(",") if item.strip()]
        if not base:
            base = ["mineru", "docling", "paddleocr_vl", "builtin"]

        fmt = str(source_format or "").strip().lower()
        if fmt in {"json", "xml", "text"}:
            return ["builtin"]
        if fmt in {"html", "docx", "eml", "zip"}:
            # OCR engines are unnecessary for born-digital structured docs.
            preferred = [item for item in base if item in {"docling", "builtin"}]
            return preferred or ["builtin"]
        if fmt == "pdf" or fmt in _IMAGE_FORMATS:
            # OCR-heavy formats should still preserve deterministic local fallback.
            return [item for item in base if item in {"mineru", "docling", "paddleocr_vl", "builtin"}] or ["builtin"]
        return ["builtin"]

    def _attempt_with_engine(
        self,
        *,
        engine: str,
        raw_text: str,
        source_format: str,
        metadata: dict[str, Any],
    ) -> ParserAttemptResult:
        token = str(engine or "").strip().lower()
        if token == "builtin":
            return ParserAttemptResult(parsed=parse_source_content(raw_text, source_format, metadata=metadata))
        if token == "docling":
            if not bool(getattr(settings, "rag_v3_parser_docling_enabled", True)):
                return ParserAttemptResult(parsed=None, warning="DOCLING_DISABLED_BY_CONFIG")
            return self._try_docling(raw_text=raw_text, source_format=source_format, metadata=metadata)
        if token == "mineru":
            if not bool(getattr(settings, "rag_v3_parser_mineru_enabled", True)):
                return ParserAttemptResult(parsed=None, warning="MINERU_DISABLED_BY_CONFIG")
            return self._try_mineru(raw_text=raw_text, source_format=source_format, metadata=metadata)
        if token == "paddleocr_vl":
            if not bool(getattr(settings, "rag_v3_parser_paddleocr_vl_enabled", True)):
                return ParserAttemptResult(parsed=None, warning="PADDLEOCR_VL_DISABLED_BY_CONFIG")
            return self._try_paddleocr_vl(raw_text=raw_text, source_format=source_format, metadata=metadata)
        return ParserAttemptResult(parsed=None, warning=f"PARSER_ENGINE_UNKNOWN:{token}")

    def _try_docling(
        self,
        *,
        raw_text: str,
        source_format: str,
        metadata: dict[str, Any],
    ) -> ParserAttemptResult:
        try:
            from docling.document_converter import DocumentConverter  # type: ignore[import-untyped]
        except Exception:
            return ParserAttemptResult(parsed=None, warning="DOCLING_ENGINE_UNAVAILABLE")

        suffix = self._suffix_for_format(source_format)
        payload = self._binary_payload(raw_text, metadata)
        if payload is None:
            payload = str(raw_text or "").encode("utf-8", errors="ignore")
        if not payload:
            return ParserAttemptResult(parsed=None, warning="DOCLING_EMPTY_PAYLOAD")

        converter = DocumentConverter()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as temp_file:
            temp_file.write(payload)
            temp_file.flush()
            try:
                result = converter.convert(temp_file.name)
            except Exception:
                return ParserAttemptResult(parsed=None, warning="DOCLING_PARSE_FAILED")

        text = ""
        try:
            text = str(result.document.export_to_markdown() or "").strip()
        except Exception:
            try:
                text = str(result.document.export_to_text() or "").strip()
            except Exception:
                text = ""
        if not text:
            return ParserAttemptResult(parsed=None, warning="DOCLING_EMPTY_OUTPUT")
        heading_count = text.count("\n# ")
        parsed = ParsedSourceContent(
            text=text,
            source_format=source_format,
            page_count=max(1, text.count("\f") + 1),
            heading_count=max(0, heading_count),
            warnings=[],
        )
        return ParserAttemptResult(parsed=parsed)

    def _try_mineru(
        self,
        *,
        raw_text: str,
        source_format: str,
        metadata: dict[str, Any],
    ) -> ParserAttemptResult:
        # MinerU APIs evolve frequently; this adapter is best-effort and fail-safe.
        try:
            import mineru  # type: ignore[import-not-found,import-untyped]  # noqa: F401
        except Exception:
            return ParserAttemptResult(parsed=None, warning="MINERU_ENGINE_UNAVAILABLE")

        # If MinerU import succeeds but no stable public adapter exists, use deterministic fallback.
        parsed = parse_source_content(raw_text, source_format, metadata=metadata)
        return ParserAttemptResult(parsed=parsed, warning="MINERU_ADAPTER_FALLBACK_TO_BUILTIN")

    def _try_paddleocr_vl(
        self,
        *,
        raw_text: str,
        source_format: str,
        metadata: dict[str, Any],
    ) -> ParserAttemptResult:
        try:
            from paddleocr import PaddleOCR  # type: ignore[import-not-found,import-untyped]  # noqa: F401
        except Exception:
            return ParserAttemptResult(parsed=None, warning="PADDLEOCR_VL_ENGINE_UNAVAILABLE")

        # Keep parser deterministic if PaddleOCR model/runtime is not pre-warmed.
        parsed = parse_source_content(raw_text, source_format, metadata=metadata)
        return ParserAttemptResult(parsed=parsed, warning="PADDLEOCR_VL_ADAPTER_FALLBACK_TO_BUILTIN")

    @staticmethod
    def _attach_engine_warning(
        parsed: ParsedSourceContent,
        engine: str,
        *,
        extra_warnings: Optional[list[str]] = None,
    ) -> ParsedSourceContent:
        warnings = list(parsed.warnings or [])
        warnings.append(f"PARSER_ENGINE:{str(engine or 'builtin').upper()}")
        if extra_warnings:
            warnings.extend(extra_warnings)
        return ParsedSourceContent(
            text=parsed.text,
            source_format=parsed.source_format,
            page_count=parsed.page_count,
            heading_count=parsed.heading_count,
            warnings=list(dict.fromkeys(warnings)),
            ocr_used=parsed.ocr_used,
            ocr_confidence=parsed.ocr_confidence,
            ocr_engine=parsed.ocr_engine,
        )

    @staticmethod
    def _suffix_for_format(source_format: str) -> str:
        token = str(source_format or "txt").strip().lower()
        mapping = {
            "pdf": ".pdf",
            "docx": ".docx",
            "html": ".html",
            "xml": ".xml",
            "json": ".json",
            "eml": ".eml",
            "zip": ".zip",
            "png": ".png",
            "jpg": ".jpg",
            "jpeg": ".jpeg",
            "tif": ".tif",
            "tiff": ".tiff",
            "bmp": ".bmp",
            "webp": ".webp",
        }
        return mapping.get(token, ".txt")

    @staticmethod
    def _binary_payload(raw_text: str, metadata: dict[str, Any]) -> Optional[bytes]:
        for key in ("binary_base64", "file_base64", "payload_base64"):
            candidate = str(metadata.get(key) or "").strip()
            blob = RagV3ParserOrchestrator._decode_b64(candidate)
            if blob is not None:
                return blob
        return RagV3ParserOrchestrator._decode_b64(raw_text)

    @staticmethod
    def _decode_b64(value: str) -> Optional[bytes]:
        token = str(value or "").strip()
        if not token:
            return None
        if token.lower().startswith("base64:"):
            token = token[7:].strip()
        if token.lower().startswith("data:") and "," in token:
            token = token.split(",", 1)[1].strip()
        compact = _B64_COMPACT_RE.sub("", token)
        if len(compact) < 64:
            return None
        try:
            return base64.b64decode(compact, validate=True)
        except Exception:
            return None


rag_v3_parser_orchestrator = RagV3ParserOrchestrator()
