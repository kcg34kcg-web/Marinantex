"""
Cost Tracker  —  Step 17
=========================
Estimates per-request LLM cost from token counts and model-specific pricing.

Model rates (USD per 1 Million tokens, input / output):
    Groq  llama-3.3-70b-versatile    :  $0.59  /  $0.79
    OpenAI gpt-4o-mini               :  $0.15  /  $0.60
    OpenAI gpt-4o                    :  $2.50  / $10.00
    OpenAI o3-mini  (reasoning)      :  $1.10  /  $4.40
    OpenAI o1-mini  (reasoning)      :  $3.00  / $12.00
    OpenAI o1       (reasoning)      : $15.00  / $60.00
    Anthropic claude-3-5-sonnet-*    :  $3.00  / $15.00
    _default (unknown model)         :  $2.50  / $10.00   (conservative)

Design:
  - `estimate_cost()` is a PURE function — same inputs → same output, no state.
  - `CostEstimate` is a frozen dataclass — immutable, hashable, log-safe.
  - `CostTracker` is an injectable wrapper that maintains a session-level
    cumulative total for the cost dashboard.
  - Token count uses the same "1 token ≈ 4 chars" heuristic as tiered_router
    to avoid pulling in tiktoken as a cost-estimation dependency.
  - Cache hits produce a zero-cost CostEstimate (cached=True, total=0.0).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

logger = logging.getLogger("babylexit.cost_tracker")


# ---------------------------------------------------------------------------
# Pricing table  (input_usd_per_1m, output_usd_per_1m)
# ---------------------------------------------------------------------------

_MODEL_RATES: Dict[str, Tuple[float, float]] = {
    # Groq
    "llama-3.3-70b-versatile": (0.59, 0.79),
    # OpenAI — standard chat models
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-2024-11-20": (2.50, 10.00),
    "gpt-4o-2024-08-06": (2.50, 10.00),
    # OpenAI — reasoning models (Gap 2: o1 / o3 family)
    "o3-mini": (1.10, 4.40),       # Best cost/quality for legal analysis
    "o1-mini": (3.00, 12.00),      # Fast reasoning
    "o1": (15.00, 60.00),          # Maximum reasoning depth
    "o1-preview": (15.00, 60.00),  # o1-preview (same rate as o1)
    # Anthropic
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "claude-3-5-sonnet-20240620": (3.00, 15.00),
    "claude-3-opus-20240229": (15.00, 75.00),
    # Conservative fallback for unlisted models
    "_default": (2.50, 10.00),
}

# Rough per-tier cost (USD) used only for logging context
_TIER_EXPECTED_COST: Dict[int, float] = {1: 0.001, 2: 0.010, 3: 0.060, 4: 0.500}


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------

def _estimate_tokens(text: str) -> int:
    """1 token ≈ 4 characters (matches tiered_router heuristic). Pure."""
    return max(1, len(text) // 4)


def _strip_model_prefix(model_id: str) -> str:
    """
    Strips provider prefix and fallback suffix from a model label.

    Examples:
        "openai/gpt-4o-mini"          →  "gpt-4o-mini"
        "groq/llama-3.3-70b-versatile+fallback"  →  "llama-3.3-70b-versatile"
    """
    bare = model_id.split("/")[-1]   # strip "provider/"
    bare = bare.split("+")[0]        # strip "+fallback"
    return bare


# ---------------------------------------------------------------------------
# Data class
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CostEstimate:
    """
    Immutable cost estimate for a single RAG request.

    Attributes:
        input_tokens    : Estimated tokens sent to the LLM (query + context).
        output_tokens   : Estimated tokens in the LLM's answer.
        total_cost_usd  : Estimated total cost in USD (rounded to 6 d.p.).
        model_id        : Full model label used for cost attribution.
        tier            : LLM query tier (1–4).
        cached          : True when the response was served from semantic cache
                          (cost = $0.00, tokens = 0).
        rate_per_1m_in  : Input token rate applied (USD per 1M tokens).
        rate_per_1m_out : Output token rate applied (USD per 1M tokens).
    """

    input_tokens: int
    output_tokens: int
    total_cost_usd: float
    model_id: str
    tier: int
    cached: bool = False
    rate_per_1m_in: float = 0.0
    rate_per_1m_out: float = 0.0


# ---------------------------------------------------------------------------
# Pure estimation function
# ---------------------------------------------------------------------------

def estimate_cost(
    model_id: str,
    tier: int,
    query: str,
    context: str,
    answer: str,
    cached: bool = False,
) -> CostEstimate:
    """
    Estimates LLM cost for a single RAG request.

    Args:
        model_id : Full model label (e.g. "openai/gpt-4o-mini").
        tier     : LLM query tier 1–4.
        query    : User query string.
        context  : Assembled numbered context block sent to the LLM.
        answer   : LLM-generated answer string.
        cached   : True when the response was served from cache (cost = $0).

    Returns:
        CostEstimate — immutable frozen dataclass.
    """
    if cached:
        return CostEstimate(
            input_tokens=0,
            output_tokens=0,
            total_cost_usd=0.0,
            model_id=model_id or "_cached",
            tier=tier,
            cached=True,
            rate_per_1m_in=0.0,
            rate_per_1m_out=0.0,
        )

    input_tokens = _estimate_tokens(query) + _estimate_tokens(context)
    output_tokens = _estimate_tokens(answer)

    bare = _strip_model_prefix(model_id)
    rate_in, rate_out = _MODEL_RATES.get(bare, _MODEL_RATES["_default"])

    total = (
        input_tokens  * rate_in  / 1_000_000
        + output_tokens * rate_out / 1_000_000
    )

    logger.debug(
        "COST_ESTIMATE | model=%s | tier=%d | in_tok=%d | out_tok=%d | cost=$%.6f",
        bare,
        tier,
        input_tokens,
        output_tokens,
        total,
    )

    return CostEstimate(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_cost_usd=round(total, 6),
        model_id=model_id,
        tier=tier,
        cached=False,
        rate_per_1m_in=rate_in,
        rate_per_1m_out=rate_out,
    )


# ---------------------------------------------------------------------------
# Injectable wrapper  (session-level cost dashboard)
# ---------------------------------------------------------------------------

class CostTracker:
    """
    Injectable wrapper around `estimate_cost()`.

    Maintains a session-level cumulative total so the cost dashboard can
    report "total spend since server start" without a database query.

    Thread-safety: float addition under CPython's GIL is safe.
                   For multi-process deployments, use Redis INCRBYFLOAT.

    Usage:
        est = cost_tracker.estimate(model_id, tier, query, context, answer)
        print(cost_tracker.session_total_usd)
    """

    def __init__(self) -> None:
        self._session_total_usd: float = 0.0
        self._session_request_count: int = 0

    def estimate(
        self,
        model_id: str,
        tier: int,
        query: str,
        context: str,
        answer: str,
        cached: bool = False,
    ) -> CostEstimate:
        """
        Delegates to `estimate_cost()` and accumulates the session total.

        Returns:
            CostEstimate — immutable frozen dataclass.
        """
        est = estimate_cost(model_id, tier, query, context, answer, cached)
        self._session_total_usd += est.total_cost_usd
        self._session_request_count += 1

        if not cached:
            logger.info(
                "COST | tier=%d | model=%s | tokens=(%d in + %d out) | "
                "cost=$%.6f | session_total=$%.4f | request_count=%d",
                tier,
                model_id,
                est.input_tokens,
                est.output_tokens,
                est.total_cost_usd,
                self._session_total_usd,
                self._session_request_count,
            )
        else:
            logger.debug(
                "COST_CACHE_HIT | tier=%d | cost=$0.00 | session_total=$%.4f",
                tier,
                self._session_total_usd,
            )

        return est

    @property
    def session_total_usd(self) -> float:
        """Cumulative estimated spend (USD) since server start / last reset."""
        return round(self._session_total_usd, 6)

    @property
    def session_request_count(self) -> int:
        """Total requests processed (including cache hits)."""
        return self._session_request_count

    def reset_session_total(self) -> None:
        """Resets session totals. Useful for tests and periodic reporting."""
        self._session_total_usd = 0.0
        self._session_request_count = 0


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

cost_tracker = CostTracker()
