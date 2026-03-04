from __future__ import annotations

from uuid import uuid4

import pytest

from api import ClientAction, SaveMode, SaveTarget
from api.schemas import (
    CitationSnapshotItemSchema,
    RAGSaveRequestV3,
)
from application.services.save_output_service import SaveOutputService


class _RepoStub:
    def __init__(self) -> None:
        self.payload = None

    async def save_rag_output_transaction(self, payload):
        self.payload = payload
        return {
            "saved_output_id": str(uuid4()),
            "case_id": payload.get("p_case_id"),
            "case_created": bool(payload.get("p_create_case", False)),
            "citation_count": len(payload.get("p_citations") or []),
            "client_message_id": str(uuid4()) if payload.get("p_client_draft_text") else None,
        }


@pytest.mark.asyncio
async def test_save_service_client_safe_rewrite_filters_internal_strategy_lines():
    repo = _RepoStub()
    service = SaveOutputService(repository=repo)

    req = RAGSaveRequestV3(
        answer="Maddi durum aciklamasi.\nIc strateji: once karsi tarafi baskila.",
        save_target=SaveTarget.MY_FILES,
        save_mode=SaveMode.OUTPUT_WITH_THREAD_AND_SOURCES,
        client_action=ClientAction.SAVE_CLIENT_DRAFT,
    )

    result = await service.save(
        req,
        bureau_id=str(uuid4()),
        user_id=str(uuid4()),
    )

    assert result.success is True
    assert result.client_message_id is not None
    assert result.client_draft_preview is not None
    assert "Ic strateji" not in result.client_draft_preview
    assert repo.payload is not None
    assert repo.payload["p_client_draft_text"] == result.client_draft_preview


@pytest.mark.asyncio
async def test_save_service_passes_case_and_citation_payload_to_rpc():
    repo = _RepoStub()
    service = SaveOutputService(repository=repo)

    case_id = str(uuid4())
    req = RAGSaveRequestV3(
        answer="Hazirlanan hukuki degerlendirme metni.",
        title="Iscilik alacagi notu",
        save_target=SaveTarget.EXISTING_CASE,
        case_id=case_id,
        save_mode=SaveMode.OUTPUT_WITH_THREAD_AND_SOURCES,
        citations=[
            CitationSnapshotItemSchema(
                source_id="doc-1",
                source_type="kanun",
                source_anchor="md. 17",
                page_no=4,
                char_start=12,
                char_end=90,
            )
        ],
        metadata={"chat_mode": "general_chat"},
    )

    result = await service.save(
        req,
        bureau_id=str(uuid4()),
        user_id=str(uuid4()),
    )

    assert result.success is True
    assert result.case_id == case_id
    assert result.citation_count == 1
    assert repo.payload is not None
    assert repo.payload["p_case_id"] == case_id
    assert repo.payload["p_save_target"] == SaveTarget.EXISTING_CASE.value
    assert repo.payload["p_save_mode"] == SaveMode.OUTPUT_WITH_THREAD_AND_SOURCES.value
    assert len(repo.payload["p_citations"]) == 1
    assert repo.payload["p_metadata"]["chat_mode"] == "general_chat"
