"""
SupabaseDocumentRepository — Concrete IDocumentRepository Implementation
=========================================================================
Wraps existing retrieval_client + Supabase RPCs to implement
IDocumentRepository, satisfying SOLID-D for all document operations.

Delegates to:
    retrieval_client.RetrieverClient.search()   — hybrid_legal_search RPC
    retrieval_client.row_to_legal_document()     — row → entity mapping
    Supabase table("documents")                  — upsert / get_by_id
    Supabase RPC("enqueue_document_indexing")     — async indexing queue

Design:
    - This class WRAPS RetrieverClient — it does not duplicate the retrieval
      logic.  The existing rag_service.py pipeline path is unchanged.
    - New ingest path (IngestDocumentUseCase) now uses this repository instead
      of calling the Supabase client directly.
    - All methods are async; supabase-py sync calls are awaited in-line
      (acceptable for current write volumes; asyncpg upgrade later if needed).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import List, Optional
from uuid import UUID

from domain.entities.legal_document import LegalDocument
from domain.repositories.document_repository import (
    DocumentNotFoundError,
    IDocumentRepository,
)
from infrastructure.llm.tiered_router import QueryTier

logger = logging.getLogger("babylexit.db.document_repository")


class SupabaseDocumentRepository(IDocumentRepository):
    """
    Concrete IDocumentRepository backed by Supabase + existing RetrieverClient.
    """

    # ------------------------------------------------------------------
    # Single-document lookups
    # ------------------------------------------------------------------

    async def get_by_id(self, doc_id: UUID) -> LegalDocument:
        """
        Fetch a document by primary key from public.documents.

        Raises:
            DocumentNotFoundError: when not found.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            from infrastructure.retrieval.retrieval_client import row_to_legal_document

            client = get_supabase_client()
            resp = (
                client.table("documents")
                .select("*")
                .eq("id", str(doc_id))
                .limit(1)
                .execute()
            )
            if not resp.data:
                raise DocumentNotFoundError(str(doc_id))

            row = resp.data[0]
            return row_to_legal_document(row, final_score=float(row.get("final_score", 0.0)))

        except DocumentNotFoundError:
            raise
        except Exception as exc:
            logger.error("get_by_id failed | doc_id=%s | error=%s", doc_id, exc)
            raise DocumentNotFoundError(str(doc_id)) from exc

    async def get_by_citation(
        self,
        citation: str,
        bureau_id: Optional[UUID] = None,
    ) -> Optional[LegalDocument]:
        """
        Fetch the most authoritative document matching a canonical citation.

        Returns None when not found.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            from infrastructure.retrieval.retrieval_client import row_to_legal_document

            client = get_supabase_client()
            query = (
                client.table("documents")
                .select("*")
                .eq("citation", citation)
                .order("authority_score", desc=True)
                .limit(1)
            )
            if bureau_id:
                query = query.eq("bureau_id", str(bureau_id))

            resp = query.execute()
            if not resp.data:
                return None

            row = resp.data[0]
            return row_to_legal_document(row, final_score=float(row.get("authority_score", 0.0)))

        except Exception as exc:
            logger.warning("get_by_citation failed | citation=%s | error=%s", citation, exc)
            return None

    # ------------------------------------------------------------------
    # Semantic / hybrid search
    # ------------------------------------------------------------------

    async def hybrid_search(
        self,
        query_embedding: List[float],
        query_text: str,
        case_id: Optional[UUID] = None,
        match_count: int = 12,
        event_date: Optional[date] = None,
        bureau_id: Optional[UUID] = None,
    ) -> List[LegalDocument]:
        """
        Delegates to RetrieverClient.search() which calls hybrid_legal_search RPC.

        Returns [] on error (hard-fail handled by caller).
        """
        try:
            from infrastructure.retrieval.retrieval_client import retriever_client

            return await retriever_client.search(
                query_embedding=query_embedding,
                query_text=query_text,
                case_id=str(case_id) if case_id else None,
                match_count=match_count,
                event_date=event_date,
                bureau_id=str(bureau_id) if bureau_id else None,
            )

        except Exception as exc:
            logger.error("hybrid_search failed | query=%s... | error=%s", query_text[:50], exc)
            return []

    # ------------------------------------------------------------------
    # Must-cite retrieval
    # ------------------------------------------------------------------

    async def get_must_cite(
        self,
        case_id: UUID,
        bureau_id: Optional[UUID] = None,
    ) -> List[LegalDocument]:
        """
        Delegates to RetrieverClient.get_must_cite_documents().

        Returns [] when no must-cite docs registered for this case.
        """
        try:
            from infrastructure.retrieval.retrieval_client import retriever_client

            return await retriever_client.get_must_cite_documents(
                case_id=str(case_id),
                bureau_id=str(bureau_id) if bureau_id else None,
            )

        except Exception as exc:
            logger.warning("get_must_cite failed | case_id=%s | error=%s", case_id, exc)
            return []

    # ------------------------------------------------------------------
    # Citation graph
    # ------------------------------------------------------------------

    async def get_citations_of(
        self,
        doc_id: UUID,
        max_depth: int = 2,
        bureau_id: Optional[UUID] = None,
    ) -> List[LegalDocument]:
        """
        Returns documents reachable via citation edges from doc_id up to max_depth.

        Delegates to CitationGraphExpander for BFS traversal.
        Returns [] on error.
        """
        try:
            from infrastructure.graph.citation_graph import citation_graph_expander
            from infrastructure.retrieval.retrieval_client import retriever_client

            async def fetcher(citation_text: str):
                results = await retriever_client.search(
                    query_embedding=[0.0] * 1536,  # zero-vector → keyword-only
                    query_text=citation_text,
                    match_count=1,
                    bureau_id=str(bureau_id) if bureau_id else None,
                )
                return results[0] if results else None

            root_doc = await self.get_by_id(doc_id)
            result = await citation_graph_expander.expand(
                root_docs=[root_doc],
                fetcher=fetcher,
                max_depth=max_depth,
                tier=QueryTier.TIER3,  # CitationGraphExpander requires tier ≥ 3
            )
            return result.expanded_docs

        except Exception as exc:
            logger.warning("get_citations_of failed | doc_id=%s | error=%s", doc_id, exc)
            return []

    # ------------------------------------------------------------------
    # Persistence (ingest path)
    # ------------------------------------------------------------------

    async def upsert(self, document: LegalDocument) -> LegalDocument:
        """
        Insert or update a document in public.documents.

        Returns the persisted document (with server-assigned id if new).
        Raises RuntimeError on failure.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            from infrastructure.retrieval.retrieval_client import row_to_legal_document

            client = get_supabase_client()

            row = {
                "id":                    document.id or None,
                "case_id":               document.case_id or None,
                "content":               document.content,
                "file_path":             document.file_path or "",
                "source_url":            document.source_url,
                "version":               document.version,
                "collected_at":          (
                    document.collected_at.isoformat()
                    if document.collected_at else None
                ),
                "court_level":           document.court_level,
                "ruling_date":           (
                    document.ruling_date.isoformat()
                    if document.ruling_date else None
                ),
                "citation":              document.citation,
                "norm_hierarchy":        document.norm_hierarchy,
                "chamber":               document.chamber,
                "majority_type":         document.majority_type,
                "dissent_present":       document.dissent_present,
                "effective_date":        (
                    document.effective_date.isoformat()
                    if document.effective_date else None
                ),
                "aym_iptal_durumu":      document.aym_iptal_durumu,
                "iptal_yururluk_tarihi": (
                    document.iptal_yururluk_tarihi.isoformat()
                    if document.iptal_yururluk_tarihi else None
                ),
                "bureau_id":             document.bureau_id,
            }
            # Remove None id so Postgres generates one
            if not row["id"]:
                del row["id"]

            resp = (
                client.table("documents")
                .upsert(row, on_conflict="id")
                .execute()
            )
            if not resp.data:
                raise RuntimeError("Upsert returned no data")

            saved_row = resp.data[0]
            return row_to_legal_document(saved_row, final_score=0.0)

        except Exception as exc:
            logger.error("upsert failed | doc_id=%s | error=%s", document.id, exc)
            raise RuntimeError(f"Document upsert failed: {exc}") from exc

    async def delete(self, doc_id: UUID) -> None:
        """
        Soft-delete (or hard-delete) a document from public.documents.
        """
        try:
            from infrastructure.database.connection import get_supabase_client

            client = get_supabase_client()
            client.table("documents").delete().eq("id", str(doc_id)).execute()
            logger.info("Document deleted | doc_id=%s", doc_id)

        except Exception as exc:
            logger.error("delete failed | doc_id=%s | error=%s", doc_id, exc)
            raise RuntimeError(f"Document delete failed: {exc}") from exc

    async def enqueue_for_indexing(self, doc_id: UUID) -> None:
        """
        Enqueue the document for async embedding + FTS indexing (Step 11 Celery).

        Non-fatal: logs warning on failure (document is already persisted;
        indexing failure means it won't appear in search immediately).
        """
        try:
            from infrastructure.async_indexing.indexing_tasks import enqueue_document

            enqueue_document.delay(str(doc_id))
            logger.debug("Enqueued for indexing | doc_id=%s", doc_id)

        except Exception as exc:
            logger.warning(
                "enqueue_for_indexing failed (non-fatal) | doc_id=%s | error=%s",
                doc_id, exc,
            )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

supabase_document_repository = SupabaseDocumentRepository()
