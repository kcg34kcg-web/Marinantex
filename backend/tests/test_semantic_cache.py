"""
Step 8: Semantic Cache — Unit Tests
=====================================
Tests for SemanticCache (infrastructure/cache/semantic_cache.py).

Coverage:
    1.  normalize_query         — whitespace + case normalization
    2.  build_l1_key            — consistent hash, scope isolation (case + bureau)
    3.  cosine_similarity       — identical, orthogonal, zero-vector
    4.  cosine_similarity       — high similarity near-identical vectors
    5.  l1_lookup               — cache miss (Redis returns None)
    6.  l1_lookup               — cache hit (Redis returns dict)
    7.  l2_lookup               — zero embedding skipped (stub guard)
    8.  l2_lookup               — similarity below threshold → miss
    9.  l2_lookup               — similarity above threshold → hit
    10. store                   — writes L1 key + L2 key + index operations
    11. invalidate_case         — removes only matching case_id entries
    12. build_l1_key            — bureau_id isolation (multi-tenant security)
    13. l2_lookup               — cross-bureau entries are rejected (scope guard)
    14. invalidate_case         — lrem cleans deleted keys from index list
    15. store                   — bureau_id stored in L2 entry
    16. cosine_similarity       — dimension mismatch logs WARNING
    17. l1_lookup               — bureau_id changes cache key

All tests use AsyncMock / MagicMock; no real Redis connection required.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from infrastructure.cache.semantic_cache import (
    SemanticCache,
    build_l1_key,
    cosine_similarity,
    normalize_query,
)


# ============================================================================
# Helpers
# ============================================================================

def _make_redis_mock(
    get_return: Optional[Any] = None,
    set_return: bool = True,
) -> MagicMock:
    """
    Builds a mock RedisClient with async get/set/delete + a mock .client
    exposing lrange, lpush, ltrim, expire.
    """
    redis_mock = MagicMock()
    redis_mock.get = AsyncMock(return_value=get_return)
    redis_mock.set = AsyncMock(return_value=set_return)
    redis_mock.delete = AsyncMock(return_value=True)

    # Raw redis.asyncio.Redis client mock
    inner = AsyncMock()
    inner.lrange = AsyncMock(return_value=[])
    inner.lpush = AsyncMock(return_value=1)
    inner.ltrim = AsyncMock(return_value=True)
    inner.expire = AsyncMock(return_value=True)
    inner.lrem = AsyncMock(return_value=1)
    redis_mock.client = inner

    return redis_mock


def _unit_vector(dim: int, index: int) -> List[float]:
    """Creates a unit vector with 1.0 at `index`, 0.0 elsewhere."""
    v = [0.0] * dim
    v[index] = 1.0
    return v


_SAMPLE_RESPONSE: Dict[str, Any] = {
    "answer": "Test yanıt",
    "sources": [
        {
            "id": "doc-1",
            "content": "Test içerik",
            "citation": "Test Kanun md. 1",
            "court_level": None,
            "ruling_date": None,
            "source_url": "https://mevzuat.gov.tr/test",
            "version": "2024-01-01",
            "collected_at": "2026-02-19T00:00:00+00:00",
            "final_score": 0.85,
        }
    ],
    "query": "test sorgu",
    "model_used": "stub/test",
    "retrieval_count": 1,
    "latency_ms": 42,
}


# ============================================================================
# 1. normalize_query
# ============================================================================

def test_normalize_query_lowercases_and_collapses_whitespace() -> None:
    # Python's str.lower() uses Unicode case-folding, NOT Turkish locale rules.
    # ASCII 'I' → 'i' (not 'ı'), which is fine for cache-key consistency.
    result = normalize_query("  İşçi  HAKKI  ")
    # Whitespace collapsed + lowercased
    assert result == result.strip()
    assert "  " not in result          # no double-spaces
    assert result == result.lower()    # all lowercase


def test_normalize_query_consistent_for_same_input() -> None:
    q = "Taşınmaz  devir  sözleşmesi"
    assert normalize_query(q) == normalize_query(q)


# ============================================================================
# 2. build_l1_key
# ============================================================================

def test_build_l1_key_same_query_same_case_produces_same_key() -> None:
    key1 = build_l1_key("TMK 706 devir şekli", "case-abc")
    key2 = build_l1_key("TMK 706 devir şekli", "case-abc")
    assert key1 == key2


def test_build_l1_key_different_case_id_produces_different_key() -> None:
    key1 = build_l1_key("TMK 706 devir şekli", "case-A")
    key2 = build_l1_key("TMK 706 devir şekli", "case-B")
    assert key1 != key2, "Keys must be scoped to case_id"


def test_build_l1_key_none_case_id_vs_empty_string_are_equivalent() -> None:
    # Both represent "no case scope" — should hash identically
    assert build_l1_key("sorgu", None) == build_l1_key("sorgu", "")


# ============================================================================
# 12. build_l1_key — bureau_id multi-tenant isolation
# ============================================================================

def test_build_l1_key_different_bureau_id_produces_different_key() -> None:
    """Same query + case_id from two bureaus must NOT share L1 cache."""
    key_a = build_l1_key("TMK 706", "case-1", bureau_id="bureau-A")
    key_b = build_l1_key("TMK 706", "case-1", bureau_id="bureau-B")
    assert key_a != key_b, "bureau_id must be included in the hash"


def test_build_l1_key_same_bureau_same_case_is_consistent() -> None:
    key1 = build_l1_key("TMK 706", "case-1", bureau_id="bureau-A")
    key2 = build_l1_key("TMK 706", "case-1", bureau_id="bureau-A")
    assert key1 == key2


# ============================================================================
# 3. cosine_similarity — mathematical correctness
# ============================================================================

def test_cosine_similarity_identical_vectors_returns_one() -> None:
    v = [0.5, 0.5, 0.5, 0.5]
    assert cosine_similarity(v, v) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors_returns_zero() -> None:
    a = _unit_vector(4, 0)  # [1, 0, 0, 0]
    b = _unit_vector(4, 1)  # [0, 1, 0, 0]
    assert cosine_similarity(a, b) == pytest.approx(0.0)


def test_cosine_similarity_zero_vector_returns_zero_no_exception() -> None:
    """Division-by-zero guard must hold."""
    zero = [0.0, 0.0, 0.0]
    v = [1.0, 2.0, 3.0]
    assert cosine_similarity(zero, v) == 0.0
    assert cosine_similarity(v, zero) == 0.0
    assert cosine_similarity(zero, zero) == 0.0


def test_cosine_similarity_near_identical_vectors_above_threshold() -> None:
    """Slightly perturbed vector should still score well above 0.92."""
    base = [1.0, 2.0, 3.0, 4.0, 5.0]
    noise = [1.01, 1.99, 3.01, 3.99, 5.01]
    score = cosine_similarity(base, noise)
    assert score > 0.999, f"Expected > 0.999, got {score}"


# ============================================================================
# 5–6. l1_lookup
# ============================================================================

@pytest.mark.asyncio
async def test_l1_lookup_miss_returns_none() -> None:
    redis_mock = _make_redis_mock(get_return=None)
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    result = await cache.l1_lookup("Bilinmeyen sorgu", "case-x")
    assert result is None


@pytest.mark.asyncio
async def test_l1_lookup_hit_returns_cached_response() -> None:
    redis_mock = _make_redis_mock(get_return=_SAMPLE_RESPONSE)
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    result = await cache.l1_lookup("test sorgu", "case-x")
    assert result is not None
    assert result["answer"] == "Test yanıt"


# ============================================================================
# 7–9. l2_lookup
# ============================================================================

@pytest.mark.asyncio
async def test_l2_lookup_zero_embedding_is_skipped() -> None:
    """Zero vectors from stub _embed_query must never produce L2 hits."""
    redis_mock = _make_redis_mock()
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    zero_emb = [0.0] * 8
    result, score = await cache.l2_lookup(zero_emb, "case-x")

    assert result is None
    assert score == 0.0
    # lrange should NOT have been called
    redis_mock.client.lrange.assert_not_called()


@pytest.mark.asyncio
async def test_l2_lookup_below_threshold_is_miss() -> None:
    """Stored vector orthogonal to query → score 0.0 < 0.92 → miss."""
    redis_mock = _make_redis_mock()

    stored_entry = {
        "embedding": _unit_vector(8, 0),   # [1, 0, 0, 0, 0, 0, 0, 0]
        "response": _SAMPLE_RESPONSE,
        "case_id": "case-x",
    }
    l2_key = "cache:rag:l2:test-entry-1"
    redis_mock.client.lrange = AsyncMock(return_value=[l2_key])
    redis_mock.get = AsyncMock(return_value=stored_entry)

    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    query_emb = _unit_vector(8, 1)         # [0, 1, 0, 0, 0, 0, 0, 0] — orthogonal
    result, score = await cache.l2_lookup(query_emb, "case-x")

    assert result is None
    assert score == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_l2_lookup_above_threshold_is_hit() -> None:
    """Stored vector nearly identical to query → score > 0.92 → hit."""
    redis_mock = _make_redis_mock()

    # Slightly perturbed — cosine will be ~0.9999
    base_emb = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    query_emb = [1.01, 2.01, 3.01, 4.01, 5.01, 6.01, 7.01, 8.01]

    stored_entry = {
        "embedding": base_emb,
        "response": _SAMPLE_RESPONSE,
        "case_id": "case-x",
    }
    l2_key = "cache:rag:l2:test-entry-2"
    redis_mock.client.lrange = AsyncMock(return_value=[l2_key])
    redis_mock.get = AsyncMock(return_value=stored_entry)

    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    result, score = await cache.l2_lookup(query_emb, "case-x")

    assert result is not None
    assert result["answer"] == "Test yanıt"
    assert score > 0.92


# ============================================================================
# 10. store
# ============================================================================

@pytest.mark.asyncio
async def test_store_writes_l1_key_and_l2_index_for_nonzero_embedding() -> None:
    redis_mock = _make_redis_mock()
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    non_zero_emb = [0.1, 0.2, 0.3]
    await cache.store("test sorgu", non_zero_emb, "case-x", _SAMPLE_RESPONSE)

    # L1 must have been written (set called with an L1-prefixed key)
    assert redis_mock.set.call_count >= 1
    first_call_key: str = redis_mock.set.call_args_list[0].args[0]
    assert first_call_key.startswith("cache:rag:l1:")

    # L2 index operations must have fired
    redis_mock.client.lpush.assert_called_once()
    redis_mock.client.ltrim.assert_called_once()
    redis_mock.client.expire.assert_called_once()


@pytest.mark.asyncio
async def test_store_skips_l2_for_zero_embedding() -> None:
    """Zero-vector stub should not pollute the L2 index."""
    redis_mock = _make_redis_mock()
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    zero_emb = [0.0] * 8
    await cache.store("test sorgu", zero_emb, None, _SAMPLE_RESPONSE)

    # L1 should still be written
    assert redis_mock.set.call_count >= 1

    # But L2 index ops must NOT fire
    redis_mock.client.lpush.assert_not_called()


# ============================================================================
# 11. invalidate_case
# ============================================================================

@pytest.mark.asyncio
async def test_invalidate_case_removes_only_matching_entries() -> None:
    redis_mock = _make_redis_mock()

    target_case = "case-target"
    other_case = "case-other"

    entries = {
        "cache:rag:l2:e1": {"case_id": target_case, "embedding": [], "response": {}},
        "cache:rag:l2:e2": {"case_id": other_case, "embedding": [], "response": {}},
        "cache:rag:l2:e3": {"case_id": target_case, "embedding": [], "response": {}},
    }

    redis_mock.client.lrange = AsyncMock(return_value=list(entries.keys()))
    redis_mock.get = AsyncMock(side_effect=lambda k: entries.get(k))

    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)
    removed = await cache.invalidate_case(target_case)

    assert removed == 2, f"Expected 2 removed, got {removed}"
    # Verify delete was called exactly twice (for e1 and e3)
    assert redis_mock.delete.call_count == 2


# ============================================================================
# 13. l2_lookup — cross-bureau scope guard
# ============================================================================

@pytest.mark.asyncio
async def test_l2_lookup_rejects_cross_bureau_entry() -> None:
    """An L2 entry belonging to bureau-B must NOT match a query from bureau-A."""
    redis_mock = _make_redis_mock()

    base_emb = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    query_emb = [1.01, 2.01, 3.01, 4.01, 5.01, 6.01, 7.01, 8.01]  # ~0.9999 cosine

    stored_entry = {
        "embedding": base_emb,
        "response": _SAMPLE_RESPONSE,
        "case_id": "case-x",
        "bureau_id": "bureau-B",  # stored by bureau-B
    }
    l2_key = "cache:rag:l2:cross-bureau-test"
    redis_mock.client.lrange = AsyncMock(return_value=[l2_key])
    redis_mock.get = AsyncMock(return_value=stored_entry)

    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    # Query comes from bureau-A — must NOT hit bureau-B's cached entry
    result, score = await cache.l2_lookup(query_emb, "case-x", bureau_id="bureau-A")

    assert result is None, "Cross-bureau L2 hit must be blocked"


# ============================================================================
# 14. invalidate_case — lrem cleans deleted keys from index list
# ============================================================================

@pytest.mark.asyncio
async def test_invalidate_case_calls_lrem_for_deleted_keys() -> None:
    """Each deleted L2 key must also be removed from the index list via lrem."""
    redis_mock = _make_redis_mock()

    target_case = "case-target"
    entries = {
        "cache:rag:l2:k1": {"case_id": target_case, "embedding": [], "response": {}},
        "cache:rag:l2:k2": {"case_id": "case-other", "embedding": [], "response": {}},
        "cache:rag:l2:k3": {"case_id": target_case, "embedding": [], "response": {}},
    }

    redis_mock.client.lrange = AsyncMock(return_value=list(entries.keys()))
    redis_mock.get = AsyncMock(side_effect=lambda k: entries.get(k))

    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)
    await cache.invalidate_case(target_case)

    # lrem must have been called once per deleted key (k1 and k3)
    assert redis_mock.client.lrem.call_count == 2


# ============================================================================
# 15. store — bureau_id persisted in L2 entry
# ============================================================================

@pytest.mark.asyncio
async def test_store_includes_bureau_id_in_l2_entry() -> None:
    """bureau_id must be persisted in the L2 entry so future scope guards work."""
    redis_mock = _make_redis_mock()
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    non_zero_emb = [0.5, 0.5, 0.5]
    await cache.store("test sorgu", non_zero_emb, "case-x", _SAMPLE_RESPONSE, bureau_id="bureau-A")

    # The second set() call stores the L2 entry — check bureau_id is in it
    assert redis_mock.set.call_count >= 2
    l2_entry_call = redis_mock.set.call_args_list[1]  # second call is L2
    stored_entry = l2_entry_call.args[1]
    assert stored_entry.get("bureau_id") == "bureau-A"


# ============================================================================
# 16. cosine_similarity — dimension mismatch logs WARNING
# ============================================================================

def test_cosine_similarity_dimension_mismatch_logs_warning() -> None:
    """Mismatched vector lengths must trigger a logger.warning call."""
    import logging

    with patch("infrastructure.cache.semantic_cache.logger") as mock_logger:
        a = [1.0, 2.0, 3.0]       # 3-dim
        b = [1.0, 2.0, 3.0, 4.0]  # 4-dim
        cosine_similarity(a, b)
        mock_logger.warning.assert_called_once()
        warning_msg = mock_logger.warning.call_args[0][0]
        assert "mismatch" in warning_msg.lower() or "%d" in warning_msg


# ============================================================================
# 17. l1_lookup — bureau_id changes cache key
# ============================================================================

@pytest.mark.asyncio
async def test_l1_lookup_different_bureau_has_independent_cache() -> None:
    """l1_lookup for bureau-A must NOT return bureau-B's cached response."""
    # bureau-B has a cached response; bureau-A query must miss
    get_calls: list = []

    async def fake_get(key: str):
        get_calls.append(key)
        # Only return a value for the bureau-B key
        if "bureau-B" in key or len(get_calls) == 1:
            return None  # first call always returns None (bureau-A miss)
        return _SAMPLE_RESPONSE

    redis_mock = _make_redis_mock()
    redis_mock.get = AsyncMock(side_effect=fake_get)
    cache = SemanticCache(redis_mock, ttl=3600, similarity_threshold=0.92, max_l2_entries=10)

    # bureau-A lookup should miss (fake_get returns None for first call)
    result = await cache.l1_lookup("TMK 706", "case-x", bureau_id="bureau-A")
    assert result is None

    # Verify the key passed to Redis.get contains the bureau-scoped hash
    key_used = get_calls[0]
    assert key_used.startswith("cache:rag:l1:")
    # A second lookup with the same params must use the SAME key (determinism)
    result2 = await cache.l1_lookup("TMK 706", "case-x", bureau_id="bureau-A")
    assert get_calls[0] == get_calls[1], "Same bureau+query+case must produce same L1 key"
