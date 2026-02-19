"""
Ingest Pipeline — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
=============================================================
Async orchestrator that ties together OCRCleaner, TurkishNormalizer,
LegalParser, and CitationExtractor into a single processing unit.

Pipeline stages:
  1. OCRCleaner.clean()           — artifact removal
  2. TurkishNormalizer.normalize()— encoding / format normalisation
  3. LegalParser.parse()          — structural segmentation
  4. CitationExtractor.extract()  — per-segment citation extraction
  5. IngestResult assembly        — combine + log metrics

All stages are pure Python (no I/O, no external deps) and run synchronously
inside the async def so no event-loop blocking occurs.  For heavy ingest
workloads, wrap in asyncio.get_event_loop().run_in_executor() or Celery.

Usage:
    pipeline = IngestPipeline()
    result = await pipeline.run(raw_text, document_id="uuid-...")
    for seg in result.segments:
        # persist seg to Supabase documents table
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from infrastructure.ingest.ocr_cleaner import OCRCleaner, ocr_cleaner
from infrastructure.ingest.text_normalizer import TurkishNormalizer, turkish_normalizer
from infrastructure.ingest.legal_parser import (
    DocumentType,
    LegalParser,
    ParsedSegment,
    legal_parser,
)
from infrastructure.ingest.citation_extractor import (
    CitationExtractor,
    ExtractedCitation,
    citation_extractor,
)

logger = logging.getLogger("babylexit.ingest.pipeline")


# ============================================================================
# Result Objects
# ============================================================================

@dataclass
class IngestMetadata:
    """Processing statistics attached to every IngestResult."""
    original_char_count: int
    cleaned_char_count: int
    normalized_char_count: int
    segment_count: int
    citation_count: int
    processing_time_ms: int
    document_type: str


@dataclass
class IngestResult:
    """
    Full output of IngestPipeline.run() for a single document.

    All parsed segments and extracted citations are available here.
    The caller (e.g. an async ingest worker) is responsible for
    persisting segments to the Supabase documents table.

    Check ``result.success`` before persisting; if False, ``result.errors``
    describes what went wrong.  Partial results may still be usable
    (e.g. segments with empty citation_refs) when errors are non-fatal.
    """
    document_id: str
    document_type: str                    # DocumentType value
    segments: list[ParsedSegment]
    citations: list[ExtractedCitation]    # All citations across all segments
    metadata: IngestMetadata
    warnings: list[str]                   # Non-fatal quality notes
    errors: list[str]                     # Empty → full success

    @property
    def success(self) -> bool:
        """True when all pipeline stages completed without errors."""
        return len(self.errors) == 0

    @property
    def segment_count(self) -> int:
        return len(self.segments)


# ============================================================================
# IngestPipeline
# ============================================================================

class IngestPipeline:
    """
    Async pipeline: raw text → structured ParsedSegments with citations.

    Accepts injectable component instances for unit testing.
    All four inner components (cleaner, normalizer, parser, extractor)
    default to their module-level settings-configured singletons.

    Usage:
        pipeline = IngestPipeline()
        result = await pipeline.run(raw_text, document_id="uuid-...")
    """

    def __init__(
        self,
        cleaner: Optional[OCRCleaner] = None,
        normalizer: Optional[TurkishNormalizer] = None,
        parser: Optional[LegalParser] = None,
        extractor: Optional[CitationExtractor] = None,
    ) -> None:
        self._cleaner = cleaner or ocr_cleaner
        self._normalizer = normalizer or turkish_normalizer
        self._parser = parser or legal_parser
        self._extractor = extractor or citation_extractor

    async def run(
        self,
        raw_text: str,
        document_id: str,
        doc_type_hint: Optional[DocumentType] = None,
    ) -> IngestResult:
        """
        Process ``raw_text`` for document ``document_id``.

        Args:
            raw_text:      Raw text from PDF extraction, OCR, or copy-paste.
            document_id:   UUID of the document (for logging + IngestResult).
            doc_type_hint: Override auto-detection when type is already known
                           (e.g. the ingest worker already knows it's a kanun).

        Returns:
            IngestResult — always returned even on partial failures.
            Check result.success and result.errors for error handling.
        """
        start_time = time.monotonic()
        warnings: list[str] = []
        errors: list[str] = []
        original_char_count = len(raw_text)

        logger.info(
            "INGEST_START | doc=%s | raw_len=%d",
            document_id, original_char_count,
        )

        # ── Stage 1: OCR cleaning ─────────────────────────────────────────────
        try:
            cleaned_text, ocr_warnings = self._cleaner.clean(raw_text)
            warnings.extend(ocr_warnings)
        except Exception as exc:
            logger.error("OCR_CLEAN_ERROR | doc=%s | %s", document_id, exc, exc_info=True)
            errors.append(f"OCR_CLEAN_ERROR: {exc}")
            cleaned_text = raw_text
            warnings.append("OCR cleaning failed — falling back to raw text.")
        cleaned_char_count = len(cleaned_text)

        # ── Stage 2: Normalisation ────────────────────────────────────────────
        try:
            normalized_text, norm_warnings = self._normalizer.normalize(cleaned_text)
            warnings.extend(norm_warnings)
        except Exception as exc:
            logger.error("NORMALIZE_ERROR | doc=%s | %s", document_id, exc, exc_info=True)
            errors.append(f"NORMALIZE_ERROR: {exc}")
            normalized_text = cleaned_text
            warnings.append("Normalization failed — using cleaned text.")
        normalized_char_count = len(normalized_text)

        # ── Stage 3: Structural parsing ───────────────────────────────────────
        segments: list[ParsedSegment] = []
        document_type = DocumentType.UNKNOWN
        try:
            document_type = doc_type_hint or self._parser.detect_document_type(normalized_text)
            segments = self._parser.parse(normalized_text, document_type)
        except Exception as exc:
            logger.error("PARSE_ERROR | doc=%s | %s", document_id, exc, exc_info=True)
            errors.append(f"PARSE_ERROR: {exc}")
            warnings.append("Structural parsing failed — no segments produced.")

        # ── Stage 4: Citation extraction ──────────────────────────────────────
        all_citations: list[ExtractedCitation] = []
        try:
            for seg in segments:
                seg_citations = self._extractor.extract(seg.text)
                seg.citation_refs = [c.raw_text for c in seg_citations]
                all_citations.extend(seg_citations)
        except Exception as exc:
            logger.error("CITATION_ERROR | doc=%s | %s", document_id, exc, exc_info=True)
            errors.append(f"CITATION_ERROR: {exc}")
            warnings.append("Citation extraction failed — citation_refs will be empty.")

        # ── Stage 5: Assemble result ──────────────────────────────────────────
        processing_time_ms = int((time.monotonic() - start_time) * 1000)
        metadata = IngestMetadata(
            original_char_count=original_char_count,
            cleaned_char_count=cleaned_char_count,
            normalized_char_count=normalized_char_count,
            segment_count=len(segments),
            citation_count=len(all_citations),
            processing_time_ms=processing_time_ms,
            document_type=document_type.value,
        )
        result = IngestResult(
            document_id=document_id,
            document_type=document_type.value,
            segments=segments,
            citations=all_citations,
            metadata=metadata,
            warnings=warnings,
            errors=errors,
        )

        logger.info(
            "INGEST_DONE | doc=%s | type=%s | segments=%d | citations=%d | "
            "warnings=%d | errors=%d | ms=%d",
            document_id, document_type.value,
            len(segments), len(all_citations),
            len(warnings), len(errors), processing_time_ms,
        )
        return result


# Module-level singleton
ingest_pipeline = IngestPipeline()
