"""
Step 13 — GraphRAG: Atıf Zinciri ve Derinlik Sınırı
====================================================
Kanun-madde-karar atıf grafı ile maksimum 2 derece derinlik kuralı.

Bileşenler:
    CitationNode        — Graf içindeki bir belge düğümü
    CitationEdge        — İki belge arasındaki atıf ilişkisi
    CitationGraphResult — Graf genişletme sonucu
    CitationGraphExpander — BFS genişletmeyi derinlik sınırıyla yönetir

Katman geçidi (Tier gate):
    Yalnızca Tier 3 (GPT-4o) ve Tier 4 (Claude) sorguları için etkinleşir.
    Tier 1/2 sorguları kök belgeleri değiştirmeden döndürür (genişletme yok).

Derinlik sınırı:
    max_depth=2 ile BFS (yapılandırılabilir). Ziyaret kümesi döngüleri önler.
    depth=0 → yalnızca kök belgeler.
    depth=1 → kök + doğrudan atıf yapılan belgeler.
    depth=2 → kök + atıf yapılan belgeler + atıf yapılanların atıf yaptığı belgeler.

Tasarım notu:
    CitationGraphExpander SAFTIR (PURE) — veritabanı aramaları için bir
    ``fetcher`` async çağrılabilirini kabul eder; bu da onu basit mock'larla
    test edilebilir kılar.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional, Set

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings
from infrastructure.ingest.citation_extractor import (
    CitationExtractor,
    ExtractedCitation,
    citation_extractor,
)
from infrastructure.llm.tiered_router import QueryTier

logger = logging.getLogger("babylexit.graph.citation_graph")


# ============================================================================
# Fetcher type alias
# ============================================================================

# CitationFetcher: (citation_raw_text: str) → Optional[LegalDocument]
# Callers supply a closure that wraps the real DB retriever or a test mock.
CitationFetcher = Callable[[str], Awaitable[Optional[LegalDocument]]]


# ============================================================================
# Domain objects
# ============================================================================


@dataclass
class CitationNode:
    """A document node in the citation graph."""

    doc_id: str
    document: LegalDocument
    depth: int
    citations: List[ExtractedCitation] = field(default_factory=list)


@dataclass
class CitationEdge:
    """A directed citation edge: source_id → target_ref."""

    source_id: str
    target_ref: str       # raw citation text (unresolved) OR resolved doc_id
    citation_type: str    # CitationType value
    raw_text: str
    resolved_id: Optional[str] = None  # Set if the target was found in DB


@dataclass
class CitationGraphResult:
    """Result of a citation graph expansion."""

    root_docs: List[LegalDocument]
    expanded_docs: List[LegalDocument]
    all_docs: List[LegalDocument]
    nodes: Dict[str, CitationNode]
    edges: List[CitationEdge]
    total_depth_reached: int
    expansion_count: int
    cycle_detected: bool


# ============================================================================
# CitationGraphExpander
# ============================================================================


class CitationGraphExpander:
    """
    Builds a citation graph from retrieved documents using BFS.

    Args:
        extractor: CitationExtractor instance (defaults to module singleton).
    """

    def __init__(self, extractor: Optional[CitationExtractor] = None) -> None:
        self._extractor: CitationExtractor = extractor or citation_extractor

    async def expand(
        self,
        root_docs: List[LegalDocument],
        tier: QueryTier,
        fetcher: Optional[CitationFetcher] = None,
        max_depth: Optional[int] = None,
        max_nodes: Optional[int] = None,
    ) -> CitationGraphResult:
        """
        Expands the citation graph up to max_depth levels using BFS.

        Tier gate:
            If tier.value < settings.graphrag_min_tier (default 3),
            returns root_docs unchanged — no expansion, no cost.

        Args:
            root_docs:  Base documents from the retrieval/re-ranking step.
            tier:       LLM routing tier for this query.
            fetcher:    Async callable (citation_raw_text → Optional[LegalDocument]).
                        If None, edges are recorded but no new docs are fetched.
            max_depth:  BFS depth limit. Defaults to settings.graphrag_max_depth (2).
            max_nodes:  Maximum total graph nodes. Defaults to settings.graphrag_max_nodes (15).

        Returns:
            CitationGraphResult with all documents, graph topology and metadata.
        """
        _max_depth = max_depth if max_depth is not None else settings.graphrag_max_depth
        _max_nodes = max_nodes if max_nodes is not None else settings.graphrag_max_nodes

        # ── Tier gate ────────────────────────────────────────────────────────
        if tier.value < settings.graphrag_min_tier:
            logger.debug(
                "GRAPHRAG_SKIP | tier=%s | min_tier=%d | no expansion",
                tier.name,
                settings.graphrag_min_tier,
            )
            return CitationGraphResult(
                root_docs=root_docs,
                expanded_docs=[],
                all_docs=list(root_docs),
                nodes={},
                edges=[],
                total_depth_reached=0,
                expansion_count=0,
                cycle_detected=False,
            )

        if not root_docs:
            return CitationGraphResult(
                root_docs=[],
                expanded_docs=[],
                all_docs=[],
                nodes={},
                edges=[],
                total_depth_reached=0,
                expansion_count=0,
                cycle_detected=False,
            )

        nodes: Dict[str, CitationNode] = {}
        edges: List[CitationEdge] = []
        visited: Set[str] = set()
        cycle_detected = False
        expanded_docs: List[LegalDocument] = []
        max_depth_reached = 0

        # BFS queue: (document, current_depth)
        queue: deque[tuple[LegalDocument, int]] = deque()

        # Seed with root docs at depth 0
        for doc in root_docs:
            visited.add(doc.id)
            node = CitationNode(
                doc_id=doc.id,
                document=doc,
                depth=0,
                citations=[],
            )
            nodes[doc.id] = node
            queue.append((doc, 0))

        # BFS traversal
        while queue:
            current_doc, current_depth = queue.popleft()
            max_depth_reached = max(max_depth_reached, current_depth)

            # Stop expanding if we have reached the depth limit
            if current_depth >= _max_depth:
                continue

            # Stop if max_nodes budget exhausted
            if len(nodes) >= _max_nodes:
                logger.info(
                    "GRAPHRAG_MAX_NODES | nodes=%d | limit=%d | stopping expansion",
                    len(nodes),
                    _max_nodes,
                )
                break

            # Extract citations from this document's content
            doc_citations = self._extractor.extract(current_doc.content or "")
            if current_doc.id in nodes:
                nodes[current_doc.id].citations = doc_citations

            # Process each extracted citation
            for citation in doc_citations:
                # Record the directed edge regardless of resolution
                edge = CitationEdge(
                    source_id=current_doc.id,
                    target_ref=citation.raw_text,
                    citation_type=citation.citation_type,
                    raw_text=citation.raw_text,
                )
                edges.append(edge)

                # If no fetcher, we only record edges — no DB expansion
                if fetcher is None:
                    continue

                # Attempt to fetch the referenced document
                try:
                    cited_doc = await fetcher(citation.raw_text)
                except Exception as exc:
                    logger.warning(
                        "GRAPHRAG_FETCH_ERROR | ref=%r | err=%s",
                        citation.raw_text[:60],
                        exc,
                    )
                    cited_doc = None

                if cited_doc is None:
                    continue

                # Cycle detection: already in the visited set
                if cited_doc.id in visited:
                    cycle_detected = True
                    logger.debug(
                        "GRAPHRAG_CYCLE | existing_id=%s | ref=%r",
                        cited_doc.id,
                        citation.raw_text[:40],
                    )
                    edge.resolved_id = cited_doc.id
                    continue

                # Max-nodes guard (re-checked after each fetch)
                if len(nodes) >= _max_nodes:
                    break

                # Add new node to the graph
                visited.add(cited_doc.id)
                next_depth = current_depth + 1
                new_node = CitationNode(
                    doc_id=cited_doc.id,
                    document=cited_doc,
                    depth=next_depth,
                    citations=[],
                )
                nodes[cited_doc.id] = new_node
                expanded_docs.append(cited_doc)
                edge.resolved_id = cited_doc.id

                # Enqueue for further BFS expansion if below depth limit
                if next_depth < _max_depth:
                    queue.append((cited_doc, next_depth))

                logger.debug(
                    "GRAPHRAG_EXPAND | source=%s | cited=%s | depth=%d",
                    current_doc.id,
                    cited_doc.id,
                    next_depth,
                )

        # Build all_docs: root first, then expanded — both deduplicated
        seen_ids: Set[str] = set()
        all_docs: List[LegalDocument] = []
        for doc in root_docs:
            if doc.id not in seen_ids:
                all_docs.append(doc)
                seen_ids.add(doc.id)
        for doc in expanded_docs:
            if doc.id not in seen_ids:
                all_docs.append(doc)
                seen_ids.add(doc.id)

        logger.info(
            "GRAPHRAG_DONE | tier=%s | root=%d | expanded=%d | total=%d | "
            "depth_reached=%d | edges=%d | cycle=%s",
            tier.name,
            len(root_docs),
            len(expanded_docs),
            len(all_docs),
            max_depth_reached,
            len(edges),
            cycle_detected,
        )

        return CitationGraphResult(
            root_docs=root_docs,
            expanded_docs=expanded_docs,
            all_docs=all_docs,
            nodes=nodes,
            edges=edges,
            total_depth_reached=max_depth_reached,
            expansion_count=len(expanded_docs),
            cycle_detected=cycle_detected,
        )


# Module-level singleton
citation_graph_expander = CitationGraphExpander()
