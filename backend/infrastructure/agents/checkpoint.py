"""
LangGraph AsyncPostgresCheckpointer
Persistent agent state storage in Postgres for full audit trail.
"""

import asyncpg
from typing import Optional, Dict, Any
import json
import logging
from datetime import datetime

from infrastructure.config import settings

logger = logging.getLogger("babylexit.checkpointer")


class AsyncPostgresCheckpointer:
    """
    Custom implementation of LangGraph checkpointer using asyncpg.
    
    Purpose:
        - Persist agent workflow state to Postgres
        - Enable time-travel debugging (replay from any checkpoint)
        - Provide full audit trail for legal compliance
        - Support multi-turn conversations with memory
    
    Schema:
        - checkpoint_id: UUID (primary key)
        - thread_id: str (conversation/session identifier)
        - checkpoint_ns: str (namespace for checkpoint type)
        - step: int (workflow step number)
        - data: jsonb (serialized state)
        - metadata: jsonb (additional context)
        - created_at: timestamptz
    
    Note: In PHASE 2, we'll integrate official langgraph-checkpoint-postgres.
    This is a minimal implementation for PHASE 1 infrastructure setup.
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self.table_name = settings.checkpoint_table_name
    
    async def setup(self):
        """
        Creates checkpoint table if it doesn't exist.
        Called during application startup.
        """
        logger.info(f"Setting up checkpoint table: {self.table_name}")
        
        async with self.pool.acquire() as conn:
            # Supabase commonly enables uuid-ossp; ensure it's present.
            # Using uuid_generate_v4() avoids requiring pgcrypto/gen_random_uuid().
            await conn.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    checkpoint_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    thread_id TEXT NOT NULL,
                    checkpoint_ns TEXT NOT NULL DEFAULT '',
                    step INTEGER NOT NULL,
                    data JSONB NOT NULL,
                    metadata JSONB DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    
                    -- Index for fast thread lookups
                    CONSTRAINT unique_thread_step UNIQUE (thread_id, checkpoint_ns, step)
                );
                
                -- Indexes for efficient queries
                CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id 
                    ON {self.table_name} (thread_id);
                
                CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at 
                    ON {self.table_name} (created_at DESC);
                
                CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_step 
                    ON {self.table_name} (thread_id, step DESC);
            """)
        
        logger.info(f"✅ Checkpoint table '{self.table_name}' ready")
    
    async def put(
        self,
        thread_id: str,
        step: int,
        data: Dict[str, Any],
        checkpoint_ns: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Saves a checkpoint to Postgres.
        
        Args:
            thread_id: Conversation/session identifier
            step: Workflow step number
            data: State data to persist
            checkpoint_ns: Namespace (e.g., "agent:planner")
            metadata: Additional context
            
        Returns:
            checkpoint_id: UUID of created checkpoint
        """
        async with self.pool.acquire() as conn:
            result = await conn.fetchrow(
                f"""
                INSERT INTO {self.table_name} (
                    thread_id, checkpoint_ns, step, data, metadata
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (thread_id, checkpoint_ns, step)
                DO UPDATE SET
                    data = EXCLUDED.data,
                    metadata = EXCLUDED.metadata,
                    created_at = NOW()
                RETURNING checkpoint_id
                """,
                thread_id,
                checkpoint_ns,
                step,
                json.dumps(data),
                json.dumps(metadata or {}),
            )
        
        checkpoint_id = str(result["checkpoint_id"])
        logger.debug(f"Checkpoint saved: {checkpoint_id} (thread={thread_id}, step={step})")
        return checkpoint_id
    
    async def get(
        self,
        thread_id: str,
        step: Optional[int] = None,
        checkpoint_ns: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves a checkpoint from Postgres.
        
        Args:
            thread_id: Conversation identifier
            step: Specific step (None = latest)
            checkpoint_ns: Namespace filter
            
        Returns:
            Checkpoint data or None if not found
        """
        async with self.pool.acquire() as conn:
            if step is not None:
                # Get specific step
                result = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step, 
                           data, metadata, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1 
                      AND checkpoint_ns = $2 
                      AND step = $3
                    """,
                    thread_id,
                    checkpoint_ns,
                    step,
                )
            else:
                # Get latest step
                result = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step, 
                           data, metadata, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1 AND checkpoint_ns = $2
                    ORDER BY step DESC
                    LIMIT 1
                    """,
                    thread_id,
                    checkpoint_ns,
                )
        
        if result is None:
            return None
        
        return {
            "checkpoint_id": str(result["checkpoint_id"]),
            "thread_id": result["thread_id"],
            "checkpoint_ns": result["checkpoint_ns"],
            "step": result["step"],
            "data": json.loads(result["data"]) if isinstance(result["data"], str) else result["data"],
            "metadata": json.loads(result["metadata"]) if isinstance(result["metadata"], str) else result["metadata"],
            "created_at": result["created_at"].isoformat(),
        }
    
    async def list_checkpoints(
        self,
        thread_id: str,
        checkpoint_ns: str = "",
        limit: int = 50,
    ) -> list[Dict[str, Any]]:
        """
        Lists all checkpoints for a thread (for debugging/audit).
        
        Args:
            thread_id: Conversation identifier
            checkpoint_ns: Namespace filter
            limit: Maximum number of results
            
        Returns:
            List of checkpoints (newest first)
        """
        async with self.pool.acquire() as conn:
            results = await conn.fetch(
                f"""
                SELECT checkpoint_id, thread_id, checkpoint_ns, step, 
                       data, metadata, created_at
                FROM {self.table_name}
                WHERE thread_id = $1 AND checkpoint_ns = $2
                ORDER BY step DESC
                LIMIT $3
                """,
                thread_id,
                checkpoint_ns,
                limit,
            )
        
        return [
            {
                "checkpoint_id": str(row["checkpoint_id"]),
                "thread_id": row["thread_id"],
                "checkpoint_ns": row["checkpoint_ns"],
                "step": row["step"],
                "data": json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
                "metadata": json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"],
                "created_at": row["created_at"].isoformat(),
            }
            for row in results
        ]
    
    async def delete_thread(self, thread_id: str, checkpoint_ns: str = ""):
        """
        Deletes all checkpoints for a thread.
        
        Args:
            thread_id: Conversation identifier
            checkpoint_ns: Namespace filter (empty = delete all namespaces)
        """
        async with self.pool.acquire() as conn:
            if checkpoint_ns:
                await conn.execute(
                    f"DELETE FROM {self.table_name} WHERE thread_id = $1 AND checkpoint_ns = $2",
                    thread_id,
                    checkpoint_ns,
                )
            else:
                await conn.execute(
                    f"DELETE FROM {self.table_name} WHERE thread_id = $1",
                    thread_id,
                )
        
        logger.info(f"Deleted checkpoints for thread: {thread_id}")
