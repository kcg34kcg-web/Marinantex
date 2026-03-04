"""
SupabaseSaveRepository - Step 24 save transaction adapter
=========================================================
Calls the SQL RPC `save_rag_output_transaction` so output/case/citation/client
writes are committed atomically.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger("babylexit.db.save_repository")


class SupabaseSaveRepository:
    """Thin RPC wrapper for Step 24 unified save transaction."""

    async def save_rag_output_transaction(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            from infrastructure.database.connection import get_supabase_client

            client = get_supabase_client()
            resp = client.rpc("save_rag_output_transaction", payload).execute()
            data = getattr(resp, "data", None)
            if isinstance(data, list):
                data = data[0] if data else None
            if not isinstance(data, dict):
                raise RuntimeError("save_rag_output_transaction returned empty payload")
            return data
        except Exception as exc:  # noqa: BLE001
            logger.error("SAVE_TRANSACTION_FAILED | error=%s", exc, exc_info=True)
            raise


# Module-level singleton
supabase_save_repository = SupabaseSaveRepository()
