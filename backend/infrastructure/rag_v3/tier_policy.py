"""Tier strategy policy for V1/V1.5 legal assistant routing.

V1:
- Tier 1: Gemini, no-RAG, safe operational intents only.
- Tier 2: Qwen Instruct + shared RAG (default legal work).
- Tier 4: Claude Sonnet + same evidence pack for premium/review.

V1.5:
- Tier 3: Qwen Thinking, trigger-gated only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SAFE_INTENT_RE = re.compile(
    r"\b(?:"
    r"giris|login|oturum|sifre|parola|hesap|abone|fatura|odeme|"
    r"upload|yukle|dosya yukleme|api anahtari|anahtar|token|"
    r"hata|error|baglanti|latency|performans|ayar|settings|"
    r"kullanici ekle|rol ata|tenant|plan|fiyat|destek"
    r")\b",
    re.IGNORECASE,
)

_LEGAL_INTENT_RE = re.compile(
    r"\b(?:"
    r"madde|kanun|ictihat|yargitay|danistay|anayasa|mahkeme|"
    r"sozlesme|kloz|hukuki|dav(a|asi)|ceza|tazminat|fesih|icra|"
    r"uyusmazlik|muvazaa|zamana[sz]imi|teblig|yonetmelik"
    r")\b",
    re.IGNORECASE,
)

_TRIGGER_CONFLICT_RE = re.compile(r"\b(?:celiski|catisma|aksi gorus|aykiri karar|farkli karar)\b", re.IGNORECASE)
_TRIGGER_STRATEGY_RE = re.compile(r"\b(?:adim adim|strateji|plan|once|sonra|senaryo|alternatif)\b", re.IGNORECASE)
_TRIGGER_COUNTER_VIEW_RE = re.compile(r"\b(?:karsi gorus|aksi gorus|itiraz|savunma senaryosu)\b", re.IGNORECASE)
_TRIGGER_CASE_LAW_RE = re.compile(r"\b(?:ictihat|yargitay|danistay|aym|karar)\b", re.IGNORECASE)
_TRIGGER_CONTRACT_RE = re.compile(r"\b(?:sozlesme|kloz|ek protokol|taahhutname)\b", re.IGNORECASE)


@dataclass(frozen=True)
class TierRoutingDecision:
    requested_tier: int
    effective_tier: int
    bypass_rag: bool
    route_reason: str
    warnings: list[str] = field(default_factory=list)
    tier3_triggers: list[str] = field(default_factory=list)


def is_safe_operational_intent(query: str) -> bool:
    text = str(query or "").strip()
    if not text:
        return False
    has_safe = bool(_SAFE_INTENT_RE.search(text))
    has_legal = bool(_LEGAL_INTENT_RE.search(text))
    return has_safe and not has_legal


def detect_tier3_triggers(
    *,
    query: str,
    retrieval_confidence: float,
    has_conflicting_case_law: bool,
    max_chunk_chars: int,
    task_type: str,
) -> list[str]:
    text = str(query or "").strip()
    triggers: list[str] = []

    if has_conflicting_case_law or bool(_TRIGGER_CONFLICT_RE.search(text)):
        triggers.append("conflicting_case_law")

    if retrieval_confidence < 0.38:
        triggers.append("low_retrieval_confidence")

    if bool(_TRIGGER_CONTRACT_RE.search(text)) and max_chunk_chars >= 6000:
        triggers.append("long_contract")

    if task_type == "comparison" or bool(_TRIGGER_STRATEGY_RE.search(text)):
        triggers.append("multi_step_strategy")

    if bool(_TRIGGER_COUNTER_VIEW_RE.search(text)):
        triggers.append("counter_argument")

    # Conservative fallback: heavy case-law request with weak confidence.
    if bool(_TRIGGER_CASE_LAW_RE.search(text)) and retrieval_confidence < 0.5:
        triggers.append("case_law_deep_reasoning")

    out: list[str] = []
    seen: set[str] = set()
    for item in triggers:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def resolve_tier_policy(
    *,
    requested_tier: int,
    query: str,
    retrieval_confidence: float,
    has_conflicting_case_law: bool,
    max_chunk_chars: int,
    task_type: str,
) -> TierRoutingDecision:
    tier = requested_tier if requested_tier in (1, 2, 3, 4) else 2
    warnings: list[str] = []

    # Tier-1 is strictly for operational/safe intents and no-RAG lane.
    if tier == 1:
        if is_safe_operational_intent(query):
            return TierRoutingDecision(
                requested_tier=1,
                effective_tier=1,
                bypass_rag=True,
                route_reason="tier1_safe_intent_no_rag",
                warnings=[],
                tier3_triggers=[],
            )
        warnings.append("tier1_safe_intent_only_auto_upgrade_tier2")
        tier = 2

    triggers = detect_tier3_triggers(
        query=query,
        retrieval_confidence=retrieval_confidence,
        has_conflicting_case_law=has_conflicting_case_law,
        max_chunk_chars=max_chunk_chars,
        task_type=task_type,
    )

    # Tier-3 is opened only when trigger exists.
    if tier == 3 and not triggers:
        warnings.append("tier3_trigger_missing_auto_downgrade_tier2")
        tier = 2

    # Auto-upgrade Tier-2 to Tier-3 on trigger.
    if tier == 2 and triggers:
        tier = 3
        warnings.append("tier2_auto_upgraded_to_tier3")

    route_reason = "shared_rag"
    if tier == 4:
        route_reason = "premium_review"
    elif tier == 3:
        route_reason = "deep_thinking_triggered"
    elif tier == 2:
        route_reason = "default_legal_rag"

    return TierRoutingDecision(
        requested_tier=requested_tier if requested_tier in (1, 2, 3, 4) else 2,
        effective_tier=tier,
        bypass_rag=False,
        route_reason=route_reason,
        warnings=warnings,
        tier3_triggers=triggers,
    )
