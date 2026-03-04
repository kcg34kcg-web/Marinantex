"""
SaveOutputService - Step 24 unified save flow
=============================================
Application service for saving chat outputs to my files/cases and optionally
creating client-safe draft messages.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional
from uuid import UUID

from api import ClientAction, SaveTarget
from api.schemas import RAGSaveRequestV3, RAGSaveResponseV3
from infrastructure.database.supabase_save_repository import (
    SupabaseSaveRepository,
    supabase_save_repository,
)

logger = logging.getLogger("babylexit.services.save_output")


_CLIENT_UNSAFE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"ic strateji",
        r"karsi arguman",
        r"gizli not",
        r"yalnizca ekip ici",
        r"savunma stratejisi",
        r"muvekkile gonderme",
        r"internal use only",
        r"confidential",
    )
]


def _validate_optional_uuid(field_name: str, value: Optional[str]) -> None:
    if value is None:
        return
    try:
        UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"{field_name} is not a valid UUID: {value}") from exc


def _build_client_safe_draft(text: str) -> str:
    """
    Deterministic client-safe rewrite pipeline.

    We drop strategy/internal lines and keep a concise plain-language summary.
    """
    normalized = (text or "").replace("\r\n", "\n").strip()
    if not normalized:
        return "This draft is for client communication and contains no legal strategy details."

    kept_parts: list[str] = []
    for line in normalized.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if any(pattern.search(stripped) for pattern in _CLIENT_UNSAFE_PATTERNS):
            continue
        kept_parts.append(stripped)

    if not kept_parts:
        return "This draft is for client communication and contains no legal strategy details."

    rewritten = " ".join(kept_parts)
    if len(rewritten) > 2400:
        rewritten = rewritten[:2397].rstrip() + "..."
    return rewritten


class SaveOutputService:
    """Handles Step 24 save orchestration and payload normalization."""

    def __init__(
        self,
        repository: Optional[SupabaseSaveRepository] = None,
    ) -> None:
        self._repository = repository or supabase_save_repository

    async def save(
        self,
        request: RAGSaveRequestV3,
        *,
        bureau_id: str,
        user_id: str,
    ) -> RAGSaveResponseV3:
        if not bureau_id:
            raise ValueError("bureau_id is required")
        if not user_id:
            raise ValueError("user_id is required")

        _validate_optional_uuid("case_id", request.case_id)
        _validate_optional_uuid("thread_id", request.thread_id)
        _validate_optional_uuid("source_message_id", request.source_message_id)
        _validate_optional_uuid("saved_from_message_id", request.saved_from_message_id)
        _validate_optional_uuid("parent_output_id", request.parent_output_id)
        _validate_optional_uuid("client_id", request.client_id)

        if request.save_target == SaveTarget.EXISTING_CASE and not request.case_id:
            raise ValueError("case_id is required for save_target=existing_case")

        client_action_requested = request.client_action in {
            ClientAction.TRANSLATE_FOR_CLIENT_DRAFT,
            ClientAction.SAVE_CLIENT_DRAFT,
        }

        client_draft_text: Optional[str] = None
        if client_action_requested:
            source_text = request.client_draft_text or request.answer
            client_draft_text = _build_client_safe_draft(source_text)

        citations = [
            item.model_dump(exclude_none=True)
            for item in list(request.citations or [])
        ]

        payload: Dict[str, Any] = {
            "p_bureau_id": bureau_id,
            "p_user_id": user_id,
            "p_save_mode": request.save_mode.value,
            "p_save_target": request.save_target.value,
            "p_case_id": request.case_id,
            "p_create_case": request.save_target == SaveTarget.NEW_CASE,
            "p_new_case_title": request.new_case_title,
            "p_title": request.title,
            "p_content": request.answer,
            "p_output_type": request.output_type,
            "p_output_kind": request.output_kind,
            "p_thread_id": request.thread_id,
            "p_source_message_id": request.source_message_id,
            "p_saved_from_message_id": request.saved_from_message_id,
            "p_parent_output_id": request.parent_output_id,
            "p_is_final": request.is_final,
            "p_metadata": {
                **dict(request.metadata or {}),
                "response_type": request.response_type.value,
            },
            "p_citations": citations,
            "p_client_action": request.client_action.value,
            "p_client_id": request.client_id,
            "p_client_draft_text": client_draft_text,
            "p_client_draft_title": request.client_draft_title,
            "p_client_metadata": dict(request.client_metadata or {}),
        }

        result = await self._repository.save_rag_output_transaction(payload)

        saved_output_id = str(result.get("saved_output_id") or "")
        if not saved_output_id:
            raise RuntimeError("save transaction returned empty saved_output_id")

        return RAGSaveResponseV3(
            success=True,
            saved_output_id=saved_output_id,
            case_id=(str(result.get("case_id")) if result.get("case_id") else None),
            case_created=bool(result.get("case_created", False)),
            citation_count=int(result.get("citation_count") or 0),
            client_message_id=(
                str(result.get("client_message_id"))
                if result.get("client_message_id")
                else None
            ),
            client_draft_preview=client_draft_text,
        )


# Module-level singleton
save_output_service = SaveOutputService()
