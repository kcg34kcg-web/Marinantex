"""Parser/OCR quality evaluation for RAG v3 ingest."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from infrastructure.rag_v3.source_parser import ParsedSourceContent

_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_SYMBOL_RE = re.compile(r"[^A-Za-z0-9_\u00c0-\u024f\s]")


@dataclass(frozen=True)
class ParserQualitySignal:
    name: str
    value: float
    threshold: float
    passed: bool
    severity: str = "warning"


@dataclass(frozen=True)
class ParserQualityReport:
    score: float
    passed: bool
    warnings: list[str] = field(default_factory=list)
    hard_fail_reasons: list[str] = field(default_factory=list)
    signals: list[ParserQualitySignal] = field(default_factory=list)


def evaluate_parser_quality(
    *,
    parsed: ParsedSourceContent,
    normalized_text: str,
    min_tokens: int = 25,
    min_chars: int = 120,
    min_ocr_confidence: float = 0.45,
    max_symbol_ratio: float = 0.40,
    pass_threshold: float = 0.62,
) -> ParserQualityReport:
    text = (normalized_text or "").strip()
    token_count = len(_TOKEN_RE.findall(text))
    char_count = len(text)
    symbol_ratio = _symbol_ratio(text)
    ocr_conf = float(parsed.ocr_confidence or 0.0) if parsed.ocr_used else 1.0

    signals = [
        ParserQualitySignal(
            name="char_count",
            value=float(char_count),
            threshold=float(min_chars),
            passed=char_count >= min_chars,
            severity="critical",
        ),
        ParserQualitySignal(
            name="token_count",
            value=float(token_count),
            threshold=float(min_tokens),
            passed=token_count >= min_tokens,
            severity="critical",
        ),
        ParserQualitySignal(
            name="symbol_ratio",
            value=float(symbol_ratio),
            threshold=float(max_symbol_ratio),
            passed=symbol_ratio <= max_symbol_ratio,
            severity="warning",
        ),
        ParserQualitySignal(
            name="ocr_confidence",
            value=float(ocr_conf),
            threshold=float(min_ocr_confidence),
            passed=(not parsed.ocr_used) or (ocr_conf >= min_ocr_confidence),
            severity="critical",
        ),
    ]

    # Weighted quality score in [0,1]
    weights = {
        "char_count": 0.22,
        "token_count": 0.30,
        "symbol_ratio": 0.18,
        "ocr_confidence": 0.30,
    }
    score = 0.0
    for signal in signals:
        contribution = 1.0 if signal.passed else max(0.0, signal.value / max(signal.threshold, 1e-6))
        if signal.name == "symbol_ratio":
            contribution = 1.0 if signal.passed else max(0.0, 1.0 - min(1.0, signal.value))
        score += weights.get(signal.name, 0.0) * contribution
    score = _clamp01(score)

    warnings: list[str] = []
    hard_fail_reasons: list[str] = []
    for signal in signals:
        if signal.passed:
            continue
        code = f"parser_quality_{signal.name}_low"
        if signal.severity == "critical":
            hard_fail_reasons.append(code)
        else:
            warnings.append(code)

    # Bubble parser warnings into quality warnings for traceability.
    for item in parsed.warnings:
        if not str(item).strip():
            continue
        warnings.append(f"parser_warning:{str(item).strip()[:120]}")

    passed = score >= _clamp01(pass_threshold) and not hard_fail_reasons
    warnings = list(dict.fromkeys(warnings))
    hard_fail_reasons = list(dict.fromkeys(hard_fail_reasons))
    return ParserQualityReport(
        score=score,
        passed=passed,
        warnings=warnings,
        hard_fail_reasons=hard_fail_reasons,
        signals=signals,
    )


def _symbol_ratio(text: str) -> float:
    body = (text or "").strip()
    if not body:
        return 1.0
    symbols = len(_SYMBOL_RE.findall(body))
    return float(symbols) / float(max(1, len(body)))


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)

