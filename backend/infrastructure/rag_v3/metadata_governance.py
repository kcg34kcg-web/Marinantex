"""Metadata governance for legal authority/version/scope correctness in RAG v3 ingest."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional

from infrastructure.config import settings
from infrastructure.rag_v3.chunker import LegalChunkDraft

_SOURCE_TO_AUTHORITY = {
    "anayasa": ("ANAYASA", 100),
    "kanun": ("KANUN", 90),
    "mevzuat": ("KANUN", 90),
    "cbk": ("CBK", 80),
    "yonetmelik": ("YONETMELIK", 70),
    "teblig": ("TEBLIG", 60),
    "genelge": ("GENELGE", 50),
    "ictihat": ("ICTIHAT", 85),
    "karar": ("KARAR", 80),
}

_LEGAL_SOURCE_HINTS = frozenset({
    "anayasa",
    "kanun",
    "mevzuat",
    "cbk",
    "yonetmelik",
    "teblig",
    "genelge",
    "ictihat",
    "karar",
    "yargitay",
    "danistay",
    "aym",
    "case_law",
    "jurisprudence",
})

_CASE_LAW_SOURCE_HINTS = frozenset({
    "ictihat",
    "case_law",
    "jurisprudence",
    "karar",
    "mahkeme",
    "yargitay",
    "danistay",
    "aym",
})

_CITATION_TEXT_RE = re.compile(
    r"\b(?:\d{3,5}\s+sayili\s+(?:kanun|kanunu)|(?:E\.|K\.)\s*\d{4}/\d+|madde\s*\d+[a-z0-9/.-]*)",
    re.IGNORECASE,
)
_ESAS_NO_PREFIX_RE = re.compile(r"\b(?:ESAS\s*NO[:\s-]*|E\.?\s*[:\s-]*)(\d{4}/\d+)\b", re.IGNORECASE)
_ESAS_NO_SUFFIX_RE = re.compile(r"\b(\d{4}/\d+)\s*E\.?\b", re.IGNORECASE)
_KARAR_NO_PREFIX_RE = re.compile(r"\b(?:KARAR\s*NO[:\s-]*|K\.?\s*[:\s-]*)(\d{4}/\d+)\b", re.IGNORECASE)
_KARAR_NO_SUFFIX_RE = re.compile(r"\b(\d{4}/\d+)\s*K\.?\b", re.IGNORECASE)
_CHAMBER_RE = re.compile(
    r"\b(\d+\.\s*(?:hukuk|ceza)?\s*daire(?:si)?|ceza genel kurulu|hukuk genel kurulu|genel kurul)\b",
    re.IGNORECASE,
)
_DECISION_DATE_HINT_RE = re.compile(
    r"(?:karar\s+tarihi|tarih(?:i)?)\s*[:\-]?\s*(\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2})",
    re.IGNORECASE,
)
_GENERIC_DATE_RE = re.compile(r"\b(\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2})\b")

_TOPIC_KEYWORD_MAP: tuple[tuple[str, str], ...] = (
    ("kidem", "is_hukuku"),
    ("ihbar", "is_hukuku"),
    ("isci", "is_hukuku"),
    ("is kanunu", "is_hukuku"),
    ("sozlesme", "sozlesme_hukuku"),
    ("kira", "borclar_hukuku"),
    ("tazminat", "borclar_hukuku"),
    ("icra", "icra_iflas_hukuku"),
    ("haciz", "icra_iflas_hukuku"),
    ("ceza", "ceza_hukuku"),
    ("anayasa", "anayasa_hukuku"),
    ("idari", "idare_hukuku"),
    ("vergi", "vergi_hukuku"),
    ("ticaret", "ticaret_hukuku"),
    ("sirket", "ticaret_hukuku"),
)


@dataclass(frozen=True)
class MetadataValidationResult:
    passed: bool
    normalized_metadata: dict[str, Any]
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class MetadataValidationInput:
    title: str
    source_type: str
    source_id: str
    jurisdiction: str
    effective_from: Optional[date]
    effective_to: Optional[date]
    metadata: dict[str, Any]
    normalized_text: str
    chunks: list[LegalChunkDraft]


def validate_ingest_metadata(payload: MetadataValidationInput) -> MetadataValidationResult:
    raw_meta = dict(payload.metadata or {})
    source_type = _token(payload.source_type)
    jurisdiction = _token(payload.jurisdiction or raw_meta.get("jurisdiction") or "tr").upper()

    authority_type = _str_or_none(raw_meta.get("authority_type"))
    authority_rank = _int_or_none(raw_meta.get("authority_rank"))
    if authority_type is None or authority_rank is None:
        inferred_type, inferred_rank = _infer_authority(source_type)
        authority_type = authority_type or inferred_type
        authority_rank = authority_rank if authority_rank is not None else inferred_rank

    article_lineage = sorted(
        {
            str(chunk.article_no).strip()
            for chunk in payload.chunks
            if str(chunk.article_no or "").strip()
        }
    )
    clause_lineage = sorted(
        {
            str(chunk.clause_no).strip()
            for chunk in payload.chunks
            if str(chunk.clause_no or "").strip()
        }
    )
    subclause_lineage = sorted(
        {
            str(chunk.subclause_no).strip()
            for chunk in payload.chunks
            if str(chunk.subclause_no or "").strip()
        }
    )

    source_scope = _str_or_none(raw_meta.get("source_scope")) or _str_or_none(raw_meta.get("scope")) or "global"
    version = _str_or_none(raw_meta.get("version")) or _str_or_none(raw_meta.get("version_id"))
    if not version and payload.effective_from is not None:
        version = f"effective:{payload.effective_from.isoformat()}"

    citation_in_payload = "canonical_citation" in raw_meta
    canonical_citation = _str_or_none(raw_meta.get("canonical_citation"))
    if canonical_citation is None and not citation_in_payload:
        canonical_citation = _infer_canonical_citation(
            source_type=source_type,
            source_id=payload.source_id,
            title=payload.title,
            normalized_text=payload.normalized_text,
            article_lineage=article_lineage,
        )

    case_law_metadata = _extract_case_law_metadata(
        source_type=source_type,
        title=payload.title,
        source_id=payload.source_id,
        normalized_text=payload.normalized_text,
        metadata=raw_meta,
    )
    decision_date = case_law_metadata.get("decision_date")
    publish_date = _first_iso_date(
        raw_meta,
        "publish_date",
        "yayim_tarihi",
        "release_date",
        "resmi_gazete_tarihi",
    )
    topic_tags = _resolve_topic_tags(
        title=payload.title,
        source_type=source_type,
        normalized_text=payload.normalized_text,
        metadata=raw_meta,
    )

    errors: list[str] = []
    warnings: list[str] = []

    if payload.effective_from and payload.effective_to and payload.effective_to < payload.effective_from:
        errors.append("effective_to_before_effective_from")

    legal_source = _is_legal_source(source_type)
    case_law_source = _is_case_law_source(source_type)

    if authority_type is None:
        errors.append("authority_type_missing")
    if authority_rank is None:
        errors.append("authority_rank_missing")
    elif authority_rank <= 0:
        errors.append("authority_rank_invalid")

    if not canonical_citation:
        errors.append("canonical_citation_missing")

    if legal_source and not article_lineage:
        warnings.append("article_lineage_empty_for_legal_source")

    require_effective_dates = bool(getattr(settings, "rag_v3_metadata_require_effective_dates_for_legal", True))
    if legal_source and require_effective_dates and payload.effective_from is None:
        errors.append("effective_from_missing_for_legal_source")

    if legal_source and version is None:
        warnings.append("version_missing_for_legal_source")

    if legal_source and bool(getattr(settings, "rag_v3_metadata_require_temporal_field", True)):
        if not any(
            [
                decision_date,
                publish_date,
                payload.effective_from.isoformat() if payload.effective_from else None,
                payload.effective_to.isoformat() if payload.effective_to else None,
            ]
        ):
            errors.append("temporal_metadata_missing_for_legal_source")

    topic_min_count = max(1, int(getattr(settings, "rag_v3_metadata_topic_min_count", 1) or 1))
    if legal_source and bool(getattr(settings, "rag_v3_metadata_require_topic_tags", True)):
        if len(topic_tags) < topic_min_count:
            errors.append("topic_tags_missing_for_legal_source")

    if case_law_source and bool(getattr(settings, "rag_v3_case_law_metadata_contract_enabled", True)):
        required_case_law_fields = _parse_csv_tokens(
            str(
                getattr(
                    settings,
                    "rag_v3_case_law_required_fields",
                    "court,chamber,esas_no,karar_no,decision_date",
                )
                or ""
            )
        )
        case_law_required_map = {
            "court": case_law_metadata.get("court"),
            "chamber": case_law_metadata.get("chamber"),
            "esas_no": case_law_metadata.get("esas_no"),
            "karar_no": case_law_metadata.get("karar_no"),
            "decision_date": decision_date,
        }
        for field_name in required_case_law_fields:
            if _is_missing_field(case_law_required_map.get(field_name)):
                errors.append(f"case_law_{field_name}_missing")

    required_fields = {
        "source_type": source_type or None,
        "effective_from": payload.effective_from.isoformat() if payload.effective_from else None,
        "effective_to": payload.effective_to.isoformat() if payload.effective_to else None,
        "authority_type": authority_type,
        "authority_rank": authority_rank,
        "jurisdiction": jurisdiction,
        "canonical_citation": canonical_citation,
        "source_scope": source_scope,
        "publish_date": publish_date,
        "decision_date": decision_date,
        "topic_tags": topic_tags,
    }

    required_tokens = _parse_csv_tokens(str(getattr(settings, "rag_v3_metadata_required_fields", "") or ""))
    for field_name in required_tokens:
        if _is_missing_field(required_fields.get(field_name)):
            errors.append(f"{field_name}_missing")

    normalized_metadata = {
        **raw_meta,
        "source_type": source_type,
        "jurisdiction": jurisdiction,
        "effective_from": payload.effective_from.isoformat() if payload.effective_from else None,
        "effective_to": payload.effective_to.isoformat() if payload.effective_to else None,
        "authority_type": authority_type,
        "authority_rank": authority_rank,
        "canonical_citation": canonical_citation,
        "source_scope": source_scope,
        "version": version,
        "version_id": version,
        "article_lineage": article_lineage,
        "clause_lineage": clause_lineage,
        "subclause_lineage": subclause_lineage,
        "court": case_law_metadata.get("court"),
        "chamber": case_law_metadata.get("chamber"),
        "esas_no": case_law_metadata.get("esas_no"),
        "karar_no": case_law_metadata.get("karar_no"),
        "decision_date": decision_date,
        "publish_date": publish_date,
        "topic_tags": topic_tags,
    }

    strict_validation = bool(getattr(settings, "rag_v3_metadata_fail_closed", True))
    passed = not errors if strict_validation else True
    return MetadataValidationResult(
        passed=passed,
        normalized_metadata=normalized_metadata,
        warnings=list(dict.fromkeys(warnings)),
        errors=list(dict.fromkeys(errors)),
    )


def _extract_case_law_metadata(
    *,
    source_type: str,
    title: str,
    source_id: str,
    normalized_text: str,
    metadata: dict[str, Any],
) -> dict[str, Optional[str]]:
    court = _first_text(
        metadata,
        "court",
        "mahkeme",
        "issuing_authority",
        "authority_name",
    )
    chamber = _first_text(metadata, "chamber", "daire")
    esas_no = _first_text(metadata, "esas_no", "docket_no", "reference_no")
    karar_no = _first_text(metadata, "karar_no", "decision_no")
    decision_date = _first_iso_date(
        metadata,
        "decision_date",
        "karar_tarihi",
        "citation_date",
    )

    blob = " ".join(
        item.strip()
        for item in [title or "", source_id or "", normalized_text[:8000]]
        if str(item or "").strip()
    )
    if court is None:
        court = _infer_case_law_court(blob)
    if chamber is None:
        chamber = _infer_case_law_chamber(blob)

    inferred_esas, inferred_karar = _extract_case_refs(blob)
    if esas_no is None:
        esas_no = inferred_esas
    if karar_no is None:
        karar_no = inferred_karar
    if decision_date is None:
        decision_date = _extract_case_law_date(blob)

    if not _is_case_law_source(source_type):
        return {
            "court": None,
            "chamber": None,
            "esas_no": None,
            "karar_no": None,
            "decision_date": decision_date,
        }

    return {
        "court": court,
        "chamber": chamber,
        "esas_no": esas_no,
        "karar_no": karar_no,
        "decision_date": decision_date,
    }


def _resolve_topic_tags(
    *,
    title: str,
    source_type: str,
    normalized_text: str,
    metadata: dict[str, Any],
) -> list[str]:
    tags = _topic_tags_from_metadata(metadata)
    if tags:
        return tags
    if not bool(getattr(settings, "rag_v3_topic_tag_auto_extract_enabled", True)):
        return []
    return _infer_topic_tags(title=title, source_type=source_type, normalized_text=normalized_text)


def _topic_tags_from_metadata(metadata: dict[str, Any]) -> list[str]:
    for key in ("topic_tags", "topics", "subject_tags", "konu_etiketleri", "labels"):
        value = metadata.get(key)
        if isinstance(value, list):
            cleaned = [str(item).strip().lower() for item in value if str(item).strip()]
            if cleaned:
                return list(dict.fromkeys(cleaned))[:20]
        if isinstance(value, str) and value.strip():
            cleaned = [item.strip().lower() for item in re.split(r"[,;|]", value) if item.strip()]
            if cleaned:
                return list(dict.fromkeys(cleaned))[:20]
    return []


def _infer_topic_tags(*, title: str, source_type: str, normalized_text: str) -> list[str]:
    blob = f"{title or ''} {normalized_text[:12000]}".lower()
    tags: list[str] = []
    for keyword, topic in _TOPIC_KEYWORD_MAP:
        if keyword in blob:
            tags.append(topic)
    _ = source_type
    return list(dict.fromkeys(tags))[:20]


def _infer_case_law_court(blob: str) -> Optional[str]:
    lowered = (blob or "").lower()
    if "yargitay" in lowered:
        return "Yargitay"
    if "danistay" in lowered:
        return "Danistay"
    if "anayasa mahkemesi" in lowered or "aym" in lowered:
        return "Anayasa Mahkemesi"
    if "bolge adliye" in lowered or "istinaf" in lowered:
        return "Bolge Adliye Mahkemesi"
    if "mahkemesi" in lowered:
        return "Mahkeme"
    return None


def _infer_case_law_chamber(blob: str) -> Optional[str]:
    match = _CHAMBER_RE.search(blob or "")
    if not match:
        return None
    return " ".join(match.group(1).split())


def _extract_case_refs(blob: str) -> tuple[Optional[str], Optional[str]]:
    text = str(blob or "")
    esas_match = _ESAS_NO_PREFIX_RE.search(text) or _ESAS_NO_SUFFIX_RE.search(text)
    karar_match = _KARAR_NO_PREFIX_RE.search(text) or _KARAR_NO_SUFFIX_RE.search(text)
    esas_no = esas_match.group(1) if esas_match else None
    karar_no = karar_match.group(1) if karar_match else None
    return _str_or_none(esas_no), _str_or_none(karar_no)


def _extract_case_law_date(blob: str) -> Optional[str]:
    text = str(blob or "")
    hint_match = _DECISION_DATE_HINT_RE.search(text)
    if hint_match:
        return _coerce_iso_date(hint_match.group(1))
    generic_match = _GENERIC_DATE_RE.search(text)
    if generic_match:
        return _coerce_iso_date(generic_match.group(1))
    return None


def _first_text(metadata: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = _str_or_none(metadata.get(key))
        if value:
            return value
    return None


def _first_iso_date(metadata: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        parsed = _coerce_iso_date(metadata.get(key))
        if parsed:
            return parsed
    return None


def _coerce_iso_date(value: object) -> Optional[str]:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    iso_match = re.match(r"^(\d{4})[./-](\d{2})[./-](\d{2})$", raw)
    if iso_match:
        try:
            return date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))).isoformat()
        except ValueError:
            return None
    day_first = re.match(r"^(\d{2})[./-](\d{2})[./-](\d{4})$", raw)
    if day_first:
        try:
            return date(int(day_first.group(3)), int(day_first.group(2)), int(day_first.group(1))).isoformat()
        except ValueError:
            return None
    if len(raw) >= 10:
        try:
            return date.fromisoformat(raw[:10]).isoformat()
        except ValueError:
            return None
    return None


def _infer_authority(source_type: str) -> tuple[Optional[str], Optional[int]]:
    token = _token(source_type)
    for key, value in _SOURCE_TO_AUTHORITY.items():
        if key in token:
            return value
    return None, None


def _infer_canonical_citation(
    *,
    source_type: str,
    source_id: str,
    title: str,
    normalized_text: str,
    article_lineage: list[str],
) -> Optional[str]:
    _ = (source_type, source_id, title, article_lineage)
    text_hit = _CITATION_TEXT_RE.search(normalized_text[:6000])
    if text_hit:
        value = " ".join(text_hit.group(0).split())
        if article_lineage and "madde" not in value.lower():
            value = f"{value} md. {article_lineage[0]}"
        return value[:240]
    return None


def _is_legal_source(source_type: str) -> bool:
    token = _token(source_type)
    return any(item in token for item in _LEGAL_SOURCE_HINTS)


def _is_case_law_source(source_type: str) -> bool:
    token = _token(source_type)
    return any(item in token for item in _CASE_LAW_SOURCE_HINTS)


def _token(value: object) -> str:
    return str(value or "").strip().lower()


def _str_or_none(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int_or_none(value: object) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_csv_tokens(raw: str) -> list[str]:
    return [token.strip().lower() for token in re.split(r"[,;\s]+", raw or "") if token.strip()]


def _is_missing_field(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False
