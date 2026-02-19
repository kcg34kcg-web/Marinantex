"""
Database Connection Management
Provides Supabase client and Postgres connection pool for LangGraph checkpointer.
"""

import asyncpg
from supabase import create_client, Client
from typing import Optional
import logging

from infrastructure.config import settings

logger = logging.getLogger("babylexit.database")


# ============================================================================
# Supabase Client (Source of Truth)
# ============================================================================

_supabase_client: Optional[Client] = None


def get_supabase_client() -> Client:
    """
    Returns singleton Supabase client instance.
    Used for business logic queries (cases, documents, legal knowledge).
    """
    global _supabase_client
    
    if _supabase_client is None:
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError(
                "Supabase settings missing. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env or container env."
            )
        logger.info("Initializing Supabase client...")
        _supabase_client = create_client(
            settings.supabase_url,
            settings.supabase_service_key,
        )
        logger.info("✅ Supabase client initialized")
    
    return _supabase_client


# ============================================================================
# Postgres Connection Pool (for LangGraph Checkpointer)
# ============================================================================

_postgres_pool: Optional[asyncpg.Pool] = None


async def init_postgres_pool() -> asyncpg.Pool:
    """
    Initializes asyncpg connection pool for direct Postgres access.
    Used exclusively by LangGraph AsyncPostgresCheckpointer for state persistence.
    
    Returns:
        asyncpg.Pool: Connection pool instance
    """
    global _postgres_pool
    
    if _postgres_pool is None:
        logger.info("Creating Postgres connection pool for LangGraph checkpointer...")
        
        _postgres_pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=5,
            max_size=20,
            command_timeout=60,
            # Optimize for checkpoint writes
            max_cached_statement_lifetime=300,
            max_cacheable_statement_size=1024 * 15,
        )
        
        logger.info("✅ Postgres pool created (min: 5, max: 20 connections)")
    
    return _postgres_pool


async def close_postgres_pool():
    """
    Closes the Postgres connection pool.
    Called during application shutdown.
    """
    global _postgres_pool
    
    if _postgres_pool is not None:
        logger.info("Closing Postgres connection pool...")
        await _postgres_pool.close()
        _postgres_pool = None
        logger.info("✅ Postgres pool closed")


# ============================================================================
# Health Check
# ============================================================================

async def check_database_health() -> bool:
    """
    Checks if database connections are healthy.
    
    Returns:
        bool: True if all connections are operational
    """
    try:
        # Check Supabase
        supabase = get_supabase_client()
        supabase.table("profiles").select("id").limit(1).execute()
        
        # Check Postgres pool
        if _postgres_pool is not None:
            async with _postgres_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        
        return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False
