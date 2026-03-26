"""Runtime security contract checks (TLS/KMS/key-rotation evidence)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from infrastructure.config import settings


@dataclass(frozen=True)
class RuntimeSecurityReport:
    checks: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return len(self.errors) == 0


def evaluate_runtime_security_contract(*, repo_root: str | Path | None = None) -> RuntimeSecurityReport:
    root = Path(repo_root or Path.cwd()).resolve()
    checks: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []

    prod_like = bool(settings.is_production or bool(getattr(settings, "tenant_enforce_in_dev", False)))

    checks.append("auth_contract")
    auth_errors, auth_warnings = _check_auth_contract(prod_like=prod_like)
    errors.extend(auth_errors)
    warnings.extend(auth_warnings)

    if bool(getattr(settings, "security_require_tls", True)):
        tls_errors = _check_tls_contract(prod_like=prod_like)
        checks.append("tls_contract")
        errors.extend(tls_errors)

    if bool(getattr(settings, "security_require_kms", True)):
        checks.append("kms_contract")
        kms_key = str(getattr(settings, "kms_key_id", "") or "").strip()
        if prod_like and not kms_key:
            errors.append("kms_key_id_missing")
        elif not kms_key:
            warnings.append("kms_key_id_missing_nonprod")

    if bool(getattr(settings, "security_require_secret_rotation_evidence", True)):
        checks.append("rotation_evidence_contract")
        evidence_path = str(getattr(settings, "security_rotation_evidence_file", "") or "").strip()
        if not evidence_path:
            errors.append("rotation_evidence_path_missing")
        else:
            abs_path = (root / evidence_path).resolve() if not Path(evidence_path).is_absolute() else Path(evidence_path)
            if not abs_path.exists():
                errors.append(f"rotation_evidence_missing:{abs_path}")
            else:
                _validate_rotation_evidence(abs_path, warnings=warnings, errors=errors)

    if bool(getattr(settings, "rag_v3_enforce_tier_strategy_contract", True)):
        checks.append("tier_strategy_contract")
        tier_errors, tier_warnings = _check_tier_strategy_contract(prod_like=prod_like)
        errors.extend(tier_errors)
        warnings.extend(tier_warnings)

    checks.append("sso_capability_contract")
    sso_errors, sso_warnings = _check_sso_capability_contract(prod_like=prod_like)
    errors.extend(sso_errors)
    warnings.extend(sso_warnings)

    checks.append("alerting_contract")
    alert_errors, alert_warnings = _check_alerting_contract(prod_like=prod_like)
    errors.extend(alert_errors)
    warnings.extend(alert_warnings)

    checks.append("compliance_artifact_contract")
    compliance_errors, compliance_warnings = _check_compliance_artifact_contract(prod_like=prod_like, root=root)
    errors.extend(compliance_errors)
    warnings.extend(compliance_warnings)

    return RuntimeSecurityReport(checks=checks, warnings=warnings, errors=errors)


def enforce_runtime_security_contract(*, repo_root: str | Path | None = None) -> RuntimeSecurityReport:
    report = evaluate_runtime_security_contract(repo_root=repo_root)
    fail_closed = bool(getattr(settings, "security_runtime_fail_closed", True))
    if fail_closed and settings.is_production and not report.passed:
        raise RuntimeError("Runtime security contract failed: " + ", ".join(report.errors))
    return report


def _check_tls_contract(*, prod_like: bool) -> list[str]:
    errors: list[str] = []
    supabase_url = str(getattr(settings, "supabase_url", "") or "").strip().lower()
    if prod_like and supabase_url and not supabase_url.startswith("https://"):
        errors.append("supabase_url_not_https")

    for field_name in ("openai_base_url", "embedding_base_url"):
        value = str(getattr(settings, field_name, "") or "").strip().lower()
        if not value:
            continue
        if value.startswith("https://"):
            continue
        if value.startswith("http://localhost") or value.startswith("http://127.0.0.1"):
            continue
        if prod_like:
            errors.append(f"{field_name}_not_https")

    tls_cert_path = str(getattr(settings, "tls_cert_path", "") or "").strip()
    if prod_like and not tls_cert_path:
        errors.append("tls_cert_path_missing")
    if tls_cert_path and not Path(tls_cert_path).exists():
        errors.append(f"tls_cert_path_not_found:{tls_cert_path}")

    return errors


def _check_auth_contract(*, prod_like: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    protected_prefixes = [
        token.strip()
        for token in str(getattr(settings, "auth_required_path_prefixes", "") or "").split(",")
        if token.strip()
    ]
    auth_enabled = bool(getattr(settings, "auth_enforce_bearer", False))
    verify_signature = bool(getattr(settings, "auth_verify_jwt_signature", True))
    use_jwks = bool(getattr(settings, "auth_jwt_use_jwks", False))
    require_jwks_prod = bool(getattr(settings, "auth_require_jwks_in_production", True))
    auth_issuer = str(getattr(settings, "auth_jwt_issuer", "") or "").strip()
    jwks_url = str(getattr(settings, "auth_jwks_url", "") or "").strip()
    jwt_secret = str(getattr(settings, "jwt_secret_key", "") or "").strip()

    if prod_like and protected_prefixes and not auth_enabled:
        errors.append("auth_bearer_enforcement_disabled")
    elif protected_prefixes and not auth_enabled:
        warnings.append("auth_bearer_enforcement_disabled_nonprod")

    if prod_like and auth_enabled and not verify_signature:
        errors.append("auth_signature_verification_disabled")
    elif auth_enabled and not verify_signature:
        warnings.append("auth_signature_verification_disabled_nonprod")

    if auth_enabled and verify_signature and use_jwks:
        if prod_like and require_jwks_prod:
            if not jwks_url:
                errors.append("auth_jwks_url_missing")
            elif not jwks_url.lower().startswith("https://"):
                errors.append("auth_jwks_url_not_https")
            if not auth_issuer:
                errors.append("auth_jwt_issuer_missing")
        else:
            if not jwks_url:
                warnings.append("auth_jwks_url_missing_nonprod")
            elif not _is_safe_nonprod_auth_url(jwks_url):
                warnings.append("auth_jwks_url_not_https_nonprod")
    elif auth_enabled and verify_signature and prod_like and require_jwks_prod:
        errors.append("auth_jwks_required_in_production")

    if auth_enabled and verify_signature and not use_jwks:
        if prod_like and _looks_insecure_default_secret(jwt_secret):
            errors.append("jwt_secret_key_insecure_default")
        elif _looks_insecure_default_secret(jwt_secret):
            warnings.append("jwt_secret_key_insecure_default_nonprod")

    secret_backend = str(getattr(settings, "secret_manager_backend", "env") or "env").strip().lower()
    require_secret_manager = bool(getattr(settings, "secret_manager_required_in_production", True))
    if prod_like and require_secret_manager and secret_backend == "env":
        errors.append("secret_manager_backend_env_forbidden_in_production")
    return errors, warnings


def _looks_insecure_default_secret(secret: str) -> bool:
    token = str(secret or "").strip()
    if not token:
        return True
    if token == "dev-secret-key-change-in-production":
        return True
    if len(token) < 24:
        return True
    return False


def _is_safe_nonprod_auth_url(url: str) -> bool:
    token = str(url or "").strip().lower()
    if not token:
        return False
    if token.startswith("https://"):
        return True
    if token.startswith("http://localhost") or token.startswith("http://127.0.0.1"):
        return True
    return False


def _validate_rotation_evidence(path: Path, *, warnings: list[str], errors: list[str]) -> None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        errors.append(f"rotation_evidence_invalid_json:{exc}")
        return

    if not isinstance(payload, dict):
        errors.append("rotation_evidence_invalid_root")
        return

    rotated_at_raw = str(payload.get("rotated_at") or "").strip()
    if not rotated_at_raw:
        errors.append("rotation_evidence_missing_rotated_at")
        return

    try:
        normalized = rotated_at_raw.replace("Z", "+00:00")
        rotated_at = datetime.fromisoformat(normalized)
        if rotated_at.tzinfo is None:
            rotated_at = rotated_at.replace(tzinfo=timezone.utc)
    except Exception:
        errors.append("rotation_evidence_invalid_rotated_at")
        return

    age_days = (datetime.now(timezone.utc) - rotated_at.astimezone(timezone.utc)).days
    if age_days > 120:
        errors.append(f"rotation_evidence_too_old:{age_days}d")
    elif age_days > 90:
        warnings.append(f"rotation_evidence_near_expiry:{age_days}d")

    key_id = str(payload.get("kms_key_id") or "").strip()
    configured_key = str(getattr(settings, "kms_key_id", "") or "").strip()
    if configured_key and key_id and configured_key != key_id:
        errors.append("rotation_evidence_kms_key_mismatch")

    actor = str(payload.get("rotated_by") or "").strip()
    if not actor:
        warnings.append("rotation_evidence_missing_rotated_by")


def _check_tier_strategy_contract(*, prod_like: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    expected_provider = {
        "hazir": "openai",
        "dusunceli": "openai",
        "uzman": "openai",
        "muazzam": "openai",
    }
    provider_actual = {
        "hazir": str(getattr(settings, "ai_tier_hazir_provider", "") or "").strip().lower(),
        "dusunceli": str(getattr(settings, "ai_tier_dusunceli_provider", "") or "").strip().lower(),
        "uzman": str(getattr(settings, "ai_tier_uzman_provider", "") or "").strip().lower(),
        "muazzam": str(getattr(settings, "ai_tier_muazzam_provider", "") or "").strip().lower(),
    }
    for lane, expected in expected_provider.items():
        actual = provider_actual.get(lane, "")
        if actual == expected:
            continue
        code = f"tier_strategy_provider_mismatch:{lane}:{actual or 'missing'}!={expected}"
        if prod_like:
            errors.append(code)
        else:
            warnings.append(f"{code}:nonprod")

    model_actual = {
        "hazir": str(getattr(settings, "ai_tier_hazir_model", "") or "").strip().lower(),
        "dusunceli": str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip().lower(),
        "uzman": str(getattr(settings, "ai_tier_uzman_model", "") or "").strip().lower(),
        "muazzam": str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip().lower(),
    }
    model_expectations = {
        "hazir": ("qwen3-next-80b-a3b", "instruct"),
        "dusunceli": ("qwen3-next-80b-a3b", "instruct"),
        "uzman": ("qwen3-next-80b-a3b", "thinking"),
        "muazzam": ("qwen3-next-80b-a3b", "thinking"),
    }
    for lane, required_tokens in model_expectations.items():
        actual = model_actual.get(lane, "")
        if "14b" in actual or "32b" in actual:
            code = f"tier_strategy_model_disallowed_size:{lane}:{actual}"
            if prod_like:
                errors.append(code)
            else:
                warnings.append(f"{code}:nonprod")
            continue
        if actual and all(token in actual for token in required_tokens):
            continue
        token_blob = "+".join(required_tokens)
        code = f"tier_strategy_model_mismatch:{lane}:{actual or 'missing'}!~{token_blob}"
        if prod_like:
            errors.append(code)
        else:
            warnings.append(f"{code}:nonprod")

    fallback_model_actual = {
        "dusunceli": str(getattr(settings, "ai_tier_dusunceli_fallback_model", "") or "").strip().lower(),
        "uzman": str(getattr(settings, "ai_tier_uzman_fallback_model", "") or "").strip().lower(),
    }
    fallback_model_expectations = {
        "dusunceli": ("qwen3-next-80b-a3b", "instruct"),
        "uzman": ("qwen3-next-80b-a3b", "instruct"),
    }
    for lane, required_tokens in fallback_model_expectations.items():
        actual = fallback_model_actual.get(lane, "")
        if actual and all(token in actual for token in required_tokens):
            continue
        token_blob = "+".join(required_tokens)
        code = f"tier_strategy_fallback_model_mismatch:{lane}:{actual or 'missing'}!~{token_blob}"
        if prod_like:
            errors.append(code)
        else:
            warnings.append(f"{code}:nonprod")

    # Fail closed for cross-provider fallback to keep policy deterministic.
    for lane, expected in (("hazir", "openai"), ("dusunceli", "openai"), ("uzman", "openai"), ("muazzam", "openai")):
        fallback_provider = str(
            getattr(settings, f"ai_tier_{lane}_fallback_provider", "") or ""
        ).strip().lower()
        if fallback_provider == expected:
            continue
        code = f"tier_strategy_fallback_provider_mismatch:{lane}:{fallback_provider or 'missing'}!={expected}"
        if prod_like:
            errors.append(code)
        else:
            warnings.append(f"{code}:nonprod")

    return errors, warnings


def _check_sso_capability_contract(*, prod_like: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    oidc_enabled = bool(getattr(settings, "auth_enforce_bearer", False)) and bool(getattr(settings, "auth_jwt_use_jwks", False))
    oidc_url = str(getattr(settings, "auth_jwks_url", "") or "").strip()
    oidc_issuer = str(getattr(settings, "auth_jwt_issuer", "") or "").strip()
    oidc_verified = oidc_enabled and bool(getattr(settings, "auth_verify_jwt_signature", True)) and bool(oidc_url) and bool(oidc_issuer)

    if oidc_enabled and not oidc_url:
        code = "oidc_jwks_url_missing"
        (errors if prod_like else warnings).append(code)
    if oidc_enabled and not oidc_issuer:
        code = "oidc_issuer_missing"
        (errors if prod_like else warnings).append(code)
    if oidc_enabled and not oidc_verified:
        code = "oidc_not_verified"
        (errors if prod_like else warnings).append(code)

    saml_enabled = bool(getattr(settings, "saml_enabled", False))
    saml_metadata_url = str(getattr(settings, "saml_metadata_url", "") or "").strip()
    saml_entity_id = str(getattr(settings, "saml_entity_id", "") or "").strip()
    saml_verified = bool(getattr(settings, "saml_verified", False))
    require_verified = bool(getattr(settings, "sso_require_verified_in_production", True))

    if saml_enabled and not saml_metadata_url:
        code = "saml_metadata_url_missing"
        (errors if prod_like else warnings).append(code)
    if saml_enabled and saml_metadata_url and prod_like and not saml_metadata_url.lower().startswith("https://"):
        errors.append("saml_metadata_url_not_https")
    if saml_enabled and not saml_entity_id:
        code = "saml_entity_id_missing"
        (errors if prod_like else warnings).append(code)
    if saml_enabled and require_verified and not saml_verified:
        code = "saml_not_verified"
        (errors if prod_like else warnings).append(code)

    return errors, warnings


def _check_alerting_contract(*, prod_like: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    alerting_enabled = bool(getattr(settings, "alerting_enabled", True))
    webhook_url = str(getattr(settings, "alerting_webhook_url", "") or "").strip()
    slack_url = str(getattr(settings, "alerting_slack_webhook_url", "") or "").strip()
    siem_url = str(getattr(settings, "alerting_siem_webhook_url", "") or "").strip()
    pagerduty_url = str(getattr(settings, "alerting_pagerduty_events_url", "") or "").strip()
    pagerduty_key = str(getattr(settings, "alerting_pagerduty_routing_key", "") or "").strip()

    sink_count = sum(1 for value in (webhook_url, slack_url, siem_url, pagerduty_url) if value)
    require_sink = bool(getattr(settings, "alerting_require_sink_in_production", True))
    require_siem = bool(getattr(settings, "alerting_require_siem_in_production", True))

    if alerting_enabled and require_sink and sink_count == 0:
        code = "alerting_sink_missing"
        (errors if prod_like else warnings).append(code)

    if alerting_enabled and require_siem and not siem_url:
        code = "alerting_siem_sink_missing"
        (errors if prod_like else warnings).append(code)

    if pagerduty_url and not pagerduty_key:
        code = "alerting_pagerduty_routing_key_missing"
        (errors if prod_like else warnings).append(code)

    url_fields = {
        "alerting_webhook_url": webhook_url,
        "alerting_slack_webhook_url": slack_url,
        "alerting_siem_webhook_url": siem_url,
        "alerting_pagerduty_events_url": pagerduty_url,
    }
    for field_name, value in url_fields.items():
        if not value:
            continue
        if value.lower().startswith("https://"):
            continue
        code = f"{field_name}_not_https"
        if prod_like:
            errors.append(code)
        elif not _is_safe_nonprod_auth_url(value):
            warnings.append(f"{code}_nonprod")

    return errors, warnings


def _check_compliance_artifact_contract(*, prod_like: bool, root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    require_artifacts = bool(getattr(settings, "compliance_require_artifacts_in_production", True))
    if not require_artifacts:
        return errors, warnings

    artifact_map = {
        "retention_policy_contract": str(
            getattr(settings, "compliance_retention_policy_contract_path", "")
            or "docs/compliance/data-retention-policy.contract.json"
        ).strip(),
        "dpia_evidence": str(
            getattr(settings, "compliance_dpia_evidence_path", "")
            or "docs/compliance/evidence/dpia-technical-evidence.json"
        ).strip(),
        "ropa_evidence": str(
            getattr(settings, "compliance_ropa_evidence_path", "")
            or "docs/compliance/evidence/ropa-technical-evidence.json"
        ).strip(),
    }

    for key, raw_path in artifact_map.items():
        if not raw_path:
            code = f"compliance_artifact_path_missing:{key}"
            (errors if prod_like else warnings).append(code)
            continue

        path = Path(raw_path)
        absolute = path if path.is_absolute() else (root / raw_path).resolve()
        if absolute.exists():
            continue

        code = f"compliance_artifact_missing:{key}:{absolute}"
        (errors if prod_like else warnings).append(code)

    return errors, warnings


def active_model_fingerprint() -> dict[str, Any]:
    tiers = {
        "hazir": str(getattr(settings, "ai_tier_hazir_model", "") or "").strip(),
        "dusunceli": str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip(),
        "uzman": str(getattr(settings, "ai_tier_uzman_model", "") or "").strip(),
        "muazzam": str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip(),
    }
    disallowed: dict[str, str] = {}
    for lane, model in tiers.items():
        normalized = model.lower()
        if ("14b" in normalized or "32b" in normalized):
            disallowed[lane] = model
            continue
        if "qwen3-next-80b-a3b" not in normalized:
            disallowed[lane] = model
            continue
        if lane in {"hazir", "dusunceli"} and "instruct" not in normalized:
            disallowed[lane] = model
            continue
        if lane in {"uzman", "muazzam"} and "thinking" not in normalized:
            disallowed[lane] = model
    expected = {
        "synthesis": "Qwen3-Next-80B-A3B-Instruct",
        "analysis": "Qwen3-Next-80B-A3B-Thinking",
    }
    return {
        "tiers": tiers,
        "expected": expected,
        "drift_detected": bool(disallowed),
        "disallowed_models": disallowed,
        "verified_80b_runtime": (
            "qwen3-next-80b-a3b" in tiers["dusunceli"].lower()
            and "instruct" in tiers["dusunceli"].lower()
            and "qwen3-next-80b-a3b" in tiers["uzman"].lower()
            and "thinking" in tiers["uzman"].lower()
        ),
    }


__all__ = [
    "RuntimeSecurityReport",
    "evaluate_runtime_security_contract",
    "enforce_runtime_security_contract",
    "active_model_fingerprint",
]
