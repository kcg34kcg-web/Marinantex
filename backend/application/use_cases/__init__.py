"""
application/use_cases
=====================
Application-layer use cases for Babylexit v3.0.

Each use case is a thin orchestrator that:
    - Accepts plain-Python request DTOs (no FastAPI / HTTP coupling)
    - Delegates to domain + infrastructure singletons
    - Returns plain-Python response DTOs
    - Is independently unit-testable via dependency injection

Use Cases:
    QueryLegalRAGUseCase       — Full RAG pipeline for a legal question
    IngestDocumentUseCase      — Ingest a raw document into the knowledge base
    LeheKanunCompareUseCase    — Dual-version retrieval for TCK Madde 7/2
"""

from application.use_cases.ingest_document import (
    IngestDocumentRequest,
    IngestDocumentResult,
    IngestDocumentUseCase,
)
from application.use_cases.lehe_kanun_compare import (
    LeheKanunCompareRequest,
    LeheKanunCompareResponse,
    LeheKanunCompareUseCase,
    VersionedSource,
)
from application.use_cases.query_legal_rag import (
    QueryLegalRAGRequest,
    QueryLegalRAGResponse,
    QueryLegalRAGUseCase,
)

__all__ = [
    # QueryLegalRAG
    "QueryLegalRAGUseCase",
    "QueryLegalRAGRequest",
    "QueryLegalRAGResponse",
    # IngestDocument
    "IngestDocumentUseCase",
    "IngestDocumentRequest",
    "IngestDocumentResult",
    # LeheKanunCompare
    "LeheKanunCompareUseCase",
    "LeheKanunCompareRequest",
    "LeheKanunCompareResponse",
    "VersionedSource",
]
