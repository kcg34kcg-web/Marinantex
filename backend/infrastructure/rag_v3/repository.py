"""Supabase repository for RAG v3 documents/chunks."""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid5

from infrastructure.database.connection import get_supabase_client

_CHUNK_ID_NAMESPACE = UUID("d29f5d66-54bb-4b89-a6f0-6ea0f349e58f")
_HYBRID_LANE_RPCS = frozenset({"rag_v3_match_chunks_dense", "rag_v3_match_chunks_sparse"})
logger = logging.getLogger("babylexit.rag_v3.repository")


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
    classification: str
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


@dataclass(frozen=True)
class RagV3DocumentLifecycleState:
    document_id: str
    lifecycle_state: str
    publish_epoch: int
    snapshot_id: int
    revocation_epoch: int
    revoked: bool
    tombstoned: bool
    legal_hold: bool


class SupabaseRagV3Repository:
    """Persistence and retrieval operations for rag_documents/rag_chunks."""

    def __init__(self) -> None:
        # Cache per-RPC classification parameter mode so we avoid
        # repeated 404+retry roundtrips after signature mismatch.
        # Supported modes:
        # - "p_allowed": expects `p_allowed_classifications`
        # - "allowed": expects `allowed_classifications`
        # - "none": no classification parameter in signature
        self._rpc_classification_param_mode: dict[str, str] = {}

    def _cache_rpc_mode(self, rpc_name: str, mode: str) -> None:
        targets = set(_HYBRID_LANE_RPCS) if rpc_name in _HYBRID_LANE_RPCS else {rpc_name}
        for target in targets:
            previous = self._rpc_classification_param_mode.get(target)
            if previous == mode:
                continue
            self._rpc_classification_param_mode[target] = mode
            if mode != "p_allowed":
                logger.warning(
                    "RAG_V3_RPC_SIGNATURE_MODE | rpc=%s | mode=%s",
                    target,
                    mode,
                )

    @staticmethod
    def _is_rpc_signature_mismatch_error(exc: Exception, rpc_name: str) -> bool:
        lowered = str(exc).strip().lower()
        if ("p_allowed_classifications" in lowered) or ("allowed_classifications" in lowered):
            return True
        hints = (
            "pgrst202",
            "404",
            "function not found",
            "could not find the function",
            "no function matches the given name and argument types",
            "undefined function",
            "42883",
        )
        return (rpc_name.lower() in lowered) and any(hint in lowered for hint in hints)

    @staticmethod
    def _is_trace_persist_retryable_error(exc: Exception) -> bool:
        lowered = str(exc).strip().lower()
        retry_hints = (
            "sslv3_alert_bad_record_mac",
            "bad record mac",
            "decryption failed or bad record mac",
            "eof occurred in violation of protocol",
            "tlsv1 alert",
            "ssl error",
            "connection reset",
            "connection aborted",
            "temporarily unavailable",
            "timed out",
            "timeout",
        )
        return any(hint in lowered for hint in retry_hints)

    async def get_control_plane_state(self, *, bureau_id: Optional[UUID]) -> dict[str, int]:
        client = get_supabase_client()
        scope_key = _scope_key(bureau_id)
        payload = {
            "scope_key": scope_key,
            "bureau_id": str(bureau_id) if bureau_id else None,
            "publish_epoch": 0,
            "revocation_epoch": 0,
        }
        try:
            resp = (
                client.table("rag_v3_control_plane")
                .select("publish_epoch, revocation_epoch")
                .eq("scope_key", scope_key)
                .limit(1)
                .execute()
            )
            rows = list(resp.data or [])
            if rows:
                row = rows[0]
                return {
                    "publish_epoch": _to_int(row.get("publish_epoch"), default=0),
                    "revocation_epoch": _to_int(row.get("revocation_epoch"), default=0),
                }
            client.table("rag_v3_control_plane").upsert(payload, on_conflict="scope_key").execute()
            return {"publish_epoch": 0, "revocation_epoch": 0}
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_CONTROL_PLANE_READ_FALLBACK | reason=%s", exc)
            return {"publish_epoch": 0, "revocation_epoch": 0}

    async def bump_publish_epoch(self, *, bureau_id: Optional[UUID]) -> int:
        return await self._bump_control_plane_epoch(bureau_id=bureau_id, field="publish_epoch")

    async def bump_revocation_epoch(self, *, bureau_id: Optional[UUID]) -> int:
        return await self._bump_control_plane_epoch(bureau_id=bureau_id, field="revocation_epoch")

    async def _bump_control_plane_epoch(self, *, bureau_id: Optional[UUID], field: str) -> int:
        if field not in {"publish_epoch", "revocation_epoch"}:
            raise ValueError("field must be publish_epoch or revocation_epoch.")
        current = await self.get_control_plane_state(bureau_id=bureau_id)
        publish_epoch = max(0, int(current.get("publish_epoch") or 0))
        revocation_epoch = max(0, int(current.get("revocation_epoch") or 0))
        if field == "publish_epoch":
            publish_epoch += 1
            bumped = publish_epoch
        else:
            revocation_epoch += 1
            bumped = revocation_epoch

        payload = {
            "scope_key": _scope_key(bureau_id),
            "bureau_id": str(bureau_id) if bureau_id else None,
            "publish_epoch": publish_epoch,
            "revocation_epoch": revocation_epoch,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            client = get_supabase_client()
            client.table("rag_v3_control_plane").upsert(payload, on_conflict="scope_key").execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAG_V3_CONTROL_PLANE_BUMP_FALLBACK | field=%s | reason=%s", field, exc)
        return int(bumped)

    async def mark_document_published(
        self,
        *,
        document_id: str,
        bureau_id: Optional[UUID],
        publish_epoch: int,
        revocation_epoch: int,
    ) -> bool:
        doc_id = str(document_id or "").strip()
        if not doc_id:
            return False
        client = get_supabase_client()
        query = (
            client.table("rag_documents")
            .select("id, metadata")
            .eq("id", doc_id)
            .limit(1)
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        resp = query.execute()
        rows = list(resp.data or [])
        if not rows:
            return False
        row = rows[0]
        metadata = dict(row.get("metadata") or {})
        now_iso = datetime.now(timezone.utc).isoformat()
        metadata.update(
            {
                "lifecycle_state": "published",
                "snapshot_id": int(max(0, publish_epoch)),
                "publish_epoch": int(max(0, publish_epoch)),
                "revocation_epoch": int(max(0, revocation_epoch)),
                "revoked": False,
                "tombstoned": False,
                "revoked_at": None,
                "tombstoned_at": None,
                "published_at": now_iso,
            }
        )
        update_q = client.table("rag_documents").update({"metadata": metadata}).eq("id", doc_id)
        if bureau_id is not None:
            update_q = update_q.eq("bureau_id", str(bureau_id))
        update_q.execute()
        return True

    async def get_document_lifecycle_states(
        self,
        *,
        document_ids: list[str],
        bureau_id: Optional[UUID],
    ) -> dict[str, dict[str, Any]]:
        ids = [str(item).strip() for item in document_ids if str(item).strip()]
        if not ids:
            return {}
        client = get_supabase_client()
        output: dict[str, dict[str, Any]] = {}
        batch_size = 200
        for i in range(0, len(ids), batch_size):
            batch = ids[i : i + batch_size]
            query = (
                client.table("rag_documents")
                .select("id, metadata")
                .in_("id", batch)
            )
            if bureau_id is not None:
                query = query.eq("bureau_id", str(bureau_id))
            resp = query.execute()
            for row in list(resp.data or []):
                doc_id = str(row.get("id") or "").strip()
                if not doc_id:
                    continue
                metadata = dict(row.get("metadata") or {})
                state = _lifecycle_from_metadata(doc_id=doc_id, metadata=metadata)
                output[doc_id] = {
                    "lifecycle_state": state.lifecycle_state,
                    "publish_epoch": state.publish_epoch,
                    "snapshot_id": state.snapshot_id,
                    "revocation_epoch": state.revocation_epoch,
                    "revoked": state.revoked,
                    "tombstoned": state.tombstoned,
                    "legal_hold": state.legal_hold,
                }
        return output

    async def apply_document_lifecycle_action(
        self,
        *,
        document_id: Optional[str],
        source_id: Optional[str],
        bureau_id: Optional[UUID],
        action: str,
        reason: Optional[str],
    ) -> dict[str, Any]:
        action_token = str(action or "").strip().lower()
        if action_token not in {"revoke", "tombstone", "legal_hold", "restore"}:
            raise ValueError("action must be one of: revoke, tombstone, legal_hold, restore.")
        has_document_id = bool((document_id or "").strip())
        has_source_id = bool((source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id must be provided.")

        client = get_supabase_client()
        query = client.table("rag_documents").select("id, metadata, bureau_id")
        if has_document_id:
            query = query.eq("id", str(document_id).strip())
        if has_source_id:
            query = query.eq("source_id", str(source_id).strip())
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        resp = query.execute()
        docs = list(resp.data or [])
        if not docs:
            return {
                "action": action_token,
                "affected_document_ids": [],
                "affected_documents": 0,
                "revocation_epoch": 0,
                "warnings": [],
            }

        control = await self.get_control_plane_state(bureau_id=bureau_id)
        publish_epoch = max(0, int(control.get("publish_epoch") or 0))
        revocation_epoch = max(0, int(control.get("revocation_epoch") or 0))
        if action_token in {"revoke", "tombstone", "restore"}:
            revocation_epoch = await self.bump_revocation_epoch(bureau_id=bureau_id)

        now_iso = datetime.now(timezone.utc).isoformat()
        affected_document_ids: list[str] = []
        warnings: list[str] = []
        for row in docs:
            doc_id = str(row.get("id") or "").strip()
            if not doc_id:
                continue
            metadata = dict(row.get("metadata") or {})
            updated_metadata = _apply_lifecycle_action_to_metadata(
                metadata=metadata,
                action=action_token,
                reason=(reason or "").strip() or None,
                now_iso=now_iso,
                publish_epoch=publish_epoch,
                revocation_epoch=revocation_epoch,
            )
            try:
                update_q = client.table("rag_documents").update({"metadata": updated_metadata}).eq("id", doc_id)
                if bureau_id is not None:
                    update_q = update_q.eq("bureau_id", str(bureau_id))
                update_q.execute()
                affected_document_ids.append(doc_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "RAG_V3_LIFECYCLE_UPDATE_FAILED | doc_id=%s | action=%s | reason=%s",
                    doc_id,
                    action_token,
                    exc,
                )
                warnings.append(f"update_failed:{doc_id}")

        return {
            "action": action_token,
            "affected_document_ids": affected_document_ids,
            "affected_documents": len(affected_document_ids),
            "revocation_epoch": int(revocation_epoch),
            "warnings": list(dict.fromkeys(warnings)),
        }

    async def upsert_document_and_replace_chunks(
        self,
        *,
        title: str,
        source_type: str,
        source_id: str,
        jurisdiction: str,
        classification: str,
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
            "classification": classification,
            "effective_from": effective_from.isoformat() if effective_from else None,
            "effective_to": effective_to.isoformat() if effective_to else None,
            "doc_hash": doc_hash,
            "acl_tags": acl_tags,
            "bureau_id": str(bureau_id) if bureau_id else None,
            "metadata": metadata or {},
        }

        try:
            doc_resp = (
                client.table("rag_documents")
                .upsert(payload, on_conflict="doc_hash")
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            # Backward compatibility when classification column migration is not yet applied.
            if "classification" not in str(exc).lower():
                raise
            legacy_payload = dict(payload)
            legacy_payload.pop("classification", None)
            legacy_payload["metadata"] = {
                **dict(metadata or {}),
                "classification": classification,
            }
            doc_resp = (
                client.table("rag_documents")
                .upsert(legacy_payload, on_conflict="doc_hash")
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
        allowed_classifications: list[str],
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
                "p_allowed_classifications": allowed_classifications,
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
        allowed_classifications: list[str],
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
                "p_allowed_classifications": allowed_classifications,
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
        allowed_classifications: list[str],
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
                "p_allowed_classifications": allowed_classifications,
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
        preferred_mode = self._rpc_classification_param_mode.get(rpc_name, "p_allowed")
        candidates: list[tuple[str, dict[str, Any]]] = []

        p_allowed_params = dict(params)
        allowed_params = dict(params)
        if "p_allowed_classifications" in allowed_params:
            allowed_params["allowed_classifications"] = allowed_params.pop("p_allowed_classifications")
        none_params = dict(params)
        none_params.pop("p_allowed_classifications", None)
        none_params.pop("allowed_classifications", None)

        if preferred_mode == "allowed":
            candidates = [("allowed", allowed_params), ("none", none_params), ("p_allowed", p_allowed_params)]
        elif preferred_mode == "none":
            candidates = [("none", none_params), ("allowed", allowed_params), ("p_allowed", p_allowed_params)]
        else:
            candidates = [("p_allowed", p_allowed_params), ("allowed", allowed_params), ("none", none_params)]

        # Dedupe candidate order by mode.
        deduped_candidates: list[tuple[str, dict[str, Any]]] = []
        seen_modes: set[str] = set()
        for mode, candidate_params in candidates:
            if mode in seen_modes:
                continue
            seen_modes.add(mode)
            deduped_candidates.append((mode, candidate_params))

        last_exc: Optional[Exception] = None
        resp = None
        for idx, (mode, candidate_params) in enumerate(deduped_candidates):
            try:
                resp = client.rpc(rpc_name, candidate_params).execute()
                self._cache_rpc_mode(rpc_name, mode)
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if idx >= len(deduped_candidates) - 1:
                    raise
                if not self._is_rpc_signature_mismatch_error(exc, rpc_name):
                    raise

        if resp is None:
            if last_exc is not None:
                raise last_exc
            raise RuntimeError(f"RPC call failed unexpectedly: {rpc_name}")
        rows = resp.data or []
        return [_row_to_match(row) for row in rows]

    async def delete_document_and_chunks(
        self,
        *,
        document_id: Optional[str],
        source_id: Optional[str],
        bureau_id: Optional[UUID],
    ) -> dict[str, Any]:
        has_document_id = bool((document_id or "").strip())
        has_source_id = bool((source_id or "").strip())
        if has_document_id == has_source_id:
            raise ValueError("Exactly one of document_id or source_id must be provided.")

        client = get_supabase_client()
        query = client.table("rag_documents").select("id, metadata, bureau_id")
        if has_document_id:
            query = query.eq("id", str(document_id).strip())
        if has_source_id:
            query = query.eq("source_id", str(source_id).strip())
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        doc_resp = query.execute()
        docs = list(doc_resp.data or [])
        if not docs:
            return {
                "deleted_document_ids": [],
                "deleted_documents": 0,
                "deleted_chunks": 0,
                "raw_storage_refs": [],
                "warnings": [],
            }

        doc_ids = [str(row.get("id") or "").strip() for row in docs if str(row.get("id") or "").strip()]
        if not doc_ids:
            return {
                "deleted_document_ids": [],
                "deleted_documents": 0,
                "deleted_chunks": 0,
                "raw_storage_refs": [],
                "warnings": ["delete_no_document_ids"],
            }

        chunk_resp = (
            client.table("rag_chunks")
            .select("document_id")
            .in_("document_id", doc_ids)
            .execute()
        )
        deleted_chunks = len(chunk_resp.data or [])

        delete_resp = (
            client.table("rag_documents")
            .delete()
            .in_("id", doc_ids)
            .execute()
        )
        deleted_rows = list(delete_resp.data or [])
        deleted_document_ids = [
            str(row.get("id") or "").strip()
            for row in deleted_rows
            if str(row.get("id") or "").strip()
        ] or doc_ids

        raw_storage_refs: list[dict[str, str]] = []
        for row in docs:
            metadata = row.get("metadata")
            if not isinstance(metadata, dict):
                continue
            bucket = str(metadata.get("raw_storage_bucket") or "").strip()
            path = str(metadata.get("raw_storage_path") or "").strip()
            if bucket and path:
                raw_storage_refs.append({"bucket": bucket, "path": path})

        return {
            "deleted_document_ids": deleted_document_ids,
            "deleted_documents": len(deleted_document_ids),
            "deleted_chunks": int(deleted_chunks),
            "raw_storage_refs": raw_storage_refs,
            "warnings": [],
        }

    async def get_index_integrity(
        self,
        *,
        bureau_id: Optional[UUID],
        allowed_classifications: list[str],
    ) -> dict[str, Any]:
        client = get_supabase_client()
        query = (
            client.table("rag_documents")
            .select("id, classification")
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        if allowed_classifications:
            query = query.in_("classification", allowed_classifications)
        try:
            doc_resp = query.execute()
            docs = list(doc_resp.data or [])
        except Exception as exc:  # noqa: BLE001
            if "classification" not in str(exc).lower():
                raise
            fallback_query = client.table("rag_documents").select("id, metadata")
            if bureau_id is not None:
                fallback_query = fallback_query.eq("bureau_id", str(bureau_id))
            doc_resp = fallback_query.execute()
            docs = []
            for row in list(doc_resp.data or []):
                metadata = row.get("metadata")
                classification = None
                if isinstance(metadata, dict):
                    classification = metadata.get("classification")
                docs.append(
                    {
                        "id": row.get("id"),
                        "classification": str(classification or "INTERNAL").upper(),
                    }
                )
        allowed_set = {
            str(item).strip().upper()
            for item in (allowed_classifications or [])
            if str(item).strip()
        }
        if allowed_set:
            docs = [
                row
                for row in docs
                if str(row.get("classification") or "INTERNAL").strip().upper() in allowed_set
            ]
        doc_ids = [str(row.get("id") or "").strip() for row in docs if str(row.get("id") or "").strip()]
        classification_breakdown: dict[str, int] = {}
        for row in docs:
            key = str(row.get("classification") or "INTERNAL").strip().upper() or "INTERNAL"
            classification_breakdown[key] = classification_breakdown.get(key, 0) + 1

        if not doc_ids:
            return {
                "document_count": 0,
                "chunk_count": 0,
                "documents_without_chunks": 0,
                "documents_without_chunks_ids": [],
                "classification_breakdown": classification_breakdown,
            }

        chunk_resp = (
            client.table("rag_chunks")
            .select("document_id")
            .in_("document_id", doc_ids)
            .execute()
        )
        chunk_rows = list(chunk_resp.data or [])
        chunk_count = len(chunk_rows)
        chunk_count_by_doc: dict[str, int] = {}
        for row in chunk_rows:
            doc_id = str(row.get("document_id") or "").strip()
            if not doc_id:
                continue
            chunk_count_by_doc[doc_id] = chunk_count_by_doc.get(doc_id, 0) + 1

        docs_without_chunks_ids = [doc_id for doc_id in doc_ids if chunk_count_by_doc.get(doc_id, 0) <= 0]
        return {
            "document_count": len(doc_ids),
            "chunk_count": chunk_count,
            "documents_without_chunks": len(docs_without_chunks_ids),
            "documents_without_chunks_ids": docs_without_chunks_ids,
            "classification_breakdown": classification_breakdown,
        }

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
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                client = get_supabase_client()
                client.table("rag_v3_query_traces").upsert(payload, on_conflict="request_id").execute()
                return
            except Exception as exc:  # noqa: BLE001
                if attempt >= max_attempts or not self._is_trace_persist_retryable_error(exc):
                    raise
                backoff_s = 0.15 * attempt
                logger.warning(
                    "RAG_V3_TRACE_PERSIST_RETRY | request_id=%s | attempt=%d/%d | backoff_s=%.2f | reason=%s",
                    request_id,
                    attempt,
                    max_attempts,
                    backoff_s,
                    exc,
                )
                await asyncio.sleep(backoff_s)

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

    async def get_observability_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
        window_hours: int,
    ) -> dict[str, Any]:
        client = get_supabase_client()
        bounded_window = max(1, min(int(window_hours), 24 * 30))
        since = datetime.now(timezone.utc) - timedelta(hours=bounded_window)
        query = (
            client.table("rag_v3_query_traces")
            .select("response_status, gate_decision, latency_ms, retrieved_count, metadata, created_at")
            .gte("created_at", since.isoformat())
            .order("created_at", desc=True)
            .limit(5000)
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))

        resp = query.execute()
        rows = list(resp.data or [])
        if not rows:
            return {
                "window_hours": bounded_window,
                "request_count": 0,
                "avg_query_latency_ms": 0.0,
                "p95_query_latency_ms": 0.0,
                "no_answer_rate": 0.0,
                "security_block_rate": 0.0,
                "cache_hit_rate": 0.0,
                "avg_retrieved_count": 0.0,
            }

        latencies: list[float] = []
        no_answer_count = 0
        security_block_count = 0
        cache_hit_count = 0
        retrieved_sum = 0.0
        for row in rows:
            try:
                latencies.append(float(row.get("latency_ms") or 0.0))
            except Exception:
                latencies.append(0.0)
            status = str(row.get("response_status") or "").strip().lower()
            if status == "no_answer":
                no_answer_count += 1
            gate_decision = str(row.get("gate_decision") or "").strip().lower()
            if gate_decision.startswith("security_block"):
                security_block_count += 1
            metadata = row.get("metadata")
            if isinstance(metadata, dict) and bool(metadata.get("cache_hit")):
                cache_hit_count += 1
            try:
                retrieved_sum += float(row.get("retrieved_count") or 0.0)
            except Exception:
                retrieved_sum += 0.0

        count = max(1, len(rows))
        latencies_sorted = sorted(latencies)
        p95_index = max(
            0,
            min(
                len(latencies_sorted) - 1,
                int(math.ceil(len(latencies_sorted) * 0.95) - 1),
            ),
        )
        return {
            "window_hours": bounded_window,
            "request_count": len(rows),
            "avg_query_latency_ms": sum(latencies) / float(count),
            "p95_query_latency_ms": float(latencies_sorted[p95_index]) if latencies_sorted else 0.0,
            "no_answer_rate": float(no_answer_count) / float(count),
            "security_block_rate": float(security_block_count) / float(count),
            "cache_hit_rate": float(cache_hit_count) / float(count),
            "avg_retrieved_count": float(retrieved_sum) / float(count),
        }


def _scope_key(bureau_id: Optional[UUID]) -> str:
    return f"bureau:{str(bureau_id)}" if bureau_id else "global"


def _to_int(value: object, *, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return int(default)


def _lifecycle_from_metadata(*, doc_id: str, metadata: dict[str, Any]) -> RagV3DocumentLifecycleState:
    state = str(metadata.get("lifecycle_state") or "published").strip().lower() or "published"
    publish_epoch = max(0, _to_int(metadata.get("publish_epoch"), default=0))
    snapshot_id = max(0, _to_int(metadata.get("snapshot_id"), default=publish_epoch))
    revocation_epoch = max(0, _to_int(metadata.get("revocation_epoch"), default=0))
    revoked = bool(metadata.get("revoked")) or state == "revoked"
    tombstoned = bool(metadata.get("tombstoned")) or state == "tombstone" or state == "tombstoned"
    legal_hold = bool(metadata.get("legal_hold")) or state == "legal_hold"
    return RagV3DocumentLifecycleState(
        document_id=doc_id,
        lifecycle_state=state,
        publish_epoch=publish_epoch,
        snapshot_id=snapshot_id,
        revocation_epoch=revocation_epoch,
        revoked=revoked,
        tombstoned=tombstoned,
        legal_hold=legal_hold,
    )


def _apply_lifecycle_action_to_metadata(
    *,
    metadata: dict[str, Any],
    action: str,
    reason: Optional[str],
    now_iso: str,
    publish_epoch: int,
    revocation_epoch: int,
) -> dict[str, Any]:
    out = dict(metadata or {})
    if action == "revoke":
        out.update(
            {
                "lifecycle_state": "revoked",
                "revoked": True,
                "tombstoned": bool(out.get("tombstoned", False)),
                "legal_hold": bool(out.get("legal_hold", False)),
                "revoked_at": now_iso,
                "revocation_epoch": int(max(0, revocation_epoch)),
            }
        )
    elif action == "tombstone":
        out.update(
            {
                "lifecycle_state": "tombstoned",
                "tombstoned": True,
                "revoked": True,
                "tombstoned_at": now_iso,
                "revoked_at": now_iso,
                "revocation_epoch": int(max(0, revocation_epoch)),
            }
        )
    elif action == "legal_hold":
        out.update(
            {
                "lifecycle_state": "legal_hold",
                "legal_hold": True,
                "legal_hold_at": now_iso,
            }
        )
    elif action == "restore":
        next_publish = max(0, _to_int(out.get("publish_epoch"), default=publish_epoch))
        next_snapshot = max(0, _to_int(out.get("snapshot_id"), default=next_publish))
        out.update(
            {
                "lifecycle_state": "published",
                "revoked": False,
                "tombstoned": False,
                "revoked_at": None,
                "tombstoned_at": None,
                "restored_at": now_iso,
                "publish_epoch": next_publish,
                "snapshot_id": next_snapshot,
                "revocation_epoch": int(max(0, revocation_epoch)),
            }
        )
    if reason:
        out["lifecycle_reason"] = reason[:400]
    return out


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
        classification=str(row.get("classification", "INTERNAL") or "INTERNAL").upper(),
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
