"""Route-level tenant guard tests for RAG v3 endpoints."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
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
            json={
                "query": "Madde 17 nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 401


def test_rag_v3_compliance_evidence_requires_bureau_when_hard_fail_enabled() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = True
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.get("/api/v1/rag-v3/compliance-evidence")

    assert response.status_code == 401


def test_rag_v3_query_requires_disclaimer_ack() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False
        settings_mock.rag_v3_require_legal_disclaimer_ack = True

        response = client.post(
            "/api/v1/rag-v3/query",
            json={"query": "Madde 17 nedir?", "top_k": 10, "jurisdiction": "TR"},
        )

    assert response.status_code == 422


def test_rag_v3_query_allows_request_when_guard_disabled() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "no_answer"
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
    fake_result.review_required = False
    fake_result.review_reason_codes = []
    fake_result.low_confidence = False
    fake_result.low_confidence_reason = ""
    fake_result.legal_disclaimer_required = True
    fake_result.human_responsibility_notice = "Nihai hukuki sorumluluk insandadir."
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
            json={
                "query": "Madde 17 nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["trace_id"] == fake_result.request_id
    assert payload["answer_text"] == "Cevap"
    assert payload["confidence_score"] == 0.8
    assert payload["source_documents"] == []


def test_rag_v3_query_forwards_event_and_decision_date_to_service() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "no_answer"
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
    fake_result.review_required = False
    fake_result.review_reason_codes = []
    fake_result.low_confidence = False
    fake_result.low_confidence_reason = ""
    fake_result.legal_disclaimer_required = True
    fake_result.human_responsibility_notice = "Nihai hukuki sorumluluk insandadir."
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
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 200
    assert query_mock.await_count == 1
    command = query_mock.await_args.args[0]
    assert command.event_date == date(2010, 1, 1)
    assert command.decision_date == date(2020, 1, 1)


def test_rag_v3_query_flags_citation_contract_violation() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "no_answer"
    fake_result.citations = [
        type(
            "Citation",
            (),
            {
                "chunk_id": "chunk-1",
                "document_id": "doc-1",
                "title": "Karar",
                "source_id": "",
                "source_type": "case_law",
                "article_no": None,
                "clause_no": None,
                "subclause_no": None,
                "page_range": None,
                "final_score": 0.7,
                "temporal_version": None,
                "evidence_text": None,
                "evidence_start": None,
                "evidence_end": None,
                "evidence_overlap": None,
            },
        )()
    ]
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
    fake_result.retrieved_count = 1
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
    fake_result.review_required = False
    fake_result.review_reason_codes = []
    fake_result.low_confidence = False
    fake_result.low_confidence_reason = ""
    fake_result.legal_disclaimer_required = True
    fake_result.human_responsibility_notice = "Nihai hukuki sorumluluk insandadir."
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
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag-v3/query",
            json={
                "query": "Kidem tazminati nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["review_required"] is True
    assert "citation_contract_violation" in payload["review_reason_codes"]
    assert payload["low_confidence"] is True
    assert any(item.startswith("citation_contract_missing_fields:") for item in payload["warnings"])


def test_rag_v3_query_exposes_citation_authority_and_date_fields() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "ok"
    fake_result.citations = [
        type(
            "Citation",
            (),
            {
                "chunk_id": "chunk-1",
                "document_id": "doc-1",
                "title": "Yargitay karari",
                "source_id": "E. 2022/10 K. 2023/20",
                "source_type": "case_law",
                "article_no": None,
                "clause_no": None,
                "subclause_no": None,
                "page_range": "4",
                "final_score": 0.85,
                "temporal_version": "current",
                "evidence_text": "Kanit",
                "evidence_start": 0,
                "evidence_end": 5,
                "evidence_overlap": 0.44,
                "source_char_start": 12,
                "source_char_end": 88,
                "paragraph_start": 2,
                "paragraph_end": 3,
                "section_path": "gerekce/2",
                "source_url": "https://karararama.yargitay.gov.tr/karar/123",
                "citation_date": "2023-05-01",
                "issuing_authority": "YARGITAY",
                "decision_no": "E. 2022/10 K. 2023/20",
                "reference_no": "karar:E. 2022/10 K. 2023/20",
            },
        )()
    ]
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
    fake_result.retrieved_count = 1
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
    fake_result.review_required = False
    fake_result.review_reason_codes = []
    fake_result.low_confidence = False
    fake_result.low_confidence_reason = ""
    fake_result.legal_disclaimer_required = True
    fake_result.human_responsibility_notice = "Nihai hukuki sorumluluk insandadir."
    fake_result.claim_verification = type(
        "Claim",
        (),
        {
            "total_claims": 1,
            "supported_claims": 1,
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
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag-v3/query",
            json={
                "query": "E.2022/10 K.2023/20 kararini getir",
                "top_k": 10,
                "jurisdiction": "TR",
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["citations"][0]["issuing_authority"] == "YARGITAY"
    assert payload["citations"][0]["citation_date"] == "2023-05-01"
    assert payload["source_documents"][0]["decision_no"] == "E. 2022/10 K. 2023/20"


def test_rag_v3_query_rejects_answered_response_without_source_url_and_span() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    fake_result = AsyncMock()
    fake_result.answer = "Cevap"
    fake_result.status = "ok"
    fake_result.citations = [
        type(
            "Citation",
            (),
            {
                "chunk_id": "chunk-1",
                "document_id": "doc-1",
                "title": "Karar",
                "source_id": "E. 2021/1 K. 2022/2",
                "source_type": "case_law",
                "article_no": None,
                "clause_no": None,
                "subclause_no": None,
                "page_range": None,
                "final_score": 0.9,
                "temporal_version": None,
                "evidence_text": "metin",
                "evidence_start": 0,
                "evidence_end": 5,
                "evidence_overlap": 0.5,
                "citation_date": "2023-05-01",
                "issuing_authority": "YARGITAY",
                "decision_no": "E. 2021/1 K. 2022/2",
                "reference_no": None,
                "source_char_start": None,
                "source_char_end": None,
                "paragraph_start": None,
                "paragraph_end": None,
                "section_path": None,
                "source_url": None,
            },
        )()
    ]
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
    fake_result.retrieved_count = 1
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
    fake_result.review_required = False
    fake_result.review_reason_codes = []
    fake_result.low_confidence = False
    fake_result.low_confidence_reason = ""
    fake_result.legal_disclaimer_required = True
    fake_result.human_responsibility_notice = "Nihai hukuki sorumluluk insandadir."
    fake_result.claim_verification = type(
        "Claim",
        (),
        {
            "total_claims": 1,
            "supported_claims": 1,
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
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag-v3/query",
            json={
                "query": "Kidem tazminati nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 422
    payload = response.json()
    assert payload["detail"]["error_code"] == "STRICT_GROUNDING_VIOLATION"
    assert any(item.startswith("citation_1_missing_source_url") for item in payload["detail"]["violations"])
    assert any(item.startswith("citation_1_missing_source_span") for item in payload["detail"]["violations"])


def test_rag_v3_query_route_exception_returns_503_fail_closed() -> None:
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
        settings_mock.rag_v3_query_contract_version = "rag.v3.query.response.v1"
        settings_mock.rag_v3_query_schema_version = "rag.v3.query.response.schema.v1"

        response = client.post(
            "/api/v1/rag-v3/query",
            json={
                "query": "Madde 17 nedir?",
                "top_k": 10,
                "jurisdiction": "TR",
                "requested_tier": 3,
                "legal_disclaimer_ack": True,
                "human_responsibility_ack": True,
            },
        )

    assert response.status_code == 503
    payload = response.json()
    assert payload["detail"] == "RAG v3 query unavailable."


def test_rag_v3_sso_capabilities_reports_disabled_saml_state() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.auth_enforce_bearer = True
        settings_mock.auth_jwt_use_jwks = True
        settings_mock.auth_jwks_url = "https://issuer.example.com/.well-known/jwks.json"
        settings_mock.auth_jwt_issuer = "https://issuer.example.com"
        settings_mock.auth_verify_jwt_signature = True
        settings_mock.saml_enabled = False
        settings_mock.saml_metadata_url = None
        settings_mock.saml_entity_id = None
        settings_mock.saml_verified = False

        response = client.get("/api/v1/rag-v3/sso-capabilities")

    assert response.status_code == 200
    payload = response.json()
    assert payload["oidc_verified"] is True
    assert payload["saml_configured"] is False
    assert payload["saml_verified"] is False
    assert "saml_disabled" in payload["saml_reason_codes"]
    assert payload["enterprise_ready"] is True


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


def test_rag_v3_delete_forwards_actor_id_to_service_command() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    fake_result = type(
        "DeleteResult",
        (),
        {
            "deleted_document_ids": ["doc-1"],
            "deleted_documents": 1,
            "deleted_chunks": 2,
            "raw_storage_delete_attempted": 0,
            "raw_storage_deleted": 0,
            "warnings": [],
            "contract_version": "rag.v3.delete.response.v1",
            "schema_version": "rag.v3.delete.response.schema.v1",
        },
    )()
    delete_mock = AsyncMock(return_value=fake_result)

    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.delete_document", new=delete_mock),
    ):
        settings_mock.multi_tenancy_enabled = True
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = True
        settings_mock.tenant_enforce_in_dev = True

        response = client.post(
            "/api/v1/rag-v3/delete",
            headers={"X-Access-Level": "OWNER", "X-User-ID": "user-actor-1"},
            json={"document_id": "doc-1"},
        )

    assert response.status_code == 200
    command = delete_mock.await_args.args[0]
    assert command.actor_id == "user-actor-1"


def test_rag_v3_delete_requires_authenticated_subject_when_auth_enforced() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.auth_enforce_bearer = True
        settings_mock.rag_v3_require_auth_subject_for_mutations = True
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag-v3/delete",
            headers={"X-User-ID": "550e8400-e29b-41d4-a716-4466554400aa"},
            json={"document_id": "doc-1"},
        )

    assert response.status_code == 401
    assert "Authenticated subject required" in response.text


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
            "low_confidence_rate": 0.15,
            "review_required_rate": 0.05,
            "contract_version": "rag.v3.observability.response.v1",
            "schema_version": "rag.v3.observability.response.schema.v1",
        },
    )()
    with (
        patch("api.routes.rag_v3.settings") as settings_mock,
        patch("api.routes.rag_v3.rag_v3_service.get_observability_snapshot", new=AsyncMock(return_value=fake_snapshot)),
        patch(
            "api.routes.rag_v3.evaluate_and_dispatch_alerts",
            return_value=SimpleNamespace(
                fired=[{"rule": "rag_v3_latency_p95_high"}],
                delivered=1,
                failed=0,
                evaluated_rules=10,
                configured_sinks=["webhook", "siem"],
                missing_metric_rules=[],
            ),
        ),
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
    assert payload["alerts_fired"] == 1
    assert payload["alerts_evaluated_rules"] == 10
    assert payload["alerts_configured_sinks"] == ["webhook", "siem"]


def test_rag_v3_review_queue_returns_items() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    fake_rows = [
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "status": "pending",
            "risk_level": "HIGH",
            "severity": "P1",
            "confidence": 0.22,
            "created_at": "2026-03-10T10:00:00Z",
            "reason_codes": ["risk:HIGH", "claim_verification_failed"],
            "metadata": {"review_sla_minutes": 60},
        }
    ]
    with patch(
        "api.routes.rag_v3.rag_v3_service.list_human_review_queue",
        new=AsyncMock(return_value=fake_rows),
    ):
        response = client.get("/api/v1/rag-v3/review-queue")

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["id"] == "11111111-1111-1111-1111-111111111111"
    assert payload["items"][0]["risk_level"] == "HIGH"


def test_rag_v3_review_assign_returns_404_when_ticket_missing() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    with patch(
        "api.routes.rag_v3.rag_v3_service.assign_human_review_ticket",
        new=AsyncMock(return_value=None),
    ):
        response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/assign",
            json={"reviewer_id": "22222222-2222-2222-2222-222222222222", "sla_minutes": 60},
        )

    assert response.status_code == 404


def test_rag_v3_review_assign_requires_authenticated_subject_when_auth_enforced() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    with patch("api.routes.rag_v3.settings") as settings_mock:
        settings_mock.auth_enforce_bearer = True
        settings_mock.rag_v3_require_auth_subject_for_mutations = True
        settings_mock.multi_tenancy_enabled = False
        settings_mock.rag_v3_tenant_hard_fail_missing_bureau = False
        settings_mock.is_production = False
        settings_mock.tenant_enforce_in_dev = False

        response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/assign",
            headers={"X-User-ID": "550e8400-e29b-41d4-a716-4466554400aa"},
            json={"reviewer_id": "22222222-2222-2222-2222-222222222222"},
        )

    assert response.status_code == 401
    assert "Authenticated subject required" in response.text


def test_rag_v3_review_assign_forwards_assigned_by_actor_uuid() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    assign_mock = AsyncMock(
        return_value={
            "id": "11111111-1111-1111-1111-111111111111",
            "status": "in_review",
            "assigned_to": "22222222-2222-2222-2222-222222222222",
        }
    )
    with patch(
        "api.routes.rag_v3.rag_v3_service.assign_human_review_ticket",
        new=assign_mock,
    ):
        response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/assign",
            headers={"X-User-ID": "33333333-3333-3333-3333-333333333333"},
            json={"reviewer_id": "22222222-2222-2222-2222-222222222222"},
        )

    assert response.status_code == 200
    assert assign_mock.await_count == 1
    kwargs = assign_mock.await_args.kwargs
    assert str(kwargs.get("assigned_by")) == "33333333-3333-3333-3333-333333333333"


def test_rag_v3_review_close_surfaces_validation_errors() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    with patch(
        "api.routes.rag_v3.rag_v3_service.close_human_review_ticket",
        new=AsyncMock(side_effect=ValueError("reviewer_feedback is required.")),
    ):
        response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/close",
            json={
                "closed_by": "22222222-2222-2222-2222-222222222222",
                "status": "resolved",
                "closure_code": "approved",
                "reviewer_feedback": "",
            },
        )

    assert response.status_code == 400


def test_rag_v3_review_close_rejects_closed_by_subject_mismatch() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)

    close_mock = AsyncMock(return_value=None)
    with patch(
        "api.routes.rag_v3.rag_v3_service.close_human_review_ticket",
        new=close_mock,
    ):
        response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/close",
            headers={"X-User-ID": "33333333-3333-3333-3333-333333333333"},
            json={
                "closed_by": "22222222-2222-2222-2222-222222222222",
                "status": "resolved",
                "closure_code": "approved",
                "reviewer_feedback": "tamamlandi",
            },
        )

    assert response.status_code == 403
    assert "closed_by must match authenticated actor" in response.json()["detail"]
    assert close_mock.await_count == 0


def test_rag_v3_review_queue_assignment_and_closure_smoke_flow() -> None:
    app = _app()
    client = TestClient(app, raise_server_exceptions=False)
    ticket: dict[str, object] = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "pending",
        "assigned_to": None,
        "closure_code": None,
        "reviewer_feedback": None,
        "due_at": None,
        "resolved_at": None,
    }

    async def _list_queue(**_: object) -> list[dict[str, object]]:
        return [dict(ticket)]

    async def _assign_ticket(**kwargs: object) -> dict[str, object]:
        ticket["status"] = "in_review"
        ticket["assigned_to"] = kwargs.get("reviewer_id")
        ticket["due_at"] = "2026-03-10T12:00:00Z"
        return dict(ticket)

    async def _close_ticket(**kwargs: object) -> dict[str, object]:
        ticket["status"] = kwargs.get("status", "resolved")
        ticket["closure_code"] = kwargs.get("closure_code")
        ticket["reviewer_feedback"] = kwargs.get("reviewer_feedback")
        ticket["resolved_at"] = "2026-03-10T12:05:00Z"
        return dict(ticket)

    with (
        patch("api.routes.rag_v3.rag_v3_service.list_human_review_queue", new=AsyncMock(side_effect=_list_queue)),
        patch("api.routes.rag_v3.rag_v3_service.assign_human_review_ticket", new=AsyncMock(side_effect=_assign_ticket)),
        patch("api.routes.rag_v3.rag_v3_service.close_human_review_ticket", new=AsyncMock(side_effect=_close_ticket)),
    ):
        list_response = client.get("/api/v1/rag-v3/review-queue")
        assert list_response.status_code == 200
        assert list_response.json()["items"][0]["status"] == "pending"

        assign_response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/assign",
            json={
                "reviewer_id": "22222222-2222-2222-2222-222222222222",
                "sla_minutes": 60,
            },
        )
        assert assign_response.status_code == 200
        assign_payload = assign_response.json()
        assert assign_payload["status"] == "in_review"
        assert assign_payload["assigned_to"] == "22222222-2222-2222-2222-222222222222"

        close_response = client.post(
            "/api/v1/rag-v3/review-queue/11111111-1111-1111-1111-111111111111/close",
            json={
                "closed_by": "22222222-2222-2222-2222-222222222222",
                "status": "resolved",
                "closure_code": "approved",
                "reviewer_feedback": "Smoketest closure passed.",
            },
        )
        assert close_response.status_code == 200
        close_payload = close_response.json()
        assert close_payload["status"] == "resolved"
        assert close_payload["closure_code"] == "approved"
