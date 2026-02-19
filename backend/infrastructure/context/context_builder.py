"""
Context Builder  —  Step 8
===========================
Converts a ranked list of LegalDocument objects into a context string that
fits within the target LLM tier's token budget.

THE PROBLEM THIS SOLVES:
    After retrieval, we may have up to ``max_sources`` (default 8) documents.
    Each tier has a different context window:

        Tier 1 (Groq / llama-3.3-70b):   800 context tokens   → simple queries
        Tier 2 (GPT-4o-mini):            2500 context tokens
        Tier 3 (GPT-4o):                 5000 context tokens
        Tier 4 (Claude-3.5-sonnet):      8192 context tokens

    If we pass all documents to the LLM without trimming, we risk:
        - Exceeding the tier's context budget → API error or truncated reply
        - Paying for irrelevant low-score documents
        - Confusing the LLM with too many conflicting sources

ALGORITHM:
    1. Reserve tokens for system prompt + query + response headroom:
           budget = tier_max_tokens
                  - settings.context_system_prompt_reserve_tokens
                  - settings.context_query_reserve_tokens
                  - settings.context_response_reserve_tokens
    2. Iterate documents in descending final_score order.
    3. For each document:
        a. Try to fit the FULL chunk.  If it fits → include it.
        b. If the full chunk does NOT fit but we have ≥ some headroom,
           truncate the document content to fit exactly (soft truncation).
        c. Once we can fit nothing more, stop.
    4. Hard minimum: at least 1 document MUST be included (the top-scorer).
       If even the top-scorer exceeds the budget after header overhead,
       it is truncated to fill the remaining budget.

TOKEN ESTIMATION:
    Reuses ``estimate_tokens(text)`` from tiered_router — 1 token ≈ 4 chars.
    This intentionally avoids tiktoken to keep the path dependency-free.
    A ~15 % over-count safety margin is added via
    ``settings.context_token_safety_margin``.

OUTPUTS:
    ``ContextBuildResult`` carries:
        context_str   — the formatted string to pass to the LLM
        used_docs     — the subset of LegalDocument that fit (may be < input)
        total_tokens  — estimated token count of context_str
        dropped_count — how many docs were dropped due to budget overflow
        truncated     — True if any document was content-truncated

HARD-FAIL INTEGRATION:
    If the input doc list is empty, ``ContextBuildResult.context_str`` is ""
    and ``used_docs`` is [].  The Hard-Fail gate in RAGService already
    ensures this never reaches the LLM, but we handle it gracefully here too.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings
from infrastructure.llm.tiered_router import estimate_tokens

logger = logging.getLogger("babylexit.context_builder")


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class ContextBuildResult:
    """
    Output of ContextBuilder.build().

    Attributes:
        context_str:   Formatted context string ready for the LLM prompt.
        used_docs:     Documents that were included (in score order).
        total_tokens:  Estimated token count of context_str.
        dropped_count: Number of documents dropped due to token budget.
        truncated:     True if at least one document was content-truncated.
        litm_applied:  True if Lost-in-the-Middle reordering was applied
                       (Step 15).  False when reordering was skipped or
                       apply_litm_reorder=False.
    """

    context_str: str
    used_docs: List[LegalDocument]
    total_tokens: int
    dropped_count: int
    truncated: bool = False
    litm_applied: bool = False


# ============================================================================
# Pure helpers — no side effects, fully unit-testable
# ============================================================================

def format_doc_header(index: int, doc: LegalDocument) -> str:
    """
    Renders the header prefix for a single document block.

    Format (stable — prompt guard and citation engine depend on this):
        --- Kaynak {i}: {citation} ---
        [Kaynak URL: {url} | Versiyon: {ver} | Toplanma tarihi: {date}]

    Args:
        index: 1-based position in the context block.
        doc:   LegalDocument to format.

    Returns:
        Multi-line header string (WITHOUT trailing content or newline).
    """
    citation_line = doc.citation or f"Kaynak {index}"
    provenance = (
        f"[Kaynak URL: {doc.source_url or 'belirsiz'} | "
        f"Versiyon: {doc.version or 'belirsiz'} | "
        f"Toplanma tarihi: "
        f"{doc.collected_at.date() if doc.collected_at else 'belirsiz'}]"
    )
    return f"--- Kaynak {index}: {citation_line} ---\n{provenance}"


def format_doc_block(index: int, doc: LegalDocument, content_override: Optional[str] = None) -> str:
    """
    Renders a complete document block (header + content + trailing newline).

    Args:
        index:            1-based position in the context block.
        doc:              LegalDocument to format.
        content_override: If provided, use this instead of doc.content
                          (used when content has been truncated to fit budget).

    Returns:
        Full block string ending with "\\n".
    """
    header = format_doc_header(index, doc)
    content = content_override if content_override is not None else doc.content
    return f"{header}\n{content}\n"


def compute_budget(
    tier_max_tokens: int,
    system_reserve: int,
    query_reserve: int,
    response_reserve: int,
    safety_margin: float,
) -> int:
    """
    Computes the effective token budget available for document context.

    Formula:
        effective = (tier_max_tokens - system_reserve - query_reserve
                     - response_reserve) * (1 - safety_margin)

    The safety_margin accounts for the token estimation being approximate.
    Minimum returned value is 100 tokens (always leaves room for at least
    a short document).

    Args:
        tier_max_tokens:   The LLM tier's context window size.
        system_reserve:    Tokens reserved for the system prompt.
        query_reserve:     Tokens reserved for the user query.
        response_reserve:  Tokens reserved for the LLM response.
        safety_margin:     Fraction [0.0, 0.5] to subtract as safety buffer.

    Returns:
        int — effective token budget for document content.
    """
    raw = tier_max_tokens - system_reserve - query_reserve - response_reserve
    effective = int(raw * (1.0 - max(0.0, min(0.5, safety_margin))))
    return max(100, effective)


# ============================================================================
# Step 15: Lost-in-the-Middle reordering
# ============================================================================

def reorder_lost_in_middle(docs: List[LegalDocument]) -> List[LegalDocument]:
    """
    Reorders documents to mitigate the "Lost in the Middle" effect.

    Research shows LLMs attend most strongly to content at the very
    beginning and very end of the context window, while "forgetting"
    content in the middle.  By placing the highest-scoring documents at
    the edges and lower-scoring ones in the middle, we ensure the most
    authoritative sources are best-remembered.

    Algorithm (alternating front/back placement):
        Input (sorted by score desc): [A(0.9), B(0.85), C(0.80), D(0.75), E(0.70)]
        Output:                        [A,      C,       E,       D,       B      ]
                                        ↑ pos 1            middle          ↑ last
        → A (highest) at pos 1 (best attended).
        → B (2nd highest) at last pos (also well-attended).
        → E (lowest) in middle (least attended — acceptable).

    Args:
        docs: List of LegalDocument objects.  Caller is responsible for
              ordering by descending final_score before passing here.
              The original list is NOT modified.

    Returns:
        A new list with documents reordered for optimal LLM attention.
        Returns the original order unchanged if len(docs) <= 2.
    """
    if len(docs) <= 2:
        return list(docs)

    result: List[Optional[LegalDocument]] = [None] * len(docs)  # type: ignore[assignment]
    front = 0
    back = len(docs) - 1

    for i, doc in enumerate(docs):
        if i % 2 == 0:
            result[front] = doc
            front += 1
        else:
            result[back] = doc
            back -= 1

    return result  # type: ignore[return-value]


# ============================================================================
# ContextBuilder
# ============================================================================

class ContextBuilder:
    """
    Stateless context assembler that respects LLM tier token budgets.

    Usage in RAGService:
        builder = ContextBuilder()
        result = builder.build(
            docs=retrieved_docs,
            tier_max_tokens=settings.llm_tier2_max_context_tokens,
        )
        context = result.context_str
        # RAGResponse sources = result.used_docs (not full retrieved_docs)
    """

    def __init__(self) -> None:
        self._system_reserve: int = settings.context_system_prompt_reserve_tokens
        self._query_reserve: int = settings.context_query_reserve_tokens
        self._response_reserve: int = settings.context_response_reserve_tokens
        self._safety_margin: float = settings.context_token_safety_margin
        self._min_snippet_chars: int = settings.context_min_snippet_chars
        logger.info(
            "ContextBuilder initialised | sys_reserve=%d | query_reserve=%d | "
            "response_reserve=%d | safety_margin=%.2f | min_snippet=%d",
            self._system_reserve,
            self._query_reserve,
            self._response_reserve,
            self._safety_margin,
            self._min_snippet_chars,
        )

    def build(
        self,
        docs: List[LegalDocument],
        tier_max_tokens: int,
        apply_litm_reorder: bool = False,
    ) -> ContextBuildResult:
        """
        Assembles a token-budget-aware context string from ranked documents.

        Args:
            docs:               Ranked LegalDocument list (descending final_score).
                                May be empty — returns empty ContextBuildResult.
            tier_max_tokens:    Context window size for the selected LLM tier.
            apply_litm_reorder: When True, documents are reordered using
                                ``reorder_lost_in_middle()`` BEFORE the budget
                                loop, placing the highest-scoring docs at the
                                edges of the context window (Step 15).
                                Default False preserves the existing behaviour.

        Returns:
            ContextBuildResult with context_str, used_docs, stats, and
            litm_applied flag.
        """
        if not docs:
            return ContextBuildResult(
                context_str="",
                used_docs=[],
                total_tokens=0,
                dropped_count=0,
                truncated=False,
                litm_applied=False,
            )

        # ── Step 15: Lost-in-the-Middle reordering ───────────────────────────
        #    Reorder docs so highest-scoring ones land at context edges;
        #    only meaningful when len(docs) > 2.
        litm_applied: bool = False
        if apply_litm_reorder and len(docs) > 2:
            docs = reorder_lost_in_middle(docs)
            litm_applied = True
            logger.debug(
                "LitM reorder applied | docs=%d | top_id=%s | last_id=%s",
                len(docs),
                docs[0].id,
                docs[-1].id,
            )

        budget = compute_budget(
            tier_max_tokens=tier_max_tokens,
            system_reserve=self._system_reserve,
            query_reserve=self._query_reserve,
            response_reserve=self._response_reserve,
            safety_margin=self._safety_margin,
        )

        logger.debug(
            "Context budget: tier_max=%d → effective=%d tokens | docs_available=%d",
            tier_max_tokens,
            budget,
            len(docs),
        )

        blocks: List[str] = []
        used_docs: List[LegalDocument] = []
        tokens_used: int = 0
        truncated: bool = False

        for i, doc in enumerate(docs, start=1):
            full_block = format_doc_block(i, doc)
            block_tokens = estimate_tokens(full_block)

            if tokens_used + block_tokens <= budget:
                # Full document fits — include as-is
                blocks.append(full_block)
                used_docs.append(doc)
                tokens_used += block_tokens

            elif i == 1:
                # First document MUST be included even if it exceeds budget.
                # Truncate content to fit the remaining budget.
                header = format_doc_header(1, doc)
                header_tokens = estimate_tokens(header)
                remaining_tokens = max(0, budget - header_tokens - 2)  # 2 = separator newlines
                remaining_chars = remaining_tokens * 4  # inverse of estimate_tokens

                truncated_content = doc.content[:remaining_chars].rstrip()
                if remaining_chars < len(doc.content):
                    truncated_content += " …[kesildi]"
                    truncated = True

                block = format_doc_block(1, doc, content_override=truncated_content)
                blocks.append(block)
                used_docs.append(doc)
                tokens_used += estimate_tokens(block)

            else:
                # Try soft truncation — fill remaining budget with partial content
                header = format_doc_header(i, doc)
                header_tokens = estimate_tokens(header)
                remaining_tokens = budget - tokens_used - header_tokens - 2
                remaining_chars = remaining_tokens * 4

                if remaining_chars >= self._min_snippet_chars:
                    # Enough room for a meaningful snippet (≥ 80 chars)
                    truncated_content = doc.content[:remaining_chars].rstrip()
                    truncated_content += " …[kesildi]"
                    block = format_doc_block(i, doc, content_override=truncated_content)
                    blocks.append(block)
                    used_docs.append(doc)
                    tokens_used += estimate_tokens(block)
                    truncated = True
                    # No more room after a truncated doc
                    break
                else:
                    # Not enough room for a meaningful snippet — drop this doc and rest
                    break

        dropped_count = len(docs) - len(used_docs)
        context_str = "\n".join(blocks)

        if dropped_count > 0:
            logger.info(
                "Context budget: included=%d truncated=%s dropped=%d "
                "tokens_used=%d/%d",
                len(used_docs),
                truncated,
                dropped_count,
                tokens_used,
                budget,
            )

        return ContextBuildResult(
            context_str=context_str,
            used_docs=used_docs,
            total_tokens=tokens_used,
            dropped_count=dropped_count,
            truncated=truncated,
            litm_applied=litm_applied,
        )


# ============================================================================
# Module-level singleton
# ============================================================================

context_builder = ContextBuilder()
