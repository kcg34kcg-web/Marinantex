"""RAG v3 infrastructure package."""

from infrastructure.rag_v3.chunker import LegalChunkDraft, LegalStructuredChunker
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
from infrastructure.rag_v3.normalizer import LegalTextNormalizer, NormalizedLegalText, legal_text_normalizer
from infrastructure.rag_v3.reranker import RagV3RerankItem, RagV3Reranker, rag_v3_reranker
from infrastructure.rag_v3.repository import RagV3ChunkMatch, SupabaseRagV3Repository, rag_v3_repository
from infrastructure.rag_v3.source_parser import ParsedSourceContent, parse_source_content

__all__ = [
    "LegalChunkDraft",
    "LegalStructuredChunker",
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
    "LegalTextNormalizer",
    "NormalizedLegalText",
    "legal_text_normalizer",
    "RagV3RerankItem",
    "RagV3Reranker",
    "rag_v3_reranker",
    "RagV3ChunkMatch",
    "SupabaseRagV3Repository",
    "rag_v3_repository",
    "ParsedSourceContent",
    "parse_source_content",
]
