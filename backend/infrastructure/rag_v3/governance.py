"""Governance helpers for RAG v3 legal safety and quality gates."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any, Optional

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

_POLICY_SENSITIVITY_ORDER = {
    "public": 0,
    "internal": 1,
    "confidential": 2,
    "privileged": 3,
}
_POLICY_RESIDENCY_ORDER = {
    "global": 0,
    "regional": 1,
    "tr-only": 2,
}
_POLICY_EXTERNAL_TRANSFER_ORDER = {
    "allowed": 0,
    "restricted": 1,
    "forbidden": 2,
}
_POLICY_RETENTION_ORDER = {
    "standard": 0,
    "limited": 1,
    "no-store": 2,
}
_POLICY_PRIVILEGE_SCOPE_ORDER = {
    "none": 0,
    "client_confidential": 1,
    "attorney_work_product": 2,
}
_POLICY_SOURCE_RIGHTS_ORDER = {
    "owned": 0,
    "licensed": 1,
    "customer_authorized": 2,
    "prohibited": 3,
}
_POLICY_EXPORTABILITY_ORDER = {
    "exportable": 0,
    "non_exportable": 1,
}
_POLICY_PURPOSE_VALUES = {"search", "draft", "compare", "summarize", "research", "review"}

_CLASSIFICATION_TO_POLICY: dict[str, dict[str, Any]] = {
    "PUBLIC": {
        "sensitivity": "public",
        "residency": "global",
        "external_transfer": "allowed",
        "retention": "standard",
        "privilege_scope": "none",
        "source_rights": "owned",
        "exportability": "exportable",
        "provider_allowlist": {"google", "openai", "anthropic", "groq"},
    },
    "INTERNAL": {
        "sensitivity": "internal",
        "residency": "regional",
        "external_transfer": "restricted",
        "retention": "limited",
        "privilege_scope": "none",
        "source_rights": "owned",
        "exportability": "exportable",
        "provider_allowlist": {"google", "openai", "anthropic", "groq"},
    },
    "CONFIDENTIAL": {
        "sensitivity": "confidential",
        "residency": "regional",
        "external_transfer": "restricted",
        "retention": "limited",
        "privilege_scope": "client_confidential",
        "source_rights": "customer_authorized",
        "exportability": "non_exportable",
        "provider_allowlist": {"openai"},
    },
    "SENSITIVE": {
        "sensitivity": "privileged",
        "residency": "tr-only",
        "external_transfer": "forbidden",
        "retention": "no-store",
        "privilege_scope": "attorney_work_product",
        "source_rights": "customer_authorized",
        "exportability": "non_exportable",
        "provider_allowlist": {"openai"},
    },
}

_PROVIDER_ALIAS_MAP = {
    "gemini": "google",
    "google": "google",
    "qwen": "openai",
    "qwen_core": "openai",
    "qwen_deep": "openai",
    "self_host": "openai",
    "openai": "openai",
    "gpt": "openai",
    "chatgpt": "openai",
    "anthropic": "anthropic",
    "claude": "anthropic",
    "groq": "groq",
}
_PROVIDER_ORDER = ("google", "openai", "anthropic", "groq")

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
class PolicyLattice:
    sensitivity: str = "public"
    residency: str = "global"
    external_transfer: str = "allowed"
    retention: str = "standard"
    privilege_scope: str = "none"
    purpose_of_use: str = "research"
    source_rights: str = "owned"
    exportability: str = "exportable"
    provider_allowlist: list[str] = field(default_factory=list)
    policy_flags: list[str] = field(default_factory=list)
    should_block_generation: bool = False


@dataclass(frozen=True)
class ClaimVerification:
    total_claims: int
    supported_claims: int
    support_ratio: float
    unsupported_claims: list[str]
    passed: bool


def evaluate_policy_lattice(
    *,
    matches: list[RagV3ChunkMatch],
    session_policy: Optional[dict[str, Any]],
    default_provider_allowlist: Optional[list[str]],
    self_host_provider_allowlist: Optional[list[str]],
) -> PolicyLattice:
    base_providers = _normalise_provider_allowlist(default_provider_allowlist)
    if not base_providers:
        base_providers = set(_PROVIDER_ORDER)

    state: dict[str, Any] = {
        "sensitivity": "public",
        "residency": "global",
        "external_transfer": "allowed",
        "retention": "standard",
        "privilege_scope": "none",
        "purpose_of_use": "research",
        "source_rights": "owned",
        "exportability": "exportable",
        "provider_allowlist": set(base_providers),
    }
    flags: list[str] = []

    session = _coerce_session_policy(session_policy)
    _apply_policy_slice(state, session, flags=flags, reason_prefix="session")

    for row in matches:
        class_policy = _CLASSIFICATION_TO_POLICY.get(str(row.classification or "").upper())
        if class_policy:
            _apply_policy_slice(state, class_policy, flags=flags, reason_prefix="classification")
        acl_policy = _acl_tags_policy(getattr(row, "acl_tags", []))
        if acl_policy:
            _apply_policy_slice(state, acl_policy, flags=flags, reason_prefix="acl")

    self_host_providers = _normalise_provider_allowlist(self_host_provider_allowlist)
    if state["external_transfer"] == "forbidden" and self_host_providers:
        narrowed = set(state["provider_allowlist"]) & set(self_host_providers)
        if narrowed != state["provider_allowlist"]:
            flags.append("EXTERNAL_TRANSFER_FORBIDDEN_SELF_HOST_ENFORCED")
            state["provider_allowlist"] = narrowed

    if state["source_rights"] == "prohibited":
        flags.append("SOURCE_RIGHTS_PROHIBITED")
    if not state["provider_allowlist"]:
        flags.append("PROVIDER_ALLOWLIST_EMPTY")

    should_block = (
        state["source_rights"] == "prohibited"
        or not state["provider_allowlist"]
    )
    return PolicyLattice(
        sensitivity=str(state["sensitivity"]),
        residency=str(state["residency"]),
        external_transfer=str(state["external_transfer"]),
        retention=str(state["retention"]),
        privilege_scope=str(state["privilege_scope"]),
        purpose_of_use=str(state["purpose_of_use"]),
        source_rights=str(state["source_rights"]),
        exportability=str(state["exportability"]),
        provider_allowlist=_ordered_provider_list(set(state["provider_allowlist"])),
        policy_flags=list(dict.fromkeys(flags)),
        should_block_generation=should_block,
    )


def resolve_as_of_date(
    query: str,
    explicit_as_of_date: Optional[date],
    *,
    event_date: Optional[date] = None,
    decision_date: Optional[date] = None,
    today: Optional[date] = None,
) -> TemporalResolution:
    now = today or date.today()
    warnings: list[str] = []

    if explicit_as_of_date is not None:
        if explicit_as_of_date > now:
            warnings.append("as_of_date_future_clamped_to_today")
            return TemporalResolution(as_of_date=now, source="explicit_clamped", warnings=warnings)
        return TemporalResolution(as_of_date=explicit_as_of_date, source="explicit", warnings=warnings)

    normalized_event = _clamp_date_to_today(event_date, now, warnings, "event_date")
    normalized_decision = _clamp_date_to_today(decision_date, now, warnings, "decision_date")

    if normalized_event is not None and normalized_decision is not None:
        if normalized_event > normalized_decision:
            warnings.append("event_date_after_decision_date_swapped")
            normalized_event, normalized_decision = normalized_decision, normalized_event
        # Single as_of retrieval uses event-time law by default.
        warnings.append("decision_date_not_used_in_single_as_of")
        return TemporalResolution(as_of_date=normalized_event, source="event_date", warnings=warnings)

    if normalized_event is not None:
        return TemporalResolution(as_of_date=normalized_event, source="event_date", warnings=warnings)

    if normalized_decision is not None:
        return TemporalResolution(as_of_date=normalized_decision, source="decision_date", warnings=warnings)

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


def _coerce_session_policy(session_policy: Optional[dict[str, Any]]) -> dict[str, Any]:
    raw = session_policy if isinstance(session_policy, dict) else {}
    policy: dict[str, Any] = {}

    sensitivity = _normalise_from_order(raw.get("sensitivity"), _POLICY_SENSITIVITY_ORDER, default="public")
    residency = _normalise_from_order(raw.get("residency"), _POLICY_RESIDENCY_ORDER, default="global")
    external_transfer = _normalise_from_order(
        raw.get("external_transfer"),
        _POLICY_EXTERNAL_TRANSFER_ORDER,
        default="allowed",
    )
    retention = _normalise_from_order(raw.get("retention"), _POLICY_RETENTION_ORDER, default="standard")
    privilege_scope = _normalise_from_order(
        raw.get("privilege_scope"),
        _POLICY_PRIVILEGE_SCOPE_ORDER,
        default="none",
    )
    source_rights = _normalise_from_order(
        raw.get("source_rights"),
        _POLICY_SOURCE_RIGHTS_ORDER,
        default="owned",
    )
    exportability = _normalise_from_order(
        raw.get("exportability"),
        _POLICY_EXPORTABILITY_ORDER,
        default="exportable",
    )
    purpose_value = _normalise_token(raw.get("purpose_of_use") or raw.get("purpose"), default="research")
    if purpose_value not in _POLICY_PURPOSE_VALUES:
        purpose_value = "research"

    policy["sensitivity"] = sensitivity
    policy["residency"] = residency
    policy["external_transfer"] = external_transfer
    policy["retention"] = retention
    policy["privilege_scope"] = privilege_scope
    policy["source_rights"] = source_rights
    policy["exportability"] = exportability
    policy["purpose_of_use"] = purpose_value

    providers = _normalise_provider_allowlist(
        raw.get("provider_allowlist")
        or raw.get("provider_allow_list")
        or raw.get("provider_allow")
    )
    if providers:
        policy["provider_allowlist"] = providers
    return policy


def _acl_tags_policy(acl_tags: list[str]) -> dict[str, Any]:
    policy: dict[str, Any] = {}
    providers: set[str] = set()
    for tag in acl_tags or []:
        token = _normalise_token(tag, default="")
        if not token:
            continue
        if token in {"privileged", "attorney_work_product"}:
            policy["sensitivity"] = "privileged"
            policy["privilege_scope"] = "attorney_work_product"
            continue
        if token in {"client_confidential", "client-confidential"}:
            policy["sensitivity"] = "confidential"
            policy["privilege_scope"] = "client_confidential"
            continue
        if token in {"tr-only", "tr_only"}:
            policy["residency"] = "tr-only"
            continue
        if token in {"no-store", "nostore"}:
            policy["retention"] = "no-store"
            continue
        if token in {"non_exportable", "non-exportable"}:
            policy["exportability"] = "non_exportable"
            continue
        if token in {"external-transfer-forbidden", "external_transfer_forbidden"}:
            policy["external_transfer"] = "forbidden"
            continue
        if token in {"source_rights_prohibited", "rights_prohibited", "prohibited"}:
            policy["source_rights"] = "prohibited"
            continue

        key, sep, value = token.partition(":")
        if not sep:
            continue
        value_token = _normalise_token(value, default="")
        if key == "sensitivity":
            parsed = _normalise_from_order(value_token, _POLICY_SENSITIVITY_ORDER, default=None)
            if parsed:
                policy["sensitivity"] = parsed
        elif key == "residency":
            parsed = _normalise_from_order(value_token, _POLICY_RESIDENCY_ORDER, default=None)
            if parsed:
                policy["residency"] = parsed
        elif key == "external_transfer":
            parsed = _normalise_from_order(value_token, _POLICY_EXTERNAL_TRANSFER_ORDER, default=None)
            if parsed:
                policy["external_transfer"] = parsed
        elif key == "retention":
            parsed = _normalise_from_order(value_token, _POLICY_RETENTION_ORDER, default=None)
            if parsed:
                policy["retention"] = parsed
        elif key == "privilege_scope":
            parsed = _normalise_from_order(value_token, _POLICY_PRIVILEGE_SCOPE_ORDER, default=None)
            if parsed:
                policy["privilege_scope"] = parsed
        elif key in {"source_rights", "rights"}:
            parsed = _normalise_from_order(value_token, _POLICY_SOURCE_RIGHTS_ORDER, default=None)
            if parsed:
                policy["source_rights"] = parsed
        elif key == "exportability":
            parsed = _normalise_from_order(value_token, _POLICY_EXPORTABILITY_ORDER, default=None)
            if parsed:
                policy["exportability"] = parsed
        elif key in {"provider", "provider_allowlist", "provider_allow_list"}:
            providers.update(_normalise_provider_allowlist(value_token))

    if providers:
        policy["provider_allowlist"] = providers
    return policy


def _apply_policy_slice(
    state: dict[str, Any],
    incoming: dict[str, Any],
    *,
    flags: list[str],
    reason_prefix: str,
) -> None:
    _apply_restrictive_value(
        state,
        incoming,
        key="sensitivity",
        order=_POLICY_SENSITIVITY_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="residency",
        order=_POLICY_RESIDENCY_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="external_transfer",
        order=_POLICY_EXTERNAL_TRANSFER_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="retention",
        order=_POLICY_RETENTION_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="privilege_scope",
        order=_POLICY_PRIVILEGE_SCOPE_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="source_rights",
        order=_POLICY_SOURCE_RIGHTS_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )
    _apply_restrictive_value(
        state,
        incoming,
        key="exportability",
        order=_POLICY_EXPORTABILITY_ORDER,
        flags=flags,
        reason_prefix=reason_prefix,
    )

    purpose_value = str(incoming.get("purpose_of_use") or "").strip().lower()
    if purpose_value in _POLICY_PURPOSE_VALUES:
        state["purpose_of_use"] = purpose_value

    providers = incoming.get("provider_allowlist")
    if isinstance(providers, set):
        narrowed = set(state["provider_allowlist"]) & set(providers)
        if narrowed != state["provider_allowlist"]:
            flags.append(f"{reason_prefix}_provider_allowlist_intersection")
            state["provider_allowlist"] = narrowed


def _apply_restrictive_value(
    state: dict[str, Any],
    incoming: dict[str, Any],
    *,
    key: str,
    order: dict[str, int],
    flags: list[str],
    reason_prefix: str,
) -> None:
    candidate = incoming.get(key)
    if not isinstance(candidate, str):
        return
    current = str(state.get(key) or "")
    if order.get(candidate, -1) > order.get(current, -1):
        state[key] = candidate
        flags.append(f"{reason_prefix}_{key}_tightened")


def _normalise_provider_allowlist(value: Any) -> set[str]:
    providers: set[str] = set()
    raw_items: list[str] = []
    if isinstance(value, str):
        raw_items = re.split(r"[,\s;+|]+", value)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            if isinstance(item, str):
                raw_items.extend(re.split(r"[,\s;+|]+", item))

    for item in raw_items:
        token = _normalise_token(item, default="")
        if not token:
            continue
        if token == "none":
            continue
        mapped = _PROVIDER_ALIAS_MAP.get(token)
        if mapped:
            providers.add(mapped)
    return providers


def _normalise_from_order(value: Any, order: dict[str, int], *, default: Optional[str]) -> Optional[str]:
    token = _normalise_token(value, default="")
    if token in order:
        return token
    return default


def _normalise_token(value: Any, *, default: str) -> str:
    if not isinstance(value, str):
        return default
    token = value.strip().lower()
    if not token:
        return default
    return token


def _ordered_provider_list(values: set[str]) -> list[str]:
    ordered = [provider for provider in _PROVIDER_ORDER if provider in values]
    extras = sorted([provider for provider in values if provider not in _PROVIDER_ORDER])
    return ordered + extras


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


def _clamp_date_to_today(
    value: Optional[date],
    today: date,
    warnings: list[str],
    label: str,
) -> Optional[date]:
    if value is None:
        return None
    if value > today:
        warnings.append(f"{label}_future_clamped_to_today")
        return today
    return value


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
