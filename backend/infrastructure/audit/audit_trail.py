"""
Legal Audit Trail  —  Step 17
==============================
Records an immutable, HMAC-signed audit entry for every RAG response.

Acceptance criterion (Step 17):
    "Sistem her cevabında; why-this-answer logu, kullanılan kaynak sürümleri,
    model kararı ve tool çağrıları şifreli kaydedilir."

Each LegalAuditEntry captures:
    request_id          — UUID4 for this specific request.
    timestamp_utc       — When the entry was created (UTC datetime).
    query_hash          — SHA-256 of the raw query (KVKK: no raw query stored).
    bureau_id           — Tenant bureau UUID (None = public / no tenant context).
    tier                — LLM tier used (1–4).
    model_used          — Full model label (e.g. "openai/gpt-4o-mini").
    source_versions     — Provenance snapshot for every source shown to the LLM.
    tool_calls_made     — Names of deterministic tools invoked (Step 14).
    grounding_ratio     — Fraction of sentences with ≥1 valid citation.
    disclaimer_severity — Legal disclaimer severity: INFO | WARNING | CRITICAL.
    latency_ms          — End-to-end request latency.
    cost_estimate_usd   — Estimated USD cost for this request.
    why_this_answer     — Human-readable reasoning log (KVKK-safe, no PII).
    audit_signature     — HMAC-SHA256 integrity digest.

HMAC-SHA256 signature covers (pipe-separated canonical string):
    query_hash | timestamp_utc(ISO) | tier | model_used |
    grounding_ratio(6dp) | cost_estimate_usd(6dp)

Any post-hoc modification of these fields will produce a signature mismatch
detectable by `verify_entry()`.

KVKK compliance:
    - Raw query is NEVER stored — only its SHA-256 hash.
    - Raw answer is NEVER stored.
    - Bureau IDs (UUIDs) carry no personal data.
    - Source IDs (UUIDs) carry no personal data.

Design:
    - LegalAuditEntry and SourceVersionRecord are frozen dataclasses
      (immutable after construction).
    - AuditTrailRecorder.record() is the single entry point — builds, signs,
      and logs the entry in one atomic call.
    - Logging: structured JSON-like log line via stdlib logging at INFO level.
    - Persistence: currently logging-only; a future migration can write entries
      to a Supabase audit_log table without changing the record() API.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, List, Optional

from infrastructure.config import settings

logger = logging.getLogger("babylexit.audit_trail")


# ---------------------------------------------------------------------------
# Immutable data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SourceVersionRecord:
    """
    Provenance snapshot for a single source document used by the LLM.

    Captured at response-generation time so that the exact document version
    shown to the LLM is permanently recorded in the audit trail.

    Attributes:
        doc_id         : Document UUID.
        citation       : Short canonical citation (e.g. "İş Kanunu md. 17").
        version        : Source version tag (YYYY-MM-DD or decision number).
        collected_at   : ISO-8601 string of the ingestion timestamp, or None.
        norm_hierarchy : Norm hierarchy tier (ANAYASA, KANUN, …) or None.
        authority_score: Computed authority score [0, 1].
    """

    doc_id: str
    citation: Optional[str]
    version: Optional[str]
    collected_at: Optional[str]    # ISO-8601 string; None when not set
    norm_hierarchy: Optional[str]
    authority_score: float


@dataclass(frozen=True)
class LegalAuditEntry:
    """
    Immutable, tamper-evident audit record for one RAG response.

    The ``audit_signature`` field is an HMAC-SHA256 hex digest.
    It covers: query_hash | timestamp_utc | tier | model_used |
               grounding_ratio | cost_estimate_usd
    Use ``verify_entry()`` to validate integrity.
    """

    request_id: str                             # UUID4
    timestamp_utc: datetime                     # timezone-aware UTC
    query_hash: str                             # SHA-256 hex of the raw query
    bureau_id: Optional[str]                    # Tenant bureau UUID or None
    tier: int                                   # 1–4
    model_used: str                             # "provider/model_id[+fallback]"
    source_versions: List[SourceVersionRecord]  # Provenance snapshots
    tool_calls_made: List[str]                  # Step 14 tool names
    grounding_ratio: float                      # [0.0, 1.0]
    disclaimer_severity: str                    # INFO | WARNING | CRITICAL
    latency_ms: int
    cost_estimate_usd: float
    why_this_answer: str                        # Human-readable, KVKK-safe log
    audit_signature: str                        # HMAC-SHA256 hex digest


# ---------------------------------------------------------------------------
# Cryptographic helpers  (pure functions — zero side effects)
# ---------------------------------------------------------------------------

def sha256_hex(text: str) -> str:
    """Returns SHA-256 hex digest of UTF-8 encoded text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hmac_sha256(payload: str, secret: str) -> str:
    """Returns HMAC-SHA256 hex digest of *payload* keyed with *secret*."""
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _canonical_payload(
    query_hash: str,
    timestamp_iso: str,
    tier: int,
    model_used: str,
    grounding_ratio: float,
    cost_estimate_usd: float,
) -> str:
    """
    Deterministic pipe-separated canonical string for HMAC signing.

    Field order is fixed; values are rendered deterministically
    (floats rounded to 6 d.p.).  The '|' separator is safe because
    none of the fields can contain that character.
    """
    return (
        f"{query_hash}"
        f"|{timestamp_iso}"
        f"|{tier}"
        f"|{model_used}"
        f"|{grounding_ratio:.6f}"
        f"|{cost_estimate_usd:.6f}"
    )


def verify_entry(entry: LegalAuditEntry, secret: Optional[str] = None) -> bool:
    """
    Verifies the HMAC-SHA256 signature of a LegalAuditEntry.

    Returns True when the entry is unmodified.

    Args:
        entry  : The audit entry to verify.
        secret : Signing secret (defaults to settings.jwt_secret_key).
    """
    _secret = secret or settings.jwt_secret_key
    payload = _canonical_payload(
        query_hash=entry.query_hash,
        timestamp_iso=entry.timestamp_utc.isoformat(),
        tier=entry.tier,
        model_used=entry.model_used,
        grounding_ratio=entry.grounding_ratio,
        cost_estimate_usd=entry.cost_estimate_usd,
    )
    expected = hmac_sha256(payload, _secret)
    return hmac.compare_digest(entry.audit_signature, expected)


# ---------------------------------------------------------------------------
# Why-this-answer builder  (pure function)
# ---------------------------------------------------------------------------

def _build_why_this_answer(
    tier: int,
    tier_reason: str,
    source_count: int,
    top_citation: Optional[str],
    grounding_ratio: float,
    disclaimer_severity: str,
    tool_calls: List[str],
) -> str:
    """
    Builds a human-readable 'why this answer' explanation log.

    Designed for compliance reviewers — no PII, no raw content.
    """
    parts: List[str] = [
        f"[TİER {tier}] {tier_reason}.",
        f"Kaynak sayısı: {source_count}.",
    ]
    if top_citation:
        parts.append(f"Öncelikli kaynak: {top_citation}.")
    parts.append(
        f"Grounding oranı: {grounding_ratio * 100:.1f}% "
        f"({'tam grounding' if grounding_ratio >= 1.0 else 'kısmi grounding'})."
    )
    if tool_calls:
        parts.append(f"Araç çağrıları: {', '.join(tool_calls)}.")
    parts.append(f"Hukuki uyarı seviyesi: {disclaimer_severity}.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Recorder
# ---------------------------------------------------------------------------

class AuditTrailRecorder:
    """
    Builds, signs, and logs a LegalAuditEntry for each RAG response.

    This class is stateless — safe as a module-level singleton.

    Usage (called from RAGService after response construction):

        entry = audit_recorder.record(
            query=request.query,
            bureau_id=_bureau_id,
            tier=tier_decision.tier.value,
            tier_reason=tier_decision.reason,
            model_used=model_used,
            source_docs=used_docs,
            tool_calls=dispatch_result.tools_invoked,
            grounding_ratio=_zt_report.grounding_ratio,
            disclaimer_severity=_legal_disclaimer.severity,
            latency_ms=latency_ms,
            cost_estimate_usd=cost_est.total_cost_usd,
        )
    """

    def record(
        self,
        query: str,
        bureau_id: Optional[str],
        tier: int,
        tier_reason: str,
        model_used: str,
        source_docs: List[Any],         # List[LegalDocument]
        tool_calls: List[str],
        grounding_ratio: float,
        disclaimer_severity: str,
        latency_ms: int,
        cost_estimate_usd: float,
    ) -> LegalAuditEntry:
        """
        Builds and returns a signed LegalAuditEntry.  Also emits an INFO log.

        Args:
            query              : Raw user query (hashed; NEVER stored as-is).
            bureau_id          : Tenant bureau UUID, or None for public access.
            tier               : LLM tier value (1–4).
            tier_reason        : Human-readable routing reason (TierDecision.reason).
            model_used         : Full model label ("provider/model_id[+fallback]").
            source_docs        : LegalDocument entities given to the LLM as context.
            tool_calls         : Names of deterministic tools invoked (Step 14).
            grounding_ratio    : Fraction of grounded sentences [0.0, 1.0].
            disclaimer_severity: "INFO" | "WARNING" | "CRITICAL".
            latency_ms         : End-to-end request latency in milliseconds.
            cost_estimate_usd  : Estimated cost in USD.

        Returns:
            LegalAuditEntry — frozen, immutable, HMAC-signed.
        """
        request_id    = str(uuid.uuid4())
        timestamp_utc = datetime.now(tz=timezone.utc)
        query_hash    = sha256_hex(query)

        # Build provenance snapshots from source documents
        source_versions: List[SourceVersionRecord] = [
            SourceVersionRecord(
                doc_id=doc.id,
                citation=doc.citation,
                version=doc.version,
                collected_at=(
                    doc.collected_at.isoformat() if doc.collected_at else None
                ),
                norm_hierarchy=doc.norm_hierarchy,
                authority_score=float(doc.authority_score),
            )
            for doc in source_docs
        ]

        top_citation = source_docs[0].citation if source_docs else None

        why_this_answer = _build_why_this_answer(
            tier=tier,
            tier_reason=tier_reason,
            source_count=len(source_docs),
            top_citation=top_citation,
            grounding_ratio=grounding_ratio,
            disclaimer_severity=disclaimer_severity,
            tool_calls=tool_calls,
        )

        # Sign the core fields
        payload = _canonical_payload(
            query_hash=query_hash,
            timestamp_iso=timestamp_utc.isoformat(),
            tier=tier,
            model_used=model_used,
            grounding_ratio=grounding_ratio,
            cost_estimate_usd=cost_estimate_usd,
        )
        audit_signature = hmac_sha256(payload, settings.jwt_secret_key)

        entry = LegalAuditEntry(
            request_id=request_id,
            timestamp_utc=timestamp_utc,
            query_hash=query_hash,
            bureau_id=bureau_id,
            tier=tier,
            model_used=model_used,
            source_versions=source_versions,
            tool_calls_made=list(tool_calls),
            grounding_ratio=round(grounding_ratio, 4),
            disclaimer_severity=disclaimer_severity,
            latency_ms=latency_ms,
            cost_estimate_usd=round(cost_estimate_usd, 6),
            why_this_answer=why_this_answer,
            audit_signature=audit_signature,
        )

        logger.info(
            "AUDIT_TRAIL | request_id=%s | tier=%d | model=%s | "
            "sources=%d | grounding=%.2f | cost=$%.6f | latency=%dms | "
            "severity=%s | sig=%s...",
            request_id,
            tier,
            model_used,
            len(source_versions),
            grounding_ratio,
            cost_estimate_usd,
            latency_ms,
            disclaimer_severity,
            audit_signature[:16],
        )

        return entry


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

audit_recorder = AuditTrailRecorder()
