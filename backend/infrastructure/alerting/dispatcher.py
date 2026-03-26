from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from infrastructure.config import settings


@dataclass(frozen=True)
class AlertDispatchResult:
    fired: list[dict[str, Any]]
    delivered: int
    failed: int
    evaluated_rules: int = 0
    configured_sinks: list[str] = field(default_factory=list)
    missing_metric_rules: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AlertSinkResult:
    sink: str
    delivered: bool
    attempts: int = 1
    retryable: bool = False
    last_error: str | None = None


@dataclass(frozen=True)
class AlertDispatchAttempt:
    delivered: bool
    retryable: bool
    error: str | None = None


class AlertSinkAdapter:
    sink_name: str

    def dispatch(self, event: dict[str, Any]) -> AlertDispatchAttempt:
        raise NotImplementedError


@dataclass(frozen=True)
class HttpJsonSinkAdapter(AlertSinkAdapter):
    sink_name: str
    webhook_url: str

    def dispatch(self, event: dict[str, Any]) -> AlertDispatchAttempt:
        return _dispatch_webhook(webhook_url=self.webhook_url, payload=event)


@dataclass(frozen=True)
class SlackSinkAdapter(AlertSinkAdapter):
    sink_name: str
    webhook_url: str

    def dispatch(self, event: dict[str, Any]) -> AlertDispatchAttempt:
        payload = {
            "text": f"[{event.get('severity', 'info')}] {event.get('rule', 'rag_v3_alert')}",
            "attachments": [
                {
                    "color": "danger" if str(event.get("severity", "")).lower() in {"critical", "high"} else "warning",
                    "fields": [
                        {"title": "metric", "value": str(event.get("metric", "")), "short": True},
                        {"title": "value", "value": str(event.get("value", "")), "short": True},
                        {"title": "threshold", "value": str(event.get("threshold", "")), "short": True},
                        {"title": "operator", "value": str(event.get("operator", "")), "short": True},
                    ],
                    "text": str(event.get("summary", "")),
                }
            ],
        }
        return _dispatch_webhook(webhook_url=self.webhook_url, payload=payload)


@dataclass(frozen=True)
class SiemSinkAdapter(AlertSinkAdapter):
    sink_name: str
    webhook_url: str

    def dispatch(self, event: dict[str, Any]) -> AlertDispatchAttempt:
        payload = {
            "event": {
                "kind": "alert",
                "module": "rag_v3",
                "id": str(event.get("delivery_id") or uuid4()),
                "severity": str(event.get("severity") or "high").lower(),
                "created": str(event.get("triggered_at") or datetime.now(timezone.utc).isoformat()),
            },
            "rule": {
                "name": str(event.get("rule") or "unnamed"),
                "metric": str(event.get("metric") or ""),
                "operator": str(event.get("operator") or ""),
                "threshold": event.get("threshold"),
                "value": event.get("value"),
                "summary": str(event.get("summary") or ""),
            },
            "labels": {
                "pipeline": "rag_v3",
                "source": "observability",
            },
        }
        return _dispatch_webhook(webhook_url=self.webhook_url, payload=payload)


@dataclass(frozen=True)
class PagerDutySinkAdapter(AlertSinkAdapter):
    sink_name: str
    events_url: str
    routing_key: str

    def dispatch(self, event: dict[str, Any]) -> AlertDispatchAttempt:
        if not self.routing_key:
            return AlertDispatchAttempt(
                delivered=False,
                retryable=False,
                error="pagerduty_routing_key_missing",
            )
        payload = {
            "routing_key": self.routing_key,
            "event_action": "trigger",
            "payload": {
                "summary": str(event.get("summary") or event.get("rule") or "rag_v3_alert"),
                "severity": _pagerduty_severity(str(event.get("severity") or "warning")),
                "source": "rag_v3",
                "custom_details": event,
            },
        }
        return _dispatch_webhook(webhook_url=self.events_url, payload=payload)


def evaluate_and_dispatch_alerts(
    *,
    metrics: dict[str, float],
    repo_root: str | Path | None = None,
) -> AlertDispatchResult:
    if not bool(getattr(settings, "alerting_enabled", True)):
        return AlertDispatchResult(fired=[], delivered=0, failed=0)

    root = Path(repo_root or Path.cwd()).resolve()
    rules_path = root / "backend" / "ops" / "rag_v3_alert_rules.json"
    if not rules_path.exists():
        return AlertDispatchResult(fired=[], delivered=0, failed=0)

    payload = json.loads(rules_path.read_text(encoding="utf-8"))
    rules = list(payload.get("rules") or [])
    sinks = _resolve_sinks()
    fired: list[dict[str, Any]] = []
    delivered = 0
    failed = 0
    missing_metric_rules: list[str] = []
    evaluated_rules = 0

    for rule in rules:
        evaluated_rules += 1
        metric = str(rule.get("metric") or "").strip()
        if not metric:
            missing_metric_rules.append(str(rule.get("name") or "unnamed"))
            continue
        if metric not in metrics:
            missing_metric_rules.append(str(rule.get("name") or metric))
            continue
        value = float(metrics.get(metric) or 0.0)
        threshold = float(rule.get("threshold") or 0.0)
        operator = str(rule.get("operator") or "").strip()
        if not _is_triggered(value=value, threshold=threshold, operator=operator):
            continue

        event = {
            "event": "rag_v3_alert_rule_fired",
            "delivery_id": str(uuid4()),
            "rule": str(rule.get("name") or "unnamed"),
            "severity": str(rule.get("severity") or "high"),
            "metric": metric,
            "value": value,
            "threshold": threshold,
            "operator": operator,
            "summary": str(rule.get("summary") or ""),
            "triggered_at": datetime.now(timezone.utc).isoformat(),
        }
        fired.append(event)
        sink_results = _dispatch_with_retry(event, sinks=sinks)
        ok = bool(sink_results) and all(item.delivered for item in sink_results)
        _append_audit(event=event, delivered=ok, sink_results=sink_results, repo_root=root)
        if ok:
            delivered += 1
        else:
            failed += 1

    return AlertDispatchResult(
        fired=fired,
        delivered=delivered,
        failed=failed,
        evaluated_rules=evaluated_rules,
        configured_sinks=[sink.sink_name for sink in sinks],
        missing_metric_rules=list(dict.fromkeys(missing_metric_rules)),
    )


def _is_triggered(*, value: float, threshold: float, operator: str) -> bool:
    if operator == "<":
        return value < threshold
    if operator == ">":
        return value > threshold
    if operator == "<=":
        return value <= threshold
    if operator == ">=":
        return value >= threshold
    if operator == "==":
        return value == threshold
    return False


def _dispatch_with_retry(event: dict[str, Any], *, sinks: list[AlertSinkAdapter] | None = None) -> list[AlertSinkResult]:
    sinks = list(sinks) if sinks is not None else _resolve_sinks()
    if not sinks:
        return []
    attempts = max(1, int(getattr(settings, "alerting_retry_max_attempts", 3) or 3))
    base_delay = max(0.1, float(getattr(settings, "alerting_retry_backoff_s", 0.75) or 0.75))
    results: list[AlertSinkResult] = []
    for sink in sinks:
        sink_ok = False
        attempt_count = 0
        last_error: str | None = None
        retryable = False
        for attempt in range(1, attempts + 1):
            attempt_count = attempt
            outcome = sink.dispatch(event)
            retryable = bool(outcome.retryable)
            if outcome.error:
                last_error = outcome.error
            if outcome.delivered:
                sink_ok = True
                break
            if not outcome.retryable:
                break
            if attempt < attempts:
                time.sleep(base_delay * (2 ** (attempt - 1)))
        results.append(
            AlertSinkResult(
                sink=sink.sink_name,
                delivered=sink_ok,
                attempts=attempt_count,
                retryable=retryable,
                last_error=last_error,
            )
        )
    return results


def _dispatch_webhook(*, webhook_url: str, payload: dict[str, Any]) -> AlertDispatchAttempt:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4.0) as response:  # noqa: S310
            status = int(getattr(response, "status", 200) or 200)
            if 200 <= status < 300:
                return AlertDispatchAttempt(delivered=True, retryable=False)
            retryable = status in {408, 425, 429} or status >= 500
            return AlertDispatchAttempt(
                delivered=False,
                retryable=retryable,
                error=f"http_status_{status}",
            )
    except urllib.error.HTTPError as exc:
        status = int(getattr(exc, "code", 500) or 500)
        retryable = status in {408, 425, 429} or status >= 500
        return AlertDispatchAttempt(
            delivered=False,
            retryable=retryable,
            error=f"http_error_{status}",
        )
    except Exception as exc:  # noqa: BLE001
        return AlertDispatchAttempt(
            delivered=False,
            retryable=True,
            error=f"transport_error:{exc.__class__.__name__}",
        )


def _append_audit(*, event: dict[str, Any], delivered: bool, sink_results: list[AlertSinkResult], repo_root: Path) -> None:
    target = Path(str(getattr(settings, "alerting_audit_log_path", "artifacts/alert-delivery-audit.jsonl") or "").strip())
    path = target if target.is_absolute() else repo_root / target
    path.parent.mkdir(parents=True, exist_ok=True)
    record = dict(event)
    record["delivered"] = bool(delivered)
    record["sink_results"] = [
        {
            "sink": item.sink,
            "delivered": bool(item.delivered),
            "attempts": int(item.attempts),
            "retryable": bool(item.retryable),
            "last_error": item.last_error,
        }
        for item in sink_results
    ]
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _resolve_sinks() -> list[AlertSinkAdapter]:
    sinks: list[AlertSinkAdapter] = []
    webhook_url = str(getattr(settings, "alerting_webhook_url", "") or "").strip()
    if webhook_url:
        sinks.append(HttpJsonSinkAdapter(sink_name="webhook", webhook_url=webhook_url))

    slack_url = str(getattr(settings, "alerting_slack_webhook_url", "") or "").strip()
    if slack_url:
        sinks.append(SlackSinkAdapter(sink_name="slack", webhook_url=slack_url))

    siem_url = str(getattr(settings, "alerting_siem_webhook_url", "") or "").strip()
    if siem_url:
        sinks.append(SiemSinkAdapter(sink_name="siem", webhook_url=siem_url))

    pagerduty_url = str(getattr(settings, "alerting_pagerduty_events_url", "") or "").strip()
    pagerduty_key = str(getattr(settings, "alerting_pagerduty_routing_key", "") or "").strip()
    if pagerduty_url:
        sinks.append(
            PagerDutySinkAdapter(
                sink_name="pagerduty",
                events_url=pagerduty_url,
                routing_key=pagerduty_key,
            )
        )

    return sinks


def _pagerduty_severity(raw: str) -> str:
    token = raw.strip().lower()
    if token in {"critical", "high"}:
        return "critical"
    if token in {"medium", "warning"}:
        return "warning"
    return "info"
