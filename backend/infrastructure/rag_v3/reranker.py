"""RAG v3 reranker with graceful fallback to lexical scoring."""

from __future__ import annotations

import asyncio
import logging
import math
import re
from dataclasses import dataclass
from typing import Optional, Sequence

from infrastructure.config import settings

logger = logging.getLogger("babylexit.rag_v3.reranker")

_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")

_STOPWORDS = frozenset(
    {
        "ve",
        "veya",
        "ile",
        "icin",
        "bu",
        "bir",
        "da",
        "de",
        "mi",
        "mu",
        "mı",
        "mü",
        "the",
        "and",
        "for",
        "with",
        "to",
        "of",
        "in",
    }
)


@dataclass(frozen=True)
class RagV3RerankItem:
    chunk_id: str
    text: str
    retrieval_score: float = 0.0


class RagV3Reranker:
    """
    Thin reranker wrapper.

    Primary path: CrossEncoder (sentence-transformers).
    Fallback path: deterministic lexical overlap scoring.
    """

    def __init__(self) -> None:
        self._model_name = settings.rag_v3_reranker_model
        self._enabled = bool(settings.rag_v3_reranker_enabled)
        self._init_done = False
        self._cross_encoder: Optional[object] = None

    async def rerank(
        self,
        query: str,
        candidates: Sequence[RagV3RerankItem],
    ) -> dict[str, float]:
        if not candidates:
            return {}

        if not self._enabled:
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

        self._ensure_model()
        if self._cross_encoder is None:
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

        try:
            return await asyncio.to_thread(self._predict_scores, query, list(candidates))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "RAG_V3_RERANKER_FALLBACK | reason=%s",
                exc,
            )
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

    def _ensure_model(self) -> None:
        if self._init_done:
            return
        self._init_done = True

        try:
            from sentence_transformers import CrossEncoder  # type: ignore[import-untyped]

            self._cross_encoder = CrossEncoder(self._model_name, trust_remote_code=True)
            logger.info("RAG_V3_RERANKER_READY | model=%s", self._model_name)
        except Exception as exc:  # noqa: BLE001
            self._cross_encoder = None
            logger.warning(
                "RAG_V3_RERANKER_UNAVAILABLE | model=%s | reason=%s",
                self._model_name,
                exc,
            )

    def _predict_scores(
        self,
        query: str,
        candidates: list[RagV3RerankItem],
    ) -> dict[str, float]:
        if self._cross_encoder is None:
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

        pairs = [(query, item.text[:4000]) for item in candidates]
        raw_scores = self._cross_encoder.predict(pairs, show_progress_bar=False)
        result: dict[str, float] = {}
        for item, raw in zip(candidates, raw_scores):
            try:
                numeric = float(raw)
            except Exception:
                numeric = 0.0
            result[item.chunk_id] = _sigmoid(numeric)
        return result


def _sigmoid(x: float) -> float:
    if x >= 0.0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _lexical_score(query: str, text: str) -> float:
    q_tokens = _normalize_tokens(query)
    if not q_tokens:
        return 0.0
    t_tokens = _normalize_tokens(text)
    if not t_tokens:
        return 0.0

    overlap = len(q_tokens & t_tokens)
    recall = overlap / max(1, len(q_tokens))
    precision = overlap / max(1, len(t_tokens))
    phrase_bonus = 0.15 if (query or "").strip().lower() in (text or "").lower() else 0.0
    score = (0.70 * recall) + (0.20 * precision) + phrase_bonus
    return max(0.0, min(1.0, score))


def _normalize_tokens(text: str) -> set[str]:
    tokens = _TOKEN_RE.findall((text or "").lower())
    return {token for token in tokens if len(token) >= 3 and token not in _STOPWORDS}


rag_v3_reranker = RagV3Reranker()

