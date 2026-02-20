"""
KVKK Redactor — Step 6: KVKK Güvenliği ve Multi-Tenancy
=========================================================
Irreversible PII redaction for prompts and logs.

KVKK (Kişisel Verilerin Korunması Kanunu — Law No. 6698) requires that
personal data is processed with the minimum necessary scope.

This module provides:
    KVKKRedactor.redact(text)  → (redacted_text, audit_records)
    KVKKRedactor.redact_for_log(text) → redacted_text (convenience)

Detected PII types (Turkish-specific patterns):
    TC_KIMLIK   — T.C. Kimlik No (11-digit Turkish national ID)
    VKN         — Vergi Kimlik Numarası (10-digit Turkish tax ID)
    TELEFON     — Turkish mobile / landline phone number
    EPOSTA      — E-mail address
    IBAN        — Turkish IBAN (TR + 24 digits)
    ADRES       — Street address (Sokak / Cadde / Bulvar / Cad. / Sok.)
    AD_SOYAD    — Turkish person name (2–4 consecutive capitalised words)

Design principles:
    IRREVERSIBLE  — unlike PrivacyMiddleware (which can restore PII),
                    this redactor replaces PII with type tokens permanently.
                    There is NO reverse operation.  Used for: LLM prompts,
                    log messages, audit records.

    ORDERING      — Patterns run most-specific first to prevent partial
                    overlap (e.g. IBAN contains digits that could match TELEFON).

    AUDIT         — Every replacement is recorded as a RedactionRecord with
                    pii_type, position, and character count.  The record
                    contains NO copy of the original value (data minimisation).

    NO EXTERNAL DEPS — Pure regex.  No spacy, presidio, or network calls.
                    Safe to call synchronously in any context.

Usage:
    from infrastructure.security.kvkk_redactor import kvkk_redactor

    clean_prompt, records = kvkk_redactor.redact(user_input)
    safe_log_line = kvkk_redactor.redact_for_log(some_string)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import List, Tuple

logger = logging.getLogger("babylexit.kvkk_redactor")


# ============================================================================
# Domain Object
# ============================================================================

@dataclass(frozen=True)
class RedactionRecord:
    """
    Audit record for a single PII replacement.

    Deliberately does NOT store the original PII value — data minimisation.
    Only the type, token, and position in the ORIGINAL text are recorded
    so auditors can verify the redaction occurred.
    """

    pii_type: str       # "TC_KIMLIK" | "TELEFON" | "EPOSTA" | "IBAN" | "ADRES"
    replacement: str    # The token that replaced the PII: "[TC_KİMLİK]" etc.
    start: int          # Character offset in the ORIGINAL text
    end: int            # Character end offset in the ORIGINAL text
    char_count: int     # Number of characters redacted (end - start)


# ============================================================================
# Compiled Patterns — ordered most-specific first to avoid partial matches
# ============================================================================

# Turkish IBAN  — TR followed by exactly 24 digits (26 chars total)
# Must come BEFORE phone pattern to prevent 11-digit sequence match inside IBAN.
_IBAN_RE = re.compile(r"\bTR\d{24}\b", re.IGNORECASE)

# T.C. Kimlik Numarası — 11 digits, first digit 1-9 (never 0)
# Word boundary (\b) prevents matching inside longer numbers.
# Must come before the generic phone pattern (phones are ≤10 digits).
_TC_KIMLIK_RE = re.compile(r"\b[1-9]\d{10}\b")

# Turkish phone numbers — various formats:
#   05XX XXX XX XX   (mobile, with leading 0)
#   5XX XXX XX XX    (mobile, without leading 0)
#   +90 5XX ...      (international mobile)
#   0(212) 555 55 55 (landline Istanbul)
_TELEFON_RE = re.compile(
    r"(?:"
    r"\+90[-\s]?5\d{2}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}"  # +90 5XX XXX XX XX
    r"|"
    r"\b0?5\d{2}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b"       # 05XX XXX XX XX
    r"|"
    r"\b0\s*\(\d{3}\)\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}\b"     # 0(212) 555 55 55
    r")",
)

# E-mail address
_EPOSTA_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
)

# Turkish street address components
# Matches: "Atatürk Cad. No: 5", "İstiklal Cadde", "23. Sokak", "Bulvarı"
_ADRES_RE = re.compile(
    r"\b\d+\.?\s*(?:Sokak|Cadde|Bulvar|Cad\.|Sok\.|Blv\.)\b"
    r"|"
    r"\b(?:Sokak|Cadde|Bulvar)\s+No\s*[:.]?\s*\d+\b",
    re.IGNORECASE | re.UNICODE,
)
# VKN — Vergi Kimlik Numarası (10 haneli, baş rakam 1-9)
# İki form desteklenir:
#   Etiketli : VKN: 1234567890  /  Vergi No: 1234567890
#   Bağımsız: kelime sınırı içinde 10 haneli sayı
# TC_KİMLİK (11 hane) sonrasında çalıştırılmalı; kısmi örtüşme riskini önler.
_VKN_RE = re.compile(
    r"(?:"
    r"(?:VKN|V\.K\.N\.|Vergi\s+(?:Kimlik\s+)?No\.?)\s*[:\-]?\s*[1-9]\d{9}"  # etiketli
    r"|"
    r"\b[1-9]\d{9}\b"   # bağımsız 10 hane
    r")",
    re.IGNORECASE,
)

# Türkçe ad soyad — 2-4 ardışık büyük harfle başlayan Türkçe kelime
# Büyük Türkçe harfler: A-Z + Ç Ğ İ Ö Ş Ü
# Küçük Türkçe harfler: a-z + ç ğ ı i ö ş ü
# Her kelime için min 3 karakter (büyük + 2 küçük) gerekli: "İş" gibi kısa hukuki
# terimlerle yanlış eşleşmeyi önler.
# Doğruluk artışı için bu kalıp hattın SONUNDA çalıştırılır; önceki eşleşmeler
# (IBAN, TC, VKN, TELEFON, ADRES) zaten maskelenmiş olur.
_AD_SOYAD_RE = re.compile(
    r"\b[A-ZÇĞİÖŞÜ][a-zçğışöü]{2,}"
    r"(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{2,}){1,3}",
    re.UNICODE,
)

# Bilinen Türkçe hukuki kurum/terim kelimeleri — AD_SOYAD eşleşmesinden dışlanır.
# Örn: "İhbar Tazminatı", "Ağır Ceza Mahkemesi", "İş Kanunu"
# Aşırı maskeleme (over-redaction) riskini azaltır, KVKK uyumunu korur.
_AD_SOYAD_LEGAL_EXCLUDE_RE = re.compile(
    r"\b(?:"
    r"Kanun[a-zçğışöü]*"           # Kanun, Kanunu, Kanunun
    r"|Mahkeme[a-zçğışöü]*"        # Mahkeme, Mahkemesi
    r"|Daire[a-zçğışöü]*"          # Daire, Dairesi
    r"|Karar[a-zçğışöü]*"          # Karar, Kararı, Kararname
    r"|Tazminat[a-zçğışöü]*"       # Tazminat, Tazminatı
    r"|Yönetmelik[a-zçğışöü]*"     # Yönetmelik
    r"|Tebliğ[a-zçğışöü]*"         # Tebliğ
    r"|Anayasa[a-zçğışöü]*"        # Anayasa
    r"|Cumhurba[sş]kanlığ[a-zçğışöü]*"  # Cumhurbaşkanlığı
    r"|Yargıtay[a-zçğışöü]*"       # Yargıtay
    r"|Danıştay[a-zçğışöü]*"       # Danıştay
    r"|Sayıştay[a-zçğışöü]*"       # Sayıştay
    r"|Müdürlüğ[a-zçğışöü]*"       # Müdürlüğü
    r"|Başkanlığ[a-zçğışöü]*"      # Başkanlığı
    r"|Bakanlığ[a-zçğışöü]*"       # Bakanlığı
    r"|Hukuk[a-zçğışöü]*"          # Hukuku, Hukuki
    r"|Ceza[a-zçğışöü]*"           # Ceza, Cezası
    r"|Tebliğ[a-zçğışöü]*"         # Tebliğ
    r"|Müvekkil[a-zçğışöü]*"       # Müvekkil
    r"|İtiraz[a-zçğışöü]*"          # İtiraz
    r"|İcra[a-zçğışöü]*"            # İcra
    r"|Sicil[a-zçğışöü]*"           # Sicil
    r"|Kurul[a-zçğışöü]*"           # Kurul, Kurulu
    r"|Kurum[a-zçğışöü]*"           # Kurum, Kurumu
    r"|Birim[a-zçğışöü]*"           # Birim, Birimi
    r"|Türkiye[a-zçğışöü]*"         # Türkiye
    r"|Cumhuriyet[a-zçğışöü]*"      # Cumhuriyeti
    r"|Davası?"                      # Dava, Davası
    r"|Uyuşmazlık[a-zçğışöü]*"      # Uyuşmazlık
    r"|Yargılama[a-zçğışöü]*"       # Yargılama
    r"|Tahliye[a-zçğışöü]*"         # Tahliye
    r"|Temyiz[a-zçğışöü]*"          # Temyiz
    r"|İstinaf[a-zçğışöü]*"         # İstinaf
    r")\b",
    re.UNICODE,
)

# ============================================================================
# Replacement tokens (display in redacted text)
# ============================================================================

_TOKENS: dict[str, str] = {
    "IBAN":      "[IBAN]",
    "TC_KIMLIK": "[TC_KİMLİK]",
    "VKN":       "[VKN]",
    "TELEFON":   "[TELEFON]",
    "EPOSTA":    "[EPOSTA]",
    "ADRES":     "[ADRES]",
    "AD_SOYAD":  "[AD_SOYAD]",
}

# Pattern pipeline: (pii_type, compiled_pattern) — applied in order
_PATTERN_PIPELINE: list[tuple[str, re.Pattern]] = [
    ("IBAN",      _IBAN_RE),
    ("TC_KIMLIK", _TC_KIMLIK_RE),
    ("VKN",       _VKN_RE),       # 10 haneli — TC (11 hane) sonrası, telefon öncesi
    ("TELEFON",   _TELEFON_RE),
    ("EPOSTA",    _EPOSTA_RE),
    ("ADRES",     _ADRES_RE),
    ("AD_SOYAD",  _AD_SOYAD_RE),  # en son — önceki maskeleme yanlış pozitif riskini azaltır
]


# ============================================================================
# KVKKRedactor
# ============================================================================

class KVKKRedactor:
    """
    Irreversible PII redactor for prompts and log messages.

    Usage:
        redactor = KVKKRedactor()
        clean, records = redactor.redact("TC: 12345678901 aradı")
        # clean = "TC: [TC_KİMLİK] aradı"
        # records = [RedactionRecord(pii_type="TC_KIMLIK", ...)]

        # For logging:
        logger.info("User input: %s", redactor.redact_for_log(raw_input))
    """

    def redact(self, text: str) -> Tuple[str, List[RedactionRecord]]:
        """
        Scans ``text`` for Turkish PII and replaces each match with a type token.

        Patterns run in order: IBAN → TC_KIMLIK → TELEFON → EPOSTA → ADRES.
        Once a span is replaced, it cannot be matched again by later patterns
        (we track covered ranges using a simple bitmask approach).

        Args:
            text: Raw string that may contain PII (user input, log line, etc.).

        Returns:
            (redacted_text, audit_records)
            redacted_text:  ``text`` with all PII replaced by type tokens.
            audit_records:  List of RedactionRecord for each replacement;
                            contains NO copy of the original value.

        The function is idempotent: if called on already-redacted text, the
        token patterns do not match real PII patterns so no further changes
        are made.
        """
        if not text:
            return text, []

        records: List[RedactionRecord] = []

        # Collect all matches across all patterns, tracking covered spans
        # to avoid double-replacing the same characters.
        covered: list[tuple[int, int]] = []  # list of (start, end) already replaced

        # Gather raw matches first (on the original text), then apply back-to-front
        raw_hits: list[tuple[int, int, str]] = []  # (start, end, pii_type)

        for pii_type, pattern in _PATTERN_PIPELINE:
            for m in pattern.finditer(text):
                start, end = m.start(), m.end()
                # Skip if fully overlapped by a previously collected hit
                if any(cs <= start and end <= ce for cs, ce in covered):
                    continue
                # AD_SOYAD: skip matches that contain known legal institution words.
                # Prevents false positives on legal terms like "İhbar Tazminatı",
                # "Ağır Ceza Mahkemesi", "Yargıtay Kararı" etc.
                if pii_type == "AD_SOYAD" and _AD_SOYAD_LEGAL_EXCLUDE_RE.search(m.group(0)):
                    logger.debug(
                        "AD_SOYAD_SKIP_LEGAL | span=[%d:%d] | text=%r",
                        start, end, m.group(0)[:40],
                    )
                    continue
                raw_hits.append((start, end, pii_type))
                covered.append((start, end))

        if not raw_hits:
            return text, []

        # Sort by start position descending so we can replace right-to-left
        # without invalidating earlier offsets.
        raw_hits.sort(key=lambda h: h[0], reverse=True)

        chars = list(text)
        for start, end, pii_type in raw_hits:
            token = _TOKENS[pii_type]
            original_len = end - start
            # Replace slice start:end with the token
            chars[start:end] = list(token)
            # Record for audit (relative to original text positions)
            records.append(
                RedactionRecord(
                    pii_type=pii_type,
                    replacement=token,
                    start=start,
                    end=end,
                    char_count=original_len,
                )
            )

        redacted_text = "".join(chars)

        # Sort audit records by original position (ascending)
        records.sort(key=lambda r: r.start)

        logger.debug(
            "KVKK_REDACT | replacements=%d | original_len=%d | redacted_len=%d",
            len(records), len(text), len(redacted_text),
        )
        if records:
            logger.info(
                "KVKK_PII_DETECTED | types=%s",
                [r.pii_type for r in records],
            )

        return redacted_text, records

    def redact_for_log(self, text: str) -> str:
        """
        Convenience wrapper: returns only the redacted string.

        Use in logging:
            logger.info("input=%s", redactor.redact_for_log(raw_input))
        """
        return self.redact(text)[0]

    def has_pii(self, text: str) -> bool:
        """
        Returns True if ``text`` contains any detectable PII.

        Cheaper than ``redact()`` when you only need a yes/no answer.
        """
        for _, pattern in _PATTERN_PIPELINE:
            if pattern.search(text):
                return True
        return False


# Module-level singleton
kvkk_redactor = KVKKRedactor()
