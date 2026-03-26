"""Secure redaction map storage for reversible masking workflows."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Optional

from infrastructure.config import settings

logger = logging.getLogger("babylexit.security.redaction_store")


@dataclass
class RedactionMapStore:
    """Stores reversible redaction maps in memory or Redis with optional encryption."""

    def __init__(self) -> None:
        self._memory: dict[str, str] = {}
        self._redis = None
        self._redis_attempted = False
        self._fernet = self._build_fernet()

    async def set_map(self, *, mask_id: str, values: dict[str, str]) -> None:
        if not mask_id:
            return
        payload = self._encode_payload(values)
        backend = str(getattr(settings, "kvkk_redaction_map_backend", "memory") or "memory").strip().lower()
        ttl = max(30, int(getattr(settings, "kvkk_redaction_map_ttl_seconds", 900) or 900))

        if backend == "redis":
            redis = await self._redis_client()
            if redis is not None:
                try:
                    await redis.setex(self._key(mask_id), ttl, payload)
                    return
                except Exception as exc:  # noqa: BLE001
                    logger.warning("REDACTION_STORE_REDIS_SET_FAILED | reason=%s", exc)
        self._memory[self._key(mask_id)] = payload

    async def get_map(self, *, mask_id: str) -> dict[str, str]:
        if not mask_id:
            return {}
        key = self._key(mask_id)
        backend = str(getattr(settings, "kvkk_redaction_map_backend", "memory") or "memory").strip().lower()
        if backend == "redis":
            redis = await self._redis_client()
            if redis is not None:
                try:
                    raw = await redis.get(key)
                    if raw:
                        return self._decode_payload(raw.decode("utf-8") if isinstance(raw, bytes) else str(raw))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("REDACTION_STORE_REDIS_GET_FAILED | reason=%s", exc)
        payload = self._memory.get(key)
        if not payload:
            return {}
        return self._decode_payload(payload)

    async def delete_map(self, *, mask_id: str) -> None:
        if not mask_id:
            return
        key = self._key(mask_id)
        self._memory.pop(key, None)
        backend = str(getattr(settings, "kvkk_redaction_map_backend", "memory") or "memory").strip().lower()
        if backend == "redis":
            redis = await self._redis_client()
            if redis is not None:
                try:
                    await redis.delete(key)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("REDACTION_STORE_REDIS_DELETE_FAILED | reason=%s", exc)

    async def _redis_client(self):
        if self._redis_attempted:
            return self._redis
        self._redis_attempted = True
        try:
            from redis import asyncio as redis_async  # type: ignore[import-untyped]
        except Exception:
            self._redis = None
            return None
        try:
            url = str(getattr(settings, "redis_url", "redis://localhost:6379") or "redis://localhost:6379")
            self._redis = redis_async.from_url(url, decode_responses=False)
            await self._redis.ping()
            return self._redis
        except Exception as exc:  # noqa: BLE001
            logger.warning("REDACTION_STORE_REDIS_UNAVAILABLE | reason=%s", exc)
            self._redis = None
            return None

    def _build_fernet(self):
        try:
            from cryptography.fernet import Fernet  # type: ignore[import-untyped]
        except Exception:
            return None
        key_material = str(getattr(settings, "pii_encryption_key", "") or "").strip()
        if not key_material:
            return None
        digest = hashlib.sha256(key_material.encode("utf-8")).digest()
        fernet_key = base64.urlsafe_b64encode(digest)
        try:
            return Fernet(fernet_key)
        except Exception:
            return None

    @staticmethod
    def _key(mask_id: str) -> str:
        return f"redaction-map:{mask_id}"

    def _encode_payload(self, values: dict[str, str]) -> str:
        raw = json.dumps(values or {}, ensure_ascii=False, separators=(",", ":"))
        if self._fernet is None:
            return raw
        try:
            token = self._fernet.encrypt(raw.encode("utf-8"))
            return "enc:" + token.decode("utf-8")
        except Exception:
            return raw

    def _decode_payload(self, payload: str) -> dict[str, str]:
        token = str(payload or "")
        if not token:
            return {}
        if token.startswith("enc:") and self._fernet is not None:
            encrypted = token[4:]
            try:
                decoded = self._fernet.decrypt(encrypted.encode("utf-8")).decode("utf-8")
                data = json.loads(decoded)
                if isinstance(data, dict):
                    return {str(k): str(v) for k, v in data.items()}
            except Exception:
                return {}
            return {}
        try:
            data = json.loads(token)
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        except Exception:
            return {}
        return {}


redaction_map_store = RedactionMapStore()
