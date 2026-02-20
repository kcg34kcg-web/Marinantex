"""
IngestDocumentUseCase — Application Use Case
============================================
Orchestrates the full ingest pipeline for a single legal document:
    OCR cleaning → normalisation → parsing → embedding → DB upsert → async index.

This use case wraps the infrastructure ingest pipeline and provides a
clean, framework-agnostic entry point for:
    - API route handlers (REST upload endpoint)
    - Celery workers (batch import scripts)
    - Tests (mock repositories)

Dependency injection:
    IngestDocumentUseCase(
        document_repository  = SupabaseDocumentRepository(),
        citation_repository  = SupabaseCitationRepository(),
        ingest_pipeline      = ingest_pipeline,       # infrastructure singleton
        embedder             = query_embedder,
    )
"""

from __future__ import annotations

import logging
import uuid as _uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from domain.entities.legal_document import LegalDocument
from domain.repositories.citation_repository import ICitationRepository
from domain.repositories.document_repository import IDocumentRepository

logger = logging.getLogger("babylexit.use_cases.ingest_document")


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------

@dataclass
class IngestDocumentRequest:
    """Input DTO for a single document ingest."""
    raw_text:        str
    source_url:      str
    court_level:     Optional[str]  = None
    citation:        Optional[str]  = None
    norm_hierarchy:  Optional[str]  = None
    bureau_id:       Optional[UUID] = None
    case_id:         Optional[UUID] = None
    # Hints for the parser (Step 5)
    document_type:   str            = "FULL"   # SegmentType default


@dataclass
class IngestDocumentResult:
    """Output DTO for a single document ingest."""
    doc_id:              str
    segments_created:    int
    citations_extracted: int
    embedding_generated: bool
    enqueued_for_index:  bool
    warnings:            List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Use Case
# ---------------------------------------------------------------------------

class IngestDocumentUseCase:
    """
    Orchestrates the full ingest pipeline for one legal document.

    Steps:
        1. OCR clean + Türkçe normalisation   (ocr_cleaner + text_normalizer)
        2. Structural parsing                  (legal_parser)
        3. Citation extraction                 (citation_extractor)
        4. Embedding generation                (embedder)
        5. DB upsert via IDocumentRepository
        6. Citation persistence via ICitationRepository
        7. Async index enqueue                 (document_index_queue)
    """

    def __init__(
        self,
        document_repository: IDocumentRepository,
        citation_repository: ICitationRepository,
    ) -> None:
        self._doc_repo  = document_repository
        self._cite_repo = citation_repository

    async def execute(self, request: IngestDocumentRequest) -> IngestDocumentResult:
        """
        Run the full ingest pipeline.

        Returns:
            IngestDocumentResult with counts and status flags.

        Raises:
            ValueError: if raw_text is empty or source_url is missing.
        """
        if not request.raw_text.strip():
            raise ValueError("raw_text cannot be empty.")
        if not request.source_url.strip():
            raise ValueError("source_url is required for provenance tracking.")

        warnings: List[str] = []

        # ------------------------------------------------------------------
        # 1–3: Parse + extract (lazy import keeps infrastructure boundary clean)
        # ------------------------------------------------------------------
        from infrastructure.ingest.ingest_pipeline import ingest_pipeline
        from infrastructure.ingest.citation_extractor import citation_extractor
        from infrastructure.embeddings.embedder import query_embedder

        _doc_id = str(_uuid.uuid4())
        _now = datetime.now(timezone.utc)

        parse_result = await ingest_pipeline.run(
            raw_text=request.raw_text,
            document_id=_doc_id,
            source_url=request.source_url,
            collected_at=_now,
        )

        # Convert ParsedSegment → LegalDocument, injecting request provenance
        segments: List[LegalDocument] = [
            LegalDocument(
                id=str(_uuid.uuid4()),
                content=seg.text,
                source_url=request.source_url,
                court_level=request.court_level,
                citation=request.citation,
                norm_hierarchy=request.norm_hierarchy,
                bureau_id=str(request.bureau_id) if request.bureau_id else None,
                case_id=str(request.case_id) if request.case_id else "",
                collected_at=_now,
            )
            for seg in parse_result.segments
        ]
        if not segments:
            warnings.append("Parser produced 0 segments — check document format.")
            segments = [
                LegalDocument(
                    id=_doc_id,
                    content=request.raw_text,
                    source_url=request.source_url,
                    court_level=request.court_level,
                    citation=request.citation,
                    norm_hierarchy=request.norm_hierarchy,
                    bureau_id=str(request.bureau_id) if request.bureau_id else None,
                    case_id=str(request.case_id) if request.case_id else "",
                    collected_at=_now,
                )
            ]

        # ------------------------------------------------------------------
        # 4: Generate embeddings
        # ------------------------------------------------------------------
        embedding_generated = False
        for seg in segments:
            try:
                embedding = await query_embedder.embed(seg.content)
                seg.embedding = embedding
                embedding_generated = True
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"Embedding failed for segment {seg.id}: {exc}")

        # ------------------------------------------------------------------
        # 5: Persist documents
        # ------------------------------------------------------------------
        saved_ids: List[str] = []
        for seg in segments:
            saved = await self._doc_repo.upsert(seg)
            saved_ids.append(saved.id)

        primary_id = saved_ids[0] if saved_ids else "unknown"

        # ------------------------------------------------------------------
        # 6: Extract + save citations
        # ------------------------------------------------------------------
        citations_total = 0
        for seg in segments:
            extracted = citation_extractor.extract(seg.content)
            if extracted:
                n = await self._cite_repo.save_citations(
                    source_doc_id=UUID(seg.id),
                    citations=extracted,
                    bureau_id=request.bureau_id,
                )
                citations_total += n

        # ------------------------------------------------------------------
        # 7: Enqueue for async indexing (Step 11)
        # ------------------------------------------------------------------
        enqueued = False
        try:
            for seg in segments:
                await self._doc_repo.enqueue_for_indexing(UUID(seg.id))
            enqueued = True
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Async index enqueue failed (non-fatal): {exc}")

        logger.info(
            "Ingest complete | source=%s | segments=%d | citations=%d | "
            "embedding=%s | enqueued=%s",
            request.source_url,
            len(segments),
            citations_total,
            embedding_generated,
            enqueued,
        )

        return IngestDocumentResult(
            doc_id=primary_id,
            segments_created=len(segments),
            citations_extracted=citations_total,
            embedding_generated=embedding_generated,
            enqueued_for_index=enqueued,
            warnings=warnings,
        )
