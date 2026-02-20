"""
ICitationRepository — Domain Repository Interface
==================================================
Abstract contract for citation_edges persistence (Step 13: GraphRAG).

Each extracted citation from the ingest pipeline is stored here.
The CitationGraphExpander reads from this repository to perform BFS
traversal up to max_depth=2 without touching the domain layer directly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from infrastructure.ingest.citation_extractor import ExtractedCitation


class ICitationRepository(ABC):
    """
    Abstract contract for citation_edges table operations.
    """

    @abstractmethod
    async def save_citations(
        self,
        source_doc_id: UUID,
        citations: List[ExtractedCitation],
        bureau_id: Optional[UUID] = None,
    ) -> int:
        """
        Persist extracted citations for a document.

        Upserts citation_edges rows — safe to call multiple times for
        the same source document (re-extraction on content update).

        Args:
            source_doc_id : UUID of the document that contains these citations.
            citations     : Extracted citation objects from CitationExtractor.
            bureau_id     : Tenant bureau UUID (None = public document).

        Returns:
            Number of rows upserted.
        """

    @abstractmethod
    async def resolve_citation(
        self,
        citation_edge_id: UUID,
        target_doc_id: UUID,
    ) -> None:
        """
        Link an unresolved citation_edge to the target document it refers to.

        Sets target_doc_id and resolved_at on the citation_edges row.
        Called by the background indexing pipeline when a raw citation text
        is matched to an existing document in the DB.
        """

    @abstractmethod
    async def get_outgoing(
        self,
        source_doc_id: UUID,
        resolved_only: bool = True,
        bureau_id: Optional[UUID] = None,
    ) -> List[UUID]:
        """
        Returns the doc IDs of documents directly cited by source_doc_id.

        Used by CitationGraphExpander for depth=1 BFS step.

        Args:
            source_doc_id : The source document.
            resolved_only : When True, only returns rows where target_doc_id
                            IS NOT NULL (i.e. citations already resolved to
                            a document in the DB).
            bureau_id     : Tenant filter.
        """

    @abstractmethod
    async def get_unresolved(
        self,
        bureau_id: Optional[UUID] = None,
        limit: int = 100,
    ) -> List[dict]:
        """
        Returns unresolved citation_edges (target_doc_id IS NULL).

        Used by the background resolution worker to batch-resolve
        raw citation strings against the document catalog.

        Returns list of dicts with keys: id, source_doc_id, raw_citation,
        citation_type.
        """
