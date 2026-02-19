"""
Celery Uygulama Fabrikası — Step 11: Asenkron Güncelleme Mimarisi
=================================================================
Celery broker/backend konfigürasyonu.  Hem RabbitMQ hem de Redis
broker olarak desteklenir; ortam değişkeniyle seçilir.

Zero-Downtime Stratejisi:
    - Doküman indeksleme HTTP isteğini BLOKLAMAZ.
    - `index_document_task` çalışırken API yanıt vermeye devam eder.
    - Görev kuyruğu Redis veya RabbitMQ'da durur; herhangi bir worker
      üstlenebilir.

Geliştirme Modu:
    Celery kurulu değilse veya `settings.celery_task_always_eager=True`
    ise tüm görevler doğrudan (senkron) çalışır — test ortamı için ideal.

Kullanım:
    from infrastructure.async_indexing.celery_app import celery_app
    celery_app.send_task("index_document", args=[doc_id, content])
"""

from __future__ import annotations

import logging
from typing import Any

from infrastructure.config import settings

logger = logging.getLogger("babylexit.async_indexing.celery_app")

# ---------------------------------------------------------------------------
# Celery'yi opsiyonel bağımlılık olarak yükle
# Test ortamında kurulu olmayabilir; fallback stub sağlanır.
# ---------------------------------------------------------------------------
try:
    from celery import Celery as _Celery  # type: ignore[import-untyped]
    _CELERY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _CELERY_AVAILABLE = False
    logger.warning(
        "Celery not installed — async indexing will run in-process (eager mode). "
        "Install with: pip install celery[rabbitmq] or celery[redis]"
    )


def create_celery_app() -> Any:
    """
    Celery uygulama örneği oluşturur veya stub döndürür.

    Broker öncelik sırası:
        1. CELERY_BROKER_URL ortam değişkeni
        2. settings.celery_broker_url (varsayılan: redis://localhost:6379/1)

    Returns:
        Celery app örneği (kuruluysa) veya _StubCeleryApp (kurulu değilse).
    """
    if not _CELERY_AVAILABLE:
        return _StubCeleryApp()

    app = _Celery(
        "babylexit",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
        include=["infrastructure.async_indexing.indexing_tasks"],
    )

    app.conf.update(
        # Serileştirme
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        # Zaman dilimi
        timezone="Europe/Istanbul",
        enable_utc=True,
        # Yeniden deneme politikası
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        task_max_retries=settings.celery_task_max_retries,
        task_default_retry_delay=settings.celery_task_retry_delay_s,
        # Geliştirme modu: eager=True → görevler senkron çalışır
        task_always_eager=settings.celery_task_always_eager,
        task_eager_propagates=True,
        # Görünürlük
        worker_send_task_events=True,
        task_send_sent_event=True,
    )

    logger.info(
        "CeleryApp created | broker=%s | eager=%s",
        settings.celery_broker_url,
        settings.celery_task_always_eager,
    )
    return app


class _StubCeleryApp:
    """
    Celery kurulu olmadığında kullanılan minimal stub.

    Tüm `send_task` çağrıları senkron (in-process) çalışır.
    Üretim ortamında bu stub asla kullanılmamalıdır.
    """

    def send_task(self, name: str, args: Any = None, kwargs: Any = None, **opts: Any) -> None:
        logger.warning(
            "StubCelery.send_task(%r) — running in-process (Celery not installed)",
            name,
        )
        # Görevleri doğrudan import edip çağır
        try:
            from infrastructure.async_indexing import indexing_tasks  # noqa: F401
            task_fn = getattr(indexing_tasks, name.split(".")[-1], None)
            if task_fn and callable(task_fn):
                task_fn(*(args or []), **(kwargs or {}))
        except Exception as exc:
            logger.error("StubCelery task execution failed: %s", exc, exc_info=True)

    @property
    def conf(self) -> "_StubConf":
        return _StubConf()

    def task(self, *args: Any, **kwargs: Any):  # type: ignore[return]
        """Decorator stub — returns the function unchanged."""
        def decorator(fn: Any) -> Any:
            return fn
        return decorator if args and callable(args[0]) else decorator


class _StubConf:
    def update(self, **kwargs: Any) -> None:
        pass


# ============================================================================
# Module-level singleton
# ============================================================================

celery_app = create_celery_app()
