"""
Tenant Middleware — Step 6: KVKK Güvenliği ve Multi-Tenancy
============================================================
FastAPI/Starlette middleware that enforces bureau (multi-tenant) isolation
at the HTTP request boundary.

Responsibilities:
    1. Extract X-Bureau-ID and X-User-ID from request headers.
    2. Validate X-Bureau-ID is a syntactically valid UUID4.
    3. In production (or when tenant_enforce_in_dev=True):
       - Block requests that lack X-Bureau-ID with HTTP 401.
       - Block requests with a malformed X-Bureau-ID with HTTP 400.
    4. In development (tenant_enforce_in_dev=False):
       - Allow requests without X-Bureau-ID (attaches anonymous context).
    5. Attach a TenantContext to request.state.tenant.
    6. Skip paths listed in SKIP_PATHS (health, docs, metrics).

The TenantContext is then read by:
    - RAGService.query()  → extracts bureau_id for retrieval scoping
    - RetrieverClient.search()  → passes bureau_id to SQL RPC

Security invariant:
    After this middleware runs, every request that reaches the route layer
    has a non-None TenantContext at request.state.tenant.
    In production, requests without a valid bureau_id never reach the route.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from domain.entities.tenant import TenantContext
from infrastructure.config import settings
from infrastructure.security.tenant_context import (
    tenant_extractor,
    validate_bureau_id,
    extract_bureau_id_from_headers,
)

logger = logging.getLogger("babylexit.tenant_middleware")

# Paths that bypass tenant enforcement (health checks, API docs, metrics)
SKIP_PATHS: frozenset[str] = frozenset({
    "/health",
    "/healthz",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
})


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Bureau isolation middleware.

    Register in FastAPI app AFTER CORSMiddleware so CORS pre-flight requests
    pass through without a bureau_id requirement:

        app.add_middleware(CORSMiddleware, ...)
        app.add_middleware(TenantMiddleware)

    In development (settings.tenant_enforce_in_dev = False):
        Missing bureau_id → attaches TenantContext.anonymous() and continues.
        This allows running the test suite without providing bureau headers.

    In production (settings.is_production = True):
        Missing bureau_id → returns HTTP 401 immediately.
        Malformed bureau_id → returns HTTP 400.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # 1. Skip enforcement for health / docs paths
        if request.url.path in SKIP_PATHS:
            request.state.tenant = TenantContext.anonymous()
            return await call_next(request)

        # 2. Multi-tenancy disabled globally → anonymous context for all
        if not settings.multi_tenancy_enabled:
            request.state.tenant = TenantContext.anonymous()
            return await call_next(request)

        # 3. Extract raw bureau_id from headers
        bureau_id = extract_bureau_id_from_headers(dict(request.headers))
        enforce   = settings.is_production or settings.tenant_enforce_in_dev

        # 4. Missing bureau_id
        if not bureau_id:
            if enforce:
                logger.warning(
                    "TENANT_MISSING | path=%s | method=%s",
                    request.url.path, request.method,
                )
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "TENANT_REQUIRED",
                        "message": (
                            "X-Bureau-ID başlığı zorunludur. "
                            "Lütfen geçerli bir büro UUID'si gönderin."
                        ),
                    },
                )
            # Development mode — allow without bureau_id
            request.state.tenant = TenantContext.anonymous()
            logger.debug(
                "TENANT_ANONYMOUS | path=%s | dev_mode=True",
                request.url.path,
            )
            return await call_next(request)

        # 5. Validate UUID4 format
        if not validate_bureau_id(bureau_id):
            logger.warning(
                "TENANT_INVALID_UUID | bureau_id=%r | path=%s",
                bureau_id, request.url.path,
            )
            return JSONResponse(
                status_code=400,
                content={
                    "error": "INVALID_BUREAU_ID",
                    "message": (
                        f"X-Bureau-ID geçerli bir UUID4 değil: '{bureau_id}'. "
                        "Lütfen doğru formatta büro kimliği gönderin."
                    ),
                },
            )

        # 6. Build and attach TenantContext
        tenant = tenant_extractor.from_headers(dict(request.headers))
        request.state.tenant = tenant
        logger.debug(
            "TENANT_OK | bureau_id=%s | user_id=%s | isolated=%s | path=%s",
            tenant.bureau_id, tenant.user_id, tenant.is_isolated,
            request.url.path,
        )
        return await call_next(request)
