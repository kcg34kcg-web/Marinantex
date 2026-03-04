from __future__ import annotations

import pytest

from infrastructure.config import settings
from infrastructure.database.supabase_audit_repository import SupabaseAuditRepository


EXPECTED_FLAG_KEYS = {
    "strict_grounding_v2",
    "tier_selector_ui",
    "router_hybrid_v3",
    "save_targets_v2",
    "client_translator_draft",
    "memory_dashboard_v1",
}


def test_feature_flags_snapshot_contains_step25_keys() -> None:
    snapshot = settings.feature_flags_snapshot()
    assert set(snapshot.keys()) == EXPECTED_FLAG_KEYS
    assert all(isinstance(value, bool) for value in snapshot.values())


def test_feature_flags_snapshot_reflects_model_overrides() -> None:
    overridden = settings.model_copy(
        update={
            "strict_grounding_v2": False,
            "tier_selector_ui": False,
            "router_hybrid_v3": True,
            "save_targets_v2": False,
            "client_translator_draft": True,
            "memory_dashboard_v1": True,
        }
    )
    snapshot = overridden.feature_flags_snapshot()
    assert snapshot["strict_grounding_v2"] is False
    assert snapshot["tier_selector_ui"] is False
    assert snapshot["router_hybrid_v3"] is True
    assert snapshot["save_targets_v2"] is False
    assert snapshot["client_translator_draft"] is True
    assert snapshot["memory_dashboard_v1"] is True


class _MockRPC:
    def __init__(self, data):
        self.data = data

    def execute(self):
        class _Resp:
            def __init__(self, payload):
                self.data = payload

        return _Resp(self.data)


class _MockClient:
    def __init__(self, payload):
        self.payload = payload
        self.rpc_name = None
        self.params = None

    def rpc(self, name, params):
        self.rpc_name = name
        self.params = params
        return _MockRPC(self.payload)


@pytest.mark.asyncio
async def test_observability_snapshot_accepts_rpc_dict(monkeypatch) -> None:
    mock_client = _MockClient(
        {
            "window_hours": 24,
            "request_count": 11,
            "avg_query_latency_ms": 321.0,
        }
    )
    monkeypatch.setattr(
        "infrastructure.database.connection.get_supabase_client",
        lambda: mock_client,
    )

    repo = SupabaseAuditRepository()
    data = await repo.get_observability_snapshot(bureau_id=None, window_hours=24)
    assert data is not None
    assert data["request_count"] == 11
    assert mock_client.rpc_name == "get_rag_observability_snapshot"
    assert mock_client.params["p_window_hours"] == 24


@pytest.mark.asyncio
async def test_observability_snapshot_accepts_rpc_list(monkeypatch) -> None:
    mock_client = _MockClient(
        [
            {
                "window_hours": 12,
                "request_count": 5,
            }
        ]
    )
    monkeypatch.setattr(
        "infrastructure.database.connection.get_supabase_client",
        lambda: mock_client,
    )

    repo = SupabaseAuditRepository()
    data = await repo.get_observability_snapshot(bureau_id=None, window_hours=12)
    assert data is not None
    assert data["request_count"] == 5


@pytest.mark.asyncio
async def test_observability_snapshot_invalid_payload_returns_none(monkeypatch) -> None:
    mock_client = _MockClient("invalid-shape")
    monkeypatch.setattr(
        "infrastructure.database.connection.get_supabase_client",
        lambda: mock_client,
    )

    repo = SupabaseAuditRepository()
    data = await repo.get_observability_snapshot(bureau_id=None, window_hours=6)
    assert data is None
