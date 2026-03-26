"""Infrastructure package.

Keep package import lightweight and avoid pulling optional runtime dependencies
during test/module collection.
"""

from __future__ import annotations

from infrastructure.config import settings

__all__ = [
    "settings",
    "get_supabase_client",
    "init_postgres_pool",
    "close_postgres_pool",
    "RedisClient",
    "AsyncPostgresCheckpointer",
]


def __getattr__(name: str):
    if name in {"get_supabase_client", "init_postgres_pool", "close_postgres_pool"}:
        from infrastructure.database.connection import (
            close_postgres_pool,
            get_supabase_client,
            init_postgres_pool,
        )

        mapping = {
            "get_supabase_client": get_supabase_client,
            "init_postgres_pool": init_postgres_pool,
            "close_postgres_pool": close_postgres_pool,
        }
        return mapping[name]

    if name == "RedisClient":
        from infrastructure.cache.redis_client import RedisClient

        return RedisClient

    if name == "AsyncPostgresCheckpointer":
        from infrastructure.agents.checkpoint import AsyncPostgresCheckpointer

        return AsyncPostgresCheckpointer

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
