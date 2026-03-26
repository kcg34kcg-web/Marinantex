"""Human-review assist heuristics for RAG v3 escalation workflow."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class ReviewAssistDecision:
    priority: str
    sla_minutes: int
    due_at_iso: str
    reviewer_roles: list[str] = field(default_factory=list)
    checklist: list[str] = field(default_factory=list)


def build_review_assist(
    *,
    risk_level: str,
    confidence: float,
    claim_support_ratio: float,
    reason_codes: list[str],
) -> ReviewAssistDecision:
    risk = str(risk_level or "LOW").strip().upper()
    reasons = [str(item).strip().lower() for item in (reason_codes or []) if str(item).strip()]

    priority = "p3"
    sla_minutes = 24 * 60
    reviewer_roles = ["legal_reviewer"]

    if risk in {"HIGH", "CRITICAL"}:
        priority = "p1"
        sla_minutes = 60 if risk == "CRITICAL" else 240
        reviewer_roles = ["senior_lawyer", "compliance"]
    elif confidence < 0.30 or claim_support_ratio < 0.55:
        priority = "p2"
        sla_minutes = 8 * 60
        reviewer_roles = ["senior_lawyer"]

    if any("policy:" in code for code in reasons):
        reviewer_roles = list(dict.fromkeys([*reviewer_roles, "compliance"]))
    if any("claim_verification_failed" in code for code in reasons):
        reviewer_roles = list(dict.fromkeys([*reviewer_roles, "knowledge_engineer"]))

    checklist = [
        "citation_source_authority_check",
        "temporal_version_scope_check",
        "claim_evidence_alignment_check",
        "final_client_safe_wording_check",
    ]
    if any("admission:" in code for code in reasons):
        checklist.append("degraded_tier_impact_check")

    due_at = datetime.now(timezone.utc) + timedelta(minutes=max(5, int(sla_minutes)))
    return ReviewAssistDecision(
        priority=priority,
        sla_minutes=max(5, int(sla_minutes)),
        due_at_iso=due_at.isoformat(),
        reviewer_roles=reviewer_roles,
        checklist=checklist,
    )

