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

from domain.repositories.audit_repository import (
    CostRecord,
    IAuditRepository,
    RAGASRecord,
    ToolCallRecord,
)
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
                    "injection_flag": sv.injection_flag,
                    "injection_notes": list(sv.injection_notes),
                }
                for sv in entry.source_versions
            ]

            row = {
                "request_id":          str(entry.request_id),
                "timestamp_utc":       entry.timestamp_utc.isoformat(),
                "query_hash":          entry.query_hash,
                "bureau_id":           entry.bureau_id,          # str UUID or None
                "requested_tier":      entry.requested_tier,
                "final_tier":          entry.final_tier,
                "final_generation_tier": entry.final_generation_tier,
                "final_model":         entry.final_model,
                "tier":                entry.tier,
                "model_used":          entry.model_used,
                "subtask_models":      list(entry.subtask_models),
                "response_type":       entry.response_type,
                "source_count":        entry.source_count,
                "case_id":             entry.case_id,
                "thread_id":           entry.thread_id,
                "intent_class":        entry.intent_class,
                "strict_grounding":    entry.strict_grounding,
                "source_versions":     source_versions_json,
                "tool_calls_made":     list(entry.tool_calls_made),
                "grounding_ratio":     round(entry.grounding_ratio, 6),
                "disclaimer_severity": entry.disclaimer_severity,
                "latency_ms":          entry.latency_ms,
                "cost_estimate_usd":   round(entry.cost_estimate_usd, 6),
                "why_this_answer":     entry.why_this_answer,
                "temporal_fields":     dict(entry.temporal_fields or {}),
                "tenant_context":      dict(entry.tenant_context or {}),
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

    async def save_tool_call_records(self, records: List[ToolCallRecord]) -> None:
        """
        Persist tool invocation rows to public.tool_call_log.

        Non-fatal: any DB failure is logged and swallowed.
        """
        if not records:
            return

        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            rows = [
                {
                    "request_id": record.request_id,
                    "tool_name": record.tool_name,
                    "success": record.success,
                    "bureau_id": record.bureau_id,
                    "case_id": record.case_id,
                    "thread_id": record.thread_id,
                    "error_message": record.error_message,
                    "query_text": record.query_text,
                    "input_params": record.input_params or {},
                    "result_json": record.result_json or {},
                    "latency_ms": record.latency_ms,
                }
                for record in records
            ]

            client.table("tool_call_log").insert(rows).execute()
            logger.debug(
                "TOOL_CALL_LOG_PERSISTED | request_id=%s | rows=%d",
                records[0].request_id,
                len(rows),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "TOOL_CALL_LOG_PERSIST_FAILED (non-fatal) | request_id=%s | error=%s",
                records[0].request_id if records else "?",
                exc,
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
                        injection_flag=bool(sv.get("injection_flag", False)),
                        injection_notes=list(sv.get("injection_notes") or []),
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
                    requested_tier=row.get("requested_tier"),
                    final_tier=(int(row["final_tier"]) if row.get("final_tier") is not None else None),
                    final_generation_tier=(
                        int(row["final_generation_tier"])
                        if row.get("final_generation_tier") is not None
                        else None
                    ),
                    final_model=row.get("final_model"),
                    tier=int(row["tier"]),
                    model_used=row["model_used"],
                    subtask_models=list(row.get("subtask_models") or []),
                    response_type=row.get("response_type") or "legal_grounded",
                    source_count=int(row.get("source_count") or 0),
                    case_id=row.get("case_id"),
                    thread_id=row.get("thread_id"),
                    intent_class=row.get("intent_class"),
                    strict_grounding=bool(row.get("strict_grounding", True)),
                    source_versions=svs,
                    tool_calls_made=list(row.get("tool_calls_made") or []),
                    tool_errors=list(row.get("tool_errors") or []),
                    grounding_ratio=float(row["grounding_ratio"]),
                    disclaimer_severity=row["disclaimer_severity"],
                    latency_ms=int(row["latency_ms"]),
                    cost_estimate_usd=float(row["cost_estimate_usd"]),
                    why_this_answer=row.get("why_this_answer", ""),
                    temporal_fields=dict(row.get("temporal_fields") or {}),
                    tenant_context=dict(row.get("tenant_context") or {}),
                    audit_signature=row["audit_signature"],
                ))
            return entries

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "AUDIT_READ_FAILED (non-fatal) | bureau_id=%s | error=%s",
                bureau_id, exc,
            )
            return []

    async def get_audit_trace(
        self,
        request_id: UUID,
        bureau_id: Optional[UUID],
    ) -> Optional[dict]:
        """
        Fetches a single request trace (audit + cost + tool calls) by request_id.
        """
        try:
            from infrastructure.database.connection import get_supabase_client
            client = get_supabase_client()

            audit_query = (
                client.table("audit_log")
                .select("*")
                .eq("request_id", str(request_id))
                .limit(1)
            )
            if bureau_id is not None:
                audit_query = audit_query.eq("bureau_id", str(bureau_id))

            audit_resp = audit_query.execute()
            if not audit_resp.data:
                return None
            audit_row = audit_resp.data[0]

            cost_resp = (
                client.table("cost_log")
                .select("*")
                .eq("request_id", str(request_id))
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            cost_row = (cost_resp.data or [None])[0]

            tool_resp = (
                client.table("tool_call_log")
                .select("tool_name, success, error_message, called_at, latency_ms")
                .eq("request_id", str(request_id))
                .order("called_at", desc=False)
                .execute()
            )

            return {
                "request_id": str(request_id),
                "timestamp_utc": audit_row.get("timestamp_utc"),
                "bureau_id": audit_row.get("bureau_id"),
                "requested_tier": audit_row.get("requested_tier"),
                "final_tier": audit_row.get("final_tier") or audit_row.get("tier"),
                "final_generation_tier": (
                    audit_row.get("final_generation_tier")
                    or audit_row.get("final_tier")
                    or audit_row.get("tier")
                ),
                "final_model": audit_row.get("final_model") or audit_row.get("model_used"),
                "model_used": audit_row.get("model_used"),
                "subtask_models": list(audit_row.get("subtask_models") or []),
                "response_type": audit_row.get("response_type") or "legal_grounded",
                "source_count": int(audit_row.get("source_count") or 0),
                "grounding_ratio": float(audit_row.get("grounding_ratio") or 0.0),
                "estimated_cost_usd": float(audit_row.get("cost_estimate_usd") or 0.0),
                "case_id": audit_row.get("case_id"),
                "thread_id": audit_row.get("thread_id"),
                "intent_class": audit_row.get("intent_class"),
                "strict_grounding": bool(audit_row.get("strict_grounding", True)),
                "temporal_fields": dict(audit_row.get("temporal_fields") or {}),
                "tenant_context": dict(audit_row.get("tenant_context") or {}),
                "cost_log": {
                    "total_cost_usd": float(cost_row.get("total_cost_usd") or 0.0),
                    "input_tokens": int(cost_row.get("input_tokens") or 0),
                    "output_tokens": int(cost_row.get("output_tokens") or 0),
                    "model_id": cost_row.get("model_id"),
                    "cache_hit": bool(cost_row.get("cache_hit", False)),
                } if cost_row else None,
                "tool_calls": list(tool_resp.data or []),
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "AUDIT_TRACE_READ_FAILED (non-fatal) | request_id=%s | error=%s",
                request_id,
                exc,
            )
            return None

    async def get_observability_snapshot(
        self,
        bureau_id: Optional[UUID],
        window_hours: int = 24,
    ) -> Optional[dict]:
        """
        Reads tenant-scoped observability metrics via SQL RPC.
        """
        try:
            from infrastructure.database.connection import get_supabase_client

            client = get_supabase_client()
            params = {
                "p_bureau_id": str(bureau_id) if bureau_id else None,
                "p_window_hours": int(window_hours),
            }
            resp = client.rpc("get_rag_observability_snapshot", params).execute()
            data = getattr(resp, "data", None)
            if isinstance(data, list):
                data = data[0] if data else None
            if not isinstance(data, dict):
                return None
            return data
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "OBSERVABILITY_READ_FAILED (non-fatal) | bureau_id=%s | window_hours=%s | error=%s",
                bureau_id,
                window_hours,
                exc,
            )
            return None


# ---------------------------------------------------------------------------
# Module-level singleton — injected into QueryLegalRAGUseCase at startup
# ---------------------------------------------------------------------------

supabase_audit_repository = SupabaseAuditRepository()
