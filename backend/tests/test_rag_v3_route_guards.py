"""Route-level tenant guard tests for RAG v3 endpoints."""

from __future__ import annotations

from datetime import date
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
    fake_result.snapshot_id = 0
    fake_result.revocation_epoch = 0
    fake_result.review_ticket_id = None
    fake_result.request_id = "550e8400-e29b-41d4-a716-446655440000"
    fake_result.gate_decision = "answered"
    fake_result.estimated_cost = 0.0
    fake_result.cost_estimate = {}
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
            "sensitivity": "public",
            "residency": "global",
            "external_transfer": "allowed",
            "retention": "standard",
            "privilege_scope": "none",
            "purpose_of_use": "research",
            "source_rights": "owned",
            "exportability": "exportable",
            "provider_allowlist": ["openai"],
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


def test_rag_v3_query_forwards_event_and_decision_date_to_service() -> None:
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
    fake_result.resolved_as_of_date = date(2010, 1, 1)
    fake_result.snapshot_id = 1
    fake_result.revocation_epoch = 0
    fake_result.review_ticket_id = None
    fake_result.request_id = "550e8400-e29b-41d4-a716-446655440000"
    fake_result.gate_decision = "answered"
    fake_result.estimated_cost = 0.0
    fake_result.cost_estimate = {}
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
            "sensitivity": "public",
            "residency": "global",
            "external_transfer": "allowed",
            "retention": "standard",
            "privilege_scope": "none",
            "purpose_of_use": "research",
            "source_rights": "owned",
            "exportability": "exportable",
            "provider_allowlist": ["openai"],
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

    query_mock = AsyncMock(return_value=fake_result)
    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.query", new=query_mock),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/query",
            json={
                "query": "Madde 17 nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "event_date": "2010-01-01",
                "decision_date": "2020-01-01",
            },
        )

    assert response.status_code == 200
    assert query_mock.await_count == 1
    command = query_mock.await_args.args[0]
    assert command.event_date == date(2010, 1, 1)
    assert command.decision_date == date(2020, 1, 1)


def test_rag_v3_query_route_exception_returns_fail_open_contract() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch(
            "api.routes.rag_v3.rag_v3_service.query",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True
        settings_mock.llm_provider_fail_open_enabled = True
        settings_mock.rag_v3_query_contract_version = "rag.v3.query.response.v1"
        settings_mock.rag_v3_query_schema_version = "rag.v3.query.response.schema.v1"

        response = client.post(
            "/api/v1/rag-v3/query",
            json={"query": "Madde 17 nedir?", "top_k": 10, "jurisdiction": "TR", "requested_tier": 3},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "no_answer"
    assert payload["gate_decision"] == "route_exception_fail_open"
    assert payload["admission"]["reason"] == "route_exception_fail_open"


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


def test_rag_v3_ingest_requires_classification_field() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/ingest",
            json={
                "title": "Belge",
                "source_type": "note",
                "source_id": "src-1",
                "raw_text": "ornek metin",
                "source_format": "text",
                "jurisdiction": "TR",
            },
        )

    assert response.status_code == 422


def test_rag_v3_delete_returns_403_on_permission_error() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch(
            "api.routes.rag_v3.rag_v3_service.delete_document",
            new=AsyncMock(side_effect=PermissionError("forbidden")),
        ),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/delete",
            headers={"X-Access-Level": "READ_ONLY"},
            json={"document_id": "doc-1"},
        )

    assert response.status_code == 403


def test_rag_v3_revoke_returns_payload() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    fake_result = type(
        "RevokeResult",
        (),
        {
            "action": "revoke",
            "affected_document_ids": ["doc-1"],
            "affected_documents": 1,
            "revocation_epoch": 3,
            "warnings": [],
            "contract_version": "rag.v3.revoke.response.v1",
            "schema_version": "rag.v3.revoke.response.schema.v1",
        },
    )()

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.revoke_document", new=AsyncMock(return_value=fake_result)),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/revoke",
            headers={"X-Access-Level": "OWNER"},
            json={"action": "revoke", "document_id": "doc-1", "reason": "test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["action"] == "revoke"
    assert payload["affected_documents"] == 1
    assert payload["revocation_epoch"] == 3


def test_rag_v3_integrity_returns_payload() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    fake_snapshot = {
        "bureau_id": "550e8400-e29b-41d4-a716-446655440000",
        "document_count": 2,
        "chunk_count": 4,
        "documents_without_chunks": 0,
        "documents_without_chunks_ids": [],
        "classification_breakdown": {"PUBLIC": 1, "INTERNAL": 1},
        "checked_at": "2026-03-06T10:00:00+00:00",
        "contract_version": "rag.v3.integrity.response.v1",
        "schema_version": "rag.v3.integrity.response.schema.v1",
    }
    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.get_index_integrity", new=AsyncMock(return_value=fake_snapshot)),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.get("/api/v1/rag-v3/integrity")

    assert response.status_code == 200
    payload = response.json()
    assert payload["document_count"] == 2
    assert payload["classification_breakdown"]["PUBLIC"] == 1


def test_rag_v3_observability_returns_payload() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    fake_snapshot = type(
        "Snapshot",
        (),
        {
            "window_hours": 24,
            "request_count": 10,
            "avg_query_latency_ms": 120.5,
            "p95_query_latency_ms": 300.0,
            "no_answer_rate": 0.2,
            "security_block_rate": 0.1,
            "cache_hit_rate": 0.3,
            "avg_retrieved_count": 3.2,
            "contract_version": "rag.v3.observability.response.v1",
            "schema_version": "rag.v3.observability.response.schema.v1",
        },
    )()
    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.get_observability_snapshot", new=AsyncMock(return_value=fake_snapshot)),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.get("/api/v1/rag-v3/observability?window_hours=24")

    assert response.status_code == 200
    payload = response.json()
    assert payload["request_count"] == 10
    assert payload["cache_hit_rate"] == 0.3
