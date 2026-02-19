"""
Context Summarizer — Step 15: Context Budget + "Lost in the Middle" Kontrolü
=============================================================================
Compresses secondary (lower-priority) legal documents into short summaries
before including them in the LLM context window.

Purpose
-------
The LLM context window has a fixed token budget.  After retrieval and
re-ranking we may have more documents than fit comfortably.  For Tier 4
(MUAZZAM) queries, instead of simply dropping low-score documents, this
module summarises them to a target token count so they STILL contribute
useful information while consuming far fewer tokens.

This works in concert with ``reorder_lost_in_middle()`` in context_builder.py:
    - Primary docs (top-N by score): full content → placed at context edges
    - Secondary docs (rank N+1+): compressed summary → placed in middle
    - Net effect: LLM sees accurate summaries for all sources and attends
      to the most critical content (at the edges) more strongly.

Architecture
------------
``ContextSummarizer`` is stateless and injectable:

    # Production: LLM-backed summarization
    summarizer = ContextSummarizer(summarize_fn=my_llm_callable)

    # Default (no API key / tests): extractive fallback
    summarizer = ContextSummarizer()

    results = await summarizer.summarize_batch(
        secondary_docs,
        target_tokens=200,
        query_context=request.query,
    )

Guarantees
----------
* On any error (LLM call fails, timeout, etc.) the summarizer falls back to
  extractive summarisation — the pipeline is never blocked.
* Documents already shorter than ``target_tokens`` are returned unchanged
  (``was_summarized=False``); no unnecessary LLM calls are made.
* ``summarize_batch()`` runs all calls concurrently via ``asyncio.gather()``
  with per-item error isolation.
* Original ``LegalDocument`` objects are NEVER mutated; a new instance with
  replaced ``content`` is returned via ``dataclasses.replace()``.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, replace as dc_replace
from typing import Callable, List, Optional

from domain.entities.legal_document import LegalDocument
from infrastructure.llm.tiered_router import estimate_tokens

logger = logging.getLogger("babylexit.context.summarizer")


# ============================================================================
# Summarisation prompt
# ============================================================================

_SUMMARY_PROMPT_TEMPLATE = (
    "Sen bir Türk hukuku uzmanısın. Aşağıdaki hukuki belgeyi, orijinal hukuki "
    "anlamını, tüm önemli madde numaraları, tarihler ve kararları koruyarak "
    "yaklaşık {target_tokens} token uzunluğunda özlü bir özet haline getir.\n\n"
    "BELGE:\n{content}\n\n"
    "SORU BAĞLAMI: {query_context}\n\n"
    "ÖZET (yalnızca özeti yaz, başka hiçbir şey ekleme):"
)


# ============================================================================
# Result type
# ============================================================================

@dataclass
class SummaryResult:
    """
    Result of a single document summarisation operation.

    Attributes:
        document:         New LegalDocument with compressed content.
                          If was_summarized=False, this is the original doc.
        original_tokens:  Estimated token count of the original content.
        summary_tokens:   Estimated token count of the summary content.
        was_summarized:   True if content was compressed; False if skipped.
        error:            Non-None if summarisation errored and extractive
                          fallback was used.
    """

    document: LegalDocument
    original_tokens: int
    summary_tokens: int
    was_summarized: bool
    error: Optional[str] = None


# ============================================================================
# Helpers
# ============================================================================

def _extractive_summary(content: str, target_tokens: int) -> str:
    """
    Extractive fallback: returns the first ``target_tokens * 4`` characters
    of ``content``, with a ``…[özet]`` suffix when truncated.

    No I/O, no external dependencies — always succeeds.

    Args:
        content:       Full document text.
        target_tokens: Desired summary length in tokens (1 token ≈ 4 chars).

    Returns:
        A string of at most ``target_tokens * 4`` characters.
    """
    target_chars = max(1, target_tokens) * 4
    if len(content) <= target_chars:
        return content
    return content[:target_chars].rstrip() + " …[özet]"


# ============================================================================
# ContextSummarizer
# ============================================================================

class ContextSummarizer:
    """
    Async document summariser for secondary context documents.

    In production the caller injects a ``summarize_fn`` that calls an LLM.
    When no function is provided, extractive summarisation is used as a
    robust, zero-cost fallback.

    Args:
        summarize_fn:  Optional async callable with signature
                       ``(content: str, query_context: str, target_tokens: int) -> str``.
                       When None, extractive fallback is always used.

    Example (production wiring in RAGService):
        async def _llm_summarize(content, query, target):
            prompt = _SUMMARY_PROMPT_TEMPLATE.format(...)
            answer, _ = await router.generate(prompt, content, 0)
            return answer

        summarizer = ContextSummarizer(summarize_fn=_llm_summarize)
    """

    def __init__(
        self,
        summarize_fn: Optional[Callable] = None,
    ) -> None:
        self._summarize_fn = summarize_fn

    # ── Single document ───────────────────────────────────────────────────────

    async def summarize(
        self,
        doc: LegalDocument,
        target_tokens: int = 200,
        query_context: str = "",
    ) -> SummaryResult:
        """
        Compresses a single document to approximately ``target_tokens``.

        If the document is already shorter than ``target_tokens``, it is
        returned unchanged (``was_summarized=False``).

        Args:
            doc:           LegalDocument to compress.
            target_tokens: Target token length for the summary.
            query_context: The user query — gives the LLM context for
                           what details to preserve in the summary.

        Returns:
            SummaryResult with a new LegalDocument whose content is the summary.
        """
        original_tokens = estimate_tokens(doc.content)

        # Skip documents that are already within the target budget
        if original_tokens <= target_tokens:
            return SummaryResult(
                document=doc,
                original_tokens=original_tokens,
                summary_tokens=original_tokens,
                was_summarized=False,
            )

        try:
            if self._summarize_fn is not None:
                summary_text: str = await self._summarize_fn(
                    doc.content, query_context, target_tokens
                )
            else:
                summary_text = _extractive_summary(doc.content, target_tokens)

            summary_tokens = estimate_tokens(summary_text)
            summarized_doc = dc_replace(doc, content=summary_text)

            logger.info(
                "DOC_SUMMARIZED | id=%s | original=%d tokens → summary=%d tokens",
                doc.id,
                original_tokens,
                summary_tokens,
            )

            return SummaryResult(
                document=summarized_doc,
                original_tokens=original_tokens,
                summary_tokens=summary_tokens,
                was_summarized=True,
            )

        except Exception as exc:
            logger.error(
                "SUMMARIZE_ERROR | id=%s | err=%s | fallback=extractive",
                doc.id,
                exc,
            )
            # Fallback to extractive — never blocks the pipeline
            fallback_text = _extractive_summary(doc.content, target_tokens)
            fallback_tokens = estimate_tokens(fallback_text)
            fallback_doc = dc_replace(doc, content=fallback_text)

            return SummaryResult(
                document=fallback_doc,
                original_tokens=original_tokens,
                summary_tokens=fallback_tokens,
                was_summarized=True,
                error=str(exc),
            )

    # ── Batch ─────────────────────────────────────────────────────────────────

    async def summarize_batch(
        self,
        docs: List[LegalDocument],
        target_tokens: int = 200,
        query_context: str = "",
    ) -> List[SummaryResult]:
        """
        Summarises a batch of documents concurrently via ``asyncio.gather()``.

        Per-item error isolation: if one document's summarisation raises an
        exception inside ``gather()``, that document falls back to extractive
        summarisation while the others proceed normally.

        Args:
            docs:          Documents to compress.
            target_tokens: Per-document token target.
            query_context: User query for context-aware summarisation.

        Returns:
            List[SummaryResult] in the same order as ``docs``.
        """
        if not docs:
            return []

        raw_results = await asyncio.gather(
            *[self.summarize(doc, target_tokens, query_context) for doc in docs],
            return_exceptions=True,
        )

        results: List[SummaryResult] = []
        for i, result in enumerate(raw_results):
            if isinstance(result, BaseException):
                # asyncio.gather returned an exception object — apply fallback
                doc = docs[i]
                fallback_text = _extractive_summary(doc.content, target_tokens)
                logger.error(
                    "SUMMARIZE_BATCH_ERROR | id=%s | err=%s | fallback=extractive",
                    doc.id,
                    result,
                )
                results.append(
                    SummaryResult(
                        document=dc_replace(doc, content=fallback_text),
                        original_tokens=estimate_tokens(doc.content),
                        summary_tokens=estimate_tokens(fallback_text),
                        was_summarized=True,
                        error=str(result),
                    )
                )
            else:
                results.append(result)  # type: ignore[arg-type]

        summarized_count = sum(1 for r in results if r.was_summarized)
        tokens_saved = sum(
            r.original_tokens - r.summary_tokens
            for r in results
            if r.was_summarized
        )
        logger.info(
            "SUMMARIZE_BATCH_DONE | total=%d | summarized=%d | tokens_saved=%d",
            len(docs),
            summarized_count,
            tokens_saved,
        )

        return results


# ============================================================================
# Module-level singleton (extractive-only; production code injects summarize_fn)
# ============================================================================

context_summarizer = ContextSummarizer()
