from __future__ import annotations

import pytest

from application.services.rag_v3_service import RagV3Service
from domain.entities.tenant import AccessLevel
from infrastructure.config import settings


class _ComplianceRepoStub:
    async def get_compliance_evidence_snapshot(self, *, bureau_id):  # noqa: ANN001
        return {
            "legal_hold_document_count": 2,
            "retention_events_30d": 5,
            "anonymize_events_30d": 2,
            "hard_delete_events_30d": 1,
            "retention_last_event_at": "2026-03-15T00:00:00Z",
            "freshness_checks_24h": 4,
            "freshness_last_check_at": "2026-03-15T00:00:00Z",
            "backup_restore_last_drill_at": None,
            "rollback_last_drill_at": None,
            "human_eval_rubric_count": 1,
        }


@pytest.mark.asyncio
async def test_compliance_evidence_enriches_with_policy_artifacts(tmp_path, monkeypatch):
    contract = tmp_path / "retention-policy.json"
    contract.write_text('{"contract_version":"retention.contract.v1"}', encoding="utf-8")
    dpia = tmp_path / "dpia.json"
    dpia.write_text('{"contract_version":"dpia.v1"}', encoding="utf-8")
    ropa = tmp_path / "ropa.json"
    ropa.write_text('{"contract_version":"ropa.v1"}', encoding="utf-8")

    monkeypatch.setattr(settings, "compliance_retention_policy_contract_path", str(contract))
    monkeypatch.setattr(settings, "compliance_dpia_evidence_path", str(dpia))
    monkeypatch.setattr(settings, "compliance_ropa_evidence_path", str(ropa))

    service = RagV3Service(repository=_ComplianceRepoStub())
    payload = await service.get_compliance_evidence_snapshot(
        bureau_id=None,
        access_level=AccessLevel.OWNER,
    )

    assert payload["retention_policy_contract_present"] is True
    assert payload["retention_policy_contract_version"] == "retention.contract.v1"
    assert payload["dpia_evidence_present"] is True
    assert payload["ropa_evidence_present"] is True
    assert payload["legal_hold_pipeline_enabled"] is True
    assert payload["delete_pipeline_enabled"] is True
    assert payload["anonymize_pipeline_enabled"] is True


@pytest.mark.asyncio
async def test_compliance_evidence_marks_missing_artifacts(monkeypatch):
    monkeypatch.setattr(settings, "compliance_retention_policy_contract_path", "docs/missing-retention-policy.json")
    monkeypatch.setattr(settings, "compliance_dpia_evidence_path", "docs/missing-dpia.json")
    monkeypatch.setattr(settings, "compliance_ropa_evidence_path", "docs/missing-ropa.json")

    service = RagV3Service(repository=_ComplianceRepoStub())
    payload = await service.get_compliance_evidence_snapshot(
        bureau_id=None,
        access_level=AccessLevel.OWNER,
    )

    assert payload["retention_policy_contract_present"] is False
    assert payload["retention_policy_contract_version"] is None
    assert payload["dpia_evidence_present"] is False
    assert payload["ropa_evidence_present"] is False
