"""Reranker quality sanity checks."""

from __future__ import annotations

from dataclasses import dataclass, field

from infrastructure.rag_v3.repository import RagV3ChunkMatch


@dataclass(frozen=True)
class RerankerHealthReport:
    healthy: bool
    spread: float
    mean_score: float
    warnings: list[str] = field(default_factory=list)


def assess_reranker_output(matches: list[RagV3ChunkMatch]) -> RerankerHealthReport:
    if not matches:
        return RerankerHealthReport(healthy=False, spread=0.0, mean_score=0.0, warnings=["reranker_empty"])
    scores = [float(item.final_score) for item in matches]
    top = max(scores)
    low = min(scores)
    mean = sum(scores) / float(max(1, len(scores)))
    spread = max(0.0, top - low)
    warnings: list[str] = []
    healthy = True
    if spread < 0.015:
        warnings.append("reranker_score_spread_too_low")
        healthy = False
    if mean <= 0.02:
        warnings.append("reranker_mean_score_too_low")
        healthy = False
    return RerankerHealthReport(
        healthy=healthy,
        spread=spread,
        mean_score=mean,
        warnings=warnings,
    )

