"""Metadata extraction + authority tagging for legal documents."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

_TOKEN_SANITIZE_RE = re.compile(r"[^a-z0-9._/-]+")
_RG_RE = re.compile(r"\bresm[iî]\s+gazete\b.*?\bsay[ıi]\s*[: ]\s*(\d+)", re.IGNORECASE | re.DOTALL)
_CASE_RE = re.compile(r"\bE\.\s*\d{4}/\d+\b|\bK\.\s*\d{4}/\d+\b", re.IGNORECASE)
_ARTICLE_RE = re.compile(r"\b(?:madde|md\.?)\s*\d{1,4}(?:/[A-Za-z0-9]+)?\b", re.IGNORECASE)

_AUTHORITY_TABLE = {
    "anayasa": ("ANAYASA", 1.00, "national"),
    "kanun": ("KANUN", 0.95, "national"),
    "cbk": ("CBK", 0.90, "national"),
    "yonetmelik": ("YONETMELIK", 0.82, "national"),
    "teblig": ("TEBLIG", 0.74, "national"),
    "ictihat": ("YARGI_KARARI", 0.82, "judicial"),
    "case_law": ("YARGI_KARARI", 0.82, "judicial"),
    "karar": ("YARGI_KARARI", 0.82, "judicial"),
    "yargi_karari": ("YARGI_KARARI", 0.82, "judicial"),
    "jurisprudence": ("YARGI_KARARI", 0.82, "judicial"),
    "yargitay_ibk": ("YARGITAY_IBK", 0.95, "judicial_binding"),
    "yargitay_hgk": ("YARGITAY_HGK", 0.90, "judicial_guiding"),
    "yargitay_cgk": ("YARGITAY_CGK", 0.90, "judicial_guiding"),
    "yargitay": ("YARGITAY_DAIRE", 0.82, "judicial"),
    "danistay_iddk": ("DANISTAY_IDDK", 0.88, "judicial_binding"),
    "danistay": ("DANISTAY_DAIRE", 0.80, "judicial"),
    "aym": ("AYM", 0.93, "constitutional"),
}


@dataclass(frozen=True)
class AuthorityTagResult:
    authority_level: str
    authority_score: float
    scope: str
    jurisdiction: str
    source_id_normalized: str
    metadata: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def extract_authority_tags(
    *,
    title: str,
    source_type: str,
    source_id: str,
    jurisdiction: str,
    text: str,
    metadata: Optional[dict[str, Any]],
) -> AuthorityTagResult:
    warnings: list[str] = []
    errors: list[str] = []
    meta: dict[str, Any] = dict(metadata or {})
    source_type_token = _normalize_token(source_type)
    source_id_token = _normalize_token(source_id)
    jurisdiction_token = (jurisdiction or "TR").strip().upper() or "TR"

    if not source_id_token:
        errors.append("source_id_missing")
    if not source_type_token:
        errors.append("source_type_missing")

    authority_level, authority_score, scope = _resolve_authority(source_type_token)
    if authority_level == "UNKNOWN":
        warnings.append("authority_unknown_source_type")

    rg_match = _RG_RE.search(text or "")
    if rg_match:
        meta["resmi_gazete_sayi"] = rg_match.group(1)
        meta["citation_authority_hint"] = "resmi_gazete"

    case_hits = len(_CASE_RE.findall(text or ""))
    article_hits = len(_ARTICLE_RE.findall(text or ""))
    if case_hits > 0:
        meta["case_reference_count"] = int(case_hits)
    if article_hits > 0:
        meta["article_reference_count"] = int(article_hits)

    title_lower = (title or "").lower()
    if "içtihadı birleştirme" in title_lower or "ictihadi birlestirme" in title_lower:
        authority_level = "YARGITAY_IBK"
        authority_score = max(authority_score, 0.95)
        scope = "judicial_binding"
    elif "genel kurul" in title_lower:
        authority_score = max(authority_score, 0.88)

    return AuthorityTagResult(
        authority_level=authority_level,
        authority_score=_clamp01(authority_score),
        scope=scope,
        jurisdiction=jurisdiction_token,
        source_id_normalized=source_id_token,
        metadata=meta,
        warnings=list(dict.fromkeys(warnings)),
        errors=list(dict.fromkeys(errors)),
    )


def validate_metadata_contract(
    *,
    source_id: str,
    source_type: str,
    jurisdiction: str,
    effective_from: Optional[date],
    effective_to: Optional[date],
    authority: AuthorityTagResult,
) -> list[str]:
    errors: list[str] = []
    if not str(source_id or "").strip():
        errors.append("source_id_empty")
    if not str(source_type or "").strip():
        errors.append("source_type_empty")
    if not str(jurisdiction or "").strip():
        errors.append("jurisdiction_empty")
    if effective_from and effective_to and effective_to < effective_from:
        errors.append("effective_to_before_effective_from")
    if authority.authority_level == "UNKNOWN":
        errors.append("authority_level_unknown")
    return list(dict.fromkeys(errors))


def _resolve_authority(source_type: str) -> tuple[str, float, str]:
    token = str(source_type or "").strip().lower()
    if not token:
        return "UNKNOWN", 0.40, "unknown"
    if token in _AUTHORITY_TABLE:
        return _AUTHORITY_TABLE[token]
    for key, value in _AUTHORITY_TABLE.items():
        if key in token:
            return value
    return "UNKNOWN", 0.40, "unknown"


def _normalize_token(value: str) -> str:
    token = str(value or "").strip().lower()
    token = _TOKEN_SANITIZE_RE.sub("-", token)
    token = token.strip("-")
    return token


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)
