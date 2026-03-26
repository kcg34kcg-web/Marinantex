"""Official source freshness evaluation primitives for RAG v3."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from infrastructure.config import settings
from infrastructure.legal.source_registry import get_official_sources

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT.parent


@dataclass(frozen=True)
class OfficialSourceSpec:
    source_registry_id: str
    source_url: str
    expected_update_interval_hours: int = 24
    latest_remote_at: Optional[datetime] = None
    ingested_latest_at_hint: Optional[datetime] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FreshnessRecord:
    source_registry_id: str
    source_url: str
    latest_remote_at: Optional[datetime]
    ingested_latest_at: Optional[datetime]
    lag_hours: float
    freshness_state: str
    metadata: dict[str, Any] = field(default_factory=dict)


def resolve_registry_path(path: Optional[str] = None) -> Path:
    configured = str(path or getattr(settings, "rag_v3_official_source_registry_json", "") or "").strip()
    relative = Path(configured or "docs/compliance/official-source-registry.json")
    if relative.is_absolute():
        return relative.resolve()

    candidates = [
        (_REPO_ROOT / relative).resolve(),
        (_BACKEND_ROOT / relative).resolve(),
        (Path.cwd() / relative).resolve(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    token = str(value).strip()
    if not token:
        return None
    if token.endswith("Z"):
        token = token[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(token)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_official_source_specs(registry_path: Optional[str] = None) -> tuple[str, list[OfficialSourceSpec]]:
    path = resolve_registry_path(registry_path)
    if path.exists():
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        return _parse_specs_from_payload(payload)
    return _fallback_specs()


def evaluate_freshness(
    *,
    spec: OfficialSourceSpec,
    ingested_latest_at: Optional[datetime],
    threshold_hours: int,
    now_utc: Optional[datetime] = None,
) -> FreshnessRecord:
    now = now_utc or datetime.now(timezone.utc)
    now = now.astimezone(timezone.utc)
    ingested = parse_datetime(ingested_latest_at)
    remote = parse_datetime(spec.latest_remote_at)
    threshold = max(1, int(threshold_hours))
    cadence = max(1, int(spec.expected_update_interval_hours))

    if ingested is None:
        return FreshnessRecord(
            source_registry_id=spec.source_registry_id,
            source_url=spec.source_url,
            latest_remote_at=remote,
            ingested_latest_at=None,
            lag_hours=float(threshold + 1),
            freshness_state="stale",
            metadata={"reason": "no_ingested_snapshot"},
        )

    if remote is not None:
        lag = max(0.0, (remote - ingested).total_seconds() / 3600.0)
        state = "fresh" if lag <= float(threshold) else "stale"
        return FreshnessRecord(
            source_registry_id=spec.source_registry_id,
            source_url=spec.source_url,
            latest_remote_at=remote,
            ingested_latest_at=ingested,
            lag_hours=round(lag, 4),
            freshness_state=state,
            metadata={"reason": "remote_vs_ingest_lag", "threshold_hours": threshold},
        )

    age = max(0.0, (now - ingested).total_seconds() / 3600.0)
    effective_threshold = max(float(threshold), float(cadence))
    state = "fresh" if age <= effective_threshold else "stale"
    return FreshnessRecord(
        source_registry_id=spec.source_registry_id,
        source_url=spec.source_url,
        latest_remote_at=None,
        ingested_latest_at=ingested,
        lag_hours=round(age, 4),
        freshness_state=state,
        metadata={
            "reason": "ingest_age_without_remote_timestamp",
            "threshold_hours": threshold,
            "expected_update_interval_hours": cadence,
        },
    )


def summarize_records(records: list[FreshnessRecord]) -> dict[str, int]:
    counts = {"fresh": 0, "stale": 0, "unknown": 0, "error": 0}
    for row in records:
        state = str(row.freshness_state or "").strip().lower()
        if state in counts:
            counts[state] += 1
        else:
            counts["unknown"] += 1
    return counts


def _parse_specs_from_payload(payload: dict[str, Any]) -> tuple[str, list[OfficialSourceSpec]]:
    if not isinstance(payload, dict):
        raise ValueError("Official source registry payload must be JSON object.")
    version = str(payload.get("registry_version") or "official_source_registry.unknown").strip()
    raw_sources = payload.get("sources")
    if not isinstance(raw_sources, list) or not raw_sources:
        raise ValueError("Official source registry requires non-empty sources list.")

    specs: list[OfficialSourceSpec] = []
    for index, item in enumerate(raw_sources, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Invalid source row #{index}: object expected.")
        source_registry_id = str(item.get("source_registry_id") or "").strip()
        source_url = str(item.get("source_url") or "").strip()
        if not source_registry_id or not source_url:
            raise ValueError(f"Invalid source row #{index}: source_registry_id and source_url are required.")
        expected_update = int(item.get("expected_update_interval_hours") or 24)
        metadata = dict(item.get("metadata") or {})
        specs.append(
            OfficialSourceSpec(
                source_registry_id=source_registry_id,
                source_url=source_url,
                expected_update_interval_hours=max(1, expected_update),
                latest_remote_at=parse_datetime(item.get("latest_remote_at")),
                ingested_latest_at_hint=parse_datetime(item.get("ingested_latest_at")),
                metadata=metadata,
            )
        )
    return version, specs


def _fallback_specs() -> tuple[str, list[OfficialSourceSpec]]:
    specs: list[OfficialSourceSpec] = []
    for entry in get_official_sources():
        specs.append(
            OfficialSourceSpec(
                source_registry_id=entry.source_id,
                source_url=entry.base_url,
                expected_update_interval_hours=24,
                latest_remote_at=None,
                ingested_latest_at_hint=None,
                metadata={"fallback_from": "infrastructure.legal.source_registry"},
            )
        )
    return "official_source_registry.fallback.v1", specs
