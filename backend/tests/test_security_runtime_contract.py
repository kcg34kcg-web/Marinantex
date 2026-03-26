"""Runtime security contract checks (TLS/KMS/rotation evidence)."""

from __future__ import annotations

import json

import pytest

from infrastructure.config import settings
from infrastructure.security.runtime_contract import (
    active_model_fingerprint,
    enforce_runtime_security_contract,
    evaluate_runtime_security_contract,
)


@pytest.fixture(autouse=True)
def _reset_security_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "tenant_enforce_in_dev", False)
    monkeypatch.setattr(settings, "security_runtime_fail_closed", True)
    monkeypatch.setattr(settings, "security_require_tls", True)
    monkeypatch.setattr(settings, "security_require_kms", True)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", True)
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "openai_base_url", "https://api.openai.com/v1")
    monkeypatch.setattr(settings, "embedding_base_url", "https://api.openai.com/v1")
    monkeypatch.setattr(settings, "tls_cert_path", "")
    monkeypatch.setattr(settings, "kms_key_id", "kms-key-1")
    monkeypatch.setattr(settings, "auth_required_path_prefixes", "/api/v1/rag-v3")
    monkeypatch.setattr(settings, "auth_enforce_bearer", True)
    monkeypatch.setattr(settings, "auth_verify_jwt_signature", True)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", False)
    monkeypatch.setattr(settings, "auth_jwks_url", None)
    monkeypatch.setattr(settings, "auth_require_jwks_in_production", True)
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "jwt_secret_key", "security-test-super-secret-key-32chars")
    monkeypatch.setattr(settings, "secret_manager_backend", "vault")
    monkeypatch.setattr(settings, "secret_manager_required_in_production", True)
    monkeypatch.setattr(settings, "rag_v3_enforce_tier_strategy_contract", True)
    monkeypatch.setattr(settings, "ai_tier_hazir_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_hazir_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_hazir_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_hazir_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_dusunceli_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_uzman_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_uzman_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")
    monkeypatch.setattr(settings, "ai_tier_uzman_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_uzman_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_muazzam_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_muazzam_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")
    monkeypatch.setattr(settings, "ai_tier_muazzam_fallback_provider", "openai")
    monkeypatch.setattr(settings, "ai_tier_muazzam_fallback_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")
    monkeypatch.setattr(settings, "alerting_enabled", True)
    monkeypatch.setattr(settings, "alerting_webhook_url", "https://hooks.example.com/incidents")
    monkeypatch.setattr(settings, "alerting_slack_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_siem_webhook_url", "https://siem.example.com/ingest")
    monkeypatch.setattr(settings, "alerting_pagerduty_events_url", None)
    monkeypatch.setattr(settings, "alerting_pagerduty_routing_key", None)
    monkeypatch.setattr(settings, "alerting_require_sink_in_production", True)
    monkeypatch.setattr(settings, "alerting_require_siem_in_production", True)
    monkeypatch.setattr(settings, "compliance_require_artifacts_in_production", False)


def test_runtime_contract_detects_missing_rotation_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    missing_path = tmp_path / "missing-rotation-evidence.json"
    monkeypatch.setattr(settings, "security_rotation_evidence_file", str(missing_path))

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert any(item.startswith("rotation_evidence_missing") for item in report.errors)


def test_runtime_contract_passes_with_valid_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    evidence = tmp_path / "rotation-evidence.json"
    evidence.write_text(
        json.dumps(
            {
                "rotated_at": "2026-03-01T10:00:00Z",
                "kms_key_id": "kms-key-1",
                "rotated_by": "security-bot",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "security_rotation_evidence_file", str(evidence))

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is True
    assert report.errors == []


def test_enforce_runtime_contract_raises_in_production(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    missing_path = tmp_path / "rotation-evidence-missing.json"
    monkeypatch.setattr(settings, "security_rotation_evidence_file", str(missing_path))
    monkeypatch.setattr(settings, "environment", "production")

    with pytest.raises(RuntimeError):
        enforce_runtime_security_contract(repo_root=tmp_path)


def test_runtime_contract_rejects_disabled_auth_enforcement_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_enforce_bearer", False)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "auth_bearer_enforcement_disabled" in report.errors


def test_runtime_contract_requires_jwks_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", False)
    monkeypatch.setattr(settings, "auth_require_jwks_in_production", True)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "auth_jwks_required_in_production" in report.errors


def test_runtime_contract_passes_with_production_jwks_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is True
    assert report.errors == []


def test_runtime_contract_rejects_tier_strategy_misalignment_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "ai_tier_hazir_provider", "google")
    monkeypatch.setattr(settings, "ai_tier_hazir_model", "Qwen/Qwen3-Next-80B-A3B-Instruct")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert any(item.startswith("tier_strategy_provider_mismatch:hazir") for item in report.errors)


def test_runtime_contract_accepts_expected_tier_strategy_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is True
    assert not any(item.startswith("tier_strategy_") for item in report.errors)


def test_runtime_contract_requires_non_env_secret_manager_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "secret_manager_backend", "env")
    monkeypatch.setattr(settings, "secret_manager_required_in_production", True)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "secret_manager_backend_env_forbidden_in_production" in report.errors


def test_active_model_fingerprint_detects_disallowed_sizes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_tier_dusunceli_model", "Qwen/Qwen3-14B-Instruct")
    monkeypatch.setattr(settings, "ai_tier_uzman_model", "Qwen/Qwen3-Next-80B-A3B-Thinking")

    payload = active_model_fingerprint()

    assert payload["drift_detected"] is True
    assert "dusunceli" in payload["disallowed_models"]


def test_runtime_contract_requires_verified_saml_when_enabled_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "saml_enabled", True)
    monkeypatch.setattr(settings, "saml_metadata_url", "https://idp.example.com/metadata")
    monkeypatch.setattr(settings, "saml_entity_id", "urn:example:sp")
    monkeypatch.setattr(settings, "saml_verified", False)
    monkeypatch.setattr(settings, "sso_require_verified_in_production", True)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "saml_not_verified" in report.errors


def test_runtime_contract_warns_for_partial_saml_setup_in_nonprod(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "saml_enabled", True)
    monkeypatch.setattr(settings, "saml_metadata_url", "")
    monkeypatch.setattr(settings, "saml_entity_id", "")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert "saml_metadata_url_missing" in report.warnings
    assert "saml_entity_id_missing" in report.warnings


def test_runtime_contract_requires_alert_sink_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "alerting_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_slack_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_siem_webhook_url", None)
    monkeypatch.setattr(settings, "alerting_pagerduty_events_url", None)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "alerting_sink_missing" in report.errors
    assert "alerting_siem_sink_missing" in report.errors


def test_runtime_contract_requires_pagerduty_key_when_endpoint_configured(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "alerting_pagerduty_events_url", "https://events.pagerduty.com/v2/enqueue")
    monkeypatch.setattr(settings, "alerting_pagerduty_routing_key", None)

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "alerting_pagerduty_routing_key_missing" in report.errors


def test_runtime_contract_requires_https_alert_sinks_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "alerting_webhook_url", "http://alerts.example.com/hook")
    monkeypatch.setattr(settings, "alerting_siem_webhook_url", "http://siem.example.com/ingest")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert "alerting_webhook_url_not_https" in report.errors
    assert "alerting_siem_webhook_url_not_https" in report.errors


def test_runtime_contract_requires_compliance_artifacts_in_production(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "compliance_require_artifacts_in_production", True)
    monkeypatch.setattr(settings, "compliance_retention_policy_contract_path", "docs/missing-retention.json")
    monkeypatch.setattr(settings, "compliance_dpia_evidence_path", "docs/missing-dpia.json")
    monkeypatch.setattr(settings, "compliance_ropa_evidence_path", "docs/missing-ropa.json")

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is False
    assert any(item.startswith("compliance_artifact_missing:retention_policy_contract") for item in report.errors)
    assert any(item.startswith("compliance_artifact_missing:dpia_evidence") for item in report.errors)
    assert any(item.startswith("compliance_artifact_missing:ropa_evidence") for item in report.errors)


def test_runtime_contract_accepts_present_compliance_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    retention = tmp_path / "retention-policy.json"
    dpia = tmp_path / "dpia.json"
    ropa = tmp_path / "ropa.json"
    retention.write_text("{}", encoding="utf-8")
    dpia.write_text("{}", encoding="utf-8")
    ropa.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "security_require_tls", False)
    monkeypatch.setattr(settings, "security_require_kms", False)
    monkeypatch.setattr(settings, "security_require_secret_rotation_evidence", False)
    monkeypatch.setattr(settings, "auth_jwt_use_jwks", True)
    monkeypatch.setattr(settings, "auth_jwks_url", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(settings, "auth_jwt_issuer", "https://issuer.example.com")
    monkeypatch.setattr(settings, "compliance_require_artifacts_in_production", True)
    monkeypatch.setattr(settings, "compliance_retention_policy_contract_path", str(retention))
    monkeypatch.setattr(settings, "compliance_dpia_evidence_path", str(dpia))
    monkeypatch.setattr(settings, "compliance_ropa_evidence_path", str(ropa))

    report = evaluate_runtime_security_contract(repo_root=tmp_path)

    assert report.passed is True
    assert not any(item.startswith("compliance_artifact_") for item in report.errors)
