"""Unit tests for RAG v3 chunk persistence stability."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest

from infrastructure.rag_v3.repository import (
    RagV3ChunkUpsert,
    SupabaseRagV3Repository,
    _stable_chunk_id,
)


@dataclass
class _FakeSupabase:
    doc_ids_by_hash: dict[str, str]
    chunks_by_doc: dict[str, dict[str, dict[str, Any]]]
    upsert_batches: list[list[dict[str, Any]]]
    deleted_hash_batches: list[list[str]]

    def __init__(self) -> None:
        self.doc_ids_by_hash = {}
        self.chunks_by_doc = {}
        self.upsert_batches = []
        self.deleted_hash_batches = []

    def table(self, name: str) -> "_FakeTable":
        return _FakeTable(self, name)


class _FakeTable:
    def __init__(self, client: _FakeSupabase, name: str) -> None:
        self._client = client
        self._name = name
        self._op: str | None = None
        self._payload: Any = None
        self._eq_filters: dict[str, Any] = {}
        self._in_filters: dict[str, list[Any]] = {}

    def upsert(self, payload: Any, on_conflict: str | None = None) -> "_FakeTable":
        self._op = "upsert"
        self._payload = payload
        return self

    def select(self, fields: str) -> "_FakeTable":
        self._op = "select"
        self._payload = fields
        return self

    def delete(self) -> "_FakeTable":
        self._op = "delete"
        return self

    def eq(self, field: str, value: Any) -> "_FakeTable":
        self._eq_filters[field] = value
        return self

    def in_(self, field: str, values: list[Any]) -> "_FakeTable":
        self._in_filters[field] = list(values)
        return self

    def execute(self) -> SimpleNamespace:
        if self._name == "rag_documents" and self._op == "upsert":
            payload = dict(self._payload)
            doc_hash = str(payload["doc_hash"])
            doc_id = self._client.doc_ids_by_hash.get(doc_hash)
            if not doc_id:
                doc_id = str(uuid5(NAMESPACE_URL, f"doc:{doc_hash}"))
                self._client.doc_ids_by_hash[doc_hash] = doc_id
            return SimpleNamespace(data=[{"id": doc_id}])

        if self._name == "rag_chunks" and self._op == "select":
            doc_id = str(self._eq_filters.get("document_id") or "")
            rows = []
            for chunk_hash, row in self._client.chunks_by_doc.get(doc_id, {}).items():
                rows.append({"id": row["id"], "chunk_hash": chunk_hash})
            return SimpleNamespace(data=rows)

        if self._name == "rag_chunks" and self._op == "upsert":
            payload = [dict(item) for item in list(self._payload)]
            self._client.upsert_batches.append(payload)
            for row in payload:
                doc_id = str(row["document_id"])
                chunk_hash = str(row["chunk_hash"])
                self._client.chunks_by_doc.setdefault(doc_id, {})
                self._client.chunks_by_doc[doc_id][chunk_hash] = row
            return SimpleNamespace(data=payload)

        if self._name == "rag_chunks" and self._op == "delete":
            doc_id = str(self._eq_filters.get("document_id") or "")
            hashes = [str(h) for h in self._in_filters.get("chunk_hash", [])]
            self._client.deleted_hash_batches.append(hashes)
            for chunk_hash in hashes:
                self._client.chunks_by_doc.setdefault(doc_id, {}).pop(chunk_hash, None)
            return SimpleNamespace(data=[])

        raise AssertionError(f"Unhandled fake operation: table={self._name} op={self._op}")


class _FakeRpcCall:
    def __init__(self, client: "_FakeRpcClient", name: str, params: dict[str, Any]) -> None:
        self._client = client
        self._name = name
        self._params = dict(params)

    def execute(self) -> SimpleNamespace:
        self._client.calls.append({"rpc": self._name, "params": dict(self._params)})
        return self._client.execute_rpc(self._name, self._params)


class _FakeRpcClient:
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.calls: list[dict[str, Any]] = []

    def rpc(self, name: str, params: dict[str, Any]) -> _FakeRpcCall:
        return _FakeRpcCall(self, name, params)

    def execute_rpc(self, name: str, params: dict[str, Any]) -> SimpleNamespace:
        if self.mode == "allowed_only":
            if "p_allowed_classifications" in params:
                raise RuntimeError("unexpected parameter p_allowed_classifications")
            if "allowed_classifications" in params:
                return SimpleNamespace(data=[])
            raise RuntimeError("missing required parameter allowed_classifications")
        if self.mode == "none_only":
            if "p_allowed_classifications" in params:
                raise RuntimeError("unexpected parameter p_allowed_classifications")
            if "allowed_classifications" in params:
                raise RuntimeError("unexpected parameter allowed_classifications")
            return SimpleNamespace(data=[])
        if self.mode == "none_404":
            if "p_allowed_classifications" in params:
                raise RuntimeError(f"404 Could not find function public.{name}")
            if "allowed_classifications" in params:
                raise RuntimeError(f"404 Could not find function public.{name}")
            return SimpleNamespace(data=[])
        raise AssertionError(f"Unsupported fake rpc mode: {self.mode}")


def _chunk(chunk_hash: str, text: str) -> RagV3ChunkUpsert:
    return RagV3ChunkUpsert(
        article_no="1",
        clause_no="1",
        subclause_no=None,
        heading_path="Is Hukuku",
        text=text,
        embedding=[0.1] * 1536,
        chunk_hash=chunk_hash,
        page_range="1",
        effective_from=date(2024, 1, 1),
        effective_to=None,
        source_id="kanun-4857",
    )


def test_stable_chunk_id_is_deterministic() -> None:
    first = _stable_chunk_id(document_id="doc-1", chunk_hash="hash-1")
    second = _stable_chunk_id(document_id="doc-1", chunk_hash="hash-1")
    third = _stable_chunk_id(document_id="doc-1", chunk_hash="hash-2")
    assert first == second
    assert first != third
    UUID(first)  # valid UUID


@pytest.mark.asyncio
async def test_upsert_keeps_existing_chunk_id_and_deletes_only_stale_hashes() -> None:
    repo = SupabaseRagV3Repository()
    fake = _FakeSupabase()
    doc_hash = "doc-hash-1"
    doc_id = str(uuid5(NAMESPACE_URL, f"doc:{doc_hash}"))
    fake.doc_ids_by_hash[doc_hash] = doc_id
    fake.chunks_by_doc[doc_id] = {
        "keep-hash": {"id": "legacy-keep-id", "chunk_hash": "keep-hash", "document_id": doc_id},
        "old-hash": {"id": "legacy-old-id", "chunk_hash": "old-hash", "document_id": doc_id},
    }

    with patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake):
        await repo.upsert_document_and_replace_chunks(
            title="Is Kanunu",
            source_type="legislation",
            source_id="kanun-4857",
            jurisdiction="TR",
            classification="PUBLIC",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            doc_hash=doc_hash,
            acl_tags=["public"],
            bureau_id=None,
            metadata={},
            chunks=[
                _chunk("keep-hash", "Ayni chunk"),
                _chunk("new-hash", "Yeni chunk"),
            ],
        )

    flattened_rows = [row for batch in fake.upsert_batches for row in batch]
    by_hash = {str(row["chunk_hash"]): row for row in flattened_rows}

    assert by_hash["keep-hash"]["id"] == "legacy-keep-id"
    assert by_hash["new-hash"]["id"] == _stable_chunk_id(
        document_id=doc_id,
        chunk_hash="new-hash",
    )
    assert fake.deleted_hash_batches == [["old-hash"]]


@pytest.mark.asyncio
async def test_reingest_same_chunks_keeps_chunk_ids_stable() -> None:
    repo = SupabaseRagV3Repository()
    fake = _FakeSupabase()
    doc_hash = "doc-hash-2"

    with patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake):
        await repo.upsert_document_and_replace_chunks(
            title="Is Kanunu",
            source_type="legislation",
            source_id="kanun-4857",
            jurisdiction="TR",
            classification="PUBLIC",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            doc_hash=doc_hash,
            acl_tags=["public"],
            bureau_id=None,
            metadata={},
            chunks=[_chunk("h1", "Paragraf 1"), _chunk("h2", "Paragraf 2")],
        )
        doc_id = fake.doc_ids_by_hash[doc_hash]
        first_ids = {
            chunk_hash: row["id"]
            for chunk_hash, row in fake.chunks_by_doc[doc_id].items()
        }

        await repo.upsert_document_and_replace_chunks(
            title="Is Kanunu",
            source_type="legislation",
            source_id="kanun-4857",
            jurisdiction="TR",
            classification="PUBLIC",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            doc_hash=doc_hash,
            acl_tags=["public"],
            bureau_id=None,
            metadata={},
            chunks=[_chunk("h1", "Paragraf 1"), _chunk("h2", "Paragraf 2")],
        )
        second_ids = {
            chunk_hash: row["id"]
            for chunk_hash, row in fake.chunks_by_doc[doc_id].items()
        }

    assert first_ids == second_ids


@pytest.mark.asyncio
async def test_match_chunks_dense_falls_back_to_allowed_classifications_alias() -> None:
    repo = SupabaseRagV3Repository()
    fake_rpc = _FakeRpcClient(mode="allowed_only")

    with patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake_rpc):
        await repo.match_chunks_dense(
            query_embedding=[0.1] * 1536,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )
        await repo.match_chunks_dense(
            query_embedding=[0.1] * 1536,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )

    assert len(fake_rpc.calls) == 3
    assert "p_allowed_classifications" in fake_rpc.calls[0]["params"]
    assert "allowed_classifications" in fake_rpc.calls[1]["params"]
    assert "p_allowed_classifications" not in fake_rpc.calls[2]["params"]
    assert "allowed_classifications" in fake_rpc.calls[2]["params"]


@pytest.mark.asyncio
async def test_match_chunks_dense_falls_back_to_no_classification_param_signature() -> None:
    repo = SupabaseRagV3Repository()
    fake_rpc = _FakeRpcClient(mode="none_only")

    with patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake_rpc):
        await repo.match_chunks_dense(
            query_embedding=[0.1] * 1536,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )
        await repo.match_chunks_dense(
            query_embedding=[0.1] * 1536,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )

    assert len(fake_rpc.calls) == 4
    assert "p_allowed_classifications" in fake_rpc.calls[0]["params"]
    assert "allowed_classifications" in fake_rpc.calls[1]["params"]
    assert "p_allowed_classifications" not in fake_rpc.calls[2]["params"]
    assert "allowed_classifications" not in fake_rpc.calls[2]["params"]
    assert "p_allowed_classifications" not in fake_rpc.calls[3]["params"]
    assert "allowed_classifications" not in fake_rpc.calls[3]["params"]


@pytest.mark.asyncio
async def test_match_chunks_sparse_reuses_dense_cached_mode_after_404_signature_mismatch() -> None:
    repo = SupabaseRagV3Repository()
    fake_rpc = _FakeRpcClient(mode="none_404")

    with patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake_rpc):
        await repo.match_chunks_dense(
            query_embedding=[0.1] * 1536,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )
        await repo.match_chunks_sparse(
            query_text="kidem tazminati",
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            acl_tags=["internal"],
            allowed_classifications=["PUBLIC", "INTERNAL"],
            bureau_id=None,
        )

    assert len(fake_rpc.calls) == 4
    dense_calls = [item for item in fake_rpc.calls if item["rpc"] == "rag_v3_match_chunks_dense"]
    sparse_calls = [item for item in fake_rpc.calls if item["rpc"] == "rag_v3_match_chunks_sparse"]
    assert len(dense_calls) == 3
    assert len(sparse_calls) == 1
    assert "p_allowed_classifications" not in sparse_calls[0]["params"]
    assert "allowed_classifications" not in sparse_calls[0]["params"]


@pytest.mark.asyncio
async def test_append_query_trace_retries_on_ssl_bad_record_mac() -> None:
    repo = SupabaseRagV3Repository()

    class _TraceTable:
        def __init__(self, parent: "_TraceClient") -> None:
            self._parent = parent

        def upsert(self, payload: dict[str, Any], on_conflict: str | None = None) -> "_TraceTable":
            self._parent.payloads.append(dict(payload))
            return self

        def execute(self) -> SimpleNamespace:
            self._parent.execute_calls += 1
            if self._parent.execute_calls < 3:
                raise RuntimeError("SSLV3_ALERT_BAD_RECORD_MAC")
            return SimpleNamespace(data=[{"request_id": "req-1"}])

    class _TraceClient:
        def __init__(self) -> None:
            self.execute_calls = 0
            self.payloads: list[dict[str, Any]] = []

        def table(self, name: str) -> _TraceTable:
            assert name == "rag_v3_query_traces"
            return _TraceTable(self)

    fake_client = _TraceClient()
    sleep_mock = AsyncMock(return_value=None)

    with (
        patch("infrastructure.rag_v3.repository.get_supabase_client", return_value=fake_client),
        patch("infrastructure.rag_v3.repository.asyncio.sleep", sleep_mock),
    ):
        await repo.append_query_trace(
            request_id="req-1",
            bureau_id=None,
            query="Kidem tazminati nedir?",
            response_status="ok",
            gate_decision="answered",
            requested_tier=2,
            effective_tier=2,
            top_k=8,
            jurisdiction="TR",
            as_of_date=None,
            admission_reason="accepted",
            retrieved_count=1,
            retrieved_chunk_ids=["chunk-1"],
            retrieval_trace=[],
            citations=[],
            fingerprint={},
            warnings=[],
            contract_version="v1",
            schema_version="v1",
            latency_ms=100,
            metadata={},
        )

    assert fake_client.execute_calls == 3
    assert sleep_mock.await_count == 2
