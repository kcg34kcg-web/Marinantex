"""
IDocumentRepository — Domain Repository Interface
==================================================
Abstract base class that decouples the domain layer from any specific
persistence technology (Supabase, PostgreSQL, mock, etc.).

All concrete implementations (e.g. SupabaseDocumentRepository) must
subclass this ABC and implement every abstract method.

This design satisfies the Dependency Inversion Principle (SOLID-D):
    - Domain / Application layers depend on THIS interface.
    - Infrastructure layer provides the concrete implementation.
    - Tests inject a lightweight MockDocumentRepository — zero DB required.

Convention:
    Methods raise DocumentNotFoundError for missing single-item lookups.
    Methods return empty list [] for missing multi-item queries.
    All I/O methods are async (asyncio).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date
from typing import List, Optional
from uuid import UUID

from domain.entities.legal_document import LegalDocument


class DocumentNotFoundError(Exception):
    """Raised when a requested document does not exist in the repository."""

    def __init__(self, doc_id: str) -> None:
        super().__init__(f"Document not found: {doc_id}")
        self.doc_id = doc_id


class IDocumentRepository(ABC):
    """
    Abstract contract for legal document persistence.

    All RAG retrieval, ingest, and graph-expansion operations go through
    this interface.  The concrete implementation (SupabaseDocumentRepository
    in infrastructure/database/) calls hybrid_legal_search() and related
    Supabase RPCs.
    """

    # ------------------------------------------------------------------
    # Single-document lookups
    # ------------------------------------------------------------------

    @abstractmethod
    async def get_by_id(self, doc_id: UUID) -> LegalDocument:
        """
        Fetch a single document by primary key.

        Raises:
            DocumentNotFoundError: if no document with doc_id exists.
        """

    @abstractmethod
    async def get_by_citation(
        self,
        citation: str,
        bureau_id: Optional[UUID] = None,
    ) -> Optional[LegalDocument]:
        """
        Fetch a single document by its canonical citation string.

        Returns None when not found (citation lookup is best-effort).
        """

    # ------------------------------------------------------------------
    # Semantic / hybrid search
    # ------------------------------------------------------------------

    @abstractmethod
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
        Calls public.hybrid_legal_search() RPC.

        Returns documents ordered by final_score descending.
        Returns [] when nothing is retrieved (callers apply hard-fail logic).
        """

    # ------------------------------------------------------------------
    # Must-cite retrieval
    # ------------------------------------------------------------------

    @abstractmethod
    async def get_must_cite(
        self,
        case_id: UUID,
        bureau_id: Optional[UUID] = None,
    ) -> List[LegalDocument]:
        """
        Returns must-cite documents for the given case.

        Calls public.get_must_cite_documents() RPC.
        Returns [] when the case has no must-cite rules.
        """

    # ------------------------------------------------------------------
    # Graph / citation traversal
    # ------------------------------------------------------------------

    @abstractmethod
    async def get_citations_of(
        self,
        doc_id: UUID,
        max_depth: int = 2,
        bureau_id: Optional[UUID] = None,
    ) -> List[LegalDocument]:
        """
        Returns documents reachable from doc_id via citation_traversal().

        Used by CitationGraphExpander.  depth=0 = root only, max_depth=2 default.
        Returns [] if doc_id has no outgoing citations.
        """

    # ------------------------------------------------------------------
    # Ingest / write operations
    # ------------------------------------------------------------------

    @abstractmethod
    async def upsert(self, document: LegalDocument) -> LegalDocument:
        """
        Insert or update a document row.

        Returns the saved document with any server-generated fields
        (e.g. id, created_at) populated.
        """

    @abstractmethod
    async def delete(self, doc_id: UUID) -> None:
        """
        Delete a document and all its dependent rows (cascade).

        Raises:
            DocumentNotFoundError: if the document does not exist.
        """

    # ------------------------------------------------------------------
    # Bulk / queue operations (Step 11 async indexing)
    # ------------------------------------------------------------------

    @abstractmethod
    async def enqueue_for_indexing(self, doc_id: UUID) -> None:
        """
        Adds doc_id to the document_index_queue table so that the
        Celery worker picks it up for embedding + FTS update.
        """
