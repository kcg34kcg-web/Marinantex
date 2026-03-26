"""Embedding fail-open governance policy."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingFailOpenDecision:
    allowed: bool
    reason: str


def decide_embedding_fail_open(
    *,
    fail_open_enabled: bool,
    mode: str,
    requested_tier: int,
    max_tier: int,
    allow_ingest: bool,
    allow_query: bool,
) -> EmbeddingFailOpenDecision:
    if not fail_open_enabled:
        return EmbeddingFailOpenDecision(allowed=False, reason="fail_open_disabled")
    if requested_tier > max(1, int(max_tier)):
        return EmbeddingFailOpenDecision(allowed=False, reason="tier_exceeds_fail_open_max")
    mode_token = (mode or "").strip().lower()
    if mode_token == "ingest" and not allow_ingest:
        return EmbeddingFailOpenDecision(allowed=False, reason="ingest_fail_open_disabled")
    if mode_token == "query" and not allow_query:
        return EmbeddingFailOpenDecision(allowed=False, reason="query_fail_open_disabled")
    return EmbeddingFailOpenDecision(allowed=True, reason="allowed")

