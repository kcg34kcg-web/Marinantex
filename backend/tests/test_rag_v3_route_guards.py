"""Route-level tenant guard tests for RAG v3 endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import rag_v3


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(rag_v3.router, prefix="/api/v1/rag-v3")
    return app


def test_rag_v3_query_requires_bureau_when_hard_fail_enabled() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = True
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/query",
            json={"query": "Madde 17 nedir?", "top_k": 10, "jurisdiction": "TR"},
        )

    assert response.status_code == 401


def test_rag_v3_query_allows_request_when_guard_disabled() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "ok"
    fake_result.citations = []
    fake_result.structured = type(
        "Structured",
        (),
        {
            "answer_text": "Cevap",
            "citations": [],
            "confidence": 0.8,
            "should_escalate": False,
            "follow_up_questions": [],
            "warnings": [],
            "legal_disclaimer": "",
        },
    )()
    fake_result.fingerprint = type(
        "Fingerprint",
        (),
        {
            "model_name": "model",
            "model_version": "provider/model",
            "index_version": "idx",
            "prompt_version": "v1",
            "doc_hashes": [],
            "chunk_hashes": [],
        },
    )()
    fake_result.retrieved_count = 0
    fake_result.resolved_as_of_date = None
    fake_result.review_ticket_id = None
    fake_result.request_id = "550e8400-e29b-41d4-a716-446655440000"
    fake_result.gate_decision = "answered"
    fake_result.contract_version = "rag.v3.query.response.v1"
    fake_result.schema_version = "rag.v3.query.response.schema.v1"
    fake_result.claim_verification = type(
        "Claim",
        (),
        {
            "total_claims": 0,
            "supported_claims": 0,
            "support_ratio": 1.0,
            "unsupported_claims": [],
            "passed": True,
        },
    )()
    fake_result.policy = type(
        "Policy",
        (),
        {
            "risk_level": "LOW",
            "policy_flags": [],
            "legal_disclaimer": "",
            "should_escalate": False,
        },
    )()
    fake_result.admission = type(
        "Admission",
        (),
        {
            "accepted": True,
            "reason": "accepted",
            "queue_wait_ms": 0,
            "effective_tier": 2,
            "degraded": False,
        },
    )()

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.query", new=AsyncMock(return_value=fake_result)),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/query",
            json={"query": "Madde 17 nedir?", "top_k": 10, "jurisdiction": "TR"},
        )

    assert response.status_code == 200


def test_rag_v3_audit_trace_returns_payload() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    req_id = "550e8400-e29b-41d4-a716-446655440000"
    fake_trace = {
        "request_id": req_id,
        "created_at": "2026-03-04T10:00:00Z",
        "bureau_id": "11111111-1111-1111-1111-111111111111",
        "query_text": "Madde 17 nedir?",
        "response_status": "ok",
        "gate_decision": "answered",
        "requested_tier": 2,
        "effective_tier": 2,
        "top_k": 10,
        "jurisdiction": "TR",
        "as_of_date": None,
        "admission_reason": "accepted",
        "retrieved_count": 1,
        "retrieved_chunk_ids": ["chunk-1"],
        "retrieval_trace": [{"rank": 1, "chunk_id": "chunk-1"}],
        "citations": [{"chunk_id": "chunk-1"}],
        "fingerprint": {"model_version": "openai/model"},
        "warnings": [],
        "contract_version": "rag.v3.query.response.v1",
        "schema_version": "rag.v3.query.response.schema.v1",
        "latency_ms": 120,
        "metadata": {},
    }

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.get_query_trace", new=AsyncMock(return_value=fake_trace)),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.get(f"/api/v1/rag-v3/audit/{req_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["request_id"] == req_id
    assert payload["gate_decision"] == "answered"
