"""
Semantic Cache  —  Step 8
==========================
Redis-backed two-level cache for RAG query results.

Level 1  (Exact Match):
    Key:  cache:rag:l1:{SHA-256(normalize(query) + "|" + case_id)}
    Cost: single Redis GET → $0.  Skips embedding, retrieval, LLM entirely.

Level 2  (Semantic Similarity):
    Key:  cache:rag:l2:{uuid4}   (individual entry: embedding + response)
    Index: cache:rag:l2:index    (Redis List of L2 keys, capped at max_l2_entries)
    Cost: one lrange + N cosine comparisons (N ≤ max_l2_entries, default 200).
          Skips retrieval + LLM entirely.  Embedding call is still made.

Cache hit at either level → LLM is NEVER called → cost = $0.

TTL:
    Default 24 h.  Turkish law texts don't change hourly.
    When a new ingest arrives for a case, call `invalidate_case(case_id)` to
    purge stale L2 entries (Step 10 ingest hook).

Failure policy:
    ALL cache operations are non-fatal.  Errors are logged at WARNING level
    and the caller falls through to the normal retrieval path.
    A broken Redis connection must NEVER block a legal query.
"""

from __future__ import annotations

import hashlib
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from infrastructure.cache.redis_client import RedisClient
from infrastructure.config import settings

logger = logging.getLogger("babylexit.semantic_cache")

# ── Redis key templates ────────────────────────────────────────────────────────
_L1_PREFIX: str = "cache:rag:l1:"
_L2_PREFIX: str = "cache:rag:l2:"
_L2_INDEX: str = "cache:rag:l2:index"


# ============================================================================
# Module-level pure helpers  (imported directly in tests — no Redis required)
# ============================================================================

def normalize_query(query: str) -> str:
    """Lowercase + collapse all whitespace for consistent key generation."""
    return " ".join(query.lower().split())


def build_l1_key(
    query: str,
    case_id: Optional[str],
    bureau_id: Optional[str] = None,
) -> str:
    """
    Deterministic L1 cache key.

    Formula: SHA-256( normalize(query) + "|" + (case_id or "") + "|" + (bureau_id or "") )

    Both case_id and bureau_id are included so that a query from bureau-A
    never hits a cached response belonging to bureau-B (multi-tenant isolation).
    """
    raw = normalize_query(query) + "|" + (case_id or "") + "|" + (bureau_id or "")
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return _L1_PREFIX + digest


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """
    Cosine similarity between two equal-length floating-point vectors.

    Pure Python — no NumPy dependency.  Safe for:
      - Zero vectors         → returns 0.0 (no ZeroDivisionError)
      - Unequal-length vecs  → logs WARNING and uses zip (stops at shorter)
      - 1536-dim vectors     → ~1.5 ms per pair in CPython (acceptable for
                               ≤200 L2 entries)

    Returns:
        float in [-1.0, 1.0], typically [0.0, 1.0] for normalised embeddings.
    """
    if len(a) != len(b):
        logger.warning(
            "cosine_similarity: dimension mismatch (%d vs %d) — zip will truncate to shorter",
            len(a),
            len(b),
        )
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ============================================================================
# SemanticCache
# ============================================================================

class SemanticCache:
    """
    Two-level semantic cache backed by Redis.

    Instantiate once at application startup and pass to RAGService:

        cache = SemanticCache(app.state.redis)
        rag = RAGService(cache=cache)

    All public methods are async and non-fatal on Redis errors.
    """

    def __init__(
        self,
        redis: RedisClient,
        ttl: Optional[int] = None,
        similarity_threshold: Optional[float] = None,
        max_l2_entries: Optional[int] = None,
    ) -> None:
        self._redis = redis
        self._ttl: int = ttl if ttl is not None else settings.semantic_cache_ttl_seconds
        self._threshold: float = (
            similarity_threshold
            if similarity_threshold is not None
            else settings.semantic_cache_similarity_threshold
        )
        self._max_entries: int = (
            max_l2_entries
            if max_l2_entries is not None
            else settings.semantic_cache_max_l2_entries
        )
        logger.info(
            "SemanticCache ready | ttl=%ds | threshold=%.2f | max_l2=%d",
            self._ttl,
            self._threshold,
            self._max_entries,
        )

    # ── L1: Exact match ───────────────────────────────────────────────────────

    async def l1_lookup(
        self,
        query: str,
        case_id: Optional[str],
        bureau_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Exact query lookup.

        Returns the cached RAGResponse dict if the (query, case_id, bureau_id)
        triplet was previously stored, else None.

        Cost: 1 Redis GET  →  $0.
        Latency: ~0.2 ms (Redis local) / ~1 ms (Redis cloud).
        """
        key = build_l1_key(query, case_id, bureau_id)
        try:
            value = await self._redis.get(key)
            if value:
                logger.info("CACHE_HIT L1 | key_suffix=…%s", key[-8:])
                return value
        except Exception as exc:
            logger.warning("L1 lookup error (non-fatal): %s", exc)
        return None

    # ── L2: Semantic similarity ───────────────────────────────────────────────

    async def l2_lookup(
        self,
        embedding: List[float],
        case_id: Optional[str],
        bureau_id: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], float]:
        """
        Semantic similarity lookup.

        Scans at most `max_l2_entries` stored embeddings and returns the
        best-matching response if its cosine similarity exceeds the threshold.

        Args:
            embedding:  Query embedding vector (must be non-zero for L2 to fire).
            case_id:    Scope guard — only matches entries from the same case.
            bureau_id:  Scope guard — only matches entries from the same bureau.

        Returns:
            (response_dict, best_score) on hit, (None, 0.0) on miss or error.

        Cost: 1 lrange + N cosine comparisons  →  $0.
        """
        if not self._redis.client:
            return None, 0.0

        # Guard: zero vector from stub _embed_query → L2 would always miss
        if all(v == 0.0 for v in embedding):
            logger.debug("L2 skipped: zero embedding vector (stub mode)")
            return None, 0.0

        try:
            l2_keys: List[str] = await self._redis.client.lrange(
                _L2_INDEX, 0, self._max_entries - 1
            )
        except Exception as exc:
            logger.warning("L2 index fetch error (non-fatal): %s", exc)
            return None, 0.0

        best_score = 0.0
        best_response: Optional[Dict[str, Any]] = None

        for key in l2_keys:
            try:
                entry = await self._redis.get(key)
                if not entry:
                    continue

                # Scope guard: don't mix case-scoped and global queries, or bureaus
                if entry.get("case_id") != case_id:
                    continue
                if entry.get("bureau_id") != bureau_id:
                    continue

                stored_emb: List[float] = entry.get("embedding", [])
                if not stored_emb:
                    continue

                score = cosine_similarity(embedding, stored_emb)
                if score > best_score:
                    best_score = score
                    best_response = entry.get("response")

            except Exception as exc:
                logger.debug("L2 entry scan error on key %r (skipping): %s", key, exc)
                continue

        if best_score >= self._threshold and best_response is not None:
            logger.info(
                "CACHE_HIT L2 | similarity=%.4f | threshold=%.2f",
                best_score,
                self._threshold,
            )
            return best_response, best_score

        logger.debug(
            "CACHE_MISS L2 | best_score=%.4f | threshold=%.2f | scanned=%d",
            best_score,
            self._threshold,
            len(l2_keys),
        )
        return None, best_score

    # ── Store ─────────────────────────────────────────────────────────────────

    async def store(
        self,
        query: str,
        embedding: List[float],
        case_id: Optional[str],
        response: Dict[str, Any],
        bureau_id: Optional[str] = None,
    ) -> None:
        """
        Persists a query+response pair in both L1 and L2.

        L1: exact-match key → response dict
        L2: uuid key → {embedding, response, query, case_id, bureau_id, cached_at}
            + prepend key to L2 index list (capped at max_l2_entries)

        Non-fatal: failures are logged but never raised so the caller
        always receives a successful RAGResponse.
        """
        # ── L1 ────────────────────────────────────────────────────────────────
        try:
            l1_key = build_l1_key(query, case_id, bureau_id)
            await self._redis.set(l1_key, response, ttl=self._ttl)
            logger.debug("CACHE_STORE L1 | key_suffix=…%s", l1_key[-8:])
        except Exception as exc:
            logger.warning("L1 store error (non-fatal): %s", exc)

        # ── L2 ────────────────────────────────────────────────────────────────
        if not self._redis.client:
            return

        # Skip L2 for zero embeddings (stub mode) — pointless to store
        if all(v == 0.0 for v in embedding):
            return

        try:
            l2_key = _L2_PREFIX + str(uuid.uuid4())
            entry: Dict[str, Any] = {
                "embedding": embedding,
                "response": response,
                "query": query,
                "case_id": case_id,
                "bureau_id": bureau_id,
                "cached_at": datetime.now(tz=timezone.utc).isoformat(),
            }
            await self._redis.set(l2_key, entry, ttl=self._ttl)

            # Prepend to index list and cap its length
            await self._redis.client.lpush(_L2_INDEX, l2_key)
            await self._redis.client.ltrim(_L2_INDEX, 0, self._max_entries - 1)
            await self._redis.client.expire(_L2_INDEX, self._ttl)

            logger.debug("CACHE_STORE L2 | key_suffix=…%s", l2_key[-8:])
        except Exception as exc:
            logger.warning("L2 store error (non-fatal): %s", exc)

    # ── Cache invalidation ────────────────────────────────────────────────────

    async def invalidate_case(self, case_id: str) -> int:
        """
        Removes all L2 cache entries scoped to `case_id`.

        Call this from the ingest pipeline whenever new documents arrive for
        a case so stale answers are not served from cache.

        Returns:
            Number of L2 entries removed (0 on error or if none matched).
        """
        if not self._redis.client:
            return 0

        removed = 0
        try:
            l2_keys: List[str] = await self._redis.client.lrange(_L2_INDEX, 0, -1)
            for key in l2_keys:
                entry = await self._redis.get(key)
                if entry and entry.get("case_id") == case_id:
                    await self._redis.delete(key)
                    # Remove from index list so future scans skip this key
                    await self._redis.client.lrem(_L2_INDEX, 0, key)
                    removed += 1

            logger.info(
                "CACHE_INVALIDATE | case_id=%s | removed=%d entries",
                case_id,
                removed,
            )
        except Exception as exc:
            logger.warning("Cache invalidation error (non-fatal): %s", exc)

        return removed
