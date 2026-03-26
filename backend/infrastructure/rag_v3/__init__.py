"""RAG v3 infrastructure package."""

from infrastructure.rag_v3.chunker import LegalChunkDraft, LegalStructuredChunker
from infrastructure.rag_v3.document_understanding import (
    DocumentUnderstandingReport,
    evaluate_document_understanding,
)
from infrastructure.rag_v3.admission import AdmissionDecision, RagV3AdmissionController, rag_v3_admission_controller
from infrastructure.rag_v3.governance import (
    ClaimVerification,
    PolicyDecision,
    TemporalResolution,
    apply_norm_hierarchy,
    evaluate_policy,
    resolve_as_of_date,
    verify_claim_support,
)
from infrastructure.rag_v3.metadata_governance import (
    MetadataValidationInput,
    MetadataValidationResult,
    validate_ingest_metadata,
)
from infrastructure.rag_v3.planner import RagV3QueryPlan, RagV3QueryPlanner, rag_v3_query_planner
from infrastructure.rag_v3.normalizer import LegalTextNormalizer, NormalizedLegalText, legal_text_normalizer
from infrastructure.rag_v3.reranker import RagV3RerankItem, RagV3Reranker, rag_v3_reranker
from infrastructure.rag_v3.repository import RagV3ChunkMatch, SupabaseRagV3Repository, rag_v3_repository
from infrastructure.rag_v3.parser_orchestrator import RagV3ParserOrchestrator, rag_v3_parser_orchestrator
from infrastructure.rag_v3.source_parser import ParsedSourceContent, parse_source_content

__all__ = [
    "LegalChunkDraft",
    "LegalStructuredChunker",
    "DocumentUnderstandingReport",
    "evaluate_document_understanding",
    "AdmissionDecision",
    "RagV3AdmissionController",
    "rag_v3_admission_controller",
    "TemporalResolution",
    "PolicyDecision",
    "ClaimVerification",
    "resolve_as_of_date",
    "apply_norm_hierarchy",
    "evaluate_policy",
    "verify_claim_support",
    "MetadataValidationInput",
    "MetadataValidationResult",
    "validate_ingest_metadata",
    "RagV3QueryPlan",
    "RagV3QueryPlanner",
    "rag_v3_query_planner",
    "LegalTextNormalizer",
    "NormalizedLegalText",
    "legal_text_normalizer",
    "RagV3RerankItem",
    "RagV3Reranker",
    "rag_v3_reranker",
    "RagV3ChunkMatch",
    "SupabaseRagV3Repository",
    "rag_v3_repository",
    "RagV3ParserOrchestrator",
    "rag_v3_parser_orchestrator",
    "ParsedSourceContent",
    "parse_source_content",
]
