"""
SupabaseAuditRepository — Concrete IAuditRepository Implementation
==================================================================
Writes Step 17 audit records to the three Supabase tables created by
rag_v2_step15_audit.sql:

    public.audit_log          — HMAC-signed, immutable audit trail
    public.cost_log           — per-request LLM cost
    public.ragas_metrics_log  — RAGAS quality metrics snapshot

Design decisions:
    - supabase-py table().insert() is used for all writes (sync API wrapped
      in async method).  For high-throughput scenarios these can be batched
      or offloaded to asyncpg; for audit writes the volume is low enough.
    - All methods are NON-FATAL — errors are caught, logged, and swallowed
      so that a DB write failure never surfaces to the end user.
    - LegalAuditEntry.source_versions (List[SourceVersionRecord]) is
      serialised to JSON because Supabase stores it as jsonb.
    - request_id is stored both as UUID primary key and as text FK in
      cost_log and ragas_metrics_log; we store the string form in both.

Dependencies:
    infrastructure.database.connection.get_supabase_client
    infrastructure.audit.audit_trail.LegalAuditEntry
    domain.repositories.audit_repository.IAuditRepository
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import List, Optional
from uuid import UUID

from domain.repositories.audit_repository import CostRecord, IAuditRepository, RAGASRecord
from infrastructure.audit.audit_trail import LegalAuditEntry

logger = logging.getLogger("babylexit.db.audit_repository")


class SupabaseAuditRepository(IAuditRepository):
    """
    Concrete IAuditRepository that writes to Supabase via the REST API.

    Instantiate once at application startup and inject into
    QueryLegalRAGUseCase:

        repo = SupabaseAuditRepository()
        use_case = QueryLegalRAGUseCase(rag_service=rag_service, audit_repository=repo)
    """

    # -------------------------------------------------------------------------
    # save_audit_entry
    # -------------------------------------------------------------------------

    async def save_audit_entry(self, entry: LegalAuditEntry) -> None:
        """
        Persist a LegalAuditEntry to public.audit_log.

        The HMAC signature is stored verbatim — the compliance team can
        re-verify any row with infrastructure.audit.audit_trail.verify_entry().

        Non-fatal: logs warning on failure.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            # Serialise SourceVersionRecord list → plain dicts for jsonb
            source_versions_json = [
                {
                    "doc_id":         sv.doc_id,
                    "citation":       sv.citation,
                    "version":        sv.version,
                    "collected_at":   sv.collected_at,
                    "norm_hierarchy": sv.norm_hierarchy,
                    "authority_score": sv.authority_score,
                }
                for sv in entry.source_versions
            ]

            row = {
                "request_id":          str(entry.request_id),
                "timestamp_utc":       entry.timestamp_utc.isoformat(),
                "query_hash":          entry.query_hash,
                "bureau_id":           entry.bureau_id,          # str UUID or None
                "tier":                entry.tier,
                "model_used":          entry.model_used,
                "source_versions":     source_versions_json,
                "tool_calls_made":     list(entry.tool_calls_made),
                "grounding_ratio":     round(entry.grounding_ratio, 6),
                "disclaimer_severity": entry.disclaimer_severity,
                "latency_ms":          entry.latency_ms,
                "cost_estimate_usd":   round(entry.cost_estimate_usd, 6),
                "why_this_answer":     entry.why_this_answer,
                "audit_signature":     entry.audit_signature,
            }

            client.table("audit_log").insert(row).execute()
            logger.debug(
                "AUDIT_PERSISTED | request_id=%s | tier=%d | sig=%s...",
                entry.request_id, entry.tier, entry.audit_signature[:16],
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "AUDIT_PERSIST_FAILED (non-fatal) | request_id=%s | error=%s",
                getattr(entry, "request_id", "?"), exc,
            )

    # -------------------------------------------------------------------------
    # save_cost_record
    # -------------------------------------------------------------------------

    async def save_cost_record(self, record: CostRecord) -> None:
        """
        Persist a per-request cost estimate to public.cost_log.

        Must be called AFTER save_audit_entry() to satisfy the FK constraint
        cost_log.request_id → audit_log.request_id.

        Non-fatal: logs warning on failure.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            row = {
                "request_id":      record.request_id,
                "model_id":        record.model_id,
                "tier":            record.tier,
                "input_tokens":    record.input_tokens,
                "output_tokens":   record.output_tokens,
                "input_cost_usd":  round(record.input_cost_usd, 6),
                "output_cost_usd": round(record.output_cost_usd, 6),
                "total_cost_usd":  round(record.total_cost_usd, 6),
                "cache_hit":       record.cache_hit,
                "bureau_id":       record.bureau_id,
            }

            client.table("cost_log").insert(row).execute()
            logger.debug(
                "COST_PERSISTED | request_id=%s | total=$%.6f | cache_hit=%s",
                record.request_id, record.total_cost_usd, record.cache_hit,
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "COST_PERSIST_FAILED (non-fatal) | request_id=%s | error=%s",
                record.request_id, exc,
            )

    # -------------------------------------------------------------------------
    # save_ragas_metrics
    # -------------------------------------------------------------------------

    async def save_ragas_metrics(self, record: RAGASRecord) -> None:
        """
        Persist RAGAS quality metrics to public.ragas_metrics_log.

        Must be called AFTER save_audit_entry() to satisfy the FK constraint
        ragas_metrics_log.request_id → audit_log.request_id.

        Non-fatal: logs warning on failure.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            row = {
                "request_id":        record.request_id,
                "faithfulness":      round(record.faithfulness, 6),
                "answer_relevancy":  round(record.answer_relevancy, 6),
                "context_precision": round(record.context_precision, 6),
                "context_recall":    round(record.context_recall, 6),
                "overall_quality":   round(record.overall_quality, 6),
                "tier":              record.tier,
                "source_count":      record.source_count,
                "bureau_id":         record.bureau_id,
            }

            client.table("ragas_metrics_log").insert(row).execute()
            logger.debug(
                "RAGAS_PERSISTED | request_id=%s | overall=%.4f",
                record.request_id, record.overall_quality,
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "RAGAS_PERSIST_FAILED (non-fatal) | request_id=%s | error=%s",
                record.request_id, exc,
            )

    # -------------------------------------------------------------------------
    # get_entries_by_bureau
    # -------------------------------------------------------------------------

    async def get_entries_by_bureau(
        self,
        bureau_id: UUID,
        limit: int = 100,
    ) -> List[LegalAuditEntry]:
        """
        Retrieve the most recent audit entries for a bureau (read-only).

        Used by the compliance / audit dashboard endpoint.
        Returns [] on any error (non-fatal read degradation).
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            from infrastructure.audit.audit_trail import SourceVersionRecord
            from datetime import datetime, timezone

            client = get_supabase_client()

            resp = (
                client.table("audit_log")
                .select("*")
                .eq("bureau_id", str(bureau_id))
                .order("timestamp_utc", desc=True)
                .limit(limit)
                .execute()
            )

            entries: List[LegalAuditEntry] = []
            for row in (resp.data or []):
                svs = [
                    SourceVersionRecord(
                        doc_id=sv["doc_id"],
                        citation=sv.get("citation"),
                        version=sv.get("version"),
                        collected_at=sv.get("collected_at"),
                        norm_hierarchy=sv.get("norm_hierarchy"),
                        authority_score=float(sv.get("authority_score", 0.0)),
                    )
                    for sv in (row.get("source_versions") or [])
                ]
                ts = row["timestamp_utc"]
                if isinstance(ts, str):
                    ts = datetime.fromisoformat(ts)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)

                entries.append(LegalAuditEntry(
                    request_id=str(row["request_id"]),
                    timestamp_utc=ts,
                    query_hash=row["query_hash"],
                    bureau_id=row.get("bureau_id"),
                    tier=int(row["tier"]),
                    model_used=row["model_used"],
                    source_versions=svs,
                    tool_calls_made=list(row.get("tool_calls_made") or []),
                    grounding_ratio=float(row["grounding_ratio"]),
                    disclaimer_severity=row["disclaimer_severity"],
                    latency_ms=int(row["latency_ms"]),
                    cost_estimate_usd=float(row["cost_estimate_usd"]),
                    why_this_answer=row.get("why_this_answer", ""),
                    audit_signature=row["audit_signature"],
                ))
            return entries

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "AUDIT_READ_FAILED (non-fatal) | bureau_id=%s | error=%s",
                bureau_id, exc,
            )
            return []


# ---------------------------------------------------------------------------
# Module-level singleton — injected into QueryLegalRAGUseCase at startup
# ---------------------------------------------------------------------------

supabase_audit_repository = SupabaseAuditRepository()
