"""
Turkish Text Normalizer — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
=====================================================================
Performs Turkish-specific normalization on OCR-cleaned legal document text.

Normalization steps (idempotent, applied in order):
  1. Unicode NFC canonical composition (handles İ/ı/I correctly).
  2. MADDE separator standardization: any dash variant after "MADDE N"
     is replaced with a consistent " – " (space en-dash space) so the
     LegalParser can rely on a single pattern.
  3. Trailing whitespace removal per line.
  4. Paragraph boundary normalization (multiple blank lines → one).
  5. Leading/trailing strip.

This normalizer does NOT alter semantic content — only encoding/format.
It is safe to run on both mevzuat and içtihat text.
"""

from __future__ import annotations

import logging
import re
import unicodedata

logger = logging.getLogger("babylexit.ingest.text_normalizer")

# ── MADDE separator standardization ──────────────────────────────────────────
# Matches "MADDE N" or "Madde N" (optionally "MADDE N/A" sub-articles)
# followed by ANY dash variant (-, –, —) with optional surrounding spaces,
# OR just trailing spaces (no dash), and normalises to " – ".
# Applied AFTER Unicode NFC so dash variants are consistent.
_MADDE_SEP_RE = re.compile(
    r"^((?:MADDE|Madde)\s+\d+(?:[/\.][A-ZÇŞĞÜÖİa-zçşğüöı\d]+)?)"
    r"(?:\s*[-–—]+\s*|\s+)",
    re.MULTILINE | re.UNICODE,
)

# ── Trailing whitespace per line ──────────────────────────────────────────────
_TRAILING_SPACE_RE = re.compile(r"[ \t]+$", re.MULTILINE)

# ── Multiple blank lines → single blank line ──────────────────────────────────
_MULTI_NEWLINE_RE = re.compile(r"\n{2,}")


class TurkishNormalizer:
    """
    Normalises Turkish legal text for downstream structural parsing.

    Usage:
        normalizer = TurkishNormalizer()
        normalized_text, warnings = normalizer.normalize(cleaned_text)

    Idempotent: calling twice on the same text produces the same result.
    """

    def normalize(self, text: str) -> tuple[str, list[str]]:
        """
        Normalises ``text`` for downstream structural parsing.

        Args:
            text: OCR-cleaned text (output of OCRCleaner.clean).

        Returns:
            (normalized_text, warnings)
            An empty input returns ("", []).
        """
        if not text:
            return "", []

        warnings: list[str] = []

        # 1. Unicode NFC — canonical composition.
        #    Ensures İ (U+0130) and ı (U+0131) are in their composed forms.
        text = unicodedata.normalize("NFC", text)

        # 2. Standardize MADDE separators: "MADDE 1 -", "MADDE 1–", "MADDE 1 —"
        #    → "MADDE 1 – " (space + en-dash + space)
        text = _MADDE_SEP_RE.sub(r"\1 – ", text)

        # 3. Trailing whitespace per line
        text = _TRAILING_SPACE_RE.sub("", text)

        # 4. Collapse consecutive blank lines to exactly one blank line
        text = _MULTI_NEWLINE_RE.sub("\n\n", text)

        # 5. Strip
        text = text.strip()

        logger.debug("NORMALIZE | output_len=%d", len(text))
        return text, warnings


# Module-level singleton
turkish_normalizer = TurkishNormalizer()
