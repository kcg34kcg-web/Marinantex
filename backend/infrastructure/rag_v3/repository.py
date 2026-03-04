"""Supabase repository for RAG v3 documents/chunks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional
from uuid import UUID, uuid5

from infrastructure.database.connection import get_supabase_client

_CHUNK_ID_NAMESPACE = UUID("d29f5d66-54bb-4b89-a6f0-6ea0f349e58f")


@dataclass(frozen=True)
class RagV3ChunkUpsert:
    article_no: Optional[str]
    clause_no: Optional[str]
    subclause_no: Optional[str]
    heading_path: Optional[str]
    text: str
    embedding: list[float]
    chunk_hash: str
    page_range: Optional[str]
    effective_from: Optional[date]
    effective_to: Optional[date]
    source_id: str


@dataclass(frozen=True)
class RagV3ChunkMatch:
    chunk_id: str
    document_id: str
    title: str
    source_type: str
    source_id: str
    jurisdiction: str
    article_no: Optional[str]
    clause_no: Optional[str]
    subclause_no: Optional[str]
    heading_path: Optional[str]
    chunk_text: str
    page_range: Optional[str]
    effective_from: Optional[date]
    effective_to: Optional[date]
    acl_tags: list[str]
    doc_hash: str
    chunk_hash: str
    semantic_score: float
    keyword_score: float
    final_score: float


class SupabaseRagV3Repository:
    """Persistence and retrieval operations for rag_documents/rag_chunks."""

    async def upsert_document_and_replace_chunks(
        self,
        *,
        title: str,
        source_type: str,
        source_id: str,
        jurisdiction: str,
        effective_from: Optional[date],
        effective_to: Optional[date],
        doc_hash: str,
        acl_tags: list[str],
        bureau_id: Optional[UUID],
        metadata: Optional[dict],
        chunks: list[RagV3ChunkUpsert],
    ) -> str:
        if not chunks:
            raise ValueError("At least one chunk is required to persist a document.")

        client = get_supabase_client()
        payload = {
            "title": title,
            "source_type": source_type,
            "source_id": source_id,
            "jurisdiction": jurisdiction,
            "effective_from": effective_from.isoformat() if effective_from else None,
            "effective_to": effective_to.isoformat() if effective_to else None,
            "doc_hash": doc_hash,
            "acl_tags": acl_tags,
            "bureau_id": str(bureau_id) if bureau_id else None,
            "metadata": metadata or {},
        }

        doc_resp = (
            client.table("rag_documents")
            .upsert(payload, on_conflict="doc_hash")
            .execute()
        )
        if not doc_resp.data:
            raise RuntimeError("Failed to upsert rag_documents row.")

        doc_id = str(doc_resp.data[0]["id"])

        existing_resp = (
            client.table("rag_chunks")
            .select("id, chunk_hash")
            .eq("document_id", doc_id)
            .execute()
        )
        existing_rows = existing_resp.data or []
        existing_chunk_ids: dict[str, str] = {}
        for row in existing_rows:
            chunk_hash = str(row.get("chunk_hash") or "")
            chunk_id = str(row.get("id") or "")
            if chunk_hash and chunk_id:
                existing_chunk_ids[chunk_hash] = chunk_id

        deduped_chunks: dict[str, RagV3ChunkUpsert] = {}
        for chunk in chunks:
            chunk_hash = str(chunk.chunk_hash or "").strip()
            if not chunk_hash or chunk_hash in deduped_chunks:
                continue
            deduped_chunks[chunk_hash] = chunk

        if not deduped_chunks:
            raise ValueError("No valid chunk hashes were provided for persistence.")

        rows = [
            {
                "id": existing_chunk_ids.get(chunk_hash) or _stable_chunk_id(
                    document_id=doc_id,
                    chunk_hash=chunk_hash,
                ),
                "document_id": doc_id,
                "article_no": chunk.article_no,
                "clause_no": chunk.clause_no,
                "subclause_no": chunk.subclause_no,
                "heading_path": chunk.heading_path,
                "text": chunk.text,
                "embedding": chunk.embedding,
                "chunk_hash": chunk.chunk_hash,
                "page_range": chunk.page_range,
                "effective_from": chunk.effective_from.isoformat() if chunk.effective_from else None,
                "effective_to": chunk.effective_to.isoformat() if chunk.effective_to else None,
                "source_id": chunk.source_id,
            }
            for chunk_hash, chunk in deduped_chunks.items()
        ]

        batch_size = 100
        for i in range(0, len(rows), batch_size):
            client.table("rag_chunks").upsert(
                rows[i : i + batch_size],
                on_conflict="document_id,chunk_hash",
            ).execute()

        incoming_hashes = set(deduped_chunks.keys())
        stale_hashes = sorted(set(existing_chunk_ids.keys()) - incoming_hashes)
        for i in range(0, len(stale_hashes), batch_size):
            batch = stale_hashes[i : i + batch_size]
            (
                client.table("rag_chunks")
                .delete()
                .eq("document_id", doc_id)
                .in_("chunk_hash", batch)
                .execute()
            )

        return doc_id

    async def match_chunks(
        self,
        *,
        query_embedding: list[float],
        query_text: str,
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        bureau_id: Optional[UUID],
    ) -> list[RagV3ChunkMatch]:
        return await self._match_chunks_rpc(
            rpc_name="rag_v3_match_chunks",
            params={
                "query_embedding": query_embedding,
                "query_text": query_text,
                "p_top_k": int(top_k),
                "p_jurisdiction": jurisdiction,
                "p_as_of_date": as_of_date.isoformat() if as_of_date else None,
                "p_acl_tags": acl_tags,
                "p_bureau_id": str(bureau_id) if bureau_id else None,
            },
        )

    async def match_chunks_dense(
        self,
        *,
        query_embedding: list[float],
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        bureau_id: Optional[UUID],
    ) -> list[RagV3ChunkMatch]:
        """
        Dense lane (vector-only) retrieval for RRF fusion.
        """
        return await self._match_chunks_rpc(
            rpc_name="rag_v3_match_chunks_dense",
            params={
                "query_embedding": query_embedding,
                "p_top_k": int(top_k),
                "p_jurisdiction": jurisdiction,
                "p_as_of_date": as_of_date.isoformat() if as_of_date else None,
                "p_acl_tags": acl_tags,
                "p_bureau_id": str(bureau_id) if bureau_id else None,
            },
        )

    async def match_chunks_sparse(
        self,
        *,
        query_text: str,
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        bureau_id: Optional[UUID],
    ) -> list[RagV3ChunkMatch]:
        """
        Sparse lane (FTS-only) retrieval for RRF fusion.
        """
        return await self._match_chunks_rpc(
            rpc_name="rag_v3_match_chunks_sparse",
            params={
                "query_text": query_text,
                "p_top_k": int(top_k),
                "p_jurisdiction": jurisdiction,
                "p_as_of_date": as_of_date.isoformat() if as_of_date else None,
                "p_acl_tags": acl_tags,
                "p_bureau_id": str(bureau_id) if bureau_id else None,
            },
        )

    async def _match_chunks_rpc(
        self,
        *,
        rpc_name: str,
        params: dict,
    ) -> list[RagV3ChunkMatch]:
        client = get_supabase_client()
        resp = client.rpc(rpc_name, params).execute()
        rows = resp.data or []
        return [_row_to_match(row) for row in rows]

    async def enqueue_human_review(
        self,
        *,
        bureau_id: Optional[UUID],
        query: str,
        answer: str,
        reason_codes: list[str],
        confidence: float,
        citations: list[dict[str, Any]],
        metadata: Optional[dict[str, Any]] = None,
    ) -> Optional[str]:
        client = get_supabase_client()
        payload = {
            "bureau_id": str(bureau_id) if bureau_id else None,
            "query_text": query,
            "answer_text": answer,
            "reason_codes": list(dict.fromkeys(reason_codes)),
            "confidence": float(confidence),
            "citations": citations,
            "metadata": metadata or {},
            "status": "pending",
        }
        resp = client.table("rag_v3_review_queue").insert(payload).execute()
        rows = resp.data or []
        if not rows:
            return None
        return str(rows[0].get("id") or "")

    async def append_feedback_candidate(
        self,
        *,
        bureau_id: Optional[UUID],
        query: str,
        answer: str,
        status: str,
        reasons: list[str],
        fingerprint: dict[str, Any],
        citations: list[dict[str, Any]],
        metadata: Optional[dict[str, Any]] = None,
    ) -> Optional[str]:
        client = get_supabase_client()
        payload = {
            "bureau_id": str(bureau_id) if bureau_id else None,
            "query_text": query,
            "answer_text": answer,
            "response_status": status,
            "reasons": list(dict.fromkeys(reasons)),
            "fingerprint": fingerprint,
            "citations": citations,
            "metadata": metadata or {},
        }
        resp = client.table("rag_v3_feedback_examples").insert(payload).execute()
        rows = resp.data or []
        if not rows:
            return None
        return str(rows[0].get("id") or "")

    async def append_query_trace(
        self,
        *,
        request_id: str,
        bureau_id: Optional[UUID],
        query: str,
        response_status: str,
        gate_decision: str,
        requested_tier: int,
        effective_tier: int,
        top_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        admission_reason: str,
        retrieved_count: int,
        retrieved_chunk_ids: list[str],
        retrieval_trace: list[dict[str, Any]],
        citations: list[dict[str, Any]],
        fingerprint: dict[str, Any],
        warnings: list[str],
        contract_version: str,
        schema_version: str,
        latency_ms: int,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        client = get_supabase_client()
        payload = {
            "request_id": request_id,
            "bureau_id": str(bureau_id) if bureau_id else None,
            "query_text": query,
            "response_status": response_status,
            "gate_decision": gate_decision,
            "requested_tier": int(requested_tier),
            "effective_tier": int(effective_tier),
            "top_k": int(top_k),
            "jurisdiction": jurisdiction,
            "as_of_date": as_of_date.isoformat() if as_of_date else None,
            "admission_reason": admission_reason,
            "retrieved_count": int(retrieved_count),
            "retrieved_chunk_ids": list(dict.fromkeys([str(item) for item in retrieved_chunk_ids if str(item).strip()])),
            "retrieval_trace": retrieval_trace,
            "citations": citations,
            "fingerprint": fingerprint,
            "warnings": list(dict.fromkeys([str(item) for item in warnings if str(item).strip()])),
            "contract_version": contract_version,
            "schema_version": schema_version,
            "latency_ms": max(0, int(latency_ms)),
            "metadata": metadata or {},
        }
        client.table("rag_v3_query_traces").upsert(payload, on_conflict="request_id").execute()

    async def get_query_trace(
        self,
        *,
        request_id: str,
        bureau_id: Optional[UUID],
    ) -> Optional[dict[str, Any]]:
        client = get_supabase_client()
        query = (
            client.table("rag_v3_query_traces")
            .select("*")
            .eq("request_id", request_id)
            .limit(1)
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        resp = query.execute()
        rows = resp.data or []
        if not rows:
            return None
        row = rows[0]
        return {
            "request_id": str(row.get("request_id") or request_id),
            "created_at": row.get("created_at"),
            "bureau_id": row.get("bureau_id"),
            "query_text": row.get("query_text") or "",
            "response_status": row.get("response_status") or "ok",
            "gate_decision": row.get("gate_decision") or "answered",
            "requested_tier": int(row.get("requested_tier") or 2),
            "effective_tier": int(row.get("effective_tier") or 2),
            "top_k": int(row.get("top_k") or 10),
            "jurisdiction": row.get("jurisdiction") or "TR",
            "as_of_date": row.get("as_of_date"),
            "admission_reason": row.get("admission_reason") or "accepted",
            "retrieved_count": int(row.get("retrieved_count") or 0),
            "retrieved_chunk_ids": list(row.get("retrieved_chunk_ids") or []),
            "retrieval_trace": list(row.get("retrieval_trace") or []),
            "citations": list(row.get("citations") or []),
            "fingerprint": dict(row.get("fingerprint") or {}),
            "warnings": list(row.get("warnings") or []),
            "contract_version": row.get("contract_version") or "",
            "schema_version": row.get("schema_version") or "",
            "latency_ms": int(row.get("latency_ms") or 0),
            "metadata": dict(row.get("metadata") or {}),
        }


def _parse_date(value: object) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if len(text) >= 10:
            try:
                return date.fromisoformat(text[:10])
            except ValueError:
                return None
    return None


def _row_to_match(row: dict) -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=str(row.get("chunk_id", "")),
        document_id=str(row.get("document_id", "")),
        title=str(row.get("title", "")),
        source_type=str(row.get("source_type", "")),
        source_id=str(row.get("source_id", "")),
        jurisdiction=str(row.get("jurisdiction", "")),
        article_no=row.get("article_no"),
        clause_no=row.get("clause_no"),
        subclause_no=row.get("subclause_no"),
        heading_path=row.get("heading_path"),
        chunk_text=str(row.get("chunk_text", "")),
        page_range=row.get("page_range"),
        effective_from=_parse_date(row.get("effective_from")),
        effective_to=_parse_date(row.get("effective_to")),
        acl_tags=list(row.get("acl_tags") or []),
        doc_hash=str(row.get("doc_hash", "")),
        chunk_hash=str(row.get("chunk_hash", "")),
        semantic_score=float(row.get("semantic_score", 0.0)),
        keyword_score=float(row.get("keyword_score", 0.0)),
        final_score=float(row.get("final_score", 0.0)),
    )


rag_v3_repository = SupabaseRagV3Repository()


def _stable_chunk_id(*, document_id: str, chunk_hash: str) -> str:
    token = f"{document_id}:{chunk_hash}"
    return str(uuid5(_CHUNK_ID_NAMESPACE, token))
