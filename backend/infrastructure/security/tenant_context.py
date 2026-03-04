"""
Tenant Context Extractor — Step 6: KVKK Güvenliği ve Multi-Tenancy
===================================================================
Utilities for extracting, validating, and building TenantContext objects
from incoming HTTP requests.

This module owns the rules for WHAT is a valid bureau_id.  The middleware
(api/middleware/tenant_middleware.py) delegates to these pure functions so
they can be unit-tested without an ASGI test client.

Architecture:
    HTTP Request
        │  X-Bureau-ID: <uuid>
        │  X-User-ID:   <uuid>          (optional)
        ▼
    extract_bureau_id_from_headers()   — reads header string
    validate_bureau_id()               — checks UUID4 format
    build_tenant_context()             — assembles TenantContext
        │
        ▼
    request.state.tenant = TenantContext(...)
        │
        ▼
    RAGService → RetrieverClient → SQL RPC (p_bureau_id = ...)

Production note:
    In a full Supabase auth flow, bureau_id should be extracted from the
    authenticated JWT claims (auth.uid() → profiles → bureau_id) rather than
    from a custom header.  The header-based approach is used here as a clean
    interface that is easy to swap for JWT parsing in production.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from domain.entities.tenant import AccessLevel, TenantContext

logger = logging.getLogger("babylexit.tenant_context")

# ---------------------------------------------------------------------------
# UUID4 validation pattern
# ---------------------------------------------------------------------------

_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Pure utility functions — no side effects, fully unit-testable
# ---------------------------------------------------------------------------

def validate_bureau_id(bureau_id: Optional[str]) -> bool:
    """
    Returns True if ``bureau_id`` is a syntactically valid UUID4.

    Args:
        bureau_id: Candidate string (from header, JWT claim, etc.).

    Returns:
        True  → valid UUID4 format.
        False → None, empty string, or malformed.

    Note: This validates FORMAT only.  The bureau must still exist in
    the ``bureaus`` DB table — that check is done at the SQL layer via FK.
    """
    if not bureau_id:
        return False
    return bool(_UUID4_RE.match(bureau_id.strip()))


def extract_bureau_id_from_headers(headers: dict) -> Optional[str]:
    """
    Extracts ``X-Bureau-ID`` from a header dict (or any mapping).

    Args:
        headers: Dict-like object of request headers (case-insensitive keys
                 when using Starlette's Headers object).

    Returns:
        Raw header value, or None if the header is absent/empty.
    """
    raw = headers.get("x-bureau-id") or headers.get("X-Bureau-ID")
    return raw.strip() if raw and raw.strip() else None


def extract_user_id_from_headers(headers: dict) -> Optional[str]:
    """
    Extracts ``X-User-ID`` from a header dict.

    In production this should come from the JWT sub claim.
    Here it is read from an explicit header for simplicity.
    """
    raw = headers.get("x-user-id") or headers.get("X-User-ID")
    return raw.strip() if raw and raw.strip() else None


def extract_plan_tier_from_headers(headers: dict) -> str:
    raw = headers.get("x-plan-tier") or headers.get("X-Plan-Tier")
    value = raw.strip().upper() if isinstance(raw, str) and raw.strip() else "FREE"
    if value not in {"FREE", "TRIAL", "PRO", "ENTERPRISE"}:
        return "FREE"
    return value


def _extract_optional_int(headers: dict, lower_key: str, title_key: str) -> Optional[int]:
    raw = headers.get(lower_key) or headers.get(title_key)
    if raw is None:
        return None
    try:
        value = int(str(raw).strip())
    except Exception:
        return None
    return value if value >= 0 else None


def build_tenant_context(
    bureau_id: Optional[str],
    user_id: Optional[str] = None,
    access_level: AccessLevel = AccessLevel.MEMBER,
    plan_tier: str = "FREE",
    messages_today: Optional[int] = None,
    tokens_used_month: Optional[int] = None,
) -> TenantContext:
    """
    Creates a TenantContext from the extracted and validated identifiers.

    Args:
        bureau_id:    Validated bureau UUID, or None for public/service access.
        user_id:      Authenticated user UUID (optional; None for service accounts).
        access_level: RBAC level within the bureau.  Defaults to MEMBER.

    Returns:
        Immutable TenantContext ready for injection into request.state.tenant.
    """
    ctx = TenantContext(
        bureau_id=bureau_id,
        user_id=user_id,
        access_level=access_level,
        plan_tier=plan_tier,
        messages_today=messages_today,
        tokens_used_month=tokens_used_month,
    )
    logger.debug(
        "TENANT_CTX | bureau_id=%s | user_id=%s | level=%s | isolated=%s",
        bureau_id, user_id, access_level.value, ctx.is_isolated,
    )
    return ctx


# ---------------------------------------------------------------------------
# TenantContextExtractor class — wraps the functions for DI / testability
# ---------------------------------------------------------------------------

class TenantContextExtractor:
    """
    Stateless helper that builds a TenantContext from a Starlette/FastAPI
    request object.

    Inject an instance for unit testing; use the module-level singleton
    ``tenant_extractor`` in production.

    Usage:
        ctx = tenant_extractor.from_headers(request.headers)
        request.state.tenant = ctx
    """

    def from_headers(self, headers: dict) -> TenantContext:
        """
        Builds a TenantContext by reading X-Bureau-ID / X-User-ID headers.

        If bureau_id is absent or invalid → returns TenantContext.anonymous().
        The caller (TenantMiddleware) is responsible for enforcing that an
        anonymous context is blocked in production.

        Args:
            headers: Starlette Headers or plain dict.

        Returns:
            TenantContext — always returns, never raises.
        """
        bureau_id = extract_bureau_id_from_headers(headers)
        user_id   = extract_user_id_from_headers(headers)
        plan_tier = extract_plan_tier_from_headers(headers)
        messages_today = _extract_optional_int(headers, "x-messages-today", "X-Messages-Today")
        tokens_used_month = _extract_optional_int(headers, "x-tokens-used-month", "X-Tokens-Used-Month")

        if bureau_id and not validate_bureau_id(bureau_id):
            logger.warning(
                "INVALID_BUREAU_ID: '%s' is not a valid UUID4 — using anonymous context.",
                bureau_id,
            )
            return TenantContext.anonymous()

        return build_tenant_context(
            bureau_id=bureau_id,
            user_id=user_id,
            plan_tier=plan_tier,
            messages_today=messages_today,
            tokens_used_month=tokens_used_month,
        )


# Module-level singleton
tenant_extractor = TenantContextExtractor()
