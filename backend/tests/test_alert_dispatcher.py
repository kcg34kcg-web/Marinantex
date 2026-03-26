from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from infrastructure.alerting.dispatcher import evaluate_and_dispatch_alerts
from infrastructure.config import settings


def _write_rules(repo_root: Path) -> None:
    target = repo_root / "backend" / "ops"
    target.mkdir(parents=True, exist_ok=True)
    payload = {
        "rules": [
            {
                "name": "latency_high",
                "metric": "rag_v3_latency_p95_ms",
                "operator": ">",
                "threshold": 1000,
                "severity": "high",
                "summary": "Latency too high",
            }
        ]
    }
    (target / "rag_v3_alert_rules.json").write_text(json.dumps(payload), encoding="utf-8")


def test_alert_dispatch_writes_audit_and_retries(monkeypatch, tmp_path: Path) -> None:
    _write_rules(tmp_path)
    monkeypatch.setattr(settings, "alerting_enabled", True)
    monkeypatch.setattr(settings, "alerting_webhook_url", "https://example.test/webhook")
    monkeypatch.setattr(settings, "alerting_retry_max_attempts", 2)
    monkeypatch.setattr(settings, "alerting_retry_backoff_s", 0.01)
    monkeypatch.setattr(settings, "alerting_audit_log_path", str(tmp_path / "artifacts" / "alerts.jsonl"))

    calls = {"count": 0}

    class _Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_urlopen(req, timeout=0):  # noqa: ANN001
        calls["count"] += 1
        if calls["count"] == 1:
            raise RuntimeError("transient failure")
        return _Resp()

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        result = evaluate_and_dispatch_alerts(
            metrics={"rag_v3_latency_p95_ms": 2500.0},
            repo_root=tmp_path,
        )

    assert len(result.fired) == 1
    assert result.delivered == 1
    assert result.failed == 0
    assert result.evaluated_rules == 1
    assert result.configured_sinks == ["webhook"]
    assert result.missing_metric_rules == []
    assert calls["count"] == 2
    audit = (tmp_path / "artifacts" / "alerts.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(audit) == 1
    payload = json.loads(audit[0])
    assert payload["rule"] == "latency_high"
    assert payload["delivered"] is True
    sink_row = payload["sink_results"][0]
    assert sink_row["sink"] == "webhook"
    assert sink_row["attempts"] == 2
    assert sink_row["last_error"] == "transport_error:RuntimeError"


def test_alert_dispatch_fanout_includes_siem_sink(monkeypatch, tmp_path: Path) -> None:
    _write_rules(tmp_path)
    monkeypatch.setattr(settings, "alerting_enabled", True)
    monkeypatch.setattr(settings, "alerting_webhook_url", "https://example.test/webhook")
    monkeypatch.setattr(settings, "alerting_siem_webhook_url", "https://example.test/siem")
    monkeypatch.setattr(settings, "alerting_retry_max_attempts", 1)
    monkeypatch.setattr(settings, "alerting_audit_log_path", str(tmp_path / "artifacts" / "alerts.jsonl"))

    called_urls: list[str] = []

    class _Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_urlopen(req, timeout=0):  # noqa: ANN001
        called_urls.append(getattr(req, "full_url", ""))
        return _Resp()

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        result = evaluate_and_dispatch_alerts(
            metrics={"rag_v3_latency_p95_ms": 2500.0},
            repo_root=tmp_path,
        )

    assert result.delivered == 1
    assert set(result.configured_sinks) == {"webhook", "siem"}
    assert "https://example.test/webhook" in called_urls
    assert "https://example.test/siem" in called_urls
    audit = (tmp_path / "artifacts" / "alerts.jsonl").read_text(encoding="utf-8").strip().splitlines()
    payload = json.loads(audit[0])
    sinks = {item["sink"]: bool(item["delivered"]) for item in payload.get("sink_results") or []}
    assert sinks.get("webhook") is True
    assert sinks.get("siem") is True


def test_alert_dispatch_does_not_retry_on_http_400(monkeypatch, tmp_path: Path) -> None:
    _write_rules(tmp_path)
    monkeypatch.setattr(settings, "alerting_enabled", True)
    monkeypatch.setattr(settings, "alerting_webhook_url", "https://example.test/webhook")
    monkeypatch.setattr(settings, "alerting_retry_max_attempts", 3)
    monkeypatch.setattr(settings, "alerting_retry_backoff_s", 0.01)
    monkeypatch.setattr(settings, "alerting_audit_log_path", str(tmp_path / "artifacts" / "alerts.jsonl"))

    calls = {"count": 0}

    def _fake_urlopen(req, timeout=0):  # noqa: ANN001
        calls["count"] += 1
        raise urllib.error.HTTPError(
            url=getattr(req, "full_url", "https://example.test/webhook"),
            code=400,
            msg="bad request",
            hdrs=None,
            fp=None,
        )

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        result = evaluate_and_dispatch_alerts(
            metrics={"rag_v3_latency_p95_ms": 2500.0},
            repo_root=tmp_path,
        )

    assert result.delivered == 0
    assert result.failed == 1
    assert calls["count"] == 1
    audit = (tmp_path / "artifacts" / "alerts.jsonl").read_text(encoding="utf-8").strip().splitlines()
    payload = json.loads(audit[0])
    sink_row = payload["sink_results"][0]
    assert sink_row["attempts"] == 1
    assert sink_row["retryable"] is False
    assert sink_row["last_error"] == "http_error_400"


def test_alert_dispatch_reports_missing_metric_rules(monkeypatch, tmp_path: Path) -> None:
    _write_rules(tmp_path)
    monkeypatch.setattr(settings, "alerting_enabled", True)
    monkeypatch.setattr(settings, "alerting_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_slack_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_siem_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_pagerduty_events_url", None)

    result = evaluate_and_dispatch_alerts(
        metrics={},
        repo_root=tmp_path,
    )

    assert result.evaluated_rules == 1
    assert result.fired == []
    assert result.delivered == 0
    assert result.failed == 0
    assert result.configured_sinks == []
    assert "latency_high" in result.missing_metric_rules
