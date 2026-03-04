"""Unit tests for RAG v3 baseline service."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from types import SimpleNamespace
from uuid import UUID

import pytest

from application.services.rag_v3_service import (
    RagV3QueryCommand,
    RagV3Service,
    _chunk_hash,
)
from infrastructure.config import settings
from infrastructure.rag_v3.chunker import LegalChunkDraft
from infrastructure.rag_v3.repository import RagV3ChunkMatch


@dataclass
class _FakeEmbedder:
    async def embed_query(self, query: str) -> list[float]:
        return [0.1] * 1536

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 1536 for _ in texts]


@dataclass
class _FakeRouter:
    answer: str
    called: bool = False
    last_requested_tier: int | None = None
    requested_tiers: list[int | None] = field(default_factory=list)

    async def generate(
        self,
        *,
        query: str,
        context: str,
        source_count: int,
        requested_tier: int | None = None,
    ) -> tuple[str, str]:
        self.called = True
        self.last_requested_tier = requested_tier
        self.requested_tiers.append(requested_tier)
        return self.answer, "openai/gpt-4o-mini"


@dataclass
class _FakeReranker:
    scores: dict[str, float] = field(default_factory=dict)
    called_with: list[str] = field(default_factory=list)

    async def rerank(self, query: str, candidates: list[object]) -> dict[str, float]:
        self.called_with = [str(getattr(item, "chunk_id", "")) for item in candidates]
        return {
            str(getattr(item, "chunk_id", "")): float(
                self.scores.get(str(getattr(item, "chunk_id", "")), 0.0)
            )
            for item in candidates
        }


class _FakeGuard:
    def check_query(self, query: str) -> None:
        return None

    def check_context(self, context: str) -> None:
        return None

    def sanitize_document_text(self, text: str) -> SimpleNamespace:
        return SimpleNamespace(
            injection_flag=False,
            matched_patterns=[],
            sanitized_text=text,
        )


class _FakeRepository:
    def __init__(self, matches: list[RagV3ChunkMatch]) -> None:
        self._matches = matches
        self.last_dense_top_k: int | None = None
        self.review_called = 0
        self.feedback_called = 0
        self.trace_called = 0
        self.last_trace_payload: dict[str, object] | None = None
        self._traces: dict[str, dict[str, object]] = {}

    async def match_chunks_dense(
        self,
        *,
        query_embedding: list[float],
        top_k: int,
        jurisdiction: str,
        as_of_date: date | None,
        acl_tags: list[str],
        bureau_id: UUID | None,
    ) -> list[RagV3ChunkMatch]:
        self.last_dense_top_k = top_k
        return list(self._matches)

    async def match_chunks_sparse(
        self,
        *,
        query_text: str,
        top_k: int,
        jurisdiction: str,
        as_of_date: date | None,
        acl_tags: list[str],
        bureau_id: UUID | None,
    ) -> list[RagV3ChunkMatch]:
        return []

    async def upsert_document_and_replace_chunks(self, **_: object) -> str:
        return "doc-id"

    async def enqueue_human_review(self, **_: object) -> str | None:
        self.review_called += 1
        return "review-ticket-1"

    async def append_feedback_candidate(self, **_: object) -> str | None:
        self.feedback_called += 1
        return "feedback-row-1"

    async def append_query_trace(self, **kwargs: object) -> None:
        self.trace_called += 1
        self.last_trace_payload = dict(kwargs)
        request_id = str(kwargs.get("request_id") or "")
        if request_id:
            self._traces[request_id] = dict(kwargs)

    async def get_query_trace(self, *, request_id: str, bureau_id: UUID | None) -> dict[str, object] | None:
        trace = self._traces.get(request_id)
        if not trace:
            return None
        if bureau_id is None:
            return trace
        trace_bureau_id = trace.get("bureau_id")
        if isinstance(trace_bureau_id, UUID):
            return trace if trace_bureau_id == bureau_id else None
        if isinstance(trace_bureau_id, str):
            return trace if trace_bureau_id == str(bureau_id) else None
        return None


def _match(
    *,
    chunk_id: str = "chunk-1",
    source_id: str = "kanun-1",
    article_no: str | None = "1",
    clause_no: str | None = "1",
    text: str = "MADDE 1 Bu hukum kidem tazminati ile ilgilidir.",
    final_score: float = 0.86,
) -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=chunk_id,
        document_id="doc-1",
        title="Is Kanunu",
        source_type="legislation",
        source_id=source_id,
        jurisdiction="TR",
        article_no=article_no,
        clause_no=clause_no,
        subclause_no=None,
        heading_path="Is Hukuku",
        chunk_text=text,
        page_range="1",
        effective_from=None,
        effective_to=None,
        acl_tags=["public"],
        doc_hash="doc-hash-1",
        chunk_hash=f"{chunk_id}-hash",
        semantic_score=0.84,
        keyword_score=0.0,
        final_score=final_score,
    )


@pytest.mark.asyncio
async def test_query_uses_dense_lane_and_top_k_is_clamped_to_8_12() -> None:
    repo = _FakeRepository(matches=[_match()])
    router = _FakeRouter(answer="Cevap.\nAtif: source_id=kanun-1; madde=1; fikra=1")
    reranker = _FakeReranker(scores={"chunk-1": 1.0})
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
        reranker=reranker,
    )

    result = await service.query(
        RagV3QueryCommand(query="Kidem tazminati nedir?", top_k=2, jurisdiction="TR"),
        bureau_id=None,
    )

    assert repo.last_dense_top_k is not None
    assert repo.last_dense_top_k >= 12
    assert result.status == "ok"
    assert len(result.citations) == 1
    assert result.citations[0].source_id == "kanun-1"
    assert router.called is True
    assert router.last_requested_tier == 2
    assert reranker.called_with == ["chunk-1"]
    assert result.request_id
    assert repo.trace_called == 1


@pytest.mark.asyncio
async def test_query_returns_no_answer_when_dense_retrieval_is_empty() -> None:
    repo = _FakeRepository(matches=[])
    router = _FakeRouter(answer="Bu cevap kullanilmamali.")
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
    )

    result = await service.query(
        RagV3QueryCommand(query="Bu soruya kaynak var mi?", top_k=12, jurisdiction="TR"),
        bureau_id=None,
    )

    assert result.status == "no_answer"
    assert "yeterli kanit" in result.answer.lower()
    assert result.retrieved_count == 0
    assert router.called is False


@pytest.mark.asyncio
async def test_query_returns_no_answer_when_overlap_gate_fails() -> None:
    repo = _FakeRepository(
        matches=[
            _match(
                text="MADDE 1 Bu metin sadece veraset hukuku ile ilgilidir.",
                final_score=0.91,
            )
        ]
    )
    router = _FakeRouter(answer="Bu cevap uretilmemeli.")
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
    )

    result = await service.query(
        RagV3QueryCommand(query="Kidem tazminati hesaplama kosullari nelerdir?", top_k=10),
        bureau_id=None,
    )

    assert result.status == "no_answer"
    assert router.called is False


@pytest.mark.asyncio
async def test_query_applies_reranker_scores_to_final_order() -> None:
    repo = _FakeRepository(
        matches=[
            _match(
                chunk_id="chunk-a",
                source_id="kanun-a",
                text="MADDE 1 Bu hukum kidem tazminati hesabina iliskindir.",
                final_score=0.95,
            ),
            _match(
                chunk_id="chunk-b",
                source_id="kanun-b",
                text="MADDE 2 Kidem tazminati alacagi ve hesaplama usulu.",
                final_score=0.90,
            ),
        ]
    )
    router = _FakeRouter(answer="Cevap.\nAtif: source_id=kanun-b; madde=2; fikra=1")
    reranker = _FakeReranker(scores={"chunk-a": 0.0, "chunk-b": 1.0})
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
        reranker=reranker,
    )

    result = await service.query(
        RagV3QueryCommand(query="Kidem tazminati nasil hesaplanir?", top_k=8),
        bureau_id=None,
    )

    assert result.status == "ok"
    assert reranker.called_with == ["chunk-a", "chunk-b"]
    assert len(result.citations) >= 1
    assert result.citations[0].chunk_id == "chunk-b"


@pytest.mark.asyncio
async def test_query_requires_bureau_scope_when_tenant_guard_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _FakeRepository(matches=[_match()])
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=_FakeRouter(answer="Cevap"),
        guard=_FakeGuard(),
    )

    monkeypatch.setattr(settings, "multi_tenancy_enabled", True)
    monkeypatch.setattr(settings, "rag_v3_tenant_hard_fail_missing_bureau", True)
    monkeypatch.setattr(settings, "tenant_enforce_in_dev", True)
    monkeypatch.setattr(settings, "environment", "production")

    with pytest.raises(ValueError):
        await service.query(
            RagV3QueryCommand(query="Kidem tazminati?", top_k=10, jurisdiction="TR"),
            bureau_id=None,
        )


@pytest.mark.asyncio
async def test_query_enqueues_human_review_for_high_risk_query() -> None:
    repo = _FakeRepository(
        matches=[
            _match(
                chunk_id="chunk-risk",
                source_id="2004",
                article_no="106",
                text="Icra ve iflas hukuku kapsaminda zamanasimi itiraz suresi bu maddededir.",
                final_score=0.92,
            )
        ]
    )
    router = _FakeRouter(
        answer="Icra hukuku kapsaminda zamanasimi itiraz suresi maddedeki kosullara baglidir."
    )
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
    )

    result = await service.query(
        RagV3QueryCommand(query="Icra zamanasimi suresini acikla", top_k=10, jurisdiction="TR"),
        bureau_id=UUID("550e8400-e29b-41d4-a716-446655440000"),
    )

    assert result.review_ticket_id == "review-ticket-1"
    assert repo.review_called == 1
    assert repo.feedback_called >= 1


@pytest.mark.asyncio
async def test_query_passes_requested_tier_to_router() -> None:
    repo = _FakeRepository(matches=[_match()])
    router = _FakeRouter(answer="Cevap.\nAtif: source_id=kanun-1; madde=1; fikra=1")
    service = RagV3Service(
        repository=repo,
        embedder=_FakeEmbedder(),
        router=router,
        guard=_FakeGuard(),
    )

    result = await service.query(
        RagV3QueryCommand(query="Kidem tazminati nedir?", top_k=10, requested_tier=4),
        bureau_id=None,
    )

    assert result.status == "ok"
    assert 4 in router.requested_tiers


def test_chunk_hash_changes_with_ordinal() -> None:
    chunk = LegalChunkDraft(
        article_no="14",
        clause_no="1",
        subclause_no=None,
        heading_path="Is Hukuku",
        text="Kidem tazminati kosullari",
        page_range="1",
        char_start=0,
        char_end=24,
    )
    first = _chunk_hash(chunk=chunk, source_id="kanun-4857", ordinal=1)
    second = _chunk_hash(chunk=chunk, source_id="kanun-4857", ordinal=2)
    assert first != second


def test_chunk_hash_changes_with_source_id() -> None:
    chunk = LegalChunkDraft(
        article_no="14",
        clause_no="1",
        subclause_no=None,
        heading_path="Is Hukuku",
        text="Kidem tazminati kosullari",
        page_range="1",
        char_start=0,
        char_end=24,
    )
    first = _chunk_hash(chunk=chunk, source_id="kanun-4857", ordinal=1)
    second = _chunk_hash(chunk=chunk, source_id="kanun-1475", ordinal=1)
    assert first != second
