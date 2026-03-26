"""Legacy RAG route hard-disable guard tests."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from api.routes import rag


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(rag.router, prefix="/api/v1/rag")
    return app


def test_legacy_rag_query_returns_410_when_single_pipeline_enforced() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag.settings") as settings_mock:
        settings_mock.rag_v3_single_pipeline_enforced = True

        response = client.post(
            "/api/v1/rag/query",
            json={"query": "Kıdem tazminatı nedir?"},
        )

    assert response.status_code == 410
    assert "rag-v3/query" in response.json().get("detail", "")


def test_legacy_rag_query_denies_matter_scope_header_payload_mismatch() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag.settings") as settings_mock, patch(
        "api.routes.rag._rag_use_case"
    ) as use_case_mock:
        settings_mock.rag_v3_single_pipeline_enforced = False
        settings_mock.multi_tenancy_enabled = False
        settings_mock.tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag/query",
            headers={"x-case-id": "case-a"},
            json={"query": "Kıdem tazminatı nedir?", "case_id": "case-b"},
        )

    assert response.status_code == 403
    detail = response.json().get("detail", {})
    assert detail.get("error_code") == "MATTER_SCOPE_MISMATCH"
    assert detail.get("reason") == "header_payload_mismatch"
    use_case_mock.execute_for_api.assert_not_called()


def test_legacy_rag_query_exception_fails_closed_with_503() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag.settings") as settings_mock, patch(
        "api.routes.rag._rag_use_case"
    ) as use_case_mock:
        settings_mock.rag_v3_single_pipeline_enforced = False
        settings_mock.multi_tenancy_enabled = False
        settings_mock.tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False
        use_case_mock.execute_for_api.side_effect = RuntimeError("backend_down")

        response = client.post(
            "/api/v1/rag/query",
            json={"query": "Kıdem tazminatı nedir?"},
        )

    assert response.status_code == 503
    assert response.json().get("detail") == "RAG query unavailable."
