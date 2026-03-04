"""Admission and SLA guardrails for RAG v3 query path."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from time import monotonic

from infrastructure.config import settings


@dataclass(frozen=True)
class AdmissionDecision:
    accepted: bool
    reason: str
    queue_wait_ms: int
    effective_tier: int
    degraded: bool


class RagV3AdmissionController:
    """
    Controls inflight load and applies deterministic degrade policy.
    """

    def __init__(self) -> None:
        max_inflight = max(1, int(getattr(settings, "rag_v3_max_inflight_requests", 64) or 64))
        self._semaphore = asyncio.Semaphore(max_inflight)
        self._max_query_chars = max(256, int(getattr(settings, "rag_v3_admission_max_query_chars", 4000) or 4000))
        self._max_input_tokens = max(256, int(getattr(settings, "rag_v3_admission_max_input_tokens", 6000) or 6000))
        self._queue_timeout_ms = max(1, int(getattr(settings, "rag_v3_queue_timeout_ms", 1000) or 1000))

    @asynccontextmanager
    async def reserve(self, *, query: str, requested_tier: int):
        decision = await self._admit(query=query, requested_tier=requested_tier)
        if not decision.accepted:
            yield decision
            return
        try:
            yield decision
        finally:
            self._semaphore.release()

    def estimate_token_load(self, *, query: str, context: str) -> int:
        # Cheap approximation used only for admission/degrade heuristics.
        return max(1, int((len(query or "") + len(context or "")) / 4))

    def clamp_requested_tier(self, *, requested_tier: int, estimated_tokens: int) -> tuple[int, bool, str]:
        tier = int(requested_tier if requested_tier in (1, 2, 3, 4) else 2)
        if estimated_tokens <= self._max_input_tokens:
            return tier, False, "none"
        if tier <= 2:
            return tier, True, "context_token_guard_tier_kept"
        return 2, True, "context_token_guard_tier_downgrade"

    async def _admit(self, *, query: str, requested_tier: int) -> AdmissionDecision:
        start = monotonic()
        query_len = len(query or "")
        if query_len > self._max_query_chars:
            return AdmissionDecision(
                accepted=False,
                reason="query_too_large",
                queue_wait_ms=0,
                effective_tier=1,
                degraded=True,
            )

        timeout_s = self._queue_timeout_ms / 1000.0
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=timeout_s)
        except TimeoutError:
            return AdmissionDecision(
                accepted=False,
                reason="queue_timeout",
                queue_wait_ms=int((monotonic() - start) * 1000),
                effective_tier=1,
                degraded=True,
            )

        wait_ms = int((monotonic() - start) * 1000)
        effective_tier = int(requested_tier if requested_tier in (1, 2, 3, 4) else 2)
        degraded = False
        reason = "accepted"
        if wait_ms > (self._queue_timeout_ms // 2) and effective_tier > 2:
            effective_tier = 2
            degraded = True
            reason = "queue_pressure_tier_downgrade"

        return AdmissionDecision(
            accepted=True,
            reason=reason,
            queue_wait_ms=wait_ms,
            effective_tier=effective_tier,
            degraded=degraded,
        )


rag_v3_admission_controller = RagV3AdmissionController()
