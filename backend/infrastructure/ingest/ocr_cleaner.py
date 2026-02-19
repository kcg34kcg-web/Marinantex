"""
OCR Cleaner — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
=========================================================
Removes OCR and PDF-extraction artifacts from raw Turkish legal document text.

Designed for text extracted from:
  - PDF/A legal databases (Resmî Gazete, Legalbank, Kazancı)
  - Scanned court decisions (Yargıtay, Danıştay, AYM arşivleri)
  - Copy-pasted mevzuat text with encoding issues

Cleaning pipeline (applied in order):
  1. Remove null bytes and non-printable control characters.
  2. Replace typography ligatures (ﬁ→fi, ﬀ→ff) and invisible chars.
  3. Rejoin line-break hyphenation ("hak-\\nkında" → "hakkında").
  4. Strip isolated page numbers.
  5. Strip common PDF header/footer lines.
  6. Normalise horizontal whitespace (tabs, multiple spaces → single space).
  7. Normalise vertical whitespace (3+ consecutive newlines → 2).
  8. Strip leading/trailing whitespace.

Returns:
    (cleaned_text: str, warnings: list[str])

This cleaner is PURE TEXT — no linguistic analysis, no external deps.
It is idempotent: calling it twice gives the same result.
"""

from __future__ import annotations

import logging
import re
import unicodedata

logger = logging.getLogger("babylexit.ingest.ocr_cleaner")

# ── Ligature and special character replacement map ────────────────────────────
# Maps known OCR/font artifacts to correct Unicode representations.
_CHAR_MAP: dict[str, str] = {
    # Typography ligatures — common in professional Turkish PDF fonts
    "\ufb01": "fi",    # ﬁ  fi ligature
    "\ufb00": "ff",    # ﬀ  ff ligature
    "\ufb02": "fl",    # ﬂ  fl ligature
    "\ufb03": "ffi",   # ﬃ  ffi ligature
    "\ufb04": "ffl",   # ﬄ  ffl ligature
    "\ufb05": "st",    # ﬅ  st ligature
    "\ufb06": "st",    # ﬆ  st ligature
    # Invisible / zero-width characters
    "\u00ad": "",      # soft hyphen — remove entirely
    "\u200b": "",      # zero-width space
    "\u200c": "",      # zero-width non-joiner
    "\u200d": "",      # zero-width joiner
    "\ufeff": "",      # BOM (byte-order mark)
    # Smart / curly quotes → straight quotes
    "\u201c": '"',     # LEFT DOUBLE QUOTATION MARK
    "\u201d": '"',     # RIGHT DOUBLE QUOTATION MARK
    "\u2018": "'",     # LEFT SINGLE QUOTATION MARK
    "\u2019": "'",     # RIGHT SINGLE QUOTATION MARK
    # Unusual spaces
    "\u00a0": " ",     # non-breaking space → regular space
    "\u2009": " ",     # thin space
    "\u202f": " ",     # narrow no-break space
}

# ── Page number pattern ────────────────────────────────────────────────────────
# Matches an entire line that contains ONLY a page number (e.g. "– 45 –", "45")
_PAGE_NUMBER_RE = re.compile(
    r"^[ \t]*[-–—]?[ \t]*\d{1,4}[ \t]*[-–—]?[ \t]*$",
    re.MULTILINE,
)

# ── Common PDF header/footer lines ────────────────────────────────────────────
_HEADER_FOOTER_RE = re.compile(
    r"^[ \t]*(?:"
    r"Resmî?\s*Gazete[^\n]*|"          # "Resmî Gazete  24.05.2003  Sayı: ..."
    r"www\.[a-zA-Z0-9._/%-]+|"         # URLs
    r"Sayfa\s+\d+\s*/\s*\d+[^\n]*|"   # "Sayfa 3/15"
    r"T\.C\.\s*$"                       # Lone "T.C." on its own line
    r")[ \t]*$",
    re.MULTILINE | re.IGNORECASE,
)

# ── Line-break hyphenation ────────────────────────────────────────────────────
# Matches: word-char HYPHEN NEWLINE word-char
# e.g. "söz-\nleşme" → "sözleşme"
# Does NOT match section separators like "MADDE 1 –\n" (en-dash, not hyphen)
_LINEBREAK_HYPHEN_RE = re.compile(
    r"([A-Za-zğüşıöçĞÜŞİÖÇ])-\n([A-Za-zğüşıöçĞÜŞİÖÇ])",
    re.UNICODE,
)

# ── Multiple whitespace ────────────────────────────────────────────────────────
_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


class OCRCleaner:
    """
    Cleans OCR and PDF-extraction artifacts from raw Turkish legal document text.

    Usage:
        cleaner = OCRCleaner()
        cleaned_text, warnings = cleaner.clean(raw_text)

    The ``warnings`` list contains non-fatal quality notes (e.g. "HIGH_LIGATURE_DENSITY").
    Warnings are passed through to IngestResult so operators can audit
    input quality without stopping the pipeline.
    """

    def __init__(
        self,
        high_ligature_threshold: int = 20,
        high_hyphen_threshold: int = 50,
        large_reduction_pct: float = 30.0,
    ) -> None:
        self._ligature_threshold = high_ligature_threshold
        self._hyphen_threshold = high_hyphen_threshold
        self._reduction_pct = large_reduction_pct

    def clean(self, text: str) -> tuple[str, list[str]]:
        """
        Cleans ``text`` and returns ``(cleaned_text, warnings)``.

        Args:
            text: Raw text from PDF extraction or OCR.  May contain null bytes,
                  ligatures, hyphenated line breaks, page numbers, etc.

        Returns:
            (cleaned_text, warnings)  — warnings are non-fatal quality notes.
            An empty input returns ("", []).
        """
        if not text:
            return "", []

        warnings: list[str] = []
        original_len = len(text)

        # 1. Remove control chars (keep \t \n \r)
        text = self._remove_control_chars(text)

        # 2. Fix ligatures and invisible characters
        ligature_count = sum(1 for k in _CHAR_MAP if k in text)
        for wrong, correct in _CHAR_MAP.items():
            if wrong in text:
                text = text.replace(wrong, correct)
        if ligature_count > self._ligature_threshold:
            warnings.append(
                f"HIGH_LIGATURE_DENSITY: {ligature_count} char replacements "
                f"— possible poor OCR or copy-paste encoding issue."
            )

        # 3. Rejoin line-break hyphens
        text, hyphen_joins = self._fix_linebreak_hyphens(text)
        if hyphen_joins > self._hyphen_threshold:
            warnings.append(
                f"HIGH_HYPHEN_JOIN_COUNT: {hyphen_joins} line-break hyphens "
                f"rejoined — likely narrow-column or scanned PDF layout."
            )

        # 4. Strip isolated page numbers
        text = _PAGE_NUMBER_RE.sub("", text)

        # 5. Strip PDF header/footer lines
        text = _HEADER_FOOTER_RE.sub("", text)

        # 6. Normalise horizontal whitespace
        text = _MULTI_SPACE_RE.sub(" ", text)

        # 7. Normalise vertical whitespace (3+ newlines → 2)
        text = _MULTI_NEWLINE_RE.sub("\n\n", text)

        # 8. Strip
        text = text.strip()

        cleaned_len = len(text)
        if original_len > 0:
            reduction_pct = (original_len - cleaned_len) / original_len * 100.0
            if reduction_pct > self._reduction_pct:
                warnings.append(
                    f"LARGE_REDUCTION: Text reduced by {reduction_pct:.1f}% "
                    f"({original_len} → {cleaned_len} chars) — verify input quality."
                )

        logger.debug(
            "OCR_CLEAN | %d → %d chars | ligatures=%d | hyphen_joins=%d | warnings=%d",
            original_len, cleaned_len, ligature_count, hyphen_joins, len(warnings),
        )
        return text, warnings

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _remove_control_chars(text: str) -> str:
        """
        Remove null bytes and non-printable control characters.
        Preserves \\t (tab), \\n (newline), \\r (carriage return).
        """
        return "".join(
            ch for ch in text
            if ch in ("\t", "\n", "\r")
            or unicodedata.category(ch) not in ("Cc", "Cs", "Co", "Cn")
        )

    @staticmethod
    def _fix_linebreak_hyphens(text: str) -> tuple[str, int]:
        """
        Rejoin word-break hyphens at line ends.

        "söz-\\nleşme" → "sözleşme"

        Returns:
            (modified_text, join_count)
        """
        count = 0

        def _rejoin(m: re.Match) -> str:
            nonlocal count
            count += 1
            return m.group(1) + m.group(2)

        return _LINEBREAK_HYPHEN_RE.sub(_rejoin, text), count


# Module-level singleton — use settings in production
from infrastructure.config import settings  # noqa: E402

ocr_cleaner = OCRCleaner(
    high_ligature_threshold=settings.ingest_high_ligature_threshold,
    high_hyphen_threshold=settings.ingest_high_hyphen_threshold,
    large_reduction_pct=settings.ingest_large_reduction_pct,
)
