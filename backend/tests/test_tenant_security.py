"""
Tests for Step 6 — KVKK Güvenliği ve Multi-Tenancy
====================================================
Groups:
    A — TenantContext domain object          (8 tests)
    B — KVKKRedactor PII patterns           (12 tests)
    C — validate_bureau_id + header extract  (7 tests)
    D — TenantMiddleware HTTP enforcement    (8 tests)
    E — RAGQueryRequest bureau_id field      (4 tests)

Total: 39 new tests  →  252 + 39 = 291 passing target
"""

from __future__ import annotations

import dataclasses
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.schemas import RAGQueryRequest
from domain.entities.tenant import AccessLevel, Bureau, TenantContext
from infrastructure.security.kvkk_redactor import KVKKRedactor, RedactionRecord
from infrastructure.security.tenant_context import (
    extract_bureau_id_from_headers,
    validate_bureau_id,
)

# ---------------------------------------------------------------------------
# Shared test constants
# ---------------------------------------------------------------------------

# A valid UUID4: third group starts with "4", fourth group starts with "a" (variant 1)
_VALID_UUID4 = "550e8400-e29b-41d4-a716-446655440000"

# UUID3-like: third group starts with "3" — fails UUID4 validation
_UUID3_LIKE = "550e8400-e29b-31d4-a716-446655440000"

_SETTINGS_PATH = "api.middleware.tenant_middleware.settings"


# ============================================================================
# A — TenantContext domain object
# ============================================================================

class TestTenantContextDomain:
    """Group A: TenantContext + Bureau frozen dataclasses and factory methods."""

    def test_anonymous_has_no_bureau_id(self) -> None:
        ctx = TenantContext.anonymous()
        assert ctx.bureau_id is None

    def test_anonymous_access_level_is_read_only(self) -> None:
        ctx = TenantContext.anonymous()
        assert ctx.access_level == AccessLevel.READ_ONLY

    def test_anonymous_is_not_isolated(self) -> None:
        ctx = TenantContext.anonymous()
        assert ctx.is_isolated is False

    def test_service_account_is_not_isolated(self) -> None:
        ctx = TenantContext.service()
        assert ctx.is_service_account is True
        assert ctx.is_isolated is False

    def test_is_isolated_true_when_bureau_id_set_and_not_service(self) -> None:
        ctx = TenantContext(
            bureau_id=_VALID_UUID4,
            user_id=None,
            access_level=AccessLevel.MEMBER,
        )
        assert ctx.is_isolated is True

    def test_is_isolated_false_when_bureau_id_set_but_service_account(self) -> None:
        ctx = TenantContext(
            bureau_id=_VALID_UUID4,
            user_id=None,
            access_level=AccessLevel.OWNER,
            is_service_account=True,
        )
        assert ctx.is_isolated is False

    def test_tenant_context_is_frozen(self) -> None:
        ctx = TenantContext.anonymous()
        with pytest.raises((dataclasses.FrozenInstanceError, AttributeError)):
            ctx.bureau_id = "should-fail"  # type: ignore[misc]

    def test_bureau_is_frozen(self) -> None:
        bureau = Bureau(id="1", name="Test Büro", slug="test-buro")
        with pytest.raises((dataclasses.FrozenInstanceError, AttributeError)):
            bureau.name = "Changed"  # type: ignore[misc]


# ============================================================================
# B — KVKKRedactor
# ============================================================================

class TestKVKKRedactor:
    """Group B: Irreversible PII redaction for Turkish personal data."""

    @pytest.fixture()
    def redactor(self) -> KVKKRedactor:
        return KVKKRedactor()

    def test_empty_string_returns_empty_and_no_records(
        self, redactor: KVKKRedactor
    ) -> None:
        text, records = redactor.redact("")
        assert text == ""
        assert records == []

    def test_tc_kimlik_is_replaced(self, redactor: KVKKRedactor) -> None:
        text, records = redactor.redact("TC No: 12345678901 aradı.")
        assert "[TC_KİMLİK]" in text
        assert "12345678901" not in text
        assert len(records) == 1
        assert records[0].pii_type == "TC_KIMLIK"

    def test_turkish_iban_is_replaced(self, redactor: KVKKRedactor) -> None:
        # TR + exactly 24 digits = 26-char IBAN
        iban = "TR330006100519786457841326"
        text, records = redactor.redact(f"IBAN numarası: {iban}")
        assert "[IBAN]" in text
        assert iban not in text
        assert len(records) >= 1
        assert records[0].pii_type == "IBAN"

    def test_turkish_mobile_phone_is_replaced(self, redactor: KVKKRedactor) -> None:
        text, records = redactor.redact("Lütfen 0532 123 45 67 numarasını arayın.")
        assert "[TELEFON]" in text
        assert "0532" not in text
        assert len(records) >= 1
        assert records[0].pii_type == "TELEFON"

    def test_email_is_replaced(self, redactor: KVKKRedactor) -> None:
        text, records = redactor.redact("E-posta: avukat@hukuk.com.tr")
        assert "[EPOSTA]" in text
        assert "avukat@hukuk.com.tr" not in text
        assert len(records) == 1
        assert records[0].pii_type == "EPOSTA"

    def test_street_address_is_replaced(self, redactor: KVKKRedactor) -> None:
        # "23. Sokak" matches first alternative: \b\d+\.?\s*(?:Sokak...)
        text, records = redactor.redact("Adres: 23. Sokak, Bakırköy")
        assert "[ADRES]" in text
        assert len(records) >= 1
        assert any(r.pii_type == "ADRES" for r in records)

    def test_multiple_pii_types_all_replaced(self, redactor: KVKKRedactor) -> None:
        raw = "TC: 12345678901  E-posta: test@avukat.com"
        redacted, records = redactor.redact(raw)
        assert "[TC_KİMLİK]" in redacted
        assert "[EPOSTA]" in redacted
        assert "12345678901" not in redacted
        assert "test@avukat.com" not in redacted
        assert len(records) == 2

    def test_redaction_record_has_no_original_value_field(
        self, redactor: KVKKRedactor
    ) -> None:
        """Data minimisation: RedactionRecord must NOT store the original PII value."""
        _, records = redactor.redact("TC: 12345678901")
        assert len(records) == 1
        rec = records[0]
        assert not hasattr(rec, "original_value"), (
            "RedactionRecord must not retain original PII — KVKK data minimisation"
        )
        assert not hasattr(rec, "original"), (
            "RedactionRecord must not retain original PII — KVKK data minimisation"
        )

    def test_has_pii_true_for_tc_kimlik(self, redactor: KVKKRedactor) -> None:
        assert redactor.has_pii("Müvekkil 12345678901 nolu vatandaş") is True

    def test_has_pii_false_for_clean_text(self, redactor: KVKKRedactor) -> None:
        assert redactor.has_pii(
            "İş Kanunu md. 17 kapsamında ihbar tazminatı nasıl hesaplanır?"
        ) is False

    def test_redact_for_log_returns_str_not_tuple(self, redactor: KVKKRedactor) -> None:
        result = redactor.redact_for_log("TC: 12345678901")
        assert isinstance(result, str)
        assert "[TC_KİMLİK]" in result

    def test_redaction_is_idempotent(self, redactor: KVKKRedactor) -> None:
        """Redacting an already-redacted string must produce zero further changes."""
        original = "TC: 12345678901"
        once, _ = redactor.redact(original)
        twice, records2 = redactor.redact(once)
        assert twice == once
        assert records2 == []


# ============================================================================
# C — validate_bureau_id + extract_bureau_id_from_headers
# ============================================================================

class TestValidateBureauId:
    """Group C: UUID4 format validation."""

    def test_valid_uuid4_returns_true(self) -> None:
        assert validate_bureau_id(_VALID_UUID4) is True

    def test_uuid_wrong_version_returns_false(self) -> None:
        # Third group starts with "3" (UUID v3), not "4"
        assert validate_bureau_id(_UUID3_LIKE) is False

    def test_non_uuid_string_returns_false(self) -> None:
        assert validate_bureau_id("not-a-uuid") is False

    def test_none_returns_false(self) -> None:
        assert validate_bureau_id(None) is False

    def test_empty_string_returns_false(self) -> None:
        assert validate_bureau_id("") is False

    def test_extract_bureau_id_present_lowercase(self) -> None:
        headers = {"x-bureau-id": _VALID_UUID4}
        result = extract_bureau_id_from_headers(headers)
        assert result == _VALID_UUID4

    def test_extract_bureau_id_absent_returns_none(self) -> None:
        result = extract_bureau_id_from_headers({})
        assert result is None


# ============================================================================
# D — TenantMiddleware HTTP enforcement
# ============================================================================

def _make_test_app() -> FastAPI:
    """
    Minimal FastAPI app with TenantMiddleware for integration testing.

    Exposes:
        GET /ping   — returns bureau_id and is_isolated from request.state.tenant
        GET /health — always returns 200 (included in SKIP_PATHS)
    """
    from api.middleware.tenant_middleware import TenantMiddleware

    app = FastAPI()
    app.add_middleware(TenantMiddleware)

    @app.get("/ping")
    async def ping(request: Request):  # type: ignore[misc]
        tenant = getattr(request.state, "tenant", None)
        return {
            "bureau_id": tenant.bureau_id if tenant else None,
            "is_isolated": tenant.is_isolated if tenant else False,
        }

    @app.get("/health")
    async def health():  # type: ignore[misc]
        return {"status": "ok"}

    return app


class TestTenantMiddleware:
    """Group D: HTTP-level bureau_id enforcement via TenantMiddleware."""

    def test_skip_path_always_returns_200(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = True
            s.tenant_enforce_in_dev = True
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/health")
        assert resp.status_code == 200

    def test_valid_bureau_id_attaches_context(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = False
            s.tenant_enforce_in_dev = False
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping", headers={"X-Bureau-ID": _VALID_UUID4})
        assert resp.status_code == 200
        assert resp.json()["bureau_id"] == _VALID_UUID4
        assert resp.json()["is_isolated"] is True

    def test_multi_tenancy_disabled_allows_anonymous(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = False
            s.is_production = True
            s.tenant_enforce_in_dev = True
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping")
        assert resp.status_code == 200
        assert resp.json()["bureau_id"] is None

    def test_missing_bureau_id_with_enforce_returns_401(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = True
            s.tenant_enforce_in_dev = True
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping")
        assert resp.status_code == 401
        assert resp.json()["error"] == "TENANT_REQUIRED"

    def test_invalid_uuid_with_enforce_returns_400(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = True
            s.tenant_enforce_in_dev = True
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping", headers={"X-Bureau-ID": "bad-uuid-value"})
        assert resp.status_code == 400
        assert resp.json()["error"] == "INVALID_BUREAU_ID"

    def test_dev_mode_no_bureau_id_returns_anonymous_context(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = False
            s.tenant_enforce_in_dev = False
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping")
        assert resp.status_code == 200
        assert resp.json()["bureau_id"] is None
        assert resp.json()["is_isolated"] is False

    def test_valid_bureau_id_is_isolated_is_true(self) -> None:
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = False
            s.tenant_enforce_in_dev = False
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/ping", headers={"X-Bureau-ID": _VALID_UUID4})
        assert resp.json()["is_isolated"] is True

    def test_lowercase_header_name_is_accepted(self) -> None:
        """
        Starlette normalises incoming headers to lowercase.
        Both 'X-Bureau-ID' and 'x-bureau-id' must be accepted.
        extract_bureau_id_from_headers() checks both casings.
        """
        app = _make_test_app()
        with patch(_SETTINGS_PATH) as s:
            s.multi_tenancy_enabled = True
            s.is_production = False
            s.tenant_enforce_in_dev = False
            client = TestClient(app, raise_server_exceptions=False)
            # httpx (used by TestClient) lowercases all headers on the wire
            resp = client.get("/ping", headers={"x-bureau-id": _VALID_UUID4})
        assert resp.status_code == 200
        assert resp.json()["bureau_id"] == _VALID_UUID4


# ============================================================================
# E — RAGQueryRequest bureau_id field
# ============================================================================

class TestRAGQueryRequestBureauId:
    """Group E: Pydantic schema validation for the bureau_id field."""

    def test_bureau_id_defaults_to_none(self) -> None:
        req = RAGQueryRequest(query="İhbar tazminatı nasıl hesaplanır?")
        assert req.bureau_id is None

    def test_bureau_id_accepts_valid_uuid_string(self) -> None:
        req = RAGQueryRequest(
            query="İhbar tazminatı nasıl hesaplanır?",
            bureau_id=_VALID_UUID4,
        )
        assert req.bureau_id == _VALID_UUID4

    def test_bureau_id_serialises_in_model_dump(self) -> None:
        req = RAGQueryRequest(
            query="İhbar tazminatı nasıl hesaplanır?",
            bureau_id=_VALID_UUID4,
        )
        data = req.model_dump()
        assert "bureau_id" in data
        assert data["bureau_id"] == _VALID_UUID4

    def test_bureau_id_none_serialises_as_none_in_model_dump(self) -> None:
        req = RAGQueryRequest(query="İhbar tazminatı nasıl hesaplanır?")
        data = req.model_dump()
        assert "bureau_id" in data
        assert data["bureau_id"] is None
