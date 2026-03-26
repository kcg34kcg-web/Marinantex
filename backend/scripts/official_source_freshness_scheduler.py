#!/usr/bin/env python3
"""Scheduled official source freshness monitor for RAG v3."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from infrastructure.config import settings
from infrastructure.database.connection import get_supabase_client
from infrastructure.rag_v3.freshness_monitor import (
    FreshnessRecord,
    OfficialSourceSpec,
    evaluate_freshness,
    load_official_source_specs,
    parse_datetime,
    summarize_records,
)


def run_freshness_job(
    *,
    registry_path: Optional[str],
    threshold_hours: int,
    scheduler_job: str,
    dry_run: bool,
) -> dict[str, Any]:
    registry_version, specs = load_official_source_specs(registry_path)
    now_utc = datetime.now(timezone.utc)
    client = None if dry_run else get_supabase_client()

    records: list[FreshnessRecord] = []
    for spec in specs:
        try:
            ingested_latest_at = (
                spec.ingested_latest_at_hint
                if dry_run
                else _fetch_ingested_latest_at(client, spec.source_registry_id)
            )
            record = evaluate_freshness(
                spec=spec,
                ingested_latest_at=ingested_latest_at,
                threshold_hours=threshold_hours,
                now_utc=now_utc,
            )
            records.append(record)
            if not dry_run:
                _persist_record(client, record=record, scheduler_job=scheduler_job, spec=spec)
        except Exception as exc:  # noqa: BLE001
            records.append(
                FreshnessRecord(
                    source_registry_id=spec.source_registry_id,
                    source_url=spec.source_url,
                    latest_remote_at=spec.latest_remote_at,
                    ingested_latest_at=None,
                    lag_hours=float(threshold_hours + 1),
                    freshness_state="error",
                    metadata={"reason": "freshness_job_exception", "error": str(exc)},
                )
            )

    counts = summarize_records(records)
    report = {
        "job": scheduler_job,
        "generated_at": now_utc.isoformat(),
        "registry_version": registry_version,
        "threshold_hours": int(threshold_hours),
        "dry_run": bool(dry_run),
        "source_count": len(records),
        "state_counts": counts,
        "records": [_serialize_record(item) for item in records],
    }
    return report


def _fetch_ingested_latest_at(client: Any, source_registry_id: str) -> Optional[datetime]:
    response = (
        client.table("rag_documents")
        .select("updated_at")
        .eq("source_id", source_registry_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = list(getattr(response, "data", []) or [])
    if not rows:
        return None
    updated_at = rows[0].get("updated_at")
    return parse_datetime(updated_at)


def _persist_record(client: Any, *, record: FreshnessRecord, scheduler_job: str, spec: OfficialSourceSpec) -> None:
    payload = {
        "source_registry_id": record.source_registry_id,
        "source_url": record.source_url,
        "latest_remote_at": _iso_or_none(record.latest_remote_at),
        "ingested_latest_at": _iso_or_none(record.ingested_latest_at),
        "lag_hours": float(record.lag_hours),
        "freshness_state": record.freshness_state,
        "scheduler_job": scheduler_job,
        "metadata": {
            **dict(spec.metadata or {}),
            **dict(record.metadata or {}),
        },
    }
    client.table("rag_v3_source_freshness_log").insert(payload).execute()


def _serialize_record(record: FreshnessRecord) -> dict[str, Any]:
    return {
        "source_registry_id": record.source_registry_id,
        "source_url": record.source_url,
        "latest_remote_at": _iso_or_none(record.latest_remote_at),
        "ingested_latest_at": _iso_or_none(record.ingested_latest_at),
        "lag_hours": float(record.lag_hours),
        "freshness_state": record.freshness_state,
        "metadata": dict(record.metadata or {}),
    }


def _iso_or_none(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    token = value.astimezone(timezone.utc).isoformat()
    return token.replace("+00:00", "Z")


def _write_output(path: Optional[str], payload: dict[str, Any]) -> None:
    if not path:
        return
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG v3 official source freshness scheduler")
    parser.add_argument("--registry", default=None, help="Optional path to official source registry JSON")
    parser.add_argument(
        "--threshold-hours",
        type=int,
        default=int(getattr(settings, "rag_v3_official_source_freshness_threshold_hours", 24) or 24),
        help="Freshness threshold (hours)",
    )
    parser.add_argument(
        "--job-name",
        default="rag_v3_official_source_freshness_scheduler",
        help="Scheduler job name saved in log rows",
    )
    parser.add_argument("--dry-run", action="store_true", help="Evaluate without database writes")
    parser.add_argument("--output", default=None, help="Optional report output path")
    parser.add_argument("--fail-on-stale", action="store_true", help="Exit with code 2 if stale records exist")
    parser.add_argument("--fail-on-error", action="store_true", help="Exit with code 1 if error records exist")
    args = parser.parse_args()

    report = run_freshness_job(
        registry_path=args.registry,
        threshold_hours=max(1, int(args.threshold_hours)),
        scheduler_job=str(args.job_name),
        dry_run=bool(args.dry_run),
    )
    _write_output(args.output, report)

    counts = dict(report.get("state_counts") or {})
    fresh = int(counts.get("fresh") or 0)
    stale = int(counts.get("stale") or 0)
    unknown = int(counts.get("unknown") or 0)
    error = int(counts.get("error") or 0)
    print(
        "[freshness] "
        f"fresh={fresh} stale={stale} unknown={unknown} error={error} "
        f"dry_run={report.get('dry_run')}"
    )

    if args.fail_on_error and error > 0:
        sys.exit(1)
    if args.fail_on_stale and stale > 0:
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
