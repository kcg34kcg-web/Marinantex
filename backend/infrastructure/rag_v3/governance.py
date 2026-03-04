"""Governance helpers for RAG v3 legal safety and quality gates."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Optional

from infrastructure.rag_v3.repository import RagV3ChunkMatch

_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")
_ISO_DATE_RE = re.compile(r"\b(19\d{2}|20\d{2})-(\d{2})-(\d{2})\b")
_DMY_DATE_RE = re.compile(r"\b(\d{1,2})[./](\d{1,2})[./](19\d{2}|20\d{2})\b")
_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
_SOURCE_ID_RE = re.compile(r"\b\d{3,5}\b")
_ARTICLE_RE = re.compile(r"(?:madde|md\.?)\s*(\d+[a-z]?)", re.IGNORECASE)

_RELATIVE_DAY_MAP = {
    "bugun": 0,
    "today": 0,
    "dun": -1,
    "yesterday": -1,
    "yarin": 1,
    "tomorrow": 1,
}

_SOURCE_TYPE_SCORES = {
    "anayasa": 1.00,
    "kanun": 0.92,
    "cbk": 0.86,
    "yonetmelik": 0.78,
    "teblig": 0.70,
    "genelge": 0.66,
    "ictihat": 0.72,
    "karar": 0.70,
    "secondary": 0.38,
}

_RISK_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("URGENT_CRIMINAL", re.compile(r"\b(tutuklama|gozalti|yakalama|ceza)\b", re.IGNORECASE)),
    ("LIMITATION_PERIOD", re.compile(r"\b(zamanasimi|hak dusurucu)\b", re.IGNORECASE)),
    ("ENFORCEMENT_ACTION", re.compile(r"\b(icra|haciz|takip)\b", re.IGNORECASE)),
    ("TAX_PENALTY", re.compile(r"\b(vergi cezasi|vuk)\b", re.IGNORECASE)),
    ("GUARANTEE_REQUEST", re.compile(r"\b(kesin kazan|garanti|mutlaka kazan)\b", re.IGNORECASE)),
    ("MEDICAL_LAW", re.compile(r"\b(malpraktis|saglik hukuku)\b", re.IGNORECASE)),
]


@dataclass(frozen=True)
class TemporalResolution:
    as_of_date: Optional[date]
    source: str
    warnings: list[str]


@dataclass(frozen=True)
class PolicyDecision:
    risk_level: str
    policy_flags: list[str]
    legal_disclaimer: str
    should_escalate: bool
    should_block_generation: bool


@dataclass(frozen=True)
class ClaimVerification:
    total_claims: int
    supported_claims: int
    support_ratio: float
    unsupported_claims: list[str]
    passed: bool


def resolve_as_of_date(
    query: str,
    explicit_as_of_date: Optional[date],
    *,
    today: Optional[date] = None,
) -> TemporalResolution:
    now = today or date.today()
    warnings: list[str] = []

    if explicit_as_of_date is not None:
        if explicit_as_of_date > now:
            warnings.append("as_of_date_future_clamped_to_today")
            return TemporalResolution(as_of_date=now, source="explicit_clamped", warnings=warnings)
        return TemporalResolution(as_of_date=explicit_as_of_date, source="explicit", warnings=warnings)

    lowered = _normalize_text(query)

    for token, offset in _RELATIVE_DAY_MAP.items():
        if token in lowered:
            resolved = now + timedelta(days=offset)
            if resolved > now:
                warnings.append("relative_future_date_clamped_to_today")
                resolved = now
            return TemporalResolution(as_of_date=resolved, source=f"relative:{token}", warnings=warnings)

    m = _ISO_DATE_RE.search(lowered)
    if m:
        y, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        parsed = _safe_date(y, mm, dd)
        if parsed is not None:
            if parsed > now:
                warnings.append("query_date_future_clamped_to_today")
                parsed = now
            return TemporalResolution(as_of_date=parsed, source="query_iso", warnings=warnings)

    m = _DMY_DATE_RE.search(lowered)
    if m:
        dd, mm, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        parsed = _safe_date(y, mm, dd)
        if parsed is not None:
            if parsed > now:
                warnings.append("query_date_future_clamped_to_today")
                parsed = now
            return TemporalResolution(as_of_date=parsed, source="query_dmy", warnings=warnings)

    m = _YEAR_RE.search(lowered)
    if m:
        year = int(m.group(1))
        # For year-only legal queries, use year-end to include amendments
        # introduced during the referenced year.
        parsed = _safe_date(year, 12, 31)
        if parsed is not None:
            if parsed > now:
                warnings.append("query_year_future_clamped_to_today")
                parsed = now
            return TemporalResolution(as_of_date=parsed, source="query_year", warnings=warnings)

    return TemporalResolution(as_of_date=None, source="none", warnings=warnings)


def apply_norm_hierarchy(
    matches: list[RagV3ChunkMatch],
    *,
    query: str,
    as_of_date: Optional[date],
) -> tuple[list[RagV3ChunkMatch], list[str]]:
    if not matches:
        return [], []

    source_id_hints = set(_SOURCE_ID_RE.findall(query or ""))
    article_hint = _extract_article_hint(query)
    notes: list[str] = []
    if source_id_hints:
        notes.append("lex_specialis_source_id_hint")
    if article_hint:
        notes.append("lex_specialis_article_hint")

    rescored: list[RagV3ChunkMatch] = []
    for row in matches:
        base = _clamp01(float(row.final_score))
        hierarchy = _source_type_score(row.source_type)
        temporal = _temporal_alignment(row, as_of_date)
        special_boost = 0.0
        if source_id_hints and str(row.source_id or "") in source_id_hints:
            special_boost += 0.08
        if article_hint and (row.article_no or "").lower() == article_hint:
            special_boost += 0.06
        # Lex posterior: when ranges overlap, prefer the latest effective_from
        # date that still satisfies as_of_date.
        posterior_bonus = _posterior_bonus(row, as_of_date)
        final = _clamp01((0.72 * base) + (0.18 * hierarchy) + (0.10 * temporal) + special_boost + posterior_bonus)
        rescored.append(replace(row, final_score=final))

    rescored.sort(key=lambda item: item.final_score, reverse=True)
    return rescored, notes


def verify_claim_support(
    *,
    answer_text: str,
    evidence_chunks: list[RagV3ChunkMatch],
    cited_chunk_ids: list[str],
    min_overlap: float,
    min_supported_ratio: float,
) -> ClaimVerification:
    claims = _split_claims(answer_text)
    if not claims:
        return ClaimVerification(
            total_claims=0,
            supported_claims=0,
            support_ratio=1.0,
            unsupported_claims=[],
            passed=True,
        )

    evidence_pool = _select_evidence_pool(evidence_chunks, cited_chunk_ids)
    unsupported: list[str] = []
    supported = 0
    threshold = _clamp01(min_overlap)

    for claim in claims:
        tokens = _tokenize(claim)
        if len(tokens) < 3:
            continue
        if _is_supported(tokens, evidence_pool, threshold):
            supported += 1
        elif len(unsupported) < 5:
            unsupported.append(claim[:200])

    total = max(1, len(claims))
    ratio = _clamp01(supported / float(total))
    passed = ratio >= _clamp01(min_supported_ratio)
    return ClaimVerification(
        total_claims=total,
        supported_claims=supported,
        support_ratio=ratio,
        unsupported_claims=unsupported,
        passed=passed,
    )


def evaluate_policy(query: str) -> PolicyDecision:
    flags: list[str] = []
    for code, pattern in _RISK_PATTERNS:
        if pattern.search(query or ""):
            flags.append(code)

    unique_flags = list(dict.fromkeys(flags))
    critical = {"URGENT_CRIMINAL", "GUARANTEE_REQUEST"}
    high = {"LIMITATION_PERIOD", "ENFORCEMENT_ACTION", "TAX_PENALTY", "MEDICAL_LAW"}

    if any(flag in critical for flag in unique_flags):
        risk_level = "CRITICAL"
    elif sum(1 for flag in unique_flags if flag in high) >= 2:
        risk_level = "HIGH"
    elif any(flag in high for flag in unique_flags):
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    disclaimer = (
        "Bu yanit bilgi amacli olup nihai hukuki tavsiye yerine gecmez. "
        "Kesin hukuki sonuc icin bir avukat incelemesi gereklidir."
    )
    should_escalate = risk_level in {"HIGH", "CRITICAL"}
    should_block = "GUARANTEE_REQUEST" in unique_flags
    return PolicyDecision(
        risk_level=risk_level,
        policy_flags=unique_flags,
        legal_disclaimer=disclaimer,
        should_escalate=should_escalate,
        should_block_generation=should_block,
    )


def _normalize_text(text: str) -> str:
    table = str.maketrans(
        {
            "I": "i",
            "İ": "i",
            "ı": "i",
            "Ç": "c",
            "ç": "c",
            "Ğ": "g",
            "ğ": "g",
            "Ö": "o",
            "ö": "o",
            "Ş": "s",
            "ş": "s",
            "Ü": "u",
            "ü": "u",
        }
    )
    return (text or "").translate(table).lower()


def _tokenize(text: str) -> set[str]:
    return {token for token in _TOKEN_RE.findall(_normalize_text(text)) if len(token) >= 3}


def _safe_date(year: int, month: int, day: int) -> Optional[date]:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _source_type_score(source_type: str) -> float:
    lowered = _normalize_text(source_type)
    for key, score in _SOURCE_TYPE_SCORES.items():
        if key in lowered:
            return score
    return 0.50


def _temporal_alignment(row: RagV3ChunkMatch, as_of_date: Optional[date]) -> float:
    if as_of_date is None:
        return 0.50
    start = row.effective_from
    end = row.effective_to
    if start and start > as_of_date:
        return 0.0
    if end and end < as_of_date:
        return 0.0
    return 1.0


def _posterior_bonus(row: RagV3ChunkMatch, as_of_date: Optional[date]) -> float:
    if as_of_date is None or row.effective_from is None:
        return 0.0
    if row.effective_from > as_of_date:
        return 0.0
    age_days = max(0, (as_of_date - row.effective_from).days)
    if age_days <= 365:
        return 0.04
    if age_days <= 5 * 365:
        return 0.02
    return 0.0


def _extract_article_hint(query: str) -> Optional[str]:
    m = _ARTICLE_RE.search(query or "")
    if not m:
        return None
    return m.group(1).strip().lower()


def _split_claims(answer_text: str) -> list[str]:
    candidates = re.split(r"(?<=[.!?])\s+|\n+", answer_text or "")
    claims: list[str] = []
    for item in candidates:
        cleaned = item.strip()
        if len(cleaned) < 15:
            continue
        lowered = _normalize_text(cleaned)
        # Citation-only lines should not be treated as factual claims.
        if lowered.startswith("atif:") or lowered.startswith("citation:"):
            continue
        if "source_id=" in lowered:
            continue
        claims.append(cleaned)
    return claims


def _select_evidence_pool(
    evidence_chunks: list[RagV3ChunkMatch],
    cited_chunk_ids: list[str],
) -> list[set[str]]:
    by_id = {row.chunk_id: row for row in evidence_chunks}
    selected: list[RagV3ChunkMatch] = []
    for chunk_id in cited_chunk_ids:
        row = by_id.get(chunk_id)
        if row is not None:
            selected.append(row)
    if not selected:
        selected = evidence_chunks[:8]
    return [_tokenize(row.chunk_text) for row in selected]


def _is_supported(claim_tokens: set[str], evidence_pool: list[set[str]], threshold: float) -> bool:
    if not claim_tokens or not evidence_pool:
        return False
    for evidence in evidence_pool:
        if not evidence:
            continue
        overlap = len(claim_tokens & evidence) / float(max(1, len(claim_tokens)))
        if overlap >= threshold:
            return True
    return False


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value
