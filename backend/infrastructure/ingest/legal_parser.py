"""
Legal Parser — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
=========================================================
Parses normalized Turkish legal text into structural segments.

Two primary document types:

  MEVZUAT  — Turkish legislation (kanun, CBK, yönetmelik, tebliğ)
             Hierarchy: BÖLÜM → MADDE → FIKRA → BENT
             Each MADDE becomes one ParsedSegment (SegmentType.MADDE).
             Long articles (> madde_split_threshold chars) are split into
             individual SegmentType.FIKRA sub-segments.

  ICTIHAT  — Court decisions (Yargıtay, Danıştay, AYM)
             Sections: HEADER → ÖZET / DAVA / GEREKÇE / İNCELEME → KARAR/HÜKÜM
             Header info (esas_no, karar_no, court) stored in segment metadata.

  UNKNOWN  — Neither signal found; whole text returned as SegmentType.FULL.

Segment type string values (SegmentType enum):
  MADDE          — Complete article (primary mevzuat chunk)
  FIKRA          — Paragraph within article (only when article is split)
  BENT           — Sub-item within a fıkra (a), b), c)… format)
  ICTIHAT_HEADER — Court name + case numbers
  ICTIHAT_BODY   — Reasoning / evidence section
  ICTIHAT_HUKUM  — Dispositif (KARAR / HÜKÜM / SONUÇ)
  FULL           — Entire document as one chunk (fallback)

citation_refs on each segment is initially [] — populated by CitationExtractor.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

logger = logging.getLogger("babylexit.ingest.legal_parser")


# ============================================================================
# Enumerations
# ============================================================================

class DocumentType(str, Enum):
    """Auto-detected document classification."""
    MEVZUAT = "MEVZUAT"   # Turkish legislation
    ICTIHAT = "ICTIHAT"   # Court decision
    UNKNOWN = "UNKNOWN"   # Cannot determine


class SegmentType(str, Enum):
    """
    Structural segment type.
    String values are stored in the documents.segment_type DB column.
    """
    MADDE          = "MADDE"
    FIKRA          = "FIKRA"
    BENT           = "BENT"
    ICTIHAT_HEADER = "ICTIHAT_HEADER"
    ICTIHAT_BODY   = "ICTIHAT_BODY"
    ICTIHAT_HUKUM  = "ICTIHAT_HUKUM"
    FULL           = "FULL"


# ============================================================================
# Domain Object
# ============================================================================

@dataclass
class ParsedSegment:
    """
    A single structural unit extracted from a Turkish legal document.

    Designed to map 1:1 to a ``documents`` table row.
    ``citation_refs`` is populated AFTER parsing by CitationExtractor.
    """
    segment_type: str             # SegmentType value
    segment_index: int            # 0-based position within document
    text: str                     # Normalized text of this segment
    madde_no: Optional[str]       # Article number: "17", "17/A"
    fikra_no: Optional[int]       # Paragraph number: 1, 2, 3
    bent_no: Optional[str]        # Sub-item letter: "a", "b"
    citation_refs: list[str]      # Populated by CitationExtractor
    char_start: int               # Character offset in normalized document
    char_end: int                 # Character offset end
    metadata: dict                # Extra: court, esas_no, karar_no, section_keyword

    # ── Step 2: Source Provenance (propagated by IngestPipeline after Stage 3) ──
    source_url: Optional[str] = None
    """Canonical source URL — populated by IngestPipeline.run()."""
    version: Optional[str] = None
    """Version/revision identifier — populated by IngestPipeline.run()."""
    collected_at: Optional[datetime] = None
    """Ingestion timestamp — set to utcnow() by the use-case layer."""


# ============================================================================
# Detection Patterns
# ============================================================================

# MEVZUAT: "MADDE \d+" (case-sensitive) is the primary signal
_MEVZUAT_SIGNAL_RE = re.compile(
    r"(?:^|\n)(?:MADDE|Madde)\s+\d+",
    re.UNICODE,
)

# ICTIHAT: case numbers, court names
_ICTIHAT_SIGNAL_RE = re.compile(
    r"(?:"
    r"Esas\s+No\s*[:/]|"
    r"\bE\.\s*\d{4}/\d+|"
    r"Karar\s+No\s*[:/]|"
    r"\bK\.\s*\d{4}/\d+|"
    r"\bYARGITAY\b|"
    r"\bDANIŞTAY\b|"
    r"ANAYASA\s+MAHKEMESİ|"
    r"BÖLGE\s+ADLİYE\s+MAHKEMESİ"
    r")",
    re.IGNORECASE | re.UNICODE,
)

# MADDE boundary at line start.
# After TurkishNormalizer the separator is " – " (space en-dash space).
# Pattern also handles unnormalized forms (plain hyphen, missing dash).
_MADDE_RE = re.compile(
    r"^((?:MADDE|Madde)\s+(\d+(?:[/\.][A-ZÇŞĞÜÖİa-zçşğüöı\d]+)?)\s*[-–]\s*)",
    re.MULTILINE | re.UNICODE,
)

# FIKRA: "(1) text" at line start — numbered paragraph within a MADDE
_FIKRA_RE = re.compile(
    r"^\((\d+)\)\s",
    re.MULTILINE,
)

# BENT: "a) text", "b) text" at line start — sub-item within a fıkra
# Türkçe alt bent harfleri: a-z + ç ğ ı ş ö ü
# Parantez formatları: "a)" ve "a." desteklenir; önce tek harf, sonra kapatıcı.
_BENT_RE = re.compile(
    r"^([a-zçğışöü])\)\s",
    re.MULTILINE | re.UNICODE,
)

# İçtihat metadata extraction from header region
_ESAS_NO_RE = re.compile(
    r"(?:Esas\s+No|E\.)\s*[:/]?\s*(\d{4}/\d+)",
    re.IGNORECASE | re.UNICODE,
)
_KARAR_NO_RE = re.compile(
    r"(?:Karar\s+No|K\.)\s*[:/]?\s*(\d{4}/\d+)",
    re.IGNORECASE | re.UNICODE,
)
_COURT_NAME_RE = re.compile(
    r"(YARGITAY(?:\s+\d+\.\s+(?:HUKUK|CEZA)\s+DAİRESİ)?|"
    r"DANIŞTAY(?:\s+\d+\.\s+[^\n]{0,40})?|"
    r"ANAYASA\s+MAHKEMESİ|"
    r"BÖLGE\s+ADLİYE\s+MAHKEMESİ[^\n]{0,40})",
    re.IGNORECASE | re.UNICODE,
)

# İçtihat section markers at line start (used to split the decision into sections)
_SECTION_MARKERS_RE = re.compile(
    r"^(ÖZET|DAVA|GEREKÇE|İNCELEME|MADDİ\s+OLAY|"
    r"KARAR|HÜKÜM|SONUÇ)\s*[:\-–]?\s*",
    re.MULTILINE | re.IGNORECASE | re.UNICODE,
)

# Keywords that identify the dispositif section
_HUKUM_KEYWORDS: frozenset[str] = frozenset({"KARAR", "HÜKÜM", "SONUÇ"})


# ============================================================================
# LegalParser
# ============================================================================

class LegalParser:
    """
    Parses normalized Turkish legal text into a flat list of ParsedSegment objects.

    Usage:
        parser = LegalParser()
        segments = parser.parse(normalized_text)

    Auto-detects document type; override with doc_type parameter.

    Args:
        min_segment_chars:      Minimum chars for a segment to be kept.
        madde_split_threshold:  MADDE segments longer than this are split into
                                FIKRA-level sub-segments.
    """

    def __init__(
        self,
        min_segment_chars: int = 50,
        madde_split_threshold: int = 4000,
    ) -> None:
        self._min_chars = min_segment_chars
        self._split_threshold = madde_split_threshold

    def detect_document_type(self, text: str) -> DocumentType:
        """
        Heuristically classifies a document as MEVZUAT, ICTIHAT, or UNKNOWN.

        MEVZUAT takes priority when "MADDE \\d+" is present (stronger signal).
        ICTIHAT is detected from case numbers (Esas No, K.) or court names.
        UNKNOWN when neither pattern matches (e.g. plain prose or short snippets).
        """
        if _MEVZUAT_SIGNAL_RE.search(text):
            return DocumentType.MEVZUAT
        if _ICTIHAT_SIGNAL_RE.search(text):
            return DocumentType.ICTIHAT
        return DocumentType.UNKNOWN

    def parse(
        self,
        text: str,
        doc_type: Optional[DocumentType] = None,
    ) -> list[ParsedSegment]:
        """
        Parses ``text`` into structural segments.

        Args:
            text:     Normalized text (after OCRCleaner + TurkishNormalizer).
            doc_type: Override auto-detection when document type is already known.

        Returns:
            List[ParsedSegment] ordered by char_start.
            Empty list for empty/whitespace-only input.
        """
        if not text or not text.strip():
            return []

        dtype = doc_type if doc_type is not None else self.detect_document_type(text)
        logger.debug("PARSE | doc_type=%s | len=%d", dtype.value, len(text))

        if dtype == DocumentType.MEVZUAT:
            return self._parse_mevzuat(text)
        if dtype == DocumentType.ICTIHAT:
            return self._parse_ictihat(text)
        # UNKNOWN — whole text as a single FULL segment
        return [
            ParsedSegment(
                segment_type=SegmentType.FULL.value,
                segment_index=0,
                text=text.strip(),
                madde_no=None,
                fikra_no=None,
                bent_no=None,
                citation_refs=[],
                char_start=0,
                char_end=len(text),
                metadata={},
            )
        ]

    # ── Private: MEVZUAT parsing ──────────────────────────────────────────────

    def _parse_mevzuat(self, text: str) -> list[ParsedSegment]:
        """
        Splits mevzuat text on MADDE boundaries.

        - Short articles (≤ madde_split_threshold chars): one MADDE segment.
        - Long articles (> threshold): one FIKRA segment per fıkra found.
          If no explicit fıkra markers, the whole article is kept as MADDE.
        """
        segments: list[ParsedSegment] = []
        boundaries = list(_MADDE_RE.finditer(text))

        if not boundaries:
            logger.warning("MEVZUAT detected but no MADDE boundaries found — returning FULL.")
            return [
                ParsedSegment(
                    segment_type=SegmentType.FULL.value,
                    segment_index=0,
                    text=text.strip(),
                    madde_no=None, fikra_no=None, bent_no=None,
                    citation_refs=[], char_start=0, char_end=len(text),
                    metadata={"parse_note": "no_madde_boundaries"},
                )
            ]

        for i, match in enumerate(boundaries):
            madde_no = match.group(2)
            seg_start = match.start()
            seg_end = boundaries[i + 1].start() if i + 1 < len(boundaries) else len(text)
            seg_text = text[seg_start:seg_end].strip()

            if len(seg_text) < self._min_chars:
                logger.debug("SKIP_SHORT | madde=%s | len=%d", madde_no, len(seg_text))
                continue

            if len(seg_text) > self._split_threshold:
                sub = self._split_into_fikralar(seg_text, madde_no, seg_start, len(segments))
                segments.extend(sub)
            else:
                fikra_count = len(_FIKRA_RE.findall(seg_text))
                # Short MADDE: try direct bent detection (no explicit fıkra markers)
                bent_segs = self._split_fikra_into_bentler(
                    fikra_text=seg_text,
                    madde_no=madde_no,
                    fikra_no=None,
                    char_offset=seg_start,
                    base_index=len(segments),
                )
                if bent_segs:
                    segments.extend(bent_segs)
                else:
                    segments.append(
                        ParsedSegment(
                            segment_type=SegmentType.MADDE.value,
                            segment_index=len(segments),
                            text=seg_text,
                            madde_no=madde_no,
                            fikra_no=None,
                            bent_no=None,
                            citation_refs=[],
                            char_start=seg_start,
                            char_end=seg_end,
                            metadata={"fikra_count": fikra_count},
                        )
                    )

        logger.info(
            "MEVZUAT_PARSED | boundaries=%d | segments=%d",
            len(boundaries), len(segments),
        )
        return segments

    def _split_into_fikralar(
        self,
        madde_text: str,
        madde_no: str,
        char_offset: int,
        base_index: int,
    ) -> list[ParsedSegment]:
        """
        Splits a long MADDE into FIKRA-level segments.
        Returns [MADDE segment] when no fıkra markers are found.
        """
        fikra_matches = list(_FIKRA_RE.finditer(madde_text))

        if not fikra_matches:
            return [
                ParsedSegment(
                    segment_type=SegmentType.MADDE.value,
                    segment_index=base_index,
                    text=madde_text,
                    madde_no=madde_no,
                    fikra_no=None, bent_no=None,
                    citation_refs=[],
                    char_start=char_offset,
                    char_end=char_offset + len(madde_text),
                    metadata={"fikra_count": 0, "split_reason": "long_madde_no_fikra"},
                )
            ]

        sub_segments: list[ParsedSegment] = []
        for j, fm in enumerate(fikra_matches):
            fikra_no = int(fm.group(1))
            f_start = fm.start()
            f_end = (
                fikra_matches[j + 1].start()
                if j + 1 < len(fikra_matches)
                else len(madde_text)
            )
            fikra_text = madde_text[f_start:f_end].strip()

            if len(fikra_text) < self._min_chars:
                continue

            # Try to split this fıkra into BENT sub-items
            bent_segs = self._split_fikra_into_bentler(
                fikra_text=fikra_text,
                madde_no=madde_no,
                fikra_no=fikra_no,
                char_offset=char_offset + f_start,
                base_index=base_index + len(sub_segments),
            )
            if bent_segs:
                sub_segments.extend(bent_segs)
            else:
                sub_segments.append(
                    ParsedSegment(
                        segment_type=SegmentType.FIKRA.value,
                        segment_index=base_index + len(sub_segments),
                        text=fikra_text,
                        madde_no=madde_no,
                        fikra_no=fikra_no,
                        bent_no=None,
                        citation_refs=[],
                        char_start=char_offset + f_start,
                        char_end=char_offset + f_end,
                        metadata={"madde_no": madde_no},
                    )
                )

        return sub_segments

    def _split_fikra_into_bentler(
        self,
        fikra_text: str,
        madde_no: Optional[str],
        fikra_no: Optional[int],
        char_offset: int,
        base_index: int,
    ) -> list[ParsedSegment]:
        """
        Bir fıkra metnini BENT alt-segmentlerine böler.

        ``a) …``, ``b) …``, ``c) …`` formatındaki bent başlıklarını tanır.
        Hiç bent bulunamazsa boş liste döndürür (çağıran orijinal tipi korur).

        Args:
            fikra_text:  Bölünecek fıkra metni.
            madde_no:    Üst madde numarası (örn. "17").
            fikra_no:    Üst fıkra numarası; doğrudan bent içeren maddeler için None.
            char_offset: Orijinal belgede fikra_text'in başlangıç konumu.
            base_index:  İlk BENT segmentine verilecek segment_index.

        Returns:
            List[ParsedSegment] with segment_type=BENT; boş liste yoksa bent yok.
        """
        bent_matches = list(_BENT_RE.finditer(fikra_text))
        if not bent_matches:
            return []

        sub: list[ParsedSegment] = []
        for j, bm in enumerate(bent_matches):
            bent_letter = bm.group(1)
            b_start = bm.start()
            b_end = (
                bent_matches[j + 1].start()
                if j + 1 < len(bent_matches)
                else len(fikra_text)
            )
            bent_text = fikra_text[b_start:b_end].strip()

            if len(bent_text) < self._min_chars:
                logger.debug(
                    "SKIP_SHORT_BENT | madde=%s | fikra=%s | bent=%s | len=%d",
                    madde_no, fikra_no, bent_letter, len(bent_text),
                )
                continue

            sub.append(
                ParsedSegment(
                    segment_type=SegmentType.BENT.value,
                    segment_index=base_index + len(sub),
                    text=bent_text,
                    madde_no=madde_no,
                    fikra_no=fikra_no,
                    bent_no=bent_letter,
                    citation_refs=[],
                    char_start=char_offset + b_start,
                    char_end=char_offset + b_end,
                    metadata={"madde_no": madde_no, "fikra_no": fikra_no},
                )
            )

        logger.debug(
            "BENT_SPLIT | madde=%s | fikra=%s | bentler=%d",
            madde_no, fikra_no, len(sub),
        )
        return sub

    # ── Private: ICTIHAT parsing ──────────────────────────────────────────────

    def _parse_ictihat(self, text: str) -> list[ParsedSegment]:
        """
        Splits an içtihat (court decision) into structural sections.

        Produces:
          - ICTIHAT_HEADER  — court info + case numbers (before first section marker)
          - ICTIHAT_BODY    — ÖZET, DAVA, GEREKÇE, İNCELEME sections
          - ICTIHAT_HUKUM   — KARAR, HÜKÜM, SONUÇ (dispositif)

        Metadata on every segment contains: esas_no, karar_no, court.
        """
        segments: list[ParsedSegment] = []

        # Extract structured metadata from the first 600 chars (header region)
        header_region = text[:600]
        esas_m = _ESAS_NO_RE.search(header_region)
        karar_m = _KARAR_NO_RE.search(header_region)
        court_m = _COURT_NAME_RE.search(header_region)
        base_meta: dict = {
            "esas_no": esas_m.group(1) if esas_m else None,
            "karar_no": karar_m.group(1) if karar_m else None,
            "court": court_m.group(1) if court_m else None,
        }

        section_matches = list(_SECTION_MARKERS_RE.finditer(text))

        if not section_matches:
            # No recognisable section markers — whole decision as one body segment
            return [
                ParsedSegment(
                    segment_type=SegmentType.ICTIHAT_BODY.value,
                    segment_index=0,
                    text=text.strip(),
                    madde_no=None, fikra_no=None, bent_no=None,
                    citation_refs=[],
                    char_start=0, char_end=len(text),
                    metadata=base_meta,
                )
            ]

        # Header = text from 0 to first section marker
        header_end = section_matches[0].start()
        if header_end > self._min_chars:
            segments.append(
                ParsedSegment(
                    segment_type=SegmentType.ICTIHAT_HEADER.value,
                    segment_index=0,
                    text=text[:header_end].strip(),
                    madde_no=None, fikra_no=None, bent_no=None,
                    citation_refs=[],
                    char_start=0, char_end=header_end,
                    metadata=base_meta,
                )
            )

        # Each marked section
        for i, sm in enumerate(section_matches):
            sec_start = sm.start()
            sec_end = (
                section_matches[i + 1].start()
                if i + 1 < len(section_matches)
                else len(text)
            )
            sec_text = text[sec_start:sec_end].strip()

            if len(sec_text) < self._min_chars:
                continue

            keyword = sm.group(1).upper().strip()
            seg_type = (
                SegmentType.ICTIHAT_HUKUM.value
                if keyword in _HUKUM_KEYWORDS
                else SegmentType.ICTIHAT_BODY.value
            )

            segments.append(
                ParsedSegment(
                    segment_type=seg_type,
                    segment_index=len(segments),
                    text=sec_text,
                    madde_no=None, fikra_no=None, bent_no=None,
                    citation_refs=[],
                    char_start=sec_start, char_end=sec_end,
                    metadata={**base_meta, "section_keyword": keyword},
                )
            )

        logger.info(
            "ICTIHAT_PARSED | sections=%d | segments=%d | esas=%s",
            len(section_matches), len(segments), base_meta.get("esas_no"),
        )
        return segments


# ── Module-level singleton ────────────────────────────────────────────────────
from infrastructure.config import settings  # noqa: E402

legal_parser = LegalParser(
    min_segment_chars=settings.ingest_min_segment_chars,
    madde_split_threshold=settings.ingest_madde_split_threshold,
)
