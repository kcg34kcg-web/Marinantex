"""Semantic claim verifier tests (entailment + contradiction)."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from infrastructure.rag_v3.claim_verifier import SemanticClaimVerifier
from infrastructure.rag_v3.repository import RagV3ChunkMatch


@dataclass
class _FailingEmbedder:
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("embed provider down")


@dataclass
class _DeterministicEmbedder:
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        # Fixed-dim non-zero vectors for deterministic cosine path.
        return [[0.1, 0.2, 0.3] for _ in texts]


def _chunk(text: str, *, chunk_id: str = "chunk-1") -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=chunk_id,
        document_id="doc-1",
        title="Is Kanunu",
        source_type="kanun",
        source_id="4857",
        classification="PUBLIC",
        jurisdiction="TR",
        article_no="17",
        clause_no="1",
        subclause_no=None,
        heading_path=None,
        chunk_text=text,
        page_range="1",
        effective_from=None,
        effective_to=None,
        acl_tags=["public"],
        doc_hash="doc-hash",
        chunk_hash="chunk-hash",
        semantic_score=0.0,
        keyword_score=0.0,
        final_score=0.0,
    )


@pytest.mark.asyncio
async def test_semantic_claim_verifier_blocks_numeric_contradiction() -> None:
    verifier = SemanticClaimVerifier(embedder=_FailingEmbedder())
    result = await verifier.verify(
        answer_text="Faiz oranı yüzde 18'dir.",
        evidence_chunks=[_chunk("Faiz oranı yüzde 24'tür.")],
        cited_chunk_ids=["chunk-1"],
        min_similarity=0.40,
        min_overlap=0.20,
        min_supported_ratio=0.70,
    )

    assert result.contradiction_count >= 1
    assert result.passed is False


@pytest.mark.asyncio
async def test_semantic_claim_verifier_passes_supported_claim() -> None:
    verifier = SemanticClaimVerifier(embedder=_DeterministicEmbedder())
    result = await verifier.verify(
        answer_text="İhbar süresi dört haftadır.",
        evidence_chunks=[_chunk("İhbar süresi dört haftadır ve yazılı bildirilir.")],
        cited_chunk_ids=["chunk-1"],
        min_similarity=0.40,
        min_overlap=0.20,
        min_supported_ratio=0.60,
    )

    assert result.supported_claims >= 1
    assert result.contradiction_count == 0
