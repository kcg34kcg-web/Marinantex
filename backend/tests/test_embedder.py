"""
Tests for Step 6 — Query Embedder
===================================
All tests use unittest.mock — no real OpenAI API calls are made.
The OpenAI client is patched at the AsyncOpenAI level so tests run
offline ($0 cost) and deterministically.

Coverage:
    - Pure helpers: is_zero_vector, l2_norm, assert_dimensions
    - embed_query: success path, zero-vector guard, dimension guard,
                   empty query guard
    - _embed_with_retry: RateLimitError back-off, 5xx retry,
                         4xx no-retry, retries-exhausted
    - embed_texts: batch splitting, empty input, zero-vector warning
    - Config integration: model/dimensions read from settings
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException

from infrastructure.embeddings.embedder import (
    EmbeddingError,
    QueryEmbedder,
    assert_dimensions,
    is_zero_vector,
    l2_norm,
)
from infrastructure.config import settings


# ============================================================================
# Helpers / Fixtures
# ============================================================================

def _make_embedding_response(vectors: list[list[float]]) -> MagicMock:
    """Build a mock that looks like openai.types.CreateEmbeddingResponse."""
    response = MagicMock()
    response.data = [
        MagicMock(embedding=vec, index=i) for i, vec in enumerate(vectors)
    ]
    return response


def _make_embedder(
    *,
    model: str = "text-embedding-3-small",
    dimensions: int = 1536,
    max_retries: int = 3,
    retry_base_delay: float = 0.0,  # zero delay in tests
    batch_size: int = 512,
) -> QueryEmbedder:
    """Creates a QueryEmbedder with test-safe settings (no real API key needed)."""
    with patch("infrastructure.embeddings.embedder.settings") as mock_settings:
        mock_settings.openai_api_key = "sk-test-key"
        mock_settings.embedding_model = model
        mock_settings.embedding_dimensions = dimensions
        mock_settings.embedding_batch_size = batch_size
        mock_settings.embedding_max_retries = max_retries
        mock_settings.embedding_retry_base_delay_s = retry_base_delay
        mock_settings.embedding_quota_cooldown_s = 120
        return QueryEmbedder()


VALID_VECTOR = [0.1] * 1536


# ============================================================================
# Pure helper tests
# ============================================================================

class TestIsZeroVector:
    def test_all_zeros_detected(self) -> None:
        assert is_zero_vector([0.0] * 1536) is True

    def test_near_zero_detected(self) -> None:
        assert is_zero_vector([1e-10] * 10) is True

    def test_nonzero_not_detected(self) -> None:
        assert is_zero_vector([0.0, 0.0, 0.1]) is False

    def test_single_nonzero_component_passes(self) -> None:
        vec = [0.0] * 100
        vec[42] = 0.5
        assert is_zero_vector(vec) is False

    def test_empty_vector_is_zero(self) -> None:
        # Edge case: empty list treated as zero (vacuously true)
        assert is_zero_vector([]) is True


class TestL2Norm:
    def test_unit_vector(self) -> None:
        vec = [1.0, 0.0, 0.0]
        assert abs(l2_norm(vec) - 1.0) < 1e-9

    def test_pythagorean(self) -> None:
        # 3-4-5 right triangle
        assert abs(l2_norm([3.0, 4.0]) - 5.0) < 1e-9

    def test_zero_vector_norm_is_zero(self) -> None:
        assert l2_norm([0.0, 0.0, 0.0]) == 0.0


class TestAssertDimensions:
    def test_correct_dimensions_does_not_raise(self) -> None:
        assert_dimensions([0.1] * 1536, 1536)  # no exception

    def test_wrong_dimensions_raises_embedding_error(self) -> None:
        with pytest.raises(EmbeddingError, match="dimension mismatch"):
            assert_dimensions([0.1] * 768, 1536)

    def test_empty_vector_raises_on_nonzero_expected(self) -> None:
        with pytest.raises(EmbeddingError):
            assert_dimensions([], 1536)


# ============================================================================
# embed_query — success path
# ============================================================================

class TestEmbedQuerySuccess:
    @pytest.mark.asyncio
    async def test_returns_vector_of_correct_length(self) -> None:
        embedder = _make_embedder()
        mock_response = _make_embedding_response([VALID_VECTOR])

        with patch.object(
            embedder._client.embeddings, "create", new=AsyncMock(return_value=mock_response)
        ):
            result = await embedder.embed_query("ihbar tazminatı nedir?")

        assert len(result) == 1536

    @pytest.mark.asyncio
    async def test_calls_openai_with_correct_model(self) -> None:
        embedder = _make_embedder(model="text-embedding-3-small", dimensions=1536)
        mock_response = _make_embedding_response([VALID_VECTOR])
        mock_create = AsyncMock(return_value=mock_response)

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            await embedder.embed_query("test query")

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["model"] == "text-embedding-3-small"
        assert call_kwargs["dimensions"] == 1536

    @pytest.mark.asyncio
    async def test_returns_exact_vector_values(self) -> None:
        expected = [float(i) / 1536 for i in range(1536)]
        embedder = _make_embedder()
        mock_response = _make_embedding_response([expected])

        with patch.object(
            embedder._client.embeddings, "create", new=AsyncMock(return_value=mock_response)
        ):
            result = await embedder.embed_query("query")

        assert result == expected


# ============================================================================
# embed_query — guards
# ============================================================================

class TestEmbedQueryGuards:
    @pytest.mark.asyncio
    async def test_empty_query_raises_http_400(self) -> None:
        embedder = _make_embedder()
        with pytest.raises(HTTPException) as exc_info:
            await embedder.embed_query("")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["error"] == "EMBED_EMPTY_QUERY"

    @pytest.mark.asyncio
    async def test_whitespace_query_raises_http_400(self) -> None:
        embedder = _make_embedder()
        with pytest.raises(HTTPException) as exc_info:
            await embedder.embed_query("   ")
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_zero_vector_response_raises_http_503(self) -> None:
        embedder = _make_embedder()
        zero_response = _make_embedding_response([[0.0] * 1536])

        with patch.object(
            embedder._client.embeddings, "create", new=AsyncMock(return_value=zero_response)
        ):
            with pytest.raises(HTTPException) as exc_info:
                await embedder.embed_query("valid query")
        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["error"] == "EMBEDDING_ZERO_VECTOR"

    @pytest.mark.asyncio
    async def test_wrong_dimension_response_raises_embedding_error(self) -> None:
        embedder = _make_embedder(dimensions=1536)
        wrong_dim_response = _make_embedding_response([[0.1] * 768])  # wrong dims

        with patch.object(
            embedder._client.embeddings, "create", new=AsyncMock(return_value=wrong_dim_response)
        ):
            with pytest.raises(EmbeddingError, match="dimension mismatch"):
                await embedder.embed_query("query")


# ============================================================================
# _embed_with_retry — retry behaviour
# ============================================================================

class TestEmbedRetry:
    @pytest.mark.asyncio
    async def test_rate_limit_retries_then_succeeds(self) -> None:
        from openai import RateLimitError

        embedder = _make_embedder(max_retries=3, retry_base_delay=0.0)
        mock_response = _make_embedding_response([VALID_VECTOR])

        # Fail twice, succeed on 3rd attempt
        side_effects = [
            RateLimitError("rate limited", response=MagicMock(status_code=429), body={}),
            RateLimitError("rate limited", response=MagicMock(status_code=429), body={}),
            mock_response,
        ]
        mock_create = AsyncMock(side_effect=side_effects)

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            result = await embedder._embed_with_retry(["query"])

        assert mock_create.call_count == 3
        assert result[0] == VALID_VECTOR

    @pytest.mark.asyncio
    async def test_retries_exhausted_raises_http_503(self) -> None:
        from openai import RateLimitError

        embedder = _make_embedder(max_retries=2, retry_base_delay=0.0)

        always_fail = AsyncMock(
            side_effect=RateLimitError(
                "rate limited", response=MagicMock(status_code=429), body={}
            )
        )

        with patch.object(embedder._client.embeddings, "create", new=always_fail):
            with pytest.raises(HTTPException) as exc_info:
                await embedder._embed_with_retry(["query"])

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["error"] == "EMBEDDING_RETRIES_EXHAUSTED"
        assert always_fail.call_count == 2

    @pytest.mark.asyncio
    async def test_client_4xx_error_not_retried(self) -> None:
        from openai import APIError

        embedder = _make_embedder(max_retries=3, retry_base_delay=0.0)

        client_error = APIError(
            message="invalid input",
            request=MagicMock(),
            body={"error": {"message": "invalid input"}},
        )
        # Manually set status_code on the error
        client_error.status_code = 400
        mock_create = AsyncMock(side_effect=client_error)

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            with pytest.raises(HTTPException) as exc_info:
                await embedder._embed_with_retry(["query"])

        # Should NOT retry 4xx — called only once
        assert mock_create.call_count == 1
        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["error"] == "EMBEDDING_CLIENT_ERROR"

    @pytest.mark.asyncio
    async def test_insufficient_quota_fails_fast_without_retry(self) -> None:
        from openai import RateLimitError

        embedder = _make_embedder(max_retries=3, retry_base_delay=0.0)

        quota_err = RateLimitError(
            "insufficient_quota",
            response=MagicMock(status_code=429),
            body={"error": {"code": "insufficient_quota", "type": "insufficient_quota"}},
        )
        always_fail = AsyncMock(side_effect=quota_err)

        with patch.object(embedder._client.embeddings, "create", new=always_fail):
            with pytest.raises(HTTPException) as exc_info:
                await embedder._embed_with_retry(["query"])

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail["error"] == "EMBEDDING_QUOTA_EXHAUSTED"
        # No exponential retry loop on hard quota exhaustion.
        assert always_fail.call_count == 1

    @pytest.mark.asyncio
    async def test_quota_cooldown_short_circuits_followup_calls(self) -> None:
        from openai import RateLimitError

        embedder = _make_embedder(max_retries=3, retry_base_delay=0.0)

        quota_err = RateLimitError(
            "insufficient_quota",
            response=MagicMock(status_code=429),
            body={"error": {"code": "insufficient_quota"}},
        )
        mock_create = AsyncMock(side_effect=quota_err)

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            # First call marks cooldown.
            with pytest.raises(HTTPException) as first_exc:
                await embedder._embed_with_retry(["query"])
            assert first_exc.value.detail["error"] == "EMBEDDING_QUOTA_EXHAUSTED"

            # Second call must fail before touching SDK.
            with pytest.raises(HTTPException) as second_exc:
                await embedder._embed_with_retry(["query"])
            assert second_exc.value.detail["error"] == "EMBEDDING_QUOTA_COOLDOWN"
            assert mock_create.call_count == 1


# ============================================================================
# embed_texts — batch embedding
# ============================================================================

class TestEmbedTexts:
    @pytest.mark.asyncio
    async def test_empty_list_returns_empty_list(self) -> None:
        embedder = _make_embedder()
        result = await embedder.embed_texts([])
        assert result == []

    @pytest.mark.asyncio
    async def test_single_batch_returns_correct_count(self) -> None:
        embedder = _make_embedder(batch_size=512)
        texts = ["chunk A", "chunk B", "chunk C"]
        mock_response = _make_embedding_response([VALID_VECTOR] * 3)
        mock_create = AsyncMock(return_value=mock_response)

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            result = await embedder.embed_texts(texts)

        assert len(result) == 3
        assert mock_create.call_count == 1  # fits in one batch

    @pytest.mark.asyncio
    async def test_large_input_split_into_batches(self) -> None:
        embedder = _make_embedder(batch_size=3)
        texts = [f"chunk {i}" for i in range(7)]
        # 7 texts, batch_size=3 → 3 API calls (3+3+1)
        mock_response_3 = _make_embedding_response([VALID_VECTOR] * 3)
        mock_response_1 = _make_embedding_response([VALID_VECTOR] * 1)
        mock_create = AsyncMock(
            side_effect=[mock_response_3, mock_response_3, mock_response_1]
        )

        with patch.object(embedder._client.embeddings, "create", new=mock_create):
            result = await embedder.embed_texts(texts)

        assert len(result) == 7
        assert mock_create.call_count == 3
