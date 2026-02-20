"""
Prompt Injection Guard  —  Step 5
===================================
Detects and blocks prompt injection attacks before they reach the LLM.

TWO SCAN SURFACES:

    Surface 1 — Query scan (user input):
        Detects jailbreak attempts, role-override commands, system prompt
        extraction, and persona-reassignment patterns (Turkish + English).
        Runs BEFORE any LLM call.  If triggered → HTTP 400 (LLM never called).

    Surface 2 — Context scan (retrieved documents):
        Detects poisoned document content — LLM prompt injection markers
        embedded in legal documents (e.g. [INST], <|im_start|>, injected
        SYSTEM: headers, "ignore the above" directives).
        Runs AFTER _build_context(), BEFORE _call_llm().

THREAT TAXONOMY:
    JAILBREAK          — attempts to bypass system instructions
    ROLE_OVERRIDE      — "sen artık X'sin", "act as", "pretend you are"
    SYSTEM_PROMPT_LEAK — attempts to extract the system prompt
    CONTEXT_POISONING  — malicious directives embedded in documents
    ENCODED_INJECTION  — Base64/hex encoded injection payloads

FAILURE POLICY:
    scan_query() and scan_context() are pure functions (no side effects).
    PromptGuard.check() raises HTTPException 400 on any positive detection.
    A detection always means LLM cost = $0 for that request.

DESIGN NOTES:
    - All patterns are case-insensitive (re.IGNORECASE).
    - Turkish dotless-ı (ı) and dotted-İ are both covered explicitly.
    - Patterns are compiled once at import time (fast matching).
    - No external dependencies — stdlib `re` only.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from fastapi import HTTPException, status

logger = logging.getLogger("babylexit.prompt_guard")


# ============================================================================
# Enumerations
# ============================================================================

class ThreatType(str, Enum):
    JAILBREAK = "JAILBREAK"
    ROLE_OVERRIDE = "ROLE_OVERRIDE"
    SYSTEM_PROMPT_LEAK = "SYSTEM_PROMPT_LEAK"
    CONTEXT_POISONING = "CONTEXT_POISONING"
    ENCODED_INJECTION = "ENCODED_INJECTION"


# ============================================================================
# Pattern Registry
# ============================================================================

@dataclass(frozen=True)
class _Pattern:
    threat: ThreatType
    regex: re.Pattern[str]
    description: str


def _p(threat: ThreatType, pattern: str, description: str) -> _Pattern:
    """Helper: compiles a pattern with IGNORECASE + DOTALL flags."""
    return _Pattern(
        threat=threat,
        regex=re.compile(pattern, re.IGNORECASE | re.DOTALL),
        description=description,
    )


def _pm(threat: ThreatType, pattern: str, description: str) -> _Pattern:
    """Helper: compiles a pattern with IGNORECASE + MULTILINE flags.

    Use this instead of _p() when the pattern uses ``^`` or ``$`` anchors
    that must match at each *line* boundary, not just the string boundary.
    """
    return _Pattern(
        threat=threat,
        regex=re.compile(pattern, re.IGNORECASE | re.MULTILINE),
        description=description,
    )


# Maximum input length scanned by scan_query().
# Queries longer than this are truncated BEFORE regex matching to prevent
# catastrophic backtracking (ReDoS) on patterns such as \bDAN\b.*?\w+
_QUERY_MAX_LEN: int = 4_000


# ── Query-surface patterns ─────────────────────────────────────────────────
_QUERY_PATTERNS: List[_Pattern] = [
    # ── Jailbreak ─────────────────────────────────────────────────────────
    _p(ThreatType.JAILBREAK,
       r"ignore\s+(all\s+)?previous\s+instructions?",
       "Classic ignore-previous-instructions jailbreak"),
    _p(ThreatType.JAILBREAK,
       r"ignore\s+(all\s+)?your\s+(instructions?|training|guidelines?|rules?)",
       "Training override jailbreak"),
    _p(ThreatType.JAILBREAK,
       r"forget\s+(everything|all|your)\s+(you\s+know|instructions?|training)?",
       "Forget-training jailbreak"),
    _p(ThreatType.JAILBREAK,
       r"\bDAN\b.*?(mode|prompt|jailbreak)?",
       "DAN jailbreak variant"),
    _p(ThreatType.JAILBREAK,
       r"(tüm|bütün|önceki)\s+(talimatları|kuralları|yönergeleri)\s+(unut|görmezden\s+gel|yoksay)",
       "Turkish: ignore all instructions"),
    _p(ThreatType.JAILBREAK,
       r"(her\s+şeyi|hepsini)\s+unut",
       "Turkish: forget everything"),
    _p(ThreatType.JAILBREAK,
       r"kısıtlamalarını?\s+(kaldır|devre\s+dışı\s+bırak|yoksay)",
       "Turkish: remove restrictions"),

    # ── Role Override ──────────────────────────────────────────────────────
    _p(ThreatType.ROLE_OVERRIDE,
       r"(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as)",
       "English role-override / act-as"),
    _p(ThreatType.ROLE_OVERRIDE,
       r"sen\s+art[iı]k\s+\w",
       "Turkish: sen artık [role]"),
    _p(ThreatType.ROLE_OVERRIDE,
       r"sen\s+bir\s+(yapay\s+zeka\s+de[gğ]ilsin|insan|bot\s+de[gğ]ilsin)",
       "Turkish: sen bir X değilsin"),
    _p(ThreatType.ROLE_OVERRIDE,
       r"rol[üu]\s+(üstlen|oyna|yap|al)",
       "Turkish: rol üstlen/oyna"),
    _p(ThreatType.ROLE_OVERRIDE,
       r"(karakter|persona|kimlik)\s+(de[gğ]i[sş]tir|üstlen|taklit)",
       "Turkish: karakter/persona değiştir"),
    _p(ThreatType.ROLE_OVERRIDE,
       r"sanki\s+sen\s+(bir\s+)?\w+\s*(imi[sş]|gibi\s+davran)",
       "Turkish: sanki sen X imiş gibi davran"),

    # ── System Prompt Leak ─────────────────────────────────────────────────
    _p(ThreatType.SYSTEM_PROMPT_LEAK,
       r"(show|print|reveal|repeat|output|tell\s+me|what\s+is)\s+(me\s+)?"
       r"(your\s+)?(system\s+prompt|instructions?|initial\s+prompt|prompt)",
       "English: reveal system prompt"),
    _p(ThreatType.SYSTEM_PROMPT_LEAK,
       r"sistem\s+promp[tu]\w*\s*(göster|söyle|yaz|ver|ne\s*(dir|yazıyor))",
       "Turkish: sistem promptunu göster"),
    _p(ThreatType.SYSTEM_PROMPT_LEAK,
       r"ba[sş]lang[iı][cç]\s+talimatlar[iı](nı|n)?\s*(göster|söyle|ver)",
       "Turkish: başlangıç talimatlarını göster"),
    _p(ThreatType.SYSTEM_PROMPT_LEAK,
       r"(ilk|orijinal|gizli)\s+talimatlar[iı](nı|n)?\s*(paylaş|ver|söyle)",
       "Turkish: gizli talimatlarını paylaş"),

    # ── Encoded Injection ──────────────────────────────────────────────────
    _p(ThreatType.ENCODED_INJECTION,
       r"base64[_\s]*(decode|encoded?|çöz)",
       "Base64 encoded payload hint"),
    _p(ThreatType.ENCODED_INJECTION,
       r"\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){4,}",
       "Hex-encoded injection sequence"),
    _p(ThreatType.ENCODED_INJECTION,
       r"(\\u[0-9a-f]{4}){4,}",
       "Unicode escape injection sequence (\\uXXXX)"),
]

# ── Context/document-surface patterns ─────────────────────────────────────
_CONTEXT_PATTERNS: List[_Pattern] = [
    # LLaMA / Mistral style
    _p(ThreatType.CONTEXT_POISONING,
       r"\[INST\]|\[/INST\]|<<SYS>>|<</SYS>>",
       "LLaMA instruction injection markers"),
    # ChatML (OpenAI fine-tune format)
    _p(ThreatType.CONTEXT_POISONING,
       r"<\|im_start\|>|<\|im_end\|>",
       "ChatML injection markers"),
    # Injected role headers in doc text — uses MULTILINE so ^ matches each line start
    _pm(ThreatType.CONTEXT_POISONING,
        r"^(SYSTEM|HUMAN|ASSISTANT|USER)\s*:",
        "Injected role-header in document"),
    # Classic document-level override
    _p(ThreatType.CONTEXT_POISONING,
       r"ignore\s+(the\s+)?(above|previous|following|all)",
       "Document-level ignore directive"),
    _p(ThreatType.CONTEXT_POISONING,
       r"(yukarıdaki|önceki|aşağıdaki)\s+(talimatları|kuralları|metni)\s+"
       r"(unut|görmezden\s+gel|yoksay)",
       "Turkish document-level ignore directive"),
    # Prompt boundary markers
    _p(ThreatType.CONTEXT_POISONING,
       r"---+\s*(new\s+instruction|system\s+prompt|override)\s*---+",
       "Prompt boundary injection marker"),
    _p(ThreatType.CONTEXT_POISONING,
       r"<prompt>|</prompt>|<system>|</system>",
       "XML-style prompt injection wrapper"),
    # Data exfiltration attempts via doc
    _p(ThreatType.CONTEXT_POISONING,
       r"(print|output|reveal|repeat|echo)\s+(the\s+)?(system\s+prompt|instructions?)",
       "Exfiltration directive in document"),
]


# ============================================================================
# Result Data Class
# ============================================================================

@dataclass
class PromptGuardResult:
    """
    Result of a single scan surface check.

    Attributes:
        safe:             True = no threat detected.
        threat_type:      ThreatType enum value if unsafe, else None.
        matched_pattern:  Human-readable description of the matched rule.
        matched_text:     The actual substring that triggered the match
                          (truncated to 120 chars for logging).
        location:         "query" or "context"
    """

    safe: bool
    threat_type: Optional[ThreatType] = None
    matched_pattern: Optional[str] = None
    matched_text: Optional[str] = None
    location: str = "query"


# ============================================================================
# Pure scan functions — no side effects, fully unit-testable
# ============================================================================

def scan_query(query: str) -> PromptGuardResult:
    """
    Scans the user query for prompt injection patterns.

    Pure function — no logging, no exceptions.  Callers decide what to do.

    Input is truncated to _QUERY_MAX_LEN characters before matching to prevent
    catastrophic backtracking (ReDoS) on greedy patterns.

    Args:
        query: The user's legal question (post-PII-masking, pre-embedding).

    Returns:
        PromptGuardResult with safe=True if no threat found, else safe=False.
    """
    # Truncate to prevent ReDoS on very long inputs
    scan_text = query[:_QUERY_MAX_LEN]
    for pattern in _QUERY_PATTERNS:
        match = pattern.regex.search(scan_text)
        if match:
            return PromptGuardResult(
                safe=False,
                threat_type=pattern.threat,
                matched_pattern=pattern.description,
                matched_text=match.group(0)[:120],
                location="query",
            )
    return PromptGuardResult(safe=True, location="query")


def scan_context(context: str) -> PromptGuardResult:
    """
    Scans the assembled context block for document-poisoning patterns.

    Pure function — no logging, no exceptions.

    Args:
        context: The context string built from retrieved LegalDocument chunks
                 (output of RAGService._build_context).

    Returns:
        PromptGuardResult with safe=True if clean, else safe=False.
    """
    for pattern in _CONTEXT_PATTERNS:
        match = pattern.regex.search(context)
        if match:
            return PromptGuardResult(
                safe=False,
                threat_type=pattern.threat,
                matched_pattern=pattern.description,
                matched_text=match.group(0)[:120],
                location="context",
            )
    return PromptGuardResult(safe=True, location="context")


# ============================================================================
# PromptGuard — stateless service class
# ============================================================================

class PromptGuard:
    """
    Stateless guard that wraps scan_query + scan_context and raises
    HTTPException 400 when any threat is detected.

    Usage in RAGService:
        guard = PromptGuard()

        # Before cache lookup:
        guard.check_query(request.query)

        # After _build_context(), before _call_llm():
        guard.check_context(context)
    """

    def check_query(self, query: str) -> None:
        """
        Runs query surface scan.  Raises HTTPException 400 on detection.

        Logging:
            SECURITY_BLOCK logged at WARNING level on injection detection.
            Always audit-logged regardless of outcome.

        Raises:
            HTTPException 400 with PROMPT_INJECTION_DETECTED error code.
        """
        result = scan_query(query)
        self._handle(result, query)

    def check_context(self, context: str) -> None:
        """
        Runs context surface scan.  Raises HTTPException 400 on detection.

        Raises:
            HTTPException 400 with PROMPT_INJECTION_DETECTED error code.
        """
        result = scan_context(context)
        self._handle(result, context[:80])

    def _handle(self, result: PromptGuardResult, preview: str) -> None:
        """
        Centralised result handler: log + raise on threat.

        Args:
            result:  The PromptGuardResult from a scan function.
            preview: First ~80 chars of the scanned text (for log context).
        """
        if result.safe:
            logger.debug(
                "PROMPT_GUARD_PASS | location=%s | preview=%r",
                result.location,
                preview[:60],
            )
            return

        logger.warning(
            "SECURITY_BLOCK | location=%s | threat=%s | pattern=%r | "
            "matched=%r | llm_called=False | cost=$0",
            result.location,
            result.threat_type,
            result.matched_pattern,
            result.matched_text,
        )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": "PROMPT_INJECTION_DETECTED",
                "message": (
                    "İstek güvenlik denetiminden geçemedi: "
                    "zararlı içerik tespit edildi. "
                    "LLM çağrısı yapılmadı."
                ),
                "threat_type": result.threat_type,
                "location": result.location,
                "llm_called": False,
            },
        )


# ============================================================================
# Module-level singleton
# ============================================================================

prompt_guard = PromptGuard()
