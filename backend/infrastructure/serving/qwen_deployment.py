"""Qwen serving backend resolution (vLLM / SGLang / OpenAI-compatible)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

from infrastructure.config import settings


@dataclass(frozen=True)
class QwenServingConfig:
    backend: str
    base_url: str
    model: str
    api_key: str
    health_url: str
    metrics_url: str
    secondary_backend: Optional[str] = None
    secondary_base_url: Optional[str] = None
    openai_compatible: bool = True


def resolve_qwen_serving_config() -> QwenServingConfig:
    backend = str(getattr(settings, "qwen_serving_backend", "auto") or "auto").strip().lower()
    model = str(getattr(settings, "qwen_served_model", "") or getattr(settings, "llm_tier2_model", "")).strip()
    api_key = str(getattr(settings, "openai_api_key", "") or "local-openai-compatible").strip()
    openai_base = str(getattr(settings, "openai_base_url", "") or "").strip()
    sglang_base = str(getattr(settings, "sglang_base_url", "") or "").strip()

    if backend == "sglang":
        base = sglang_base or "http://localhost:30000/v1"
        return QwenServingConfig(
            backend="sglang",
            base_url=base,
            model=model,
            api_key=api_key,
            health_url=f"{_strip_v1(base)}/health",
            metrics_url=f"{_strip_v1(base)}/metrics",
            secondary_backend="vllm" if openai_base else None,
            secondary_base_url=openai_base or None,
        )
    if backend == "vllm":
        base = openai_base or "http://localhost:8008/v1"
        return QwenServingConfig(
            backend="vllm",
            base_url=base,
            model=model,
            api_key=api_key,
            health_url=f"{_strip_v1(base)}/models",
            metrics_url=f"{_strip_v1(base)}/metrics",
            secondary_backend="sglang" if sglang_base else None,
            secondary_base_url=sglang_base or None,
        )
    if backend == "openai":
        base = openai_base or "https://api.openai.com/v1"
        return QwenServingConfig(
            backend="openai",
            base_url=base,
            model=model,
            api_key=api_key,
            health_url=f"{_strip_v1(base)}/models",
            metrics_url=f"{_strip_v1(base)}/metrics",
        )

    # auto
    if openai_base:
        base = openai_base
        return QwenServingConfig(
            backend="vllm" if ("localhost" in base or "vllm" in base) else "openai",
            base_url=base,
            model=model,
            api_key=api_key,
            health_url=f"{_strip_v1(base)}/models",
            metrics_url=f"{_strip_v1(base)}/metrics",
            secondary_backend="sglang" if sglang_base else None,
            secondary_base_url=sglang_base or None,
        )
    if sglang_base:
        base = sglang_base
        return QwenServingConfig(
            backend="sglang",
            base_url=base,
            model=model,
            api_key=api_key,
            health_url=f"{_strip_v1(base)}/health",
            metrics_url=f"{_strip_v1(base)}/metrics",
        )
    base = "http://localhost:8008/v1"
    return QwenServingConfig(
        backend="vllm",
        base_url=base,
        model=model,
        api_key=api_key,
        health_url=f"{_strip_v1(base)}/models",
        metrics_url=f"{_strip_v1(base)}/metrics",
    )


def probe_qwen_backend_health(config: Optional[QwenServingConfig] = None, *, timeout_s: float = 2.5) -> dict[str, object]:
    cfg = config or resolve_qwen_serving_config()
    req = urllib.request.Request(cfg.health_url, headers={"Authorization": f"Bearer {cfg.api_key}"})
    try:
        with urllib.request.urlopen(req, timeout=max(0.5, float(timeout_s))) as resp:  # noqa: S310
            body = resp.read().decode("utf-8", errors="replace")
            payload: object
            try:
                payload = json.loads(body) if body else {}
            except json.JSONDecodeError:
                payload = {"raw": body[:240]}
            return {
                "ok": True,
                "backend": cfg.backend,
                "status": int(getattr(resp, "status", 200) or 200),
                "payload": payload,
            }
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "backend": cfg.backend,
            "status": int(getattr(exc, "code", 0) or 0),
            "error": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "backend": cfg.backend,
            "status": 0,
            "error": str(exc),
        }


def _strip_v1(url: str) -> str:
    value = str(url or "").strip().rstrip("/")
    if value.endswith("/v1"):
        return value[:-3]
    return value
