"""Tests for secure redaction map storage."""

from __future__ import annotations

import pytest

from infrastructure.config import settings
from infrastructure.security.redaction_store import RedactionMapStore


@pytest.mark.asyncio
async def test_redaction_store_roundtrip_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kvkk_redaction_map_backend", "memory")
    monkeypatch.setattr(settings, "kvkk_redaction_map_ttl_seconds", 120)
    monkeypatch.setattr(settings, "pii_encryption_key", "test-redaction-secret")

    store = RedactionMapStore()
    await store.set_map(mask_id="m1", values={"[MASKED_PERSON_X]": "Ahmet Yılmaz"})
    payload = await store.get_map(mask_id="m1")
    assert payload.get("[MASKED_PERSON_X]") == "Ahmet Yılmaz"
    await store.delete_map(mask_id="m1")
    payload_after = await store.get_map(mask_id="m1")
    assert payload_after == {}
