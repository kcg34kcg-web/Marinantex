"""Tests for official source freshness monitor primitives."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from infrastructure.rag_v3.freshness_monitor import (
    OfficialSourceSpec,
    evaluate_freshness,
    load_official_source_specs,
    summarize_records,
)


def test_load_official_source_specs_from_registry_json(tmp_path) -> None:
    registry = tmp_path / "official-source-registry.json"
    registry.write_text(
        json.dumps(
            {
                "registry_version": "official.vtest",
                "sources": [
                    {
                        "source_registry_id": "resmi_gazete",
                        "source_url": "https://www.resmigazete.gov.tr",
                        "expected_update_interval_hours": 24,
                        "latest_remote_at": "2026-03-10T10:00:00Z",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    version, specs = load_official_source_specs(str(registry))

    assert version == "official.vtest"
    assert len(specs) == 1
    assert specs[0].source_registry_id == "resmi_gazete"
    assert specs[0].latest_remote_at is not None


def test_evaluate_freshness_with_remote_timestamp_marks_stale_when_lag_high() -> None:
    spec = OfficialSourceSpec(
        source_registry_id="resmi_gazete",
        source_url="https://www.resmigazete.gov.tr",
        expected_update_interval_hours=24,
        latest_remote_at=datetime(2026, 3, 11, 12, 0, tzinfo=timezone.utc),
    )
    ingested = datetime(2026, 3, 10, 8, 0, tzinfo=timezone.utc)
    record = evaluate_freshness(spec=spec, ingested_latest_at=ingested, threshold_hours=24)

    assert record.freshness_state == "stale"
    assert record.lag_hours > 24.0


def test_evaluate_freshness_without_remote_uses_ingest_age() -> None:
    now = datetime(2026, 3, 11, 12, 0, tzinfo=timezone.utc)
    spec = OfficialSourceSpec(
        source_registry_id="yargitay",
        source_url="https://karararama.yargitay.gov.tr",
        expected_update_interval_hours=48,
    )
    ingested = datetime(2026, 3, 10, 8, 0, tzinfo=timezone.utc)
    record = evaluate_freshness(
        spec=spec,
        ingested_latest_at=ingested,
        threshold_hours=24,
        now_utc=now,
    )

    assert record.freshness_state == "fresh"
    summary = summarize_records([record])
    assert summary["fresh"] == 1
