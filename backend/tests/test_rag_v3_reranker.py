"""Regression tests for RAG v3 reranker runtime behavior."""

from __future__ import annotations

import asyncio

import pytest

from infrastructure.rag_v3.reranker import RagV3RerankItem, RagV3Reranker


@pytest.mark.asyncio
async def test_rerank_runs_heavy_steps_via_to_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    reranker = RagV3Reranker()
    reranker._enabled = True
    reranker._cross_encoder = object()
    reranker._init_done = False
    trace: list[str] = []

    def fake_ensure_model() -> None:
        trace.append("ensure_model")
        reranker._init_done = True

    def fake_predict_scores(query: str, candidates: list[RagV3RerankItem]) -> dict[str, float]:
        trace.append("predict_scores")
        return {item.chunk_id: 0.9 for item in candidates}

    async def fake_to_thread(func, *args, **kwargs):  # type: ignore[no-untyped-def]
        trace.append(f"to_thread:{getattr(func, '__name__', 'callable')}")
        return func(*args, **kwargs)

    monkeypatch.setattr(reranker, "_ensure_model", fake_ensure_model)
    monkeypatch.setattr(reranker, "_predict_scores", fake_predict_scores)
    monkeypatch.setattr(asyncio, "to_thread", fake_to_thread)

    scores = await reranker.rerank(
        "akdi faiz orani",
        [RagV3RerankItem(chunk_id="chunk-1", text="Akdi faiz orani yuzde 18'dir.")],
    )

    assert scores["chunk-1"] == 0.9
    assert any(item.startswith("to_thread:fake_ensure_model") for item in trace)
    assert any(item.startswith("to_thread:fake_predict_scores") for item in trace)
    assert "ensure_model" in trace
    assert "predict_scores" in trace


@pytest.mark.asyncio
async def test_rerank_falls_back_to_lexical_when_model_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reranker = RagV3Reranker()
    reranker._enabled = True
    reranker._init_done = False
    reranker._cross_encoder = object()

    def fake_ensure_model() -> None:
        reranker._init_done = True
        reranker._cross_encoder = None

    async def fake_to_thread(func, *args, **kwargs):  # type: ignore[no-untyped-def]
        return func(*args, **kwargs)

    monkeypatch.setattr(reranker, "_ensure_model", fake_ensure_model)
    monkeypatch.setattr(asyncio, "to_thread", fake_to_thread)

    scores = await reranker.rerank(
        "kidem tazminati",
        [RagV3RerankItem(chunk_id="chunk-1", text="Kidem tazminati sartlari bu metinde aciklanir.")],
    )

    assert 0.0 <= scores["chunk-1"] <= 1.0
