"""
Citation Extractor — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
================================================================
Extracts legal citations from normalized Turkish legal text using regex patterns.

Detected citation types (CitationType enum):
  KANUN_NO      — "4857 sayılı"  (law number references)
  MADDE_REF     — "md. 17", "17. maddesi", "madde 17"
  YARGITAY      — "Yargıtay 9. HD, E. 2023/1234, K. 2024/5678"
                  Also covers IBK, HGK, CGK
  DANISTAY      — "Danıştay 4. Dairesi, E. 2023/123, K. 2024/456"
  AYM           — "AYM, E. 2022/45, K. 2023/78"
  RESMI_GAZETE  — "RG. 01.01.2024, S. 32456"
  UNKNOWN       — Matched only by a fallback (currently unused)

Patterns are applied in order of SPECIFICITY (most specific first) to avoid
double-counting overlapping matches. After extraction, overlapping matches
are de-duplicated keeping the larger span.

Usage:
    extractor = CitationExtractor()
    citations = extractor.extract(segment_text)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional

logger = logging.getLogger("babylexit.ingest.citation_extractor")


# ============================================================================
# Enumerations
# ============================================================================

class CitationType(str, Enum):
    KANUN_NO     = "KANUN_NO"
    MADDE_REF    = "MADDE_REF"
    YARGITAY     = "YARGITAY"
    DANISTAY     = "DANISTAY"
    AYM          = "AYM"
    RESMI_GAZETE = "RESMI_GAZETE"
    UNKNOWN      = "UNKNOWN"


# ============================================================================
# Domain Object
# ============================================================================

@dataclass
class ExtractedCitation:
    """A single legal citation found within a text segment."""
    raw_text: str                         # The matched text as it appears in source
    citation_type: str                    # CitationType value
    kanun_no: Optional[str] = None        # "4857"
    madde_ref: Optional[str] = None       # "17" or "17/1"
    court_name: Optional[str] = None      # "Yargıtay 9. HD"
    esas_no: Optional[str] = None         # "2023/1234"
    karar_no: Optional[str] = None        # "2024/5678"
    char_start: int = 0
    char_end: int = 0


# ============================================================================
# Compiled Patterns — most specific first
# ============================================================================

# AYM / Anayasa Mahkemesi
_AYM_RE = re.compile(
    r"(?:AYM|Anayasa\s+Mahkemesi)"
    r"[^,;\n]{0,20}?"
    r"(?:,\s*)?"
    r"(?:E\.\s*(\d{4}/\d+))"
    r"(?:[^,;\n]{0,20}?,?\s*K\.\s*(\d{4}/\d+))?",
    re.IGNORECASE | re.UNICODE,
)

# Yargıtay İçtihadı Birleştirme Kurulu
_IBK_RE = re.compile(
    r"Yargıtay\s+(?:İBK|İçtihadı\s+Birleştirme\s+Kurulu)"
    r"[^,;\n]{0,50}?"
    r"(?:,?\s*E\.\s*(\d{4}/\d+))?"
    r"(?:[^,;\n]{0,20}?,?\s*K\.\s*(\d{4}/\d+))?",
    re.IGNORECASE | re.UNICODE,
)

# Yargıtay HGK / CGK
_HGK_RE = re.compile(
    r"Yargıtay\s+(?:HGK|CGK|Hukuk\s+Genel\s+Kurulu|Ceza\s+Genel\s+Kurulu)"
    r"[^,;\n]{0,50}?"
    r"(?:,?\s*E\.\s*(\d{4}/\d+))?"
    r"(?:[^,;\n]{0,20}?,?\s*K\.\s*(\d{4}/\d+))?",
    re.IGNORECASE | re.UNICODE,
)

# Regular Yargıtay chamber decision (must come AFTER IBK/HGK patterns)
_YARGITAY_RE = re.compile(
    r"Yargıtay\s+\d+\.\s+(?:Hukuk\s+Dairesi|Ceza\s+Dairesi|HD|CD)"
    r"[^,;\n]{0,30}?"
    r"(?:,\s*E\.\s*(\d{4}/\d+))?"
    r"(?:[^,;\n]{0,20}?,?\s*K\.\s*(\d{4}/\d+))?",
    re.IGNORECASE | re.UNICODE,
)

# Danıştay
_DANISTAY_RE = re.compile(
    r"Danıştay\s+(?:\d+\.\s+)?(?:Dairesi|Daire|İdari\s+Dava\s+Daireleri\s+Kurulu|IDDK)?"
    r"[^,;\n]{0,30}?"
    r"(?:,?\s*E\.\s*(\d{4}/\d+))?"
    r"(?:[^,;\n]{0,20}?,?\s*K\.\s*(\d{4}/\d+))?",
    re.IGNORECASE | re.UNICODE,
)

# Kanun number: "4857 sayılı"
# Simplified: capture the 4-digit number followed by "sayılı" (any law type follows)
_KANUN_NO_RE = re.compile(
    r"\b(\d{4})\s+sayılı\b",
    re.UNICODE,
)

# Madde reference — various Turkish legal forms:
#   "md. 17", "madde 17", "m. 17"
#   "17. maddesi", "3. fıkrası"
_MADDE_REF_RE = re.compile(
    r"(?:"
    r"\b(?:md\.|madde|m\.)\s*(\d+(?:[/\.]\d+)?)"   # md. 17 / madde 17
    r"|"
    r"(\d+)\.\s*(?:maddesi|fıkrası|bendi)"           # 17. maddesi / 3. fıkrası
    r")",
    re.IGNORECASE | re.UNICODE,
)

# Resmî Gazete
_RG_RE = re.compile(
    r"(?:RG|Resmî\s*Gazete)\s*[.,]?\s*"
    r"(\d{2}\.\d{2}\.\d{4})"
    r"(?:[^,;\n]{0,20}?S\.\s*(\d+))?",
    re.IGNORECASE | re.UNICODE,
)


# ============================================================================
# CitationExtractor
# ============================================================================

class CitationExtractor:
    """
    Extracts legal citations from Turkish legal text using regex patterns.

    Usage:
        extractor = CitationExtractor()
        citations = extractor.extract(segment_text)
        # citations is List[ExtractedCitation] sorted by char_start
    """

    def extract(self, text: str) -> list[ExtractedCitation]:
        """
        Extracts all legal citations from ``text``.

        Args:
            text: Normalized segment text.

        Returns:
            List[ExtractedCitation] sorted by char_start.
            Empty list if no citations found or text is empty.
        """
        if not text:
            return []

        results: list[ExtractedCitation] = []

        # Apply patterns in order of specificity (most specific first)
        results.extend(self._extract_aym(text))
        results.extend(self._extract_ibk(text))
        results.extend(self._extract_hgk(text))
        results.extend(self._extract_yargitay(text))
        results.extend(self._extract_danistay(text))
        results.extend(self._extract_kanun_no(text))
        results.extend(self._extract_madde_refs(text))
        results.extend(self._extract_rg(text))

        # De-duplicate overlapping matches
        results = _dedup_citations(results)
        results.sort(key=lambda c: c.char_start)

        logger.debug("CITATIONS | found=%d | text_len=%d", len(results), len(text))
        return results

    # ── Pattern-specific extractors ───────────────────────────────────────────

    def _extract_aym(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.AYM.value,
                court_name="Anayasa Mahkemesi",
                esas_no=m.group(1),
                karar_no=m.group(2),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _AYM_RE.finditer(text)
        ]

    def _extract_ibk(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.YARGITAY.value,
                court_name="Yargıtay İBK",
                esas_no=m.group(1),
                karar_no=m.group(2),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _IBK_RE.finditer(text)
        ]

    def _extract_hgk(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.YARGITAY.value,
                court_name=m.group(0).split(",")[0].strip(),
                esas_no=m.group(1),
                karar_no=m.group(2),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _HGK_RE.finditer(text)
        ]

    def _extract_yargitay(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.YARGITAY.value,
                court_name=m.group(0).split(",")[0].strip(),
                esas_no=m.group(1),
                karar_no=m.group(2),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _YARGITAY_RE.finditer(text)
        ]

    def _extract_danistay(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.DANISTAY.value,
                court_name=m.group(0).split(",")[0].strip(),
                esas_no=m.group(1),
                karar_no=m.group(2),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _DANISTAY_RE.finditer(text)
        ]

    def _extract_kanun_no(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.KANUN_NO.value,
                kanun_no=m.group(1),
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _KANUN_NO_RE.finditer(text)
        ]

    def _extract_madde_refs(self, text: str) -> list[ExtractedCitation]:
        results = []
        for m in _MADDE_REF_RE.finditer(text):
            madde_no = m.group(1) or m.group(2)
            results.append(
                ExtractedCitation(
                    raw_text=m.group(0),
                    citation_type=CitationType.MADDE_REF.value,
                    madde_ref=madde_no,
                    char_start=m.start(),
                    char_end=m.end(),
                )
            )
        return results

    def _extract_rg(self, text: str) -> list[ExtractedCitation]:
        return [
            ExtractedCitation(
                raw_text=m.group(0),
                citation_type=CitationType.RESMI_GAZETE.value,
                char_start=m.start(),
                char_end=m.end(),
            )
            for m in _RG_RE.finditer(text)
        ]


# ============================================================================
# De-duplication helper (module-level pure function)
# ============================================================================

def _dedup_citations(citations: list[ExtractedCitation]) -> list[ExtractedCitation]:
    """
    Remove overlapping citations, keeping the one with the larger character span.

    Uses a greedy sweep: sort by start position (ties broken by span length
    descending), then skip any citation whose start overlaps the previous kept one.
    """
    if len(citations) <= 1:
        return citations

    sorted_cits = sorted(
        citations,
        key=lambda c: (c.char_start, -(c.char_end - c.char_start)),
    )
    kept: list[ExtractedCitation] = []
    last_end = -1

    for cit in sorted_cits:
        if cit.char_start >= last_end:
            kept.append(cit)
            last_end = cit.char_end
        else:
            # Overlap: replace kept entry if this one has a larger span
            if kept and (cit.char_end - cit.char_start) > (kept[-1].char_end - kept[-1].char_start):
                kept[-1] = cit
                last_end = cit.char_end

    return kept


# Module-level singleton
citation_extractor = CitationExtractor()
