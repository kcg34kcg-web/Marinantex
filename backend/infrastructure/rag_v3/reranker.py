"""RAG v3 reranker with graceful fallback to lexical scoring."""

from __future__ import annotations

import asyncio
import logging
import math
import re
import threading
from dataclasses import dataclass
from typing import Optional, Sequence

import httpx

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
        self._provider = str(getattr(settings, "rag_v3_reranker_provider", "auto") or "auto").strip().lower()
        self._base_url = str(getattr(settings, "rag_v3_reranker_base_url", "") or "").strip().rstrip("/")
        self._api_key = str(getattr(settings, "rag_v3_reranker_api_key", "") or "").strip()
        self._request_timeout_s = float(getattr(settings, "rag_v3_reranker_request_timeout_s", 3.0) or 3.0)
        self._use_http = self._provider == "http" or (self._provider == "auto" and bool(self._base_url))
        self._init_done = False
        self._init_inflight = False
        self._init_lock = threading.Lock()
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

        if self._cross_encoder is not None and not self._init_done:
            # Keeps backward-compatible behavior for warmup bookkeeping.
            await asyncio.to_thread(self._ensure_model)

        if self._use_http:
            try:
                http_scores = await self._rerank_via_http(query=query, candidates=list(candidates))
                if http_scores:
                    return http_scores
            except Exception as exc:  # noqa: BLE001
                logger.warning("RAG_V3_RERANKER_HTTP_FALLBACK | reason=%s", exc)

        if self._cross_encoder is None:
            # First load can be slow (model download). Start warmup in background
            # and keep request path non-blocking to avoid timeout-based fallback.
            self._kickoff_model_init()
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

        try:
            return await asyncio.to_thread(self._predict_scores, query, list(candidates))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "RAG_V3_RERANKER_FALLBACK | reason=%s",
                exc,
            )
            return {item.chunk_id: _lexical_score(query, item.text) for item in candidates}

    def _kickoff_model_init(self) -> None:
        if self._init_done or self._init_inflight:
            return
        with self._init_lock:
            if self._init_done or self._init_inflight:
                return
            self._init_inflight = True
        threading.Thread(target=self._ensure_model, name="rag-v3-reranker-init", daemon=True).start()

    def _ensure_model(self) -> None:
        with self._init_lock:
            if self._init_done:
                self._init_inflight = False
                return
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
        finally:
            with self._init_lock:
                self._init_done = True
                self._init_inflight = False

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

    async def _rerank_via_http(
        self,
        *,
        query: str,
        candidates: list[RagV3RerankItem],
    ) -> dict[str, float]:
        if not self._base_url or not candidates:
            return {}
        endpoints = _rerank_endpoints(self._base_url)
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        docs = [item.text[:4000] for item in candidates]
        payloads = [
            {
                "model": self._model_name,
                "query": query,
                "documents": docs,
                "top_n": len(docs),
            },
            {
                "model": self._model_name,
                "query": query,
                "texts": docs,
                "top_n": len(docs),
            },
        ]

        async with httpx.AsyncClient(timeout=max(0.5, self._request_timeout_s)) as client:
            last_error: Optional[Exception] = None
            for endpoint in endpoints:
                for payload in payloads:
                    try:
                        resp = await client.post(endpoint, headers=headers, json=payload)
                        if resp.status_code >= 400:
                            continue
                        body = resp.json()
                        parsed = _parse_http_rerank_scores(body=body, candidates=candidates)
                        if parsed:
                            return parsed
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
                        continue
            if last_error is not None:
                raise last_error
        return {}


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


def _rerank_endpoints(base_url: str) -> list[str]:
    token = str(base_url or "").strip().rstrip("/")
    if not token:
        return []
    if token.endswith("/rerank"):
        return [token]
    endpoints = [f"{token}/rerank"]
    if not token.endswith("/v1"):
        endpoints.append(f"{token}/v1/rerank")
    return list(dict.fromkeys(endpoints))


def _parse_http_rerank_scores(
    *,
    body: object,
    candidates: list[RagV3RerankItem],
) -> dict[str, float]:
    if isinstance(body, dict):
        if isinstance(body.get("results"), list):
            parsed = _parse_results_array(body["results"], candidates)
            if parsed:
                return parsed
        if isinstance(body.get("data"), list):
            parsed = _parse_results_array(body["data"], candidates)
            if parsed:
                return parsed
        if isinstance(body.get("scores"), list):
            parsed = _parse_score_array(body["scores"], candidates)
            if parsed:
                return parsed
    if isinstance(body, list):
        parsed = _parse_score_array(body, candidates)
        if parsed:
            return parsed
    return {}


def _parse_results_array(results: list[object], candidates: list[RagV3RerankItem]) -> dict[str, float]:
    out: dict[str, float] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        idx_raw = item.get("index")
        try:
            idx = int(idx_raw)
        except Exception:
            continue
        if idx < 0 or idx >= len(candidates):
            continue
        score = _coerce_http_score(item.get("relevance_score", item.get("score", 0.0)))
        out[candidates[idx].chunk_id] = score
    return out


def _parse_score_array(scores: list[object], candidates: list[RagV3RerankItem]) -> dict[str, float]:
    out: dict[str, float] = {}
    for idx, raw in enumerate(scores):
        if idx >= len(candidates):
            break
        out[candidates[idx].chunk_id] = _coerce_http_score(raw)
    return out


def _coerce_http_score(value: object) -> float:
    try:
        numeric = float(value)
    except Exception:
        return 0.0
    if 0.0 <= numeric <= 1.0:
        return numeric
    return _sigmoid(numeric)


rag_v3_reranker = RagV3Reranker()
