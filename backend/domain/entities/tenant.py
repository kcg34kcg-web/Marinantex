"""
Tenant Domain Objects — Step 6: KVKK Güvenliği ve Multi-Tenancy
================================================================
Pure Python domain model for multi-tenant (multi-bureau) isolation.

Design:
    A "bureau" (büro) is a law firm or independent lawyer account that forms
    the primary unit of tenant isolation in the system.

    Bureau isolation contract:
        • Documents with bureau_id = NULL are PUBLIC (mevzuat, içtihat).
          They are accessible to EVERY bureau.
        • Documents with bureau_id = <uuid> are PRIVATE to that bureau.
          They are inaccessible to any other bureau — enforced at both
          the SQL RLS layer (Step 6 migration) and the Python retrieval
          layer (bureau_id passed to hybrid_legal_search RPC).

    KVKK data minimisation:
        • TenantContext carries only the bureau_id and user_id needed for
          routing decisions — never personal data.
        • KVKKRedactor (infrastructure/security/kvkk_redactor.py) handles
          PII stripping from prompts and logs.

Immutability:
    Bureau and TenantContext are frozen dataclasses — once created by the
    middleware they must not be mutated downstream.  Any modification
    attempt raises FrozenInstanceError at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ============================================================================
# AccessLevel — RBAC role within a bureau
# ============================================================================

class AccessLevel(str, Enum):
    """
    Role-based access level within a bureau.

    OWNER:      Bureau administrator — can add/remove members, delete documents.
    MEMBER:     Regular lawyer or assistant — full read/write within the bureau.
    READ_ONLY:  Observer — can query but not modify.  Also used for anonymous
                requests in development mode.
    """

    OWNER     = "OWNER"
    MEMBER    = "MEMBER"
    READ_ONLY = "READ_ONLY"


# ============================================================================
# Bureau — law firm / tenant entity
# ============================================================================

@dataclass(frozen=True)
class Bureau:
    """
    Immutable law-firm / bureau entity.

    Mirrors the ``bureaus`` database table (Step 6 SQL migration).

    plan_tier values (enforced by DB CHECK constraint):
        FREE        — single-user plan, limited document storage
        PRO         — multi-user, full feature set
        ENTERPRISE  — white-label, custom SLA, audit trail export
    """

    id: str
    name: str
    slug: str
    plan_tier: str = "FREE"
    is_active: bool = True


# ============================================================================
# TenantContext — request-scoped identity + access descriptor
# ============================================================================

@dataclass(frozen=True)
class TenantContext:
    """
    Immutable, request-scoped tenant security context.

    Created by ``TenantMiddleware`` from the incoming HTTP request and
    attached to ``request.state.tenant``.  Consumed by:
        - RAGService  → passes bureau_id to retrieval
        - RetrieverClient → passes bureau_id to SQL RPC (hybrid_legal_search)
        - KVKKRedactor → used to tag audit records with bureau context

    Fields:
        bureau_id:          UUID of the caller's bureau (None = public / service).
        user_id:            UUID of the authenticated user (None = service account).
        access_level:       RBAC level within the bureau.
        is_service_account: True for background workers, ingestion jobs, etc.
                            Service accounts bypass bureau isolation.

    Properties:
        is_isolated:        True when bureau_id is set AND not a service account.
                            In isolated mode, the retrieval layer MUST apply
                            bureau_id filtering.
    """

    bureau_id: Optional[str]
    user_id: Optional[str]
    access_level: AccessLevel
    plan_tier: str = "FREE"
    messages_today: Optional[int] = None
    tokens_used_month: Optional[int] = None
    is_service_account: bool = False

    @classmethod
    def anonymous(cls) -> "TenantContext":
        """
        Returns a TenantContext for unauthenticated/anonymous access.

        Used in development mode when no X-Bureau-ID header is provided.
        In production, anonymous requests are blocked at the middleware layer.
        bureau_id = None → retrieval returns only public documents.
        """
        return cls(
            bureau_id=None,
            user_id=None,
            access_level=AccessLevel.READ_ONLY,
            plan_tier="FREE",
        )

    @classmethod
    def service(cls) -> "TenantContext":
        """
        Returns a TenantContext for internal service accounts.

        Service accounts (e.g. the ingest pipeline, background jobs) bypass
        bureau isolation: bureau_id = None makes hybrid_legal_search return
        ALL documents regardless of bureau ownership.
        """
        return cls(
            bureau_id=None,
            user_id=None,
            access_level=AccessLevel.OWNER,
            plan_tier="ENTERPRISE",
            is_service_account=True,
        )

    @property
    def is_isolated(self) -> bool:
        """
        True when this context enforces bureau-level document isolation.

        Isolation is active when:
            1. bureau_id is set (not None), AND
            2. this is NOT a service account.

        When is_isolated is True, the retrieval layer MUST pass bureau_id to
        hybrid_legal_search to prevent cross-bureau data leakage.
        """
        return self.bureau_id is not None and not self.is_service_account
