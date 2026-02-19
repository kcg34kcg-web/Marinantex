"""
RAGAS-Inspired Metrics Adapter  —  Step 17
==========================================
Computes four RAG quality metrics from data already available in the response
pipeline.  Zero external API calls — all metrics are derived deterministically
from Step 16 outputs and the retrieved source set.

Metric definitions (RAGAS-inspired, adapted for zero-API-call computation):

  faithfulness     : Fraction of non-trivial answer sentences that carry at
                     least one valid [K:N] citation.
                     Source: ZeroTrustPromptBuilder grounding report.
                     Formula: grounded_sentences / total_sentences.
                     Special case: empty answer → 1.0 (vacuously grounded).
                     Range: [0.0, 1.0].  1.0 = every sentence is grounded.

  answer_relevancy : Keyword overlap between query tokens and answer tokens.
                     Measures whether the LLM addressed the query at all.
                     Formula: |query_tokens ∩ answer_tokens| / |query_tokens|
                     Turkish stop-words are excluded from token sets.
                     Range: [0.0, 1.0].  Approximate — not semantic.

  context_precision: Mean final_score of the used source documents.
                     Measures how relevant the retrieved sources are.
                     Formula: mean(source.final_score for source in used_docs)
                     Range: [0.0, 1.0].

  context_recall   : Normalised source coverage:
                     min(1.0, source_count / target_source_count).
                     Measures whether enough sources were retrieved.
                     Default target = 3 (Tier 1 top-3 retrieval).
                     Range: [0.0, 1.0].  1.0 when ≥ target sources retrieved.

  overall_quality  : Weighted linear combination:
                     0.35 × faithfulness
                     + 0.25 × answer_relevancy
                     + 0.25 × context_precision
                     + 0.15 × context_recall
                     Range: [0.0, 1.0].

Design:
  - All five pure functions have ZERO side effects and are individually testable.
  - RAGASAdapter is a thin injectable wrapper — stateless, safe as singleton.
  - RAGASMetrics is a frozen dataclass (immutable, hashable, serialisable).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

logger = logging.getLogger("babylexit.ragas_adapter")


# ---------------------------------------------------------------------------
# Metric weights
# ---------------------------------------------------------------------------

_W_FAITHFULNESS: float = 0.35
_W_RELEVANCY: float    = 0.25
_W_PRECISION: float    = 0.25
_W_RECALL: float       = 0.15

# ---------------------------------------------------------------------------
# Turkish stop-words (minimal set — excludes noise from keyword overlap)
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset({
    "ve", "veya", "ile", "bir", "bu", "da", "de", "den", "için", "ne",
    "mi", "mu", "mü", "var", "yok", "ise", "gibi", "kadar", "olan",
    "olarak", "madde", "kanun", "hukuk", "hakkında", "göre", "olan",
    "her", "her", "çok", "az", "daha", "en", "kendi", "diğer", "ise",
    "ancak", "fakat", "lakin", "ama", "ki", "ki", "şu", "o", "ben",
    "sen", "biz", "siz", "onlar",
})


# ---------------------------------------------------------------------------
# Pure metric functions
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> frozenset:
    """
    Splits text into lowercase word tokens, removing stop-words.

    Returns a frozenset so the result is hashable and set-intersection fast.
    """
    tokens = set(re.findall(r"\b\w+\b", text.lower()))
    return frozenset(tokens - _STOP_WORDS)


def compute_faithfulness(
    total_sentences: int,
    grounded_sentences: int,
) -> float:
    """
    Computes faithfulness score.

    Returns 1.0 for empty answers (no un-grounded claims were made).

    Args:
        total_sentences    : Non-trivial sentences parsed from the answer.
        grounded_sentences : Sentences with ≥1 valid citation.

    Returns:
        float in [0.0, 1.0].
    """
    if total_sentences <= 0:
        return 1.0
    ratio = grounded_sentences / total_sentences
    return round(max(0.0, min(1.0, ratio)), 4)


def compute_answer_relevancy(query: str, answer: str) -> float:
    """
    Heuristic keyword overlap between query and answer.

    Formula: |query_tokens ∩ answer_tokens| / |query_tokens|
    Returns 0.0 when the query has no meaningful tokens (post stop-word filter).

    Args:
        query  : User's legal question.
        answer : LLM-generated answer text.

    Returns:
        float in [0.0, 1.0].
    """
    q_tokens = _tokenize(query)
    if not q_tokens:
        return 0.0
    a_tokens = _tokenize(answer)
    overlap = len(q_tokens & a_tokens)
    return round(min(1.0, overlap / len(q_tokens)), 4)


def compute_context_precision(source_scores: List[float]) -> float:
    """
    Mean final_score of used source documents.

    Returns 0.0 when the source list is empty.
    (Should not happen after the Hard-Fail gate, but is handled gracefully.)

    Args:
        source_scores : List of final_score values from SourceDocumentSchema.

    Returns:
        float in [0.0, 1.0].
    """
    if not source_scores:
        return 0.0
    mean = sum(source_scores) / len(source_scores)
    return round(max(0.0, min(1.0, mean)), 4)


def compute_context_recall(
    source_count: int,
    target_source_count: int = 3,
) -> float:
    """
    Normalised source coverage: min(1.0, source_count / target_source_count).

    Args:
        source_count         : Number of documents included in the context.
        target_source_count  : Expected minimum for a well-grounded answer.
                               Default 3 (Tier 1 top-3 retrieval).

    Returns:
        float in [0.0, 1.0].
    """
    if target_source_count <= 0:
        return 1.0
    return round(min(1.0, source_count / target_source_count), 4)


def compute_overall_quality(
    faithfulness: float,
    answer_relevancy: float,
    context_precision: float,
    context_recall: float,
) -> float:
    """
    Weighted quality score combining all four metric components.

    Weights:
        faithfulness     0.35 (most critical — citation coverage)
        answer_relevancy 0.25 (does answer address the query?)
        context_precision 0.25 (are sources topically relevant?)
        context_recall   0.15 (enough sources retrieved?)

    Returns:
        float in [0.0, 1.0].
    """
    score = (
        _W_FAITHFULNESS * faithfulness
        + _W_RELEVANCY   * answer_relevancy
        + _W_PRECISION   * context_precision
        + _W_RECALL      * context_recall
    )
    return round(max(0.0, min(1.0, score)), 4)


# ---------------------------------------------------------------------------
# Data class
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RAGASMetrics:
    """
    Computed quality metrics for a single RAG response.

    Attributes:
        faithfulness      : Fraction of grounded sentences [0, 1].
        answer_relevancy  : Query–answer keyword overlap score [0, 1].
        context_precision : Mean source final_score [0, 1].
        context_recall    : Normalised source coverage [0, 1].
        overall_quality   : Weighted quality composite score [0, 1].
        computed_at       : UTC timestamp when metrics were computed.
    """

    faithfulness: float
    answer_relevancy: float
    context_precision: float
    context_recall: float
    overall_quality: float
    computed_at: datetime


# ---------------------------------------------------------------------------
# Injectable adapter
# ---------------------------------------------------------------------------

class RAGASAdapter:
    """
    Stateless adapter that computes RAGAS-inspired metrics.

    All computation is local — zero LLM calls, zero network I/O.
    Safe as a module-level singleton.

    Usage:
        metrics = ragas_adapter.compute(
            query="İhbar süresi nedir?",
            answer="İhbar süresi 4 haftadır. [K:1]",
            total_sentences=1,
            grounded_sentences=1,
            source_scores=[0.87],
        )
    """

    def compute(
        self,
        query: str,
        answer: str,
        total_sentences: int,
        grounded_sentences: int,
        source_scores: List[float],
        target_source_count: int = 3,
    ) -> RAGASMetrics:
        """
        Computes all five RAGAS metrics and returns a frozen RAGASMetrics.

        Args:
            query               : User query (raw or PII-masked).
            answer              : LLM-generated answer text.
            total_sentences     : Non-trivial sentence count (ZeroTrust parser).
            grounded_sentences  : Sentences with ≥1 valid citation.
            source_scores       : final_score values for each used source.
            target_source_count : Minimum source count for full recall.

        Returns:
            RAGASMetrics (frozen dataclass, immutable).
        """
        faith   = compute_faithfulness(total_sentences, grounded_sentences)
        relev   = compute_answer_relevancy(query, answer)
        prec    = compute_context_precision(source_scores)
        recall  = compute_context_recall(len(source_scores), target_source_count)
        overall = compute_overall_quality(faith, relev, prec, recall)

        metrics = RAGASMetrics(
            faithfulness=faith,
            answer_relevancy=relev,
            context_precision=prec,
            context_recall=recall,
            overall_quality=overall,
            computed_at=datetime.now(tz=timezone.utc),
        )

        logger.info(
            "RAGAS_METRICS | faith=%.3f | relev=%.3f | prec=%.3f | "
            "recall=%.3f | overall=%.3f",
            faith,
            relev,
            prec,
            recall,
            overall,
        )

        return metrics


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

ragas_adapter = RAGASAdapter()
