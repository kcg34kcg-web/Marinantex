"""
IAuditRepository — Domain Repository Interface
===============================================
Abstract contract for writing audit, cost, and RAGAS records to the DB.

Concrete implementation writes to:
    public.audit_log        (Step 17 — HMAC-signed audit trail)
    public.cost_log         (Step 17 — per-request cost)
    public.ragas_metrics_log (Step 17 — RAGAS quality metrics)

The AuditTrailRecorder in infrastructure/audit/audit_trail.py calls
this repository after building a LegalAuditEntry, so the audit trail
is persisted to the DB (not just logged to stdout).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional
from uuid import UUID

from infrastructure.audit.audit_trail import LegalAuditEntry


@dataclass(frozen=True)
class CostRecord:
    """Matches the public.cost_log schema."""
    request_id:      str
    model_id:        str
    tier:            int
    input_tokens:    int
    output_tokens:   int
    input_cost_usd:  float
    output_cost_usd: float
    total_cost_usd:  float
    cache_hit:       bool
    bureau_id:       Optional[str]


@dataclass(frozen=True)
class RAGASRecord:
    """Matches the public.ragas_metrics_log schema."""
    request_id:         str
    faithfulness:       float
    answer_relevancy:   float
    context_precision:  float
    context_recall:     float
    overall_quality:    float
    tier:               int
    source_count:       int
    bureau_id:          Optional[str]


class IAuditRepository(ABC):
    """
    Abstract contract for writing Step 17 audit records to the database.

    All three methods are fire-and-forget (non-blocking failures):
    if the DB write fails, the pipeline logs a warning and continues —
    the in-memory LegalAuditEntry is the source of truth.
    """

    @abstractmethod
    async def save_audit_entry(self, entry: LegalAuditEntry) -> None:
        """
        Persist a LegalAuditEntry to public.audit_log.

        The entry's HMAC signature is stored in the audit_signature column
        and can be verified later with verify_entry().
        """

    @abstractmethod
    async def save_cost_record(self, record: CostRecord) -> None:
        """
        Persist a per-request cost estimate to public.cost_log.

        The cost_log row is linked to audit_log via request_id FK.
        Always called after save_audit_entry() to honour the FK constraint.
        """

    @abstractmethod
    async def save_ragas_metrics(self, record: RAGASRecord) -> None:
        """
        Persist RAGAS quality metrics to public.ragas_metrics_log.

        The ragas_metrics_log row is linked to audit_log via request_id FK.
        Always called after save_audit_entry() to honour the FK constraint.
        """

    @abstractmethod
    async def get_entries_by_bureau(
        self,
        bureau_id: UUID,
        limit: int = 100,
    ) -> List[LegalAuditEntry]:
        """
        Retrieve the most recent audit entries for a bureau.

        Used by the compliance / audit dashboard endpoint.
        Returns entries ordered by timestamp_utc DESC.
        """
