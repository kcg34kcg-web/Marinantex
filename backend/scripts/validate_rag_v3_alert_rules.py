#!/usr/bin/env python3
"""Validate RAG v3 alert contract for observability/SRE enforcement."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REQUIRED_METRICS = {
    "rag_v3_retrieval_success_rate",
    "rag_v3_empty_result_rate",
    "rag_v3_low_confidence_rate",
    "rag_v3_no_answer_rate",
    "rag_v3_repealed_source_hit_rate",
    "rag_v3_latency_p95_ms",
    "rag_v3_provider_cost_per_1k_requests",
    "rag_v3_ingestion_failure_rate",
    "rag_v3_security_alert_count",
    "rag_v3_audit_pipeline_health",
}
ALLOWED_OPERATORS = {"<", "<=", ">", ">=", "=="}
ALLOWED_SEVERITIES = {"low", "medium", "high", "critical"}


def validate_alert_contract(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["contract root must be object"]

    contract_version = str(payload.get("contract_version") or "").strip()
    if not contract_version:
        errors.append("contract_version is required")

    rules = payload.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("rules must be non-empty list")
        return errors

    seen_names: set[str] = set()
    seen_metrics: set[str] = set()
    for index, rule in enumerate(rules, start=1):
        if not isinstance(rule, dict):
            errors.append(f"rule[{index}] must be object")
            continue
        name = str(rule.get("name") or "").strip()
        metric = str(rule.get("metric") or "").strip()
        operator = str(rule.get("operator") or "").strip()
        severity = str(rule.get("severity") or "").strip().lower()
        summary = str(rule.get("summary") or "").strip()
        threshold = rule.get("threshold")
        window = rule.get("window_minutes")

        if not name:
            errors.append(f"rule[{index}] name is required")
        elif name in seen_names:
            errors.append(f"rule[{index}] duplicate name: {name}")
        else:
            seen_names.add(name)

        if not metric:
            errors.append(f"rule[{index}] metric is required")
        else:
            seen_metrics.add(metric)

        if operator not in ALLOWED_OPERATORS:
            errors.append(f"rule[{index}] invalid operator: {operator}")
        if severity not in ALLOWED_SEVERITIES:
            errors.append(f"rule[{index}] invalid severity: {severity}")
        if not summary:
            errors.append(f"rule[{index}] summary is required")
        if not isinstance(window, int) or window <= 0:
            errors.append(f"rule[{index}] window_minutes must be positive integer")
        if not isinstance(threshold, (int, float)):
            errors.append(f"rule[{index}] threshold must be numeric")

    for metric in sorted(REQUIRED_METRICS):
        if metric not in seen_metrics:
            errors.append(f"missing required metric rule: {metric}")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate RAG v3 alert rules contract")
    parser.add_argument(
        "--path",
        default="ops/rag_v3_alert_rules.json",
        help="Path to alert contract JSON, relative to backend root",
    )
    parser.add_argument("--output", default=None, help="Optional output JSON report")
    args = parser.parse_args()

    backend_root = Path(__file__).resolve().parents[1]
    target = (backend_root / args.path).resolve() if not Path(args.path).is_absolute() else Path(args.path).resolve()
    report = {
        "path": str(target),
        "valid": False,
        "errors": [],
    }

    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        report["errors"] = [f"unable_to_read_contract: {exc}"]
    else:
        errors = validate_alert_contract(payload)
        report["errors"] = errors
        report["valid"] = len(errors) == 0

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not report["valid"]:
        print("[alert-rules] FAILED")
        for err in report["errors"]:
            print(f"- {err}")
        sys.exit(1)

    print("[alert-rules] OK")
    sys.exit(0)


if __name__ == "__main__":
    main()
