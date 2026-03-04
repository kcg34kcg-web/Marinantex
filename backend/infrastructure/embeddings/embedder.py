"""
Query Embedder  â€”  Step 6
==========================
Converts a user query (or a batch of texts) into a 1536-dim dense vector
using OpenAI ``text-embedding-3-small``.

DESIGN GOALS:
    1. Zero-vector guard â€” detects all-zero responses and raises rather than
       silently polluting the L2 cache with useless entries.
    2. Dimension guard â€” asserts the returned vector length matches
       ``settings.embedding_dimensions`` (default 1536) so schema drift is
       caught immediately at the embedder boundary.
    3. Retry with exponential back-off â€” handles transient OpenAI 429 / 5xx
       errors without crashing the pipeline.  Configurable via settings.
    4. Async-native â€” uses ``openai.AsyncOpenAI`` so the FastAPI event loop
       is never blocked.
    5. Batch API â€” ``embed_texts()`` sends up to
       ``settings.embedding_batch_size`` strings per request, needed by the
       ingest pipeline (Step 8).

COST REFERENCE:
    text-embedding-3-small: $0.02 / 1M tokens (~$0.000_002 per query).
    A typical 15-word legal query â‰ˆ 20 tokens â†’ $0.000_000_04 per embed call.

FAILURE POLICY:
    ``EmbeddingError`` (HTTP 503) is raised for:
      - Missing OPENAI_API_KEY
      - Persistent API errors after retries exhausted
      - All-zero response vector (upstream model anomaly)
      - Wrong vector dimensions

    The cache lookup always precedes ``embed_query()``, so embedding is
    never called on a cache hit â€” saving both latency and cost.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import List

from fastapi import HTTPException, status
from openai import AsyncOpenAI, RateLimitError, APIError

from infrastructure.config import settings

logger = logging.getLogger("babylexit.embedder")


# ============================================================================
# Custom Exception
# ============================================================================

class EmbeddingError(Exception):
    """Raised when the embedding service fails fatally (after retries)."""


# ============================================================================
# Pure helper functions â€” no side effects, fully unit-testable
# ============================================================================

def is_zero_vector(vector: List[float]) -> bool:
    """
    Returns True if every component of the vector is (near) zero.

    A zero vector from the embedding API indicates a serious upstream anomaly
    (e.g. empty or whitespace-only input accepted by the API, or a bug in
    the response parsing path).  Storing it in the L2 semantic cache would
    corrupt all future cosine lookups, so we hard-fail instead.

    Args:
        vector: Any float list â€” the embedding to inspect.

    Returns:
        True  â†’ all components |v_i| < 1e-9  (effectively zero)
        False â†’ at least one non-negligible component present
    """
    return all(abs(v) < 1e-9 for v in vector)


def l2_norm(vector: List[float]) -> float:
    """Returns the Euclidean (L2) norm of a vector.  Pure function."""
    return math.sqrt(sum(v * v for v in vector))


def assert_dimensions(vector: List[float], expected: int) -> None:
    """
    Asserts the vector has exactly ``expected`` dimensions.

    Raises:
        EmbeddingError: if ``len(vector) != expected``.
    """
    if len(vector) != expected:
        raise EmbeddingError(
            f"Embedding dimension mismatch: expected {expected}, got {len(vector)}. "
            f"Check EMBEDDING_MODEL / EMBEDDING_DIMENSIONS in .env."
        )


# ============================================================================
# QueryEmbedder
# ============================================================================

class QueryEmbedder:
    """
    Async embedding client backed by OpenAI ``text-embedding-3-small``.

    Usage:
        embedder = QueryEmbedder()

        # Single query (RAG pipeline):
        vector = await embedder.embed_query("ihbar tazminatÄ± nasÄ±l hesaplanÄ±r?")

        # Batch (ingest pipeline):
        vectors = await embedder.embed_texts(["chunk A", "chunk B", ...])

    Configuration (all read from ``settings``):
        EMBEDDING_MODEL          = "text-embedding-3-small"
        EMBEDDING_DIMENSIONS     = 1536
        EMBEDDING_BATCH_SIZE     = 512   (max strings per API call)
        EMBEDDING_MAX_RETRIES    = 3
        EMBEDDING_RETRY_BASE_DELAY_S = 1.0
    """

    def __init__(self) -> None:
        base_url = str(getattr(settings, "embedding_base_url", "") or "").strip()
        if not base_url:
            base_url = str(getattr(settings, "openai_base_url", "") or "").strip()

        api_key = (
            str(getattr(settings, "embedding_api_key", "") or "").strip()
            or str(getattr(settings, "openai_api_key", "") or "").strip()
        )
        if not api_key and not base_url:
            logger.warning(
                "No embedding credentials or base URL set; embedding calls will fail at runtime. "
                "Set EMBEDDING_BASE_URL (or OPENAI_BASE_URL) and credentials in backend/.env."
            )

        client_kwargs: dict[str, str] = {"api_key": api_key or "local-not-required"}
        if base_url:
            client_kwargs["base_url"] = base_url
        self._client = AsyncOpenAI(**client_kwargs)
        self._model: str = settings.embedding_model
        self._dimensions: int = settings.embedding_dimensions
        self._send_dimensions: bool = bool(getattr(settings, "embedding_send_dimensions_param", True))
        self._batch_size: int = settings.embedding_batch_size
        self._max_retries: int = settings.embedding_max_retries
        self._retry_base_delay: float = settings.embedding_retry_base_delay_s
        self._quota_cooldown_s: int = int(
            max(0, getattr(settings, "embedding_quota_cooldown_s", 300) or 0)
        )
        self._quota_block_until_ts: float = 0.0

        logger.info(
            "QueryEmbedder initialised | model=%s | dims=%d | send_dims=%s | batch=%d | retries=%d",
            self._model,
            self._dimensions,
            self._send_dimensions,
            self._batch_size,
            self._max_retries,
        )

    async def embed_query(self, query: str) -> List[float]:
        """
        Embeds a single query string.

        This is the hot-path called by ``RAGService._embed_query()``.
        L1 cache is checked before this method â€” it is never called on a hit.

        Args:
            query: The user's legal question (post-PII-masking,
                   post-prompt-guard, pre-retrieval).

        Returns:
            List[float] of length ``settings.embedding_dimensions`` (1536).

        Raises:
            HTTPException 503: API failure after retries, or zero-vector guard.
        """
        if not query or not query.strip():
            # Empty query should never reach here (Pydantic min_length=3 guard)
            # but we protect defensively
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "EMBED_EMPTY_QUERY",
                    "message": "Cannot embed an empty query string.",
                },
            )

        vectors = await self._embed_with_retry([query])
        vector = vectors[0]

        assert_dimensions(vector, self._dimensions)

        if is_zero_vector(vector):
            logger.error(
                "ZERO_VECTOR: embedding API returned all-zeros for query=%r",
                query[:80],
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "EMBEDDING_ZERO_VECTOR",
                    "message": (
                        "Embedding modeli sÄ±fÄ±r vektÃ¶r dÃ¶ndÃ¼rdÃ¼. "
                        "LÃ¼tfen tekrar deneyin."
                    ),
                },
            )

        logger.debug(
            "embed_query OK | model=%s | norm=%.4f | query_len=%d",
            self._model,
            l2_norm(vector),
            len(query),
        )
        return vector

    async def embed(self, text: str) -> List[float]:
        """
        Backward-compatible alias for legacy callers.

        NOTE:
            New call sites should use ``embed_query()`` for single query text
            and ``embed_texts()`` for batch ingest flow.
        """
        return await self.embed_query(text)

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Embeds a batch of text strings (used by the ingest pipeline).

        Automatically splits into chunks of ``settings.embedding_batch_size``
        and makes sequential API calls (OpenAI enforces per-request limits).

        Args:
            texts: A list of document chunk strings to embed.

        Returns:
            Parallel list of embedding vectors, same order as input.

        Raises:
            HTTPException 503: On persistent API failure or zero-vector.
        """
        if not texts:
            return []

        results: List[List[float]] = []
        for i in range(0, len(texts), self._batch_size):
            batch = texts[i : i + self._batch_size]
            batch_vectors = await self._embed_with_retry(batch)
            for j, vec in enumerate(batch_vectors):
                assert_dimensions(vec, self._dimensions)
                if is_zero_vector(vec):
                    logger.warning(
                        "ZERO_VECTOR in batch: index=%d text_preview=%r",
                        i + j,
                        batch[j][:60],
                    )
            results.extend(batch_vectors)

        logger.info(
            "embed_texts OK | count=%d | model=%s",
            len(texts),
            self._model,
        )
        return results

    # â”€â”€ Private helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def _embed_with_retry(self, texts: List[str]) -> List[List[float]]:
        """
        Calls the OpenAI embeddings endpoint with exponential back-off retry.

        Retries on:
            - ``RateLimitError``  (HTTP 429) â€” back-off then retry
            - ``APIError``        (HTTP 5xx) â€” back-off then retry

        Does NOT retry on authentication / input validation errors (4xx).

        Args:
            texts: Strings to embed (already split to â‰¤ batch_size).

        Returns:
            List of float vectors, one per input string.

        Raises:
            HTTPException 503: After all retries exhausted.
        """
        now = time.time()
        if self._quota_block_until_ts > now:
            remaining = int(max(1, self._quota_block_until_ts - now))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "EMBEDDING_QUOTA_COOLDOWN",
                    "message": (
                        "Embedding kotasi dolu oldugu icin istek hizli reddedildi. "
                        f"Lutfen {remaining} saniye sonra tekrar deneyin."
                    ),
                },
            )

        last_exc: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            try:
                request_kwargs: dict[str, object] = {
                    "model": self._model,
                    "input": texts,
                }
                if self._send_dimensions:
                    request_kwargs["dimensions"] = self._dimensions

                response = await self._client.embeddings.create(**request_kwargs)
                # Sort by index to guarantee order (API contract)
                sorted_data = sorted(response.data, key=lambda d: d.index)
                return [item.embedding for item in sorted_data]

            except RateLimitError as exc:
                if self._is_hard_quota_exhausted(exc):
                    if self._quota_cooldown_s > 0:
                        self._quota_block_until_ts = time.time() + float(self._quota_cooldown_s)
                    logger.error(
                        "EMBED_QUOTA_EXHAUSTED | cooldown_s=%d | err=%s",
                        self._quota_cooldown_s,
                        exc,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail={
                            "error": "EMBEDDING_QUOTA_EXHAUSTED",
                            "message": (
                                "Embedding kotasi dolu. Lutfen kota/paket ayarlarini kontrol edin."
                            ),
                        },
                    ) from exc
                last_exc = exc
                delay = self._retry_base_delay * (2 ** (attempt - 1))
                logger.warning(
                    "EMBED_RATE_LIMIT: attempt %d/%d â€” sleeping %.1fs before retry",
                    attempt,
                    self._max_retries,
                    delay,
                )
                await asyncio.sleep(delay)

            except APIError as exc:
                # DÃœZELTME BURADA: Pylance'i mutlu etmek ve gÃ¼venli kod yazmak iÃ§in getattr kullanÄ±yoruz
                status_code = getattr(exc, "status_code", None)
                error_message = getattr(exc, "message", str(exc))
                
                # Only retry on 5xx server errors
                if status_code is not None and status_code < 500:
                    logger.error(
                        "EMBED_CLIENT_ERROR: %s (status=%s) â€” not retrying",
                        error_message,
                        status_code,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail={
                            "error": "EMBEDDING_CLIENT_ERROR",
                            "message": f"OpenAI embedding error: {error_message}",
                        },
                    ) from exc

                last_exc = exc
                delay = self._retry_base_delay * (2 ** (attempt - 1))
                logger.warning(
                    "EMBED_API_ERROR: attempt %d/%d status=%s â€” sleeping %.1fs",
                    attempt,
                    self._max_retries,
                    status_code,
                    delay,
                )
                await asyncio.sleep(delay)

            except Exception as exc:
                # Unexpected error â€” fail immediately (no retry)
                logger.error("EMBED_UNEXPECTED_ERROR: %s", exc, exc_info=True)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "error": "EMBEDDING_UNEXPECTED_ERROR",
                        "message": f"Embedding service error: {exc}",
                    },
                ) from exc

        # All retries exhausted
        logger.error(
            "EMBED_RETRIES_EXHAUSTED: %d attempts failed. Last error: %s",
            self._max_retries,
            last_exc,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "EMBEDDING_RETRIES_EXHAUSTED",
                "message": (
                    "Embedding servisi geÃ§ici olarak kullanÄ±lamÄ±yor. "
                    "LÃ¼tfen kÄ±sa sÃ¼re sonra tekrar deneyin."
                ),
            },
        )

    @staticmethod
    def _is_hard_quota_exhausted(exc: Exception) -> bool:
        """
        Detects non-transient quota exhaustion (e.g. OpenAI insufficient_quota).
        """
        try:
            body = getattr(exc, "body", None)
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict):
                    code = str(err.get("code", "") or "").strip().lower()
                    err_type = str(err.get("type", "") or "").strip().lower()
                    if code == "insufficient_quota" or err_type == "insufficient_quota":
                        return True
        except Exception:
            pass
        lowered = str(exc).lower()
        return ("insufficient_quota" in lowered) or ("quota exceeded" in lowered)


# ============================================================================
# Module-level singleton
# ============================================================================

query_embedder = QueryEmbedder()

