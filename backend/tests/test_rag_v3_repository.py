"""Unit tests for RAG v3 chunk persistence stability."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch
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
