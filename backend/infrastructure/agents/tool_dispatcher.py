"""
Tool Dispatcher — Step 14: Agentic Tool Calling (Matematik/Süre Hesabı)
========================================================================
Orchestrates intent detection → deterministic tool execution → context injection.

Architecture:
    1. ToolDispatcher.dispatch(query_text, event_date) is called from RAGService
       for Tier 3/4 queries only (gated by settings.agentic_tools_min_tier).
    2. LegalDeadlineEngine.detect_tools() scans the query for deadline keywords.
    3. For each matched tool, LegalDeadlineEngine.calculate() runs the arithmetic.
    4. Results are formatted as a deterministic tool block and prepended to the
       LLM context so the LLM reads exact dates instead of guessing.

Context Injection Format (stable — downstream prompt parsers depend on this):
    === ARAÇ SONUÇLARI (Deterministik Hesap) ===
    [ARAÇ: IS_AKDI_IHBAR_6AY]
    Hukuki Dayanak : İş Kanunu md. 17/I — 6 ay ≤ kıdem < 18 ay
    Başlangıç Tarihi : 2025-01-15
    Hesaplanan Süre : 28 takvim günü
    Son Gün         : 2025-02-12
    Açıklama        : ...
    ==========================================

Design:
    - ToolDispatcher is STATELESS — safe as a module-level singleton.
    - All calculations are performed synchronously (pure Python, no I/O).
    - On calculation error: logged + skipped (never blocks the pipeline).
    - If no tools match: returns empty string (no injection, pipeline continues).
    - event_date from RAGQueryRequest is used as the start_date for calculations.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import List, Optional

from infrastructure.config import settings
from infrastructure.legal.tools.deadline_engine import (
    DeadlineResult,
    LegalDeadlineEngine,
    legal_deadline_engine,
)
from infrastructure.llm.tiered_router import QueryTier

logger = logging.getLogger("babylexit.agents.tool_dispatcher")


# ============================================================================
# Dispatch result
# ============================================================================


@dataclass
class DispatchResult:
    """
    Result of a ToolDispatcher.dispatch() call.

    Attributes:
        tool_results:       List of successfully computed deadlines.
        context_block:      Formatted string to prepend to the LLM context.
                            Empty string if no tools matched.
        tools_invoked:      Names of tools that were run.
        tools_errored:      Names of tools that raised errors (logged + skipped).
        was_triggered:      True if at least one tool matched and ran.
    """

    tool_results: List[DeadlineResult]
    context_block: str
    tools_invoked: List[str]
    tools_errored: List[str]
    was_triggered: bool


# ============================================================================
# ToolDispatcher
# ============================================================================


class ToolDispatcher:
    """
    Detects deadline-calculation intent, runs deterministic tools,
    and builds a tool-result block to inject into the LLM context.

    Args:
        engine: LegalDeadlineEngine instance (defaults to module singleton).
    """

    def __init__(self, engine: Optional[LegalDeadlineEngine] = None) -> None:
        self._engine: LegalDeadlineEngine = engine or legal_deadline_engine

    def dispatch(
        self,
        query_text: str,
        tier: QueryTier,
        start_date: Optional[date] = None,
    ) -> DispatchResult:
        """
        Main entry point for agentic tool dispatch.

        Tier gate:
            If tier.value < settings.agentic_tools_min_tier (default 3),
            returns empty DispatchResult immediately — no tools run.

        Args:
            query_text:  The user's Turkish legal query.
            tier:        LLM routing tier for this query.
            start_date:  Reference date for deadline calculations.
                         Falls back to ``date.today()`` if None.

        Returns:
            DispatchResult — always succeeds (errors are caught and logged).
        """
        # ── Tier gate ────────────────────────────────────────────────────────
        if not settings.agentic_tools_enabled:
            logger.debug("TOOL_DISPATCHER_SKIP | agentic_tools_enabled=False")
            return _empty_result()

        if tier.value < settings.agentic_tools_min_tier:
            logger.debug(
                "TOOL_DISPATCHER_SKIP | tier=%s | min_tier=%d",
                tier.name,
                settings.agentic_tools_min_tier,
            )
            return _empty_result()

        # ── Intent detection ─────────────────────────────────────────────────
        matched_tools = self._engine.detect_tools(query_text)

        if not matched_tools:
            logger.debug(
                "TOOL_DISPATCHER_NO_MATCH | tier=%s | query_len=%d",
                tier.name,
                len(query_text),
            )
            return _empty_result()

        _start_date = start_date or date.today()

        # ── Execute tools ────────────────────────────────────────────────────
        tool_results: List[DeadlineResult] = []
        tools_invoked: List[str] = []
        tools_errored: List[str] = []

        for tool in matched_tools:
            try:
                result = self._engine.calculate(tool, _start_date)
                tool_results.append(result)
                tools_invoked.append(tool.value)
                logger.info(
                    "TOOL_INVOKED | tool=%s | start=%s | deadline=%s",
                    tool.value,
                    _start_date.isoformat(),
                    result.deadline_date.isoformat(),
                )
            except Exception as exc:
                tools_errored.append(tool.value)
                logger.error(
                    "TOOL_ERROR | tool=%s | start=%s | err=%s",
                    tool.value,
                    _start_date.isoformat(),
                    exc,
                )

        if not tool_results:
            return _empty_result()

        # ── Build context block ──────────────────────────────────────────────
        context_block = _format_tool_block(tool_results)

        logger.info(
            "TOOL_DISPATCH_DONE | tier=%s | tools_run=%d | errors=%d",
            tier.name,
            len(tools_invoked),
            len(tools_errored),
        )

        return DispatchResult(
            tool_results=tool_results,
            context_block=context_block,
            tools_invoked=tools_invoked,
            tools_errored=tools_errored,
            was_triggered=True,
        )


# ============================================================================
# Formatting helper
# ============================================================================


_HEADER = "=== ARAÇ SONUÇLARI (Deterministik Hesap) ==="
_FOOTER = "=" * len(_HEADER)
_INSTRUCTION = (
    "NOT: Aşağıdaki tarihler ve süreler Python tarafından matematiksel olarak "
    "hesaplanmıştır. Bunları DEĞİŞTİRMEDEN yanıtında kullan. "
    "Hesaplamalar kesinlikle doğrudur."
)


def _format_tool_block(results: List[DeadlineResult]) -> str:
    """
    Formats a list of DeadlineResult objects into a structured string
    to prepend to the LLM context.
    """
    lines: List[str] = [_HEADER, _INSTRUCTION, ""]

    for r in results:
        lines.append(f"[ARAÇ: {r.tool.value}]")
        lines.append(f"Hukuki Dayanak   : {r.legal_basis}")
        lines.append(f"Başlangıç Tarihi : {r.start_date.isoformat()}")
        lines.append(f"Hesaplanan Süre  : {r.calculation.days_from_start} takvim günü")
        lines.append(f"Son Gün          : {r.deadline_date.isoformat()}")
        if r.adjusted_for_weekend:
            lines.append("Hafta sonu düzeltmesi uygulandı (son gün iş gününe kaydırıldı).")
        lines.append(f"Açıklama         : {r.description_tr}")
        lines.append("")

    lines.append(_FOOTER)
    return "\n".join(lines)


def _empty_result() -> DispatchResult:
    return DispatchResult(
        tool_results=[],
        context_block="",
        tools_invoked=[],
        tools_errored=[],
        was_triggered=False,
    )


# Module-level singleton
tool_dispatcher = ToolDispatcher()
