"""
SupabaseCitationRepository — Concrete ICitationRepository Implementation
=========================================================================
Persists and queries citation_edges rows in public.citation_edges
(created by rag_v2_step13_graph.sql).

Operations:
    save_citations()    — bulk-upsert extracted citations after ingest
    resolve_citation()  — link a raw citation_edge to a target document
    get_outgoing()      — fetch resolved target doc IDs for BFS traversal
    get_unresolved()    — fetch unresolved edges for the background worker

Design:
    - Uses supabase-py table API for all operations.
    - save_citations() upserts on (source_doc_id, citation_raw_text) so
      re-ingesting a document is idempotent.
    - All methods are non-fatal on read (return [] / None); write methods
      raise RuntimeError on failure so the caller can decide.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from domain.repositories.citation_repository import ICitationRepository
from infrastructure.ingest.citation_extractor import ExtractedCitation

logger = logging.getLogger("babylexit.db.citation_repository")


class SupabaseCitationRepository(ICitationRepository):
    """
    Concrete ICitationRepository backed by Supabase citation_edges table.
    """

    # ------------------------------------------------------------------
    # save_citations
    # ------------------------------------------------------------------

    async def save_citations(
        self,
        source_doc_id: UUID,
        citations: List[ExtractedCitation],
        bureau_id: Optional[UUID] = None,
    ) -> int:
        """
        Bulk-upsert extracted citation_edges for a document.

        Returns number of rows upserted.
        Raises RuntimeError on failure.
        """
        if not citations:
            return 0

        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            rows = [
                {
                    "source_doc_id": str(source_doc_id),
                    "raw_citation":  c.raw_text,
                    "citation_type": c.citation_type,
                    "target_doc_id": None,   # resolved later by background worker
                    "bureau_id":     str(bureau_id) if bureau_id else None,
                }
                for c in citations
            ]

            resp = (
                client.table("citation_edges")
                .upsert(rows, on_conflict="source_doc_id,raw_citation")
                .execute()
            )

            count = len(resp.data or [])
            logger.debug(
                "CITATIONS_SAVED | source=%s | count=%d", source_doc_id, count
            )
            return count

        except Exception as exc:
            logger.error(
                "save_citations failed | source_doc_id=%s | error=%s",
                source_doc_id, exc,
            )
            raise RuntimeError(f"save_citations failed: {exc}") from exc

    # ------------------------------------------------------------------
    # resolve_citation
    # ------------------------------------------------------------------

    async def resolve_citation(
        self,
        citation_edge_id: UUID,
        target_doc_id: UUID,
    ) -> None:
        """
        Set target_doc_id and resolved_at on a citation_edge row.

        Called by the background resolution worker when a raw citation
        string is successfully matched to a document in the DB.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            client.table("citation_edges").update({
                "target_doc_id": str(target_doc_id),
                "resolved_at":   datetime.now(timezone.utc).isoformat(),
            }).eq("id", str(citation_edge_id)).execute()

            logger.debug(
                "CITATION_RESOLVED | edge_id=%s | target=%s",
                citation_edge_id, target_doc_id,
            )

        except Exception as exc:
            logger.warning(
                "resolve_citation failed (non-fatal) | edge_id=%s | error=%s",
                citation_edge_id, exc,
            )

    # ------------------------------------------------------------------
    # get_outgoing
    # ------------------------------------------------------------------

    async def get_outgoing(
        self,
        source_doc_id: UUID,
        resolved_only: bool = True,
        bureau_id: Optional[UUID] = None,
    ) -> List[UUID]:
        """
        Returns target doc UUIDs directly cited by source_doc_id.

        Used by CitationGraphExpander for depth=1 BFS step.
        Returns [] on error.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            query = (
                client.table("citation_edges")
                .select("target_doc_id")
                .eq("source_doc_id", str(source_doc_id))
            )
            if resolved_only:
                query = query.not_.is_("target_doc_id", "null")
            if bureau_id:
                query = query.eq("bureau_id", str(bureau_id))

            resp = query.execute()
            return [
                UUID(row["target_doc_id"])
                for row in (resp.data or [])
                if row.get("target_doc_id")
            ]

        except Exception as exc:
            logger.warning(
                "get_outgoing failed (non-fatal) | source=%s | error=%s",
                source_doc_id, exc,
            )
            return []

    # ------------------------------------------------------------------
    # get_unresolved
    # ------------------------------------------------------------------

    async def get_unresolved(
        self,
        bureau_id: Optional[UUID] = None,
        limit: int = 100,
    ) -> List[dict]:
        """
        Returns unresolved citation_edges (target_doc_id IS NULL).

        Used by background citation-resolution worker.
        Returns [] on error.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            query = (
                client.table("citation_edges")
                .select("id, source_doc_id, raw_citation, citation_type")
                .is_("target_doc_id", "null")
                .limit(limit)
            )
            if bureau_id:
                query = query.eq("bureau_id", str(bureau_id))

            resp = query.execute()
            return list(resp.data or [])

        except Exception as exc:
            logger.warning(
                "get_unresolved failed (non-fatal) | error=%s", exc
            )
            return []


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

supabase_citation_repository = SupabaseCitationRepository()
