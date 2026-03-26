#!/usr/bin/env python3
"""Generate 'Ek kanit gerekli alanlar' report from runtime data."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infrastructure.config import settings  # noqa: E402
from infrastructure.database.connection import get_supabase_client  # noqa: E402


OFFICIAL_SOURCE_TYPES = {"legislation", "mevzuat", "regulation", "kanun", "tuzuk", "yonetmelik"}
CASE_LAW_SOURCE_TYPES = {"case_law", "ictihat", "karar", "yargi_karari", "jurisprudence"}
TOPIC_KEYS = ("topic_tags", "topics", "subject_tags", "konu_etiketleri", "labels")
DATE_KEYS = ("publish_date", "decision_date", "release_date", "resmi_gazete_tarihi")


@dataclass(frozen=True)
class EvidenceCheck:
    check_id: str
    status: str  # SUFFICIENT | PARTIAL | MISSING
    observed: dict[str, Any] = field(default_factory=dict)
    missing_evidence: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _read_rows(client: Any, *, table: str, columns: str, batch_size: int = 1000) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = (
            client.table(table)
            .select(columns)
            .range(start, start + batch_size - 1)
            .execute()
        )
        batch = list(response.data or [])
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        start += batch_size
    return rows


def _token(value: Any) -> str:
    return str(value or "").strip().lower()


def _metadata(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("metadata")
    return payload if isinstance(payload, dict) else {}


def _has_any_date(md: dict[str, Any]) -> bool:
    return any(bool(str(md.get(key) or "").strip()) for key in DATE_KEYS)


def _topic_count(md: dict[str, Any]) -> int:
    for key in TOPIC_KEYS:
        value = md.get(key)
        if isinstance(value, list):
            return len([item for item in value if str(item or "").strip()])
        if isinstance(value, str) and value.strip():
            return len([item for item in value.split(",") if item.strip()])
    return 0


def _status_from_ratio(ratio: float) -> str:
    if ratio >= 0.80:
        return "SUFFICIENT"
    if ratio > 0:
        return "PARTIAL"
    return "MISSING"


def _tier_lane_from_trace(row: dict[str, Any]) -> str:
    metadata = _metadata(row)
    lane = _token(metadata.get("model_lane"))
    if lane in {"instruct", "thinking"}:
        return lane
    tier = int(row.get("effective_tier") or row.get("requested_tier") or 0)
    return "thinking" if tier in {3, 4} else "instruct"


def _expected_model_from_trace(row: dict[str, Any]) -> str:
    metadata = _metadata(row)
    explicit = str(metadata.get("model_expected_version") or "").strip()
    if explicit:
        return explicit
    tier = int(row.get("effective_tier") or row.get("requested_tier") or 0)
    if tier == 1:
        return str(getattr(settings, "ai_tier_hazir_model", "") or "").strip()
    if tier == 2:
        return str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip()
    if tier == 3:
        return str(getattr(settings, "ai_tier_uzman_model", "") or "").strip()
    if tier == 4:
        return str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip()
    return ""


def _runtime_model_from_trace(row: dict[str, Any]) -> str:
    metadata = _metadata(row)
    runtime = str(metadata.get("model_runtime_version") or "").strip()
    if runtime:
        return runtime
    direct = str(row.get("model_version") or "").strip()
    if direct:
        return direct
    fingerprint = row.get("fingerprint")
    if isinstance(fingerprint, dict):
        token = str(fingerprint.get("model_version") or "").strip()
        if token:
            return token
    return ""


def _qwen_lane_seen(values: set[str], lane: str) -> bool:
    lane_token = lane.lower()
    return any("qwen3-next-80b-a3b" in item.lower() and lane_token in item.lower() for item in values)


def build_checks(*, docs: list[dict[str, Any]], traces: list[dict[str, Any]]) -> list[EvidenceCheck]:
    checks: list[EvidenceCheck] = []
    total_docs = len(docs)
    source_types = [_token(row.get("source_type")) for row in docs]
    official_count = sum(1 for token in source_types if token in OFFICIAL_SOURCE_TYPES)
    case_law_count = sum(1 for token in source_types if token in CASE_LAW_SOURCE_TYPES)

    checks.append(
        EvidenceCheck(
            check_id="official_mevzuat_coverage",
            status="SUFFICIENT" if official_count > 0 else "MISSING",
            observed={
                "total_docs": total_docs,
                "official_docs": official_count,
            },
            missing_evidence=[] if official_count > 0 else [
                "No documents with official-mevzuat source_type detected.",
                "Need source registry mapping (official domain + source_type contract).",
            ],
        )
    )

    checks.append(
        EvidenceCheck(
            check_id="ictihat_coverage",
            status="SUFFICIENT" if case_law_count > 0 else "MISSING",
            observed={
                "total_docs": total_docs,
                "ictihat_docs": case_law_count,
            },
            missing_evidence=[] if case_law_count > 0 else [
                "No documents with ictihat/case_law source_type detected.",
                "Need ingest evidence for court/chamber/decision identifiers.",
            ],
        )
    )

    dated_docs = sum(1 for row in docs if _has_any_date(_metadata(row)))
    date_ratio = (dated_docs / total_docs) if total_docs else 0.0
    checks.append(
        EvidenceCheck(
            check_id="publish_or_decision_date_completeness",
            status=_status_from_ratio(date_ratio) if total_docs else "MISSING",
            observed={
                "total_docs": total_docs,
                "dated_docs": dated_docs,
                "coverage_ratio": round(date_ratio, 4),
            },
            missing_evidence=[] if date_ratio >= 0.80 else [
                "Metadata date fields are missing on a material portion of documents.",
                "Need deterministic date extraction + ingestion validation logs.",
            ],
        )
    )

    topic_docs = sum(1 for row in docs if _topic_count(_metadata(row)) > 0)
    topic_ratio = (topic_docs / total_docs) if total_docs else 0.0
    checks.append(
        EvidenceCheck(
            check_id="topic_taxonomy_coverage",
            status=_status_from_ratio(topic_ratio) if total_docs else "MISSING",
            observed={
                "total_docs": total_docs,
                "topic_tagged_docs": topic_docs,
                "coverage_ratio": round(topic_ratio, 4),
            },
            missing_evidence=[] if topic_ratio >= 0.80 else [
                "Topic taxonomy tags are not consistently present.",
                "Need controlled taxonomy dictionary and tagging pipeline evidence.",
            ],
        )
    )

    trace_count = len(traces)
    discovered_runtime_models: set[str] = set()
    discovered_expected_models: set[str] = set()
    lane_counts = {"instruct": 0, "thinking": 0}
    mapping_evidence_rows = 0
    mapping_verified_rows = 0
    for row in traces:
        lane = _tier_lane_from_trace(row)
        lane_counts[lane] = lane_counts.get(lane, 0) + 1

        expected = _expected_model_from_trace(row)
        runtime = _runtime_model_from_trace(row)
        if expected:
            discovered_expected_models.add(expected)
        if runtime:
            discovered_runtime_models.add(runtime)

        meta = _metadata(row)
        mapping_complete = bool(meta.get("model_mapping_evidence_complete"))
        if not mapping_complete:
            mapping_complete = bool(expected) and bool(lane)
        if mapping_complete:
            mapping_evidence_rows += 1

        verified = meta.get("model_mapping_verified")
        if isinstance(verified, bool) and verified:
            mapping_verified_rows += 1

    qwen_instruct_seen = _qwen_lane_seen(discovered_runtime_models | discovered_expected_models, "instruct")
    qwen_thinking_seen = _qwen_lane_seen(discovered_runtime_models | discovered_expected_models, "thinking")
    mapping_ratio = (mapping_evidence_rows / trace_count) if trace_count else 0.0
    verified_ratio = (mapping_verified_rows / trace_count) if trace_count else 0.0
    if trace_count == 0:
        model_status = "MISSING"
    elif mapping_ratio >= 0.80 and qwen_instruct_seen and qwen_thinking_seen:
        model_status = "SUFFICIENT"
    elif mapping_ratio > 0:
        model_status = "PARTIAL"
    else:
        model_status = "MISSING"
    model_missing: list[str] = []
    if trace_count == 0:
        model_missing.append("No rag_v3_query_traces rows found; runtime model mapping cannot be verified.")
    if trace_count > 0 and mapping_ratio < 0.80:
        model_missing.append("Trace metadata lacks sufficient model lane/expected mapping evidence coverage.")
        model_missing.append("Need model_lane + model_expected_version + model_mapping_verified in trace metadata.")
    if trace_count > 0 and not qwen_instruct_seen:
        model_missing.append("Qwen Instruct mapping evidence not observed in query traces.")
    if trace_count > 0 and not qwen_thinking_seen:
        model_missing.append("Qwen Thinking mapping evidence not observed in query traces.")
    if trace_count > 0 and not (qwen_instruct_seen and qwen_thinking_seen):
        model_missing.append("Qwen Instruct/Thinking fingerprints were not observed in query traces.")
        model_missing.append("Need production trace evidence linking tasks -> model lane.")
    checks.append(
        EvidenceCheck(
            check_id="runtime_model_mapping_evidence",
            status=model_status,
            observed={
                "trace_count": trace_count,
                "mapping_evidence_rows": mapping_evidence_rows,
                "mapping_coverage_ratio": round(mapping_ratio, 4),
                "mapping_verified_rows": mapping_verified_rows,
                "mapping_verified_ratio": round(verified_ratio, 4),
                "lane_counts": lane_counts,
                "observed_runtime_models": sorted(discovered_runtime_models)[:20],
                "observed_expected_models": sorted(discovered_expected_models)[:20],
                "qwen_instruct_seen": qwen_instruct_seen,
                "qwen_thinking_seen": qwen_thinking_seen,
            },
            missing_evidence=model_missing,
        )
    )
    return checks


def _markdown_report(*, generated_at: str, checks: list[EvidenceCheck]) -> str:
    lines = [
        "# Ek Kanit Gerekli Alanlar Raporu",
        "",
        f"- generated_at_utc: `{generated_at}`",
        "",
        "| check_id | status | observed |",
        "|---|---|---|",
    ]
    for item in checks:
        observed = json.dumps(item.observed, ensure_ascii=True, separators=(",", ":"))
        lines.append(f"| {item.check_id} | {item.status} | `{observed}` |")

    missing_rows = [item for item in checks if item.status != "SUFFICIENT"]
    lines.extend(["", "## Ek kanit gerekli alanlar", ""])
    if not missing_rows:
        lines.append("- Ek kanit gerektiren alan bulunmadi.")
    else:
        for item in missing_rows:
            lines.append(f"- {item.check_id} ({item.status})")
            for reason in item.missing_evidence:
                lines.append(f"  - {reason}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate additional evidence gap report for legal RAG.")
    parser.add_argument(
        "--json-out",
        default=str(BACKEND_ROOT / "artifacts" / "evidence-gap-report.json"),
        help="Output JSON path.",
    )
    parser.add_argument(
        "--md-out",
        default=str(BACKEND_ROOT / "artifacts" / "evidence-gap-report.md"),
        help="Output Markdown path.",
    )
    args = parser.parse_args()

    generated_at = datetime.now(timezone.utc).isoformat()
    output_json = Path(args.json_out).resolve()
    output_md = Path(args.md_out).resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)

    checks: list[EvidenceCheck] = []
    global_errors: list[str] = []
    docs: list[dict[str, Any]] = []
    traces: list[dict[str, Any]] = []
    client = None
    try:
        client = get_supabase_client()
    except Exception as exc:  # noqa: BLE001
        global_errors.append(f"supabase_client_init_failed:{exc}")

    if client is not None:
        try:
            docs = _read_rows(client, table="rag_documents", columns="id,source_type,source_id,metadata")
        except Exception as exc:  # noqa: BLE001
            global_errors.append(f"rag_documents_query_failed:{exc}")
        try:
            traces = _read_rows(
                client,
                table="rag_v3_query_traces",
                columns="fingerprint,metadata,requested_tier,effective_tier,created_at",
            )
        except Exception as exc:  # noqa: BLE001
            global_errors.append(f"rag_v3_query_traces_query_failed:{exc}")

    if docs or traces:
        checks = build_checks(docs=docs, traces=traces)
    else:
        checks = [
            EvidenceCheck(
                check_id="runtime_data_access",
                status="MISSING",
                observed={},
                missing_evidence=[
                    "Supabase runtime data could not be queried.",
                    "Configure SUPABASE_URL/SUPABASE_SERVICE_KEY and rerun report.",
                ],
                notes=global_errors[:5],
            )
        ]

    payload = {
        "report_version": "evidence_gap.v1",
        "generated_at": generated_at,
        "checks": [asdict(item) for item in checks],
        "global_errors": global_errors,
    }
    output_json.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    output_md.write_text(_markdown_report(generated_at=generated_at, checks=checks), encoding="utf-8")

    print(f"[evidence-gap] JSON: {output_json}")
    print(f"[evidence-gap] MD:   {output_md}")
    if global_errors:
        print("[evidence-gap] completed with global_errors")
        return 2
    print("[evidence-gap] completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
