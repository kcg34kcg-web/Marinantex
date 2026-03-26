"""Supabase repository for RAG v3 documents/chunks."""

from __future__ import annotations

import asyncio
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid5

from infrastructure.config import settings
from infrastructure.database.connection import get_supabase_client

_CHUNK_ID_NAMESPACE = UUID("d29f5d66-54bb-4b89-a6f0-6ea0f349e58f")
_POSTGREST_MISSING_COLUMN_RE = re.compile(
    r"could not find the '([^']+)' column of '([^']+)'",
    re.IGNORECASE,
)
_RELATION_MISSING_COLUMN_RE = re.compile(
    r'column "?([a-z0-9_]+)"? of relation "?([a-z0-9_]+)"? does not exist',
    re.IGNORECASE,
)
_HYBRID_LANE_RPCS = frozenset(
    {
        "rag_v3_match_chunks_dense",
        "rag_v3_match_chunks_sparse",
        "rag_v3_match_chunks_legal_exact",
        "rag_v3_doc_shortlist",
    }
)
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
    chunk_order: int
    chunk_type: str
    token_count: int
    embedding_version: str
    index_version: str
    source_id: str
    source_char_start: Optional[int] = None
    source_char_end: Optional[int] = None
    paragraph_start: Optional[int] = None
    paragraph_end: Optional[int] = None
    section_path: Optional[str] = None
    source_url: Optional[str] = None


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
    source_char_start: Optional[int] = None
    source_char_end: Optional[int] = None
    paragraph_start: Optional[int] = None
    paragraph_end: Optional[int] = None
    section_path: Optional[str] = None
    source_url: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    acl_tags: list[str] = field(default_factory=list)
    doc_hash: str = ""
    chunk_hash: str = ""
    semantic_score: float = 0.0
    keyword_score: float = 0.0
    final_score: float = 0.0


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


@dataclass(frozen=True)
class RagV3DocumentShortlistItem:
    document_id: str
    source_id: str
    source_type: str
    classification: str
    authority_rank: int
    doc_score: float


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

    @staticmethod
    def _is_trace_extended_column_error(exc: Exception) -> bool:
        lowered = str(exc).strip().lower()
        if "column" not in lowered:
            return False
        trace_fields = (
            "legal_disclaimer_ack",
            "human_responsibility_ack",
            "tier_policy_route_reason",
            "query_expansion",
            "prompt_scenario",
            "prompt_registry_version",
            "source_documents",
            "review_required",
            "review_reason_codes",
            "low_confidence",
            "low_confidence_reason",
        )
        return any(field in lowered for field in trace_fields)

    @staticmethod
    def _extract_missing_table_column(exc: Exception, *, table: str) -> Optional[str]:
        message = str(exc or "")
        match = _POSTGREST_MISSING_COLUMN_RE.search(message)
        if match:
            column = str(match.group(1) or "").strip()
            found_table = str(match.group(2) or "").strip().lower()
            if column and found_table == str(table).strip().lower():
                return column

        match = _RELATION_MISSING_COLUMN_RE.search(message)
        if match:
            column = str(match.group(1) or "").strip()
            found_table = str(match.group(2) or "").strip().lower()
            if column and found_table == str(table).strip().lower():
                return column
        return None

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
        metadata_payload = dict(metadata or {})
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
            "metadata": metadata_payload,
            "law_no": _metadata_text(metadata_payload, "law_no", "kanun_no"),
            "article_no": _metadata_text(metadata_payload, "article_no", "article", "madde_no"),
            "docket_no": _metadata_text(metadata_payload, "docket_no", "esas_no", "esasNo"),
            "decision_no": _metadata_text(metadata_payload, "decision_no", "karar_no", "kararNo"),
            "decision_date": _metadata_date(metadata_payload, "decision_date", "karar_tarihi"),
            "publish_date": _metadata_date(metadata_payload, "publish_date", "yayim_tarihi"),
            "court": _metadata_text(metadata_payload, "court", "mahkeme"),
            "chamber": _metadata_text(metadata_payload, "chamber", "daire"),
            "mulga_state": _metadata_mulga_state(metadata_payload),
            "topic_tags": _metadata_tags(metadata_payload),
        }

        doc_resp = None
        doc_payload = dict(payload)
        max_doc_retries = max(1, len(doc_payload) + 2)
        for _ in range(max_doc_retries):
            try:
                doc_resp = (
                    client.table("rag_documents")
                    .upsert(doc_payload, on_conflict="doc_hash")
                    .execute()
                )
                break
            except Exception as exc:  # noqa: BLE001
                missing_col = self._extract_missing_table_column(exc, table="rag_documents")
                if missing_col and missing_col in doc_payload:
                    if missing_col == "classification":
                        legacy_metadata = dict(doc_payload.get("metadata") or {})
                        legacy_metadata.setdefault("classification", classification)
                        doc_payload["metadata"] = legacy_metadata
                    doc_payload.pop(missing_col, None)
                    logger.warning(
                        "RAG_V3_DOCUMENT_COLUMN_MISSING | column=%s | falling_back=true | reason=%s",
                        missing_col,
                        exc,
                    )
                    continue

                lowered = str(exc).lower()
                # Backward compatibility when classification column migration is not yet applied.
                if "classification" in lowered and "classification" in doc_payload:
                    legacy_metadata = dict(doc_payload.get("metadata") or {})
                    legacy_metadata.setdefault("classification", classification)
                    doc_payload["metadata"] = legacy_metadata
                    doc_payload.pop("classification", None)
                    logger.warning(
                        "RAG_V3_DOCUMENT_CLASSIFICATION_COLUMN_MISSING | falling_back=true | reason=%s",
                        exc,
                    )
                    continue
                raise

        if doc_resp is None:
            raise RuntimeError("Failed to upsert rag_documents row after schema-compat retries.")
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
                "chunk_order": int(chunk.chunk_order),
                "chunk_type": str(chunk.chunk_type or "generic").strip() or "generic",
                "token_count": max(0, int(chunk.token_count)),
                "embedding_version": str(chunk.embedding_version or "legacy/unknown").strip()
                or "legacy/unknown",
                "index_version": str(chunk.index_version or "legacy/unknown").strip()
                or "legacy/unknown",
                "source_id": chunk.source_id,
                "source_char_start": int(chunk.source_char_start)
                if chunk.source_char_start is not None
                else None,
                "source_char_end": int(chunk.source_char_end)
                if chunk.source_char_end is not None
                else None,
                "paragraph_start": int(chunk.paragraph_start)
                if chunk.paragraph_start is not None
                else None,
                "paragraph_end": int(chunk.paragraph_end)
                if chunk.paragraph_end is not None
                else None,
                "section_path": chunk.section_path,
                "source_url": chunk.source_url,
            }
            for chunk_hash, chunk in deduped_chunks.items()
        ]

        batch_size = 100
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            batch_payload = [dict(row) for row in batch]
            max_chunk_retries = max(1, len(batch_payload[0]) + 2)
            persisted = False
            for _ in range(max_chunk_retries):
                try:
                    client.table("rag_chunks").upsert(
                        batch_payload,
                        on_conflict="document_id,chunk_hash",
                    ).execute()
                    persisted = True
                    break
                except Exception as exc:  # noqa: BLE001
                    missing_col = self._extract_missing_table_column(exc, table="rag_chunks")
                    if not missing_col:
                        raise
                    if not any(missing_col in row for row in batch_payload):
                        raise
                    for row in batch_payload:
                        row.pop(missing_col, None)
                    logger.warning(
                        "RAG_V3_CHUNK_COLUMN_MISSING | column=%s | falling_back=true | reason=%s",
                        missing_col,
                        exc,
                    )
                    continue

            if not persisted:
                raise RuntimeError("Failed to upsert rag_chunks batch after schema-compat retries.")

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

    async def get_latest_document_by_source(
        self,
        *,
        source_id: str,
        jurisdiction: str,
        bureau_id: Optional[UUID],
    ) -> Optional[dict[str, Any]]:
        token = str(source_id or "").strip()
        if not token:
            return None
        client = get_supabase_client()
        query = (
            client.table("rag_documents")
            .select("id, source_id, source_type, jurisdiction, effective_from, effective_to, updated_at, metadata")
            .eq("source_id", token)
            .eq("jurisdiction", str(jurisdiction or "TR").strip() or "TR")
            .order("updated_at", desc=True)
            .limit(1)
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        resp = query.execute()
        rows = list(resp.data or [])
        if not rows:
            return None
        row = rows[0]
        return {
            "id": str(row.get("id") or "").strip(),
            "source_id": str(row.get("source_id") or "").strip(),
            "source_type": str(row.get("source_type") or "").strip(),
            "jurisdiction": str(row.get("jurisdiction") or "").strip(),
            "effective_from": _parse_date(row.get("effective_from")),
            "effective_to": _parse_date(row.get("effective_to")),
            "updated_at": row.get("updated_at"),
            "metadata": dict(row.get("metadata") or {}),
        }

    async def get_document_chunks(
        self,
        *,
        document_id: str,
        limit: int = 2500,
    ) -> list[dict[str, Any]]:
        doc_id = str(document_id or "").strip()
        if not doc_id:
            return []
        client = get_supabase_client()
        query = (
            client.table("rag_chunks")
            .select("id, article_no, clause_no, subclause_no, text, chunk_hash")
            .eq("document_id", doc_id)
            .limit(max(1, int(limit)))
        )
        resp = query.execute()
        rows = list(resp.data or [])
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "id": str(row.get("id") or "").strip(),
                    "article_no": row.get("article_no"),
                    "clause_no": row.get("clause_no"),
                    "subclause_no": row.get("subclause_no"),
                    "text": str(row.get("text") or ""),
                    "chunk_hash": str(row.get("chunk_hash") or "").strip(),
                }
            )
        return out

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

    async def match_chunks_legal_exact(
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
        Deterministic legal exact lane (E/K no, madde/fikra hints, phrase/proximity).
        """
        return await self._match_chunks_rpc(
            rpc_name="rag_v3_match_chunks_legal_exact",
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

    async def match_document_shortlist(
        self,
        *,
        query_embedding: list[float],
        query_text: str,
        doc_k: int,
        jurisdiction: str,
        as_of_date: Optional[date],
        acl_tags: list[str],
        allowed_classifications: list[str],
        bureau_id: Optional[UUID],
    ) -> list[RagV3DocumentShortlistItem]:
        client = get_supabase_client()
        preferred_mode = self._rpc_classification_param_mode.get("rag_v3_doc_shortlist", "p_allowed")
        params = {
            "query_embedding": query_embedding,
            "query_text": query_text,
            "p_doc_k": int(doc_k),
            "p_jurisdiction": jurisdiction,
            "p_as_of_date": as_of_date.isoformat() if as_of_date else None,
            "p_acl_tags": acl_tags,
            "p_allowed_classifications": allowed_classifications,
            "p_bureau_id": str(bureau_id) if bureau_id else None,
        }
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

        response = None
        last_exc: Optional[Exception] = None
        for idx, (mode, candidate_params) in enumerate(candidates):
            try:
                response = client.rpc("rag_v3_doc_shortlist", candidate_params).execute()
                self._cache_rpc_mode("rag_v3_doc_shortlist", mode)
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if idx >= len(candidates) - 1:
                    raise
                if not self._is_rpc_signature_mismatch_error(exc, "rag_v3_doc_shortlist"):
                    raise

        if response is None:
            if last_exc is not None:
                raise last_exc
            return []
        rows = list(response.data or [])
        return [_row_to_doc_shortlist(item) for item in rows]

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

    async def append_retention_deletion_logs(
        self,
        *,
        bureau_id: Optional[UUID],
        target_table: str,
        target_ids: list[str],
        reason: Optional[str],
        delete_mode: str = "soft",
        deleted_by: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        table_name = str(target_table or "").strip()
        if not table_name:
            return 0
        mode = str(delete_mode or "soft").strip().lower()
        if mode not in {"soft", "hard"}:
            mode = "soft"
        targets = list(dict.fromkeys([str(item or "").strip() for item in target_ids if str(item or "").strip()]))
        if not targets:
            return 0

        now_iso = datetime.now(timezone.utc).isoformat()
        payload: list[dict[str, Any]] = []
        for target_id in targets:
            payload.append(
                {
                    "created_at": now_iso,
                    "bureau_id": str(bureau_id) if bureau_id else None,
                    "target_table": table_name,
                    "target_id": target_id,
                    "reason": str(reason or "").strip() or None,
                    "delete_mode": mode,
                    "deleted_by": str(deleted_by or "").strip() or None,
                    "metadata": dict(metadata or {}),
                }
            )
        client = get_supabase_client()
        resp = client.table("rag_v3_retention_deletion_log").insert(payload).execute()
        rows = list(resp.data or [])
        return len(rows) if rows else len(payload)

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

    async def get_corpus_coverage_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
        allowed_classifications: list[str],
        limit: int = 5000,
    ) -> dict[str, Any]:
        client = get_supabase_client()
        query = (
            client.table("rag_documents")
            .select(
                "id, source_type, classification, source_id, created_at, updated_at, metadata, "
                "law_no, article_no, docket_no, decision_no, decision_date, publish_date, court, chamber, mulga_state, topic_tags"
            )
            .order("updated_at", desc=True)
            .limit(max(100, min(int(limit), 10000)))
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        if allowed_classifications:
            query = query.in_("classification", allowed_classifications)
        resp = query.execute()
        docs = list(resp.data or [])

        by_source_type: dict[str, int] = {}
        by_court: dict[str, int] = {}
        by_chamber: dict[str, int] = {}
        metadata_required = [
            "source_url",
            "law_no",
            "article_no",
            "docket_no",
            "decision_no",
            "decision_date",
            "publish_date",
            "mulga_state",
            "topic_tags",
        ]
        metadata_filled = {key: 0 for key in metadata_required}
        verified_count = 0
        ingest_last_at: Optional[datetime] = None
        min_date: Optional[str] = None
        max_date: Optional[str] = None

        for row in docs:
            source_type = str(row.get("source_type") or "unknown").strip() or "unknown"
            by_source_type[source_type] = by_source_type.get(source_type, 0) + 1
            metadata = dict(row.get("metadata") or {})

            if bool(metadata.get("corpus_verified")):
                verified_count += 1

            court = str(row.get("court") or metadata.get("court") or "").strip()
            if court:
                by_court[court] = by_court.get(court, 0) + 1
            chamber = str(row.get("chamber") or metadata.get("chamber") or "").strip()
            if chamber:
                by_chamber[chamber] = by_chamber.get(chamber, 0) + 1

            for field in metadata_required:
                value = row.get(field)
                if value is None:
                    value = metadata.get(field)
                if value is None:
                    continue
                if isinstance(value, str) and not value.strip():
                    continue
                if isinstance(value, list) and len(value) == 0:
                    continue
                metadata_filled[field] += 1

            updated_at = _parse_datetime(row.get("updated_at"))
            if updated_at and (ingest_last_at is None or updated_at > ingest_last_at):
                ingest_last_at = updated_at

            for date_field in ("decision_date", "publish_date"):
                token = str(row.get(date_field) or metadata.get(date_field) or "").strip()
                if len(token) >= 10:
                    token = token[:10]
                    if min_date is None or token < min_date:
                        min_date = token
                    if max_date is None or token > max_date:
                        max_date = token

        total_docs = len(docs)
        metadata_completeness = {
            key: (float(metadata_filled[key]) / float(total_docs) if total_docs > 0 else 0.0)
            for key in metadata_required
        }

        return {
            "document_count": total_docs,
            "verified_document_count": int(verified_count),
            "verified_state": bool(total_docs > 0 and verified_count == total_docs),
            "source_type_distribution": by_source_type,
            "court_distribution": by_court,
            "chamber_distribution": by_chamber,
            "date_range": {
                "min": min_date,
                "max": max_date,
            },
            "metadata_completeness": metadata_completeness,
            "last_ingest_at": ingest_last_at.isoformat() if ingest_last_at else None,
            "sample_truncated": bool(total_docs >= max(100, min(int(limit), 10000))),
        }

    async def get_compliance_evidence_snapshot(
        self,
        *,
        bureau_id: Optional[UUID],
    ) -> dict[str, Any]:
        client = get_supabase_client()
        bureau_token = str(bureau_id) if bureau_id else None

        legal_hold_count = 0
        try:
            q = client.table("rag_documents").select("id", count="exact")
            if bureau_token:
                q = q.eq("bureau_id", bureau_token)
            q = q.eq("metadata->>legal_hold", "true")
            resp = q.execute()
            legal_hold_count = int(getattr(resp, "count", 0) or 0)
        except Exception:
            legal_hold_count = 0

        retention_events_30d = 0
        anonymize_events_30d = 0
        hard_delete_events_30d = 0
        retention_last_at: Optional[str] = None
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            q = (
                client.table("rag_v3_retention_deletion_log")
                .select("id, created_at, reason, delete_mode", count="exact")
                .gte("created_at", since)
                .order("created_at", desc=True)
                .limit(2000)
            )
            if bureau_token:
                q = q.eq("bureau_id", bureau_token)
            resp = q.execute()
            retention_events_30d = int(getattr(resp, "count", 0) or 0)
            rows = list(resp.data or [])
            if rows:
                retention_last_at = str(rows[0].get("created_at") or "").strip() or None
            for row in rows:
                delete_mode = str(row.get("delete_mode") or "").strip().lower()
                reason = str(row.get("reason") or "").strip().lower()
                if delete_mode == "hard":
                    hard_delete_events_30d += 1
                if "anonym" in reason or "pseudonym" in reason:
                    anonymize_events_30d += 1
        except Exception:
            retention_events_30d = 0
            anonymize_events_30d = 0
            hard_delete_events_30d = 0

        freshness_checks_24h = 0
        freshness_last_at: Optional[str] = None
        try:
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            q = (
                client.table("rag_v3_source_freshness_log")
                .select("id, created_at", count="exact")
                .gte("created_at", since)
                .order("created_at", desc=True)
                .limit(1)
            )
            resp = q.execute()
            freshness_checks_24h = int(getattr(resp, "count", 0) or 0)
            rows = list(resp.data or [])
            if rows:
                freshness_last_at = str(rows[0].get("created_at") or "").strip() or None
        except Exception:
            freshness_checks_24h = 0

        backup_restore_last_drill: Optional[str] = None
        rollback_last_drill: Optional[str] = None
        human_eval_rubric_count = 0

        try:
            q = (
                client.table("rag_v3_backup_restore_drill_log")
                .select("executed_at")
                .order("executed_at", desc=True)
                .limit(1)
            )
            if bureau_token:
                q = q.eq("bureau_id", bureau_token)
            resp = q.execute()
            rows = list(resp.data or [])
            if rows:
                backup_restore_last_drill = str(rows[0].get("executed_at") or "").strip() or None
        except Exception:
            backup_restore_last_drill = None

        try:
            q = (
                client.table("rag_v3_rollback_drill_log")
                .select("executed_at")
                .order("executed_at", desc=True)
                .limit(1)
            )
            if bureau_token:
                q = q.eq("bureau_id", bureau_token)
            resp = q.execute()
            rows = list(resp.data or [])
            if rows:
                rollback_last_drill = str(rows[0].get("executed_at") or "").strip() or None
        except Exception:
            rollback_last_drill = None

        try:
            q = client.table("rag_v3_human_eval_rubrics").select("id", count="exact")
            if bureau_token:
                q = q.eq("bureau_id", bureau_token)
            resp = q.execute()
            human_eval_rubric_count = int(getattr(resp, "count", 0) or 0)
        except Exception:
            human_eval_rubric_count = 0

        return {
            "legal_hold_document_count": int(legal_hold_count),
            "retention_events_30d": int(retention_events_30d),
            "anonymize_events_30d": int(anonymize_events_30d),
            "hard_delete_events_30d": int(hard_delete_events_30d),
            "retention_last_event_at": retention_last_at,
            "freshness_checks_24h": int(freshness_checks_24h),
            "freshness_last_check_at": freshness_last_at,
            "backup_restore_last_drill_at": backup_restore_last_drill,
            "rollback_last_drill_at": rollback_last_drill,
            "human_eval_rubric_count": int(human_eval_rubric_count),
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
        md = dict(metadata or {})
        review_priority = str(md.get("review_priority") or "p3").strip().lower()
        severity_map = {"p0": "P0", "p1": "P1", "p2": "P2", "p3": "P3"}
        severity = severity_map.get(review_priority, "P3")
        sla_minutes = _to_int(md.get("review_sla_minutes"), default=0)
        due_at = _parse_datetime(md.get("review_due_at"))
        risk_level = str(md.get("risk_level") or "").strip().upper()
        if not risk_level:
            for code in reason_codes:
                token = str(code or "").strip()
                if token.lower().startswith("risk:"):
                    risk_level = token.split(":", 1)[1].strip().upper()
                    break
        if risk_level not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
            risk_level = "MEDIUM"
        now_iso = datetime.now(timezone.utc).isoformat()
        audit_trail = [
            {
                "event": "created",
                "at": now_iso,
                "reason_codes": list(dict.fromkeys(reason_codes))[:20],
                "priority": review_priority,
            }
        ]
        payload = {
            "bureau_id": str(bureau_id) if bureau_id else None,
            "query_text": query,
            "answer_text": answer,
            "reason_codes": list(dict.fromkeys(reason_codes)),
            "confidence": float(confidence),
            "citations": citations,
            "metadata": md,
            "status": "pending",
            "due_at": due_at.isoformat() if due_at else None,
            "sla_minutes": int(sla_minutes) if sla_minutes > 0 else None,
            "risk_level": risk_level,
            "severity": severity,
            "escalation_reason": str(md.get("escalation_reason") or "").strip() or None,
            "audit_trail": audit_trail,
        }
        resp = client.table("rag_v3_review_queue").insert(payload).execute()
        rows = resp.data or []
        if not rows:
            return None
        return str(rows[0].get("id") or "")

    async def list_human_reviews(
        self,
        *,
        bureau_id: Optional[UUID],
        status: Optional[str] = None,
        assigned_to: Optional[UUID] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        client = get_supabase_client()
        query = (
            client.table("rag_v3_review_queue")
            .select("*")
            .order("created_at", desc=True)
            .limit(max(1, min(int(limit), 200)))
        )
        if bureau_id is not None:
            query = query.eq("bureau_id", str(bureau_id))
        if status:
            query = query.eq("status", str(status).strip().lower())
        if assigned_to is not None:
            query = query.eq("assigned_to", str(assigned_to))
        resp = query.execute()
        return [dict(row) for row in list(resp.data or [])]

    async def assign_human_review(
        self,
        *,
        ticket_id: str,
        bureau_id: Optional[UUID],
        reviewer_id: UUID,
        assigned_by: Optional[UUID] = None,
        sla_minutes: Optional[int] = None,
        due_at: Optional[datetime] = None,
        escalation_reason: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        client = get_supabase_client()
        ticket = str(ticket_id or "").strip()
        if not ticket:
            return None
        select_q = (
            client.table("rag_v3_review_queue")
            .select("id, status, audit_trail")
            .eq("id", ticket)
            .limit(1)
        )
        if bureau_id is not None:
            select_q = select_q.eq("bureau_id", str(bureau_id))
        selected = select_q.execute()
        rows = list(selected.data or [])
        if not rows:
            return None
        current = dict(rows[0])
        now_iso = datetime.now(timezone.utc).isoformat()
        audit_trail = list(current.get("audit_trail") or [])
        audit_trail.append(
            {
                "event": "assigned",
                "at": now_iso,
                "reviewer_id": str(reviewer_id),
                "assigned_by": (str(assigned_by) if assigned_by is not None else None),
                "escalation_reason": str(escalation_reason or "").strip() or None,
            }
        )
        update_payload: dict[str, Any] = {
            "status": "in_review",
            "assigned_to": str(reviewer_id),
            "assigned_at": now_iso,
            "audit_trail": audit_trail,
        }
        if sla_minutes is not None and int(sla_minutes) > 0:
            update_payload["sla_minutes"] = int(sla_minutes)
        if due_at is not None:
            update_payload["due_at"] = due_at.isoformat()
        if escalation_reason:
            update_payload["escalation_reason"] = str(escalation_reason).strip()

        update_q = client.table("rag_v3_review_queue").update(update_payload).eq("id", ticket)
        if bureau_id is not None:
            update_q = update_q.eq("bureau_id", str(bureau_id))
        resp = update_q.execute()
        updated = list(resp.data or [])
        return dict(updated[0]) if updated else None

    async def close_human_review(
        self,
        *,
        ticket_id: str,
        bureau_id: Optional[UUID],
        closed_by: UUID,
        status: str,
        closure_code: str,
        reviewer_feedback: Optional[str],
        escalation_reason: Optional[str] = None,
        require_feedback: bool = True,
    ) -> Optional[dict[str, Any]]:
        ticket = str(ticket_id or "").strip()
        if not ticket:
            return None
        status_token = str(status or "").strip().lower()
        if status_token not in {"resolved", "rejected"}:
            raise ValueError("status must be resolved or rejected.")
        closure_token = str(closure_code or "").strip()
        if not closure_token:
            raise ValueError("closure_code is required.")
        feedback = str(reviewer_feedback or "").strip()
        if require_feedback and not feedback:
            raise ValueError("reviewer_feedback is required.")

        client = get_supabase_client()
        select_q = (
            client.table("rag_v3_review_queue")
            .select("id, status, audit_trail")
            .eq("id", ticket)
            .limit(1)
        )
        if bureau_id is not None:
            select_q = select_q.eq("bureau_id", str(bureau_id))
        selected = select_q.execute()
        rows = list(selected.data or [])
        if not rows:
            return None
        current = dict(rows[0])
        now_iso = datetime.now(timezone.utc).isoformat()
        audit_trail = list(current.get("audit_trail") or [])
        audit_trail.append(
            {
                "event": "closed",
                "at": now_iso,
                "status": status_token,
                "closure_code": closure_token,
                "closed_by": str(closed_by),
            }
        )
        update_payload: dict[str, Any] = {
            "status": status_token,
            "closure_code": closure_token,
            "reviewer_feedback": feedback or None,
            "escalation_reason": str(escalation_reason or "").strip() or None,
            "resolved_at": now_iso,
            "audit_trail": audit_trail,
        }
        update_q = client.table("rag_v3_review_queue").update(update_payload).eq("id", ticket)
        if bureau_id is not None:
            update_q = update_q.eq("bureau_id", str(bureau_id))
        resp = update_q.execute()
        updated = list(resp.data or [])
        return dict(updated[0]) if updated else None

    async def enqueue_ingest_reprocess(
        self,
        *,
        bureau_id: Optional[UUID],
        title: str,
        source_type: str,
        source_id: str,
        jurisdiction: str,
        reason_codes: list[str],
        quality_score: float,
        parser_confidence: float,
        ocr_confidence: float,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Optional[str]:
        client = get_supabase_client()
        payload = {
            "bureau_id": str(bureau_id) if bureau_id else None,
            "title": title,
            "source_type": source_type,
            "source_id": source_id,
            "jurisdiction": jurisdiction,
            "reason_codes": list(dict.fromkeys(reason_codes)),
            "quality_score": float(max(0.0, min(1.0, quality_score))),
            "parser_confidence": float(max(0.0, min(1.0, parser_confidence))),
            "ocr_confidence": float(max(0.0, min(1.0, ocr_confidence))),
            "metadata": metadata or {},
            "status": "pending",
        }
        resp = client.table("rag_v3_ingest_reprocess_queue").insert(payload).execute()
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
        trace_metadata = _ensure_trace_model_mapping_metadata(
            metadata=dict(metadata or {}),
            fingerprint=dict(fingerprint or {}),
            requested_tier=int(requested_tier),
            effective_tier=int(effective_tier),
        )
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
            "metadata": trace_metadata,
            "legal_disclaimer_ack": _metadata_bool(trace_metadata, "legal_disclaimer_ack"),
            "human_responsibility_ack": _metadata_bool(trace_metadata, "human_responsibility_ack"),
            "tier_policy_route_reason": _metadata_text(trace_metadata, "tier_policy_route_reason"),
            "query_expansion": _metadata_object(trace_metadata, "query_expansion"),
            "prompt_scenario": _metadata_text(trace_metadata, "prompt_scenario"),
            "prompt_registry_version": _metadata_text(trace_metadata, "prompt_registry_version"),
            "source_documents": _metadata_array(trace_metadata, "source_documents"),
            "review_required": _metadata_bool(trace_metadata, "review_required"),
            "review_reason_codes": _metadata_text_list(trace_metadata, "review_reason_codes"),
            "low_confidence": _metadata_bool(trace_metadata, "low_confidence"),
            "low_confidence_reason": _metadata_text(trace_metadata, "low_confidence_reason"),
        }
        legacy_payload = dict(payload)
        for key in (
            "legal_disclaimer_ack",
            "human_responsibility_ack",
            "tier_policy_route_reason",
            "query_expansion",
            "prompt_scenario",
            "prompt_registry_version",
            "source_documents",
            "review_required",
            "review_reason_codes",
            "low_confidence",
            "low_confidence_reason",
        ):
            legacy_payload.pop(key, None)
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                client = get_supabase_client()
                client.table("rag_v3_query_traces").upsert(payload, on_conflict="request_id").execute()
                return
            except Exception as exc:  # noqa: BLE001
                if self._is_trace_extended_column_error(exc):
                    logger.warning(
                        "RAG_V3_TRACE_EXTENDED_COLUMNS_UNAVAILABLE | request_id=%s | reason=%s",
                        request_id,
                        exc,
                    )
                    client = get_supabase_client()
                    client.table("rag_v3_query_traces").upsert(
                        legacy_payload,
                        on_conflict="request_id",
                    ).execute()
                    return
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
            "legal_disclaimer_ack": bool(row.get("legal_disclaimer_ack")),
            "human_responsibility_ack": bool(row.get("human_responsibility_ack")),
            "tier_policy_route_reason": str(row.get("tier_policy_route_reason") or "") or None,
            "query_expansion": dict(row.get("query_expansion") or {}),
            "prompt_scenario": str(row.get("prompt_scenario") or "") or None,
            "prompt_registry_version": str(row.get("prompt_registry_version") or "") or None,
            "source_documents": list(row.get("source_documents") or []),
            "review_required": bool(row.get("review_required")),
            "review_reason_codes": list(row.get("review_reason_codes") or []),
            "low_confidence": bool(row.get("low_confidence")),
            "low_confidence_reason": str(row.get("low_confidence_reason") or "") or None,
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
            .select(
                "response_status, gate_decision, latency_ms, retrieved_count, "
                "metadata, created_at, low_confidence, review_required"
            )
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
        low_confidence_count = 0
        review_required_count = 0
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
            low_confidence_row = bool(row.get("low_confidence"))
            review_required_row = bool(row.get("review_required"))
            if low_confidence_row:
                low_confidence_count += 1
            if review_required_row:
                review_required_count += 1
            metadata = row.get("metadata")
            if isinstance(metadata, dict):
                if bool(metadata.get("cache_hit")):
                    cache_hit_count += 1
                low_confidence_meta = bool(metadata.get("low_confidence"))
                if (not low_confidence_row) and low_confidence_meta:
                    low_confidence_count += 1
                review_required_meta = bool(metadata.get("review_required"))
                if (not review_required_row) and review_required_meta:
                    review_required_count += 1
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
            "low_confidence_rate": float(low_confidence_count) / float(count),
            "review_required_rate": float(review_required_count) / float(count),
        }


def _scope_key(bureau_id: Optional[UUID]) -> str:
    return f"bureau:{str(bureau_id)}" if bureau_id else "global"


def _to_int(value: object, *, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return int(default)


def _trace_model_lane(tier: int) -> tuple[str, str]:
    value = int(tier) if int(tier) in (1, 2, 3, 4) else 2
    if value in (1, 2):
        return "instruct", "synthesis"
    return "thinking", "analysis"


def _trace_expected_model_for_tier(tier: int) -> str:
    value = int(tier) if int(tier) in (1, 2, 3, 4) else 2
    if value == 1:
        return str(getattr(settings, "ai_tier_hazir_model", "") or "").strip()
    if value == 2:
        return str(getattr(settings, "ai_tier_dusunceli_model", "") or "").strip()
    if value == 3:
        return str(getattr(settings, "ai_tier_uzman_model", "") or "").strip()
    return str(getattr(settings, "ai_tier_muazzam_model", "") or "").strip()


def _trace_model_family(model_token: str) -> str:
    lowered = str(model_token or "").strip().lower()
    if not lowered:
        return "none"
    if "qwen3-next-80b-a3b" in lowered:
        return "qwen3-next-80b-a3b"
    if "gpt" in lowered or lowered.startswith("openai/"):
        return "openai"
    if "claude" in lowered or lowered.startswith("anthropic/"):
        return "anthropic"
    if "gemini" in lowered or lowered.startswith("google/"):
        return "google"
    if lowered.startswith("fallback/"):
        return "fallback"
    return "unknown"


def _ensure_trace_model_mapping_metadata(
    *,
    metadata: dict[str, Any],
    fingerprint: dict[str, Any],
    requested_tier: int,
    effective_tier: int,
) -> dict[str, Any]:
    trace_metadata = dict(metadata or {})
    model_lane, model_role = _trace_model_lane(effective_tier)
    expected_model = _trace_expected_model_for_tier(effective_tier)
    runtime_model = str(fingerprint.get("model_version") or "").strip()
    execution_state = str(trace_metadata.get("model_execution_state") or "").strip().lower()
    if not execution_state:
        normalized_runtime = runtime_model.lower()
        if not normalized_runtime or normalized_runtime == "none/none":
            execution_state = "not_invoked"
        elif normalized_runtime.startswith("fallback/extractive"):
            execution_state = "extractive_fallback"
        elif "+fallback" in normalized_runtime:
            execution_state = "llm_fallback"
        else:
            execution_state = "llm_primary"

    trace_metadata.setdefault("model_lane", model_lane)
    trace_metadata.setdefault("model_role", model_role)
    trace_metadata.setdefault("model_expected_version", expected_model or None)
    trace_metadata.setdefault(
        "model_expected_family",
        _trace_model_family(str(trace_metadata.get("model_expected_version") or expected_model)),
    )
    trace_metadata.setdefault("model_runtime_version", runtime_model or None)
    trace_metadata.setdefault("model_runtime_family", _trace_model_family(runtime_model))
    trace_metadata.setdefault("model_execution_state", execution_state)
    trace_metadata.setdefault("model_mapping_verified", bool(trace_metadata.get("model_mapping_verified", False)))
    trace_metadata.setdefault("model_mapping_reason_codes", list(trace_metadata.get("model_mapping_reason_codes") or []))
    trace_metadata.setdefault("model_mapping_evidence_complete", True)
    trace_metadata.setdefault("model_mapping_requested_tier", int(requested_tier))
    trace_metadata.setdefault("model_mapping_effective_tier", int(effective_tier))
    return trace_metadata


def _metadata_bool(metadata: dict[str, Any], key: str, *, default: bool = False) -> bool:
    value = metadata.get(key)
    if isinstance(value, bool):
        return value
    token = str(value or "").strip().lower()
    if token in {"1", "true", "t", "yes", "on"}:
        return True
    if token in {"0", "false", "f", "no", "off"}:
        return False
    return bool(default)


def _metadata_text(metadata: dict[str, Any], key: str) -> Optional[str]:
    value = str(metadata.get(key) or "").strip()
    return value or None


def _metadata_object(metadata: dict[str, Any], key: str) -> dict[str, Any]:
    value = metadata.get(key)
    if isinstance(value, dict):
        return value
    return {}


def _metadata_array(metadata: dict[str, Any], key: str) -> list[Any]:
    value = metadata.get(key)
    if isinstance(value, list):
        return value
    return []


def _metadata_text_list(metadata: dict[str, Any], key: str) -> list[str]:
    value = metadata.get(key)
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        token = str(item or "").strip()
        if token:
            out.append(token)
    return list(dict.fromkeys(out))


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


def _parse_datetime(value: object) -> Optional[datetime]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


def _metadata_text(metadata: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = metadata.get(key)
        if not isinstance(value, str):
            continue
        token = value.strip()
        if token:
            return token
    return None


def _metadata_date(metadata: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        parsed = _parse_date(metadata.get(key))
        if parsed is not None:
            return parsed.isoformat()
    return None


def _metadata_mulga_state(metadata: dict[str, Any]) -> str:
    raw = _metadata_text(metadata, "mulga_state")
    if not raw:
        return "UNKNOWN"
    token = raw.upper()
    if token in {"IN_FORCE", "REPEALED", "AMENDED", "UNKNOWN"}:
        return token
    return "UNKNOWN"


def _metadata_tags(metadata: dict[str, Any]) -> list[str]:
    raw = metadata.get("topic_tags")
    if isinstance(raw, list):
        items = [str(item).strip() for item in raw if str(item).strip()]
        return list(dict.fromkeys(items))[:64]
    if isinstance(raw, str) and raw.strip():
        items = [item.strip() for item in raw.split(",") if item.strip()]
        return list(dict.fromkeys(items))[:64]
    return []


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
        source_char_start=_to_int(row.get("source_char_start"), default=0) if row.get("source_char_start") is not None else None,
        source_char_end=_to_int(row.get("source_char_end"), default=0) if row.get("source_char_end") is not None else None,
        paragraph_start=_to_int(row.get("paragraph_start"), default=1) if row.get("paragraph_start") is not None else None,
        paragraph_end=_to_int(row.get("paragraph_end"), default=1) if row.get("paragraph_end") is not None else None,
        section_path=(str(row.get("section_path") or "").strip() or None),
        source_url=(str(row.get("source_url") or "").strip() or None),
        effective_from=_parse_date(row.get("effective_from")),
        effective_to=_parse_date(row.get("effective_to")),
        acl_tags=list(row.get("acl_tags") or []),
        doc_hash=str(row.get("doc_hash", "")),
        chunk_hash=str(row.get("chunk_hash", "")),
        semantic_score=float(row.get("semantic_score", 0.0)),
        keyword_score=float(row.get("keyword_score", 0.0)),
        final_score=float(row.get("final_score", 0.0)),
    )


def _row_to_doc_shortlist(row: dict[str, Any]) -> RagV3DocumentShortlistItem:
    return RagV3DocumentShortlistItem(
        document_id=str(row.get("document_id") or "").strip(),
        source_id=str(row.get("source_id") or "").strip(),
        source_type=str(row.get("source_type") or "").strip(),
        classification=str(row.get("classification") or "INTERNAL").strip().upper() or "INTERNAL",
        authority_rank=_to_int(row.get("authority_rank"), default=0),
        doc_score=float(row.get("doc_score") or 0.0),
    )


rag_v3_repository = SupabaseRagV3Repository()


def _stable_chunk_id(*, document_id: str, chunk_hash: str) -> str:
    token = f"{document_id}:{chunk_hash}"
    return str(uuid5(_CHUNK_ID_NAMESPACE, token))
