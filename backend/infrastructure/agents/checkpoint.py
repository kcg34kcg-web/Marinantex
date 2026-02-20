"""
LangGraph AsyncPostgresCheckpointer — BaseCheckpointSaver implementation
=========================================================================
Persistent agent state storage in Postgres for full audit trail.

Implements the LangGraph BaseCheckpointSaver async interface using asyncpg,
so this checkpointer can be passed directly to StateGraph.compile().

Schema (managed by supabase/rag_v2_step16_checkpoint.sql):
    checkpoint_id : UUID       — primary key (matches LangGraph checkpoint["id"])
    thread_id     : text       — conversation / session identifier
    checkpoint_ns : text       — namespace (default "")
    step          : int        — workflow step (from CheckpointMetadata["step"])
    data          : jsonb      — full serialised Checkpoint dict
    metadata      : jsonb      — CheckpointMetadata + _parent_checkpoint_id
    bureau_id     : text       — tenant UUID for RLS (NULL = public)
    created_at    : timestamptz

Tenant isolation (Step 6 / P1.3):
    bureau_id is stored in every row.  Pass it via
    config["configurable"]["bureau_id"] so RLS can be verified server-side
    even when the service-role key bypasses it client-side.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Sequence

import asyncpg
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)

from infrastructure.config import settings

logger = logging.getLogger("babylexit.checkpointer")


def _load_json(value: Any) -> Any:
    """Deserialise asyncpg jsonb values (may arrive as str or dict)."""
    if isinstance(value, str):
        return json.loads(value)
    if isinstance(value, dict):
        return dict(value)
    return value or {}


class AsyncPostgresCheckpointer(BaseCheckpointSaver):
    """
    LangGraph-compatible checkpoint saver backed by asyncpg + Postgres.

    Implements the full BaseCheckpointSaver async interface so this class
    can be passed directly to ``StateGraph.compile(checkpointer=...)``.

    Also exposes convenience methods for internal use:
        save_checkpoint()  — low-level upsert with explicit params
        get_checkpoint()   — low-level fetch by thread/step
        list_checkpoints() — audit listing with optional tenant filter
        adelete_thread()   — async delete with optional namespace/bureau filters

    Note: In PHASE 2, migrate to the official ``langgraph-checkpoint-postgres``
    package once psycopg3/libpq is available in the deployment environment.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__()
        self.pool = pool
        self.table_name = settings.checkpoint_table_name

    # =========================================================================
    # Startup verification
    # =========================================================================

    async def setup(self) -> None:
        """
        Verifies connectivity to the checkpoint table.

        The table schema, indexes, and RLS policies are managed exclusively by
        the Supabase migration: supabase/rag_v2_step16_checkpoint.sql

        This method no longer creates the table at runtime — doing so would
        bypass Supabase's Row-Level Security and RBAC policies.
        """
        logger.info("Verifying checkpoint table: %s", self.table_name)
        async with self.pool.acquire() as conn:
            exists = await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                " WHERE table_schema = 'public' AND table_name = $1)",
                self.table_name,
            )
            if not exists:
                raise RuntimeError(
                    f"Checkpoint table '{self.table_name}' not found. "
                    "Run supabase/rag_v2_step16_checkpoint.sql first."
                )
        logger.info("✅ Checkpoint table '%s' ready", self.table_name)

    # =========================================================================
    # LangGraph async interface  (primary — used by StateGraph)
    # =========================================================================

    async def aget_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        """Load the latest (or a specific) CheckpointTuple for a thread."""
        cfg = config.get("configurable", {})
        thread_id: str = cfg["thread_id"]
        checkpoint_ns: str = cfg.get("checkpoint_ns", "")
        checkpoint_id: Optional[str] = cfg.get("checkpoint_id")

        async with self.pool.acquire() as conn:
            if checkpoint_id:
                row = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                           data, metadata, bureau_id, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1
                      AND checkpoint_ns = $2
                      AND checkpoint_id = $3::uuid
                    """,
                    thread_id, checkpoint_ns, checkpoint_id,
                )
            else:
                row = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                           data, metadata, bureau_id, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1 AND checkpoint_ns = $2
                    ORDER BY step DESC
                    LIMIT 1
                    """,
                    thread_id, checkpoint_ns,
                )

        if row is None:
            return None
        return self._row_to_tuple(row)

    async def alist(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> AsyncIterator[CheckpointTuple]:
        """Yield CheckpointTuples matching the given criteria (newest first)."""
        cfg = (config or {}).get("configurable", {})
        thread_id: Optional[str] = cfg.get("thread_id")
        checkpoint_ns: str = cfg.get("checkpoint_ns", "")

        clauses: List[str] = []
        params: List[Any] = []

        if thread_id:
            params.append(thread_id)
            clauses.append(f"thread_id = ${len(params)}")
            params.append(checkpoint_ns)
            clauses.append(f"checkpoint_ns = ${len(params)}")

        if before:
            before_id = (before.get("configurable") or {}).get("checkpoint_id")
            if before_id:
                params.append(before_id)
                p = len(params)
                clauses.append(
                    f"created_at < (SELECT created_at FROM {self.table_name} "
                    f"WHERE checkpoint_id = ${p}::uuid)"
                )

        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        limit_sql = f"LIMIT {int(limit)}" if limit else ""

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                       data, metadata, bureau_id, created_at
                FROM {self.table_name}
                {where_sql}
                ORDER BY step DESC
                {limit_sql}
                """,
                *params,
            )

        for row in rows:
            yield self._row_to_tuple(row)

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        """Persist a checkpoint and return the updated config (with checkpoint_id)."""
        cfg = config.get("configurable", {})
        thread_id: str = cfg["thread_id"]
        checkpoint_ns: str = cfg.get("checkpoint_ns", "")
        bureau_id: Optional[str] = cfg.get("bureau_id")

        # The current config's checkpoint_id becomes the parent of the new one.
        parent_checkpoint_id: Optional[str] = cfg.get("checkpoint_id")
        checkpoint_id: str = checkpoint["id"]
        step: int = int((metadata or {}).get("step", 0))

        meta_to_store: Dict[str, Any] = dict(metadata or {})
        if parent_checkpoint_id:
            meta_to_store["_parent_checkpoint_id"] = parent_checkpoint_id

        async with self.pool.acquire() as conn:
            await conn.execute(
                f"""
                INSERT INTO {self.table_name} (
                    checkpoint_id, thread_id, checkpoint_ns, step,
                    data, metadata, bureau_id
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (thread_id, checkpoint_ns, step)
                DO UPDATE SET
                    checkpoint_id = EXCLUDED.checkpoint_id,
                    data          = EXCLUDED.data,
                    metadata      = EXCLUDED.metadata,
                    bureau_id     = EXCLUDED.bureau_id,
                    created_at    = NOW()
                """,
                checkpoint_id,
                thread_id,
                checkpoint_ns,
                step,
                json.dumps(checkpoint),
                json.dumps(meta_to_store),
                bureau_id,
            )

        logger.debug(
            "Checkpoint saved: %s (thread=%s, step=%d)",
            checkpoint_id, thread_id, step,
        )
        return {
            "configurable": {
                "thread_id":     thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        }

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        """
        Store intermediate task writes for the current checkpoint.

        Since our schema has no separate writes table, we JSONB-merge the
        writes into the checkpoint's metadata under '_pending_writes'.
        Non-serialisable values are coerced to their repr() string.
        """
        cfg = config.get("configurable", {})
        thread_id: str = cfg.get("thread_id", "")
        checkpoint_ns: str = cfg.get("checkpoint_ns", "")
        checkpoint_id: Optional[str] = cfg.get("checkpoint_id")

        if not checkpoint_id:
            return

        def _safe(v: Any) -> Any:
            try:
                json.dumps(v)
                return v
            except (TypeError, ValueError):
                return repr(v)

        serialized = [
            {
                "task_id":   task_id,
                "task_path": task_path,
                "channel":   channel,
                "value":     _safe(value),
            }
            for channel, value in writes
        ]

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    f"""
                    UPDATE {self.table_name}
                    SET metadata = metadata || jsonb_build_object(
                        '_pending_writes', $1::jsonb
                    )
                    WHERE checkpoint_id = $2::uuid
                      AND thread_id     = $3
                      AND checkpoint_ns = $4
                    """,
                    json.dumps(serialized),
                    checkpoint_id,
                    thread_id,
                    checkpoint_ns,
                )
        except Exception as exc:
            logger.warning(
                "aput_writes failed (non-fatal) | checkpoint=%s | %s",
                checkpoint_id, exc,
            )

    # =========================================================================
    # LangGraph sync stubs  (async-only — raise NotImplementedError if called)
    # =========================================================================

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        raise NotImplementedError(
            "AsyncPostgresCheckpointer is async-only — use aget_tuple()."
        )

    def list(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError(
            "AsyncPostgresCheckpointer is async-only — use alist()."
        )

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        raise NotImplementedError(
            "AsyncPostgresCheckpointer is async-only — use aput()."
        )

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        raise NotImplementedError(
            "AsyncPostgresCheckpointer is async-only — use aput_writes()."
        )

    def delete_thread(self, thread_id: str) -> None:
        """
        LangGraph BaseCheckpointSaver sync interface.

        Schedules the actual async deletion as a fire-and-forget task on the
        running event loop.  If there is no running loop (e.g. during tests),
        logs a warning and returns immediately without deleting.
        Use ``await adelete_thread()`` for guaranteed execution.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                self.adelete_thread(thread_id),
                name=f"delete_thread_{thread_id[:8]}",
            )
        except RuntimeError:
            logger.warning(
                "delete_thread called outside async context — "
                "checkpoint rows for thread=%s NOT deleted. "
                "Use `await adelete_thread()` instead.",
                thread_id,
            )

    # =========================================================================
    # Convenience / internal async methods  (for non-LangGraph callers)
    # =========================================================================

    async def save_checkpoint(
        self,
        thread_id: str,
        step: int,
        data: Dict[str, Any],
        checkpoint_ns: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        bureau_id: Optional[str] = None,
    ) -> str:
        """
        Low-level upsert using explicit parameters (for non-LangGraph callers).

        Returns:
            checkpoint_id: UUID string of the created/updated row.
        """
        async with self.pool.acquire() as conn:
            result = await conn.fetchrow(
                f"""
                INSERT INTO {self.table_name} (
                    thread_id, checkpoint_ns, step, data, metadata, bureau_id
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (thread_id, checkpoint_ns, step)
                DO UPDATE SET
                    data      = EXCLUDED.data,
                    metadata  = EXCLUDED.metadata,
                    bureau_id = EXCLUDED.bureau_id,
                    created_at = NOW()
                RETURNING checkpoint_id
                """,
                thread_id,
                checkpoint_ns,
                step,
                json.dumps(data),
                json.dumps(metadata or {}),
                bureau_id,
            )
        checkpoint_id = str(result["checkpoint_id"])
        logger.debug(
            "Checkpoint saved: %s (thread=%s, step=%d)", checkpoint_id, thread_id, step,
        )
        return checkpoint_id

    async def get_checkpoint(
        self,
        thread_id: str,
        step: Optional[int] = None,
        checkpoint_ns: str = "",
        bureau_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Low-level fetch by thread + optional step (for non-LangGraph callers).
        When step=None, returns the latest checkpoint.
        """
        bureau_clause = (
            " AND (bureau_id = $4 OR bureau_id IS NULL)" if bureau_id is not None else ""
        )
        async with self.pool.acquire() as conn:
            if step is not None:
                row = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                           data, metadata, bureau_id, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1
                      AND checkpoint_ns = $2
                      AND step = $3
                      {bureau_clause}
                    """,
                    *(
                        [thread_id, checkpoint_ns, step, bureau_id]
                        if bureau_id is not None
                        else [thread_id, checkpoint_ns, step]
                    ),
                )
            else:
                row = await conn.fetchrow(
                    f"""
                    SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                           data, metadata, bureau_id, created_at
                    FROM {self.table_name}
                    WHERE thread_id = $1 AND checkpoint_ns = $2
                      {bureau_clause}
                    ORDER BY step DESC
                    LIMIT 1
                    """,
                    *(
                        [thread_id, checkpoint_ns, bureau_id]
                        if bureau_id is not None
                        else [thread_id, checkpoint_ns]
                    ),
                )

        if row is None:
            return None

        return {
            "checkpoint_id": str(row["checkpoint_id"]),
            "thread_id":     row["thread_id"],
            "checkpoint_ns": row["checkpoint_ns"],
            "step":          row["step"],
            "data":          _load_json(row["data"]),
            "metadata":      _load_json(row["metadata"]),
            "bureau_id":     row["bureau_id"],
            "created_at":    row["created_at"].isoformat(),
        }

    async def list_checkpoints(
        self,
        thread_id: str,
        checkpoint_ns: str = "",
        limit: int = 50,
        bureau_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List all checkpoints for a thread, newest first (for audit/debug)."""
        bureau_clause = (
            " AND (bureau_id = $4 OR bureau_id IS NULL)" if bureau_id is not None else ""
        )
        args: List[Any] = (
            [thread_id, checkpoint_ns, limit, bureau_id]
            if bureau_id is not None
            else [thread_id, checkpoint_ns, limit]
        )
        limit_param = "$5" if bureau_id is not None else "$3"

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT checkpoint_id, thread_id, checkpoint_ns, step,
                       data, metadata, bureau_id, created_at
                FROM {self.table_name}
                WHERE thread_id = $1 AND checkpoint_ns = $2
                  {bureau_clause}
                ORDER BY step DESC
                LIMIT {limit_param}
                """,
                *args,
            )

        return [
            {
                "checkpoint_id": str(row["checkpoint_id"]),
                "thread_id":     row["thread_id"],
                "checkpoint_ns": row["checkpoint_ns"],
                "step":          row["step"],
                "data":          _load_json(row["data"]),
                "metadata":      _load_json(row["metadata"]),
                "bureau_id":     row["bureau_id"],
                "created_at":    row["created_at"].isoformat(),
            }
            for row in rows
        ]

    async def adelete_thread(
        self,
        thread_id: str,
        checkpoint_ns: str = "",
        bureau_id: Optional[str] = None,
    ) -> None:
        """
        Delete checkpoints for a thread (async, with optional tenant scoping).
        Preferred over the sync ``delete_thread()`` stub.
        """
        async with self.pool.acquire() as conn:
            if checkpoint_ns and bureau_id:
                await conn.execute(
                    f"DELETE FROM {self.table_name} "
                    "WHERE thread_id = $1 AND checkpoint_ns = $2 AND bureau_id = $3",
                    thread_id, checkpoint_ns, bureau_id,
                )
            elif checkpoint_ns:
                await conn.execute(
                    f"DELETE FROM {self.table_name} "
                    "WHERE thread_id = $1 AND checkpoint_ns = $2",
                    thread_id, checkpoint_ns,
                )
            elif bureau_id:
                await conn.execute(
                    f"DELETE FROM {self.table_name} "
                    "WHERE thread_id = $1 AND bureau_id = $2",
                    thread_id, bureau_id,
                )
            else:
                await conn.execute(
                    f"DELETE FROM {self.table_name} WHERE thread_id = $1",
                    thread_id,
                )
        logger.info("Deleted checkpoints for thread: %s", thread_id)

    # =========================================================================
    # Private helpers
    # =========================================================================

    def _row_to_tuple(self, row: Any) -> CheckpointTuple:
        """Convert an asyncpg Record to a LangGraph CheckpointTuple."""
        checkpoint: Checkpoint = _load_json(row["data"])
        meta: Dict[str, Any] = _load_json(row["metadata"])

        # Extract internal tracking fields before exposing as public metadata.
        parent_checkpoint_id: Optional[str] = meta.pop("_parent_checkpoint_id", None)
        pending_writes_raw: Optional[Any] = meta.pop("_pending_writes", None)

        parent_config: Optional[RunnableConfig] = None
        if parent_checkpoint_id:
            parent_config = {
                "configurable": {
                    "thread_id":     row["thread_id"],
                    "checkpoint_ns": row["checkpoint_ns"],
                    "checkpoint_id": parent_checkpoint_id,
                }
            }

        # Reconstruct pending_writes as List[Tuple[task_id, channel, value]]
        # (format stored by aput_writes: [{"task_id":…, "channel":…, "value":…}])
        pending_writes: Optional[List[tuple]] = None
        if pending_writes_raw:
            try:
                pending_writes = [
                    (w["task_id"], w["channel"], w["value"])
                    for w in pending_writes_raw
                ]
            except (KeyError, TypeError):
                pending_writes = None

        return CheckpointTuple(
            config={
                "configurable": {
                    "thread_id":     row["thread_id"],
                    "checkpoint_ns": row["checkpoint_ns"],
                    "checkpoint_id": str(row["checkpoint_id"]),
                }
            },
            checkpoint=checkpoint,
            metadata=meta,
            parent_config=parent_config,
            pending_writes=pending_writes,
        )
