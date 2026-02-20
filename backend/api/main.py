# ============================================================================
# Babylexit v3.0 - "Sovereign" Legal Engine
# FastAPI Main Entry Point with LangGraph Checkpointer
# ============================================================================

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import sys

# Infrastructure imports (will be created in next steps)
from infrastructure.database.connection import get_supabase_client, init_postgres_pool
from infrastructure.cache.redis_client import RedisClient
from infrastructure.agents.checkpoint import AsyncPostgresCheckpointer
from infrastructure.config import settings
from infrastructure.audit.audit_trail import audit_recorder as _audit_recorder
from infrastructure.database.supabase_audit_repository import SupabaseAuditRepository

# API routes
from api.routes import rag as rag_route       # Step 10 — RAG query endpoint
from api.routes import ingest as ingest_route  # Step 5/11 — Document ingest endpoint
# from api.routes import chat, search, admin  (future steps)
from api.middleware.privacy_gateway import PrivacyMiddleware
from api.middleware.tenant_middleware import TenantMiddleware

# ============================================================================
# Logging Configuration
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("babylexit")

# ============================================================================
# Application Lifecycle Management
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """
    Manages startup and shutdown of critical infrastructure:
    - Postgres connection pool (for LangGraph checkpointer)
    - Redis client (cache & pub/sub)
    - Supabase client (source of truth)
    """
    logger.info("🚀 Babylexit v3.0 - 'Sovereign' Legal Engine Starting...")
    
    # ========================================================================
    # STARTUP: Initialize infrastructure
    # ========================================================================
    
    # 1. Postgres Pool (for LangGraph AsyncPostgresCheckpointer)
    if settings.database_url:
        try:
            postgres_pool = await init_postgres_pool()
            app.state.postgres_pool = postgres_pool
            logger.info("✅ Postgres connection pool initialized (LangGraph checkpointer ready)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Postgres pool: {e}")
    else:
        logger.warning("⚠️ DATABASE_URL not set; skipping Postgres pool/checkpointer initialization")
    
    # 2. Redis Client (cache only, no persistent state)
    try:
        redis_client = RedisClient()
        await redis_client.connect()
        app.state.redis = redis_client
        logger.info("✅ Redis client connected (cache layer ready)")
    except Exception as e:
        logger.error(f"❌ Failed to connect to Redis: {e}")
    
    # 3. Supabase Client (source of truth for legal data)
    if settings.supabase_url and settings.supabase_service_key:
        try:
            supabase_client = get_supabase_client()
            app.state.supabase = supabase_client
            logger.info("✅ Supabase client initialized (knowledge base ready)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase: {e}")
    else:
        logger.warning("⚠️ SUPABASE_URL/SUPABASE_SERVICE_KEY not set; skipping Supabase initialization")
    
    # 4. Audit Trail DB persistence (Step 17)
    try:
        _audit_recorder.set_repository(SupabaseAuditRepository())
        logger.info("✅ Audit trail DB persistence enabled (SupabaseAuditRepository wired)")
    except Exception as e:
        logger.error(f"❌ Failed to enable audit trail DB persistence: {e}")

    # 5. LangGraph Checkpointer (persistent agent state)
    if hasattr(app.state, "postgres_pool"):
        try:
            checkpointer = AsyncPostgresCheckpointer(app.state.postgres_pool)
            await checkpointer.setup()
            app.state.checkpointer = checkpointer
            logger.info("✅ LangGraph checkpointer initialized (audit trail ready)")
        except Exception as e:
            logger.error(f"❌ Failed to initialize LangGraph checkpointer: {e}")
    else:
        logger.warning("⚠️ Postgres pool not available; skipping LangGraph checkpointer")
    
    logger.info("🎯 API started. Privacy-first gateway active.")
    
    yield  # Application runs here
    
    # ========================================================================
    # SHUTDOWN: Cleanup resources
    # ========================================================================
    
    logger.info("🛑 Shutting down Babylexit v3.0...")
    
    # Close Redis connection
    if hasattr(app.state, "redis"):
        await app.state.redis.disconnect()
        logger.info("✅ Redis client disconnected")
    
    # Close Postgres pool
    if hasattr(app.state, "postgres_pool"):
        await app.state.postgres_pool.close()
        logger.info("✅ Postgres connection pool closed")
    
    logger.info("👋 Shutdown complete. Goodbye!")

# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="Babylexit v3.0 - Sovereign Legal Engine",
    description=(
        "High-Integrity Legal Tech Platform with:\n"
        "- Privacy-First Gateway (PII masking)\n"
        "- Temporal Knowledge (time travel for statutes)\n"
        "- LangGraph Orchestration (checkpointed workflows)\n"
        "- Citation Engine (audit trail for every legal claim)"
    ),
    version="3.0.0",
    lifespan=lifespan,
)

# ============================================================================
# CORS Configuration (allow Next.js frontend)
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Next.js dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Privacy Middleware (CRITICAL: Must be first in chain)
# ============================================================================

# TenantMiddleware: resolves bureau_id from X-Bureau-ID header (Step 6)
app.add_middleware(TenantMiddleware)

app.add_middleware(PrivacyMiddleware)

# ============================================================================
# Health Check Endpoint
# ============================================================================

@app.get("/health", tags=["System"])
async def health_check(request: Request):
    """
    Health check endpoint for Docker healthcheck and monitoring.
    Returns status of critical infrastructure components.
    """
    components = {
        "api": True,
        "postgres": hasattr(request.app.state, "postgres_pool"),
        "redis": hasattr(request.app.state, "redis"),
        "supabase": hasattr(request.app.state, "supabase"),
        "checkpointer": hasattr(request.app.state, "checkpointer"),
    }

    health_status = {"status": "healthy", "components": components}
    
    # Check if any critical component is missing
    if not all(components.values()):
        health_status["status"] = "degraded"

    # Return 200 so the container can run even in dev/degraded mode.
    return JSONResponse(content=health_status, status_code=200)

# ============================================================================
# Root Endpoint
# ============================================================================

@app.get("/", tags=["System"])
async def root():
    """
    API root endpoint with system information.
    """
    return {
        "name": "Babylexit v3.0",
        "subtitle": "The Sovereign Legal Engine",
        "version": "3.0.0",
        "principles": [
            "Privacy-First (Zero Trust)",
            "Cost-Efficient Intelligence",
            "Temporal Legal Knowledge",
            "Auditability & Trust",
        ],
        "documentation": "/docs",
    }

# ============================================================================
# Error Handlers
# ============================================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler for uncaught errors.
    Logs the error and returns a sanitized response (no PII exposure).
    """
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": "An unexpected error occurred. Please contact support.",
        },
    )

# ============================================================================
# API Routes
# ============================================================================

# Step 10 — RAG query (event_date + decision_date + lehe kanun)
app.include_router(rag_route.router, prefix="/api/v1/rag", tags=["RAG"])

# Step 5/11 — Document ingest (OCR → parse → embed → upsert → async index)
app.include_router(ingest_route.router, prefix="/api/v1/ingest", tags=["Ingest"])

# Future steps:
# app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])
# app.include_router(search.router, prefix="/api/v1/search", tags=["Search"])
# app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])

# ============================================================================
# Development Helpers
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
