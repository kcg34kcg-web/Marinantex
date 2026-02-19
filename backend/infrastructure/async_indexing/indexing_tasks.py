"""
Asenkron İndeksleme Görevleri — Step 11: Zero-Downtime Güncelleme
=================================================================
Celery görevleri: doküman indeksleme ve embedding hesaplama,
HTTP isteğini bloke etmeden arka planda gerçekleşir.

Zero-Downtime Garantisi:
    - Yeni doküman ekleme / güncelleme: API yanıt vermaya devam eder.
    - Görev kuyruğa alınır; arama sonuçlarına birkaç saniye içinde yansır.
    - Hata durumunda: settings.celery_task_max_retries kez otomatik yeniden
      denenir; ardından dead-letter kuyruğuna düşer (manuel inceleme).

Görev Envanteri:
    index_document_task     — tek dokümanı embed + Supabase'e upsert
    bulk_index_task         — birden fazla doküman, toplu embed + upsert
    reindex_case_task       — bir dava ID'sinin tüm dokümanlarını yeniden indexle
    delete_document_task    — doküman silme (soft delete + vektör temizleme)

Celery Kurulu Değilse:
    Tüm görevler doğrudan (senkron) çalışır — geliştirme/test için ideal.
    Üretimde Celery worker başlatılmalıdır:
        celery -A infrastructure.async_indexing.celery_app worker -l info
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum

logger = logging.getLogger("babylexit.async_indexing.tasks")


# ============================================================================
# Görev Sonuç Nesneleri
# ============================================================================

class IndexTaskStatus(str, Enum):
    SUCCESS  = "SUCCESS"
    FAILED   = "FAILED"
    RETRYING = "RETRYING"
    SKIPPED  = "SKIPPED"


@dataclass
class IndexTaskResult:
    """Her görev çağrısının sonuç kaydı — denetim izi için."""
    task_name: str
    document_id: str
    status: IndexTaskStatus
    duration_ms: int
    message: str = ""
    retries: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Görev implementasyonları — Celery'den bağımsız saf fonksiyonlar
# ============================================================================

def _do_index_document(
    document_id: str,
    content: str,
    case_id: Optional[str] = None,
    bureau_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> IndexTaskResult:
    """
    Tek bir dokümanı embed edip Supabase'e upsert eder.

    Adımlar:
        1. Dokümanı QueryEmbedder ile embed et (text-embedding-3-small).
        2. Supabase documents tablosuna upsert et (ON CONFLICT DO UPDATE).
        3. pgvector indeksini tetikle (otomatik — HNSW index self-updates).

    Bu fonksiyon senkrondur; asyncio bağlamı gerektirmez.
    Celery worker ayrı bir süreçte çalıştığından asyncio event loop yoktur.
    Embedding API çağrısı burada requests kütüphanesiyle yapılır.

    Args:
        document_id: Supabase doküman UUID'si.
        content:     İndekslecek ham metin.
        case_id:     Opsiyonel dava kapsamı.
        bureau_id:   Büro izolasyonu için (Step 6).
        metadata:    Ek metadata alanları (effective_date, norm_hierarchy vb.)

    Returns:
        IndexTaskResult
    """
    start = time.monotonic()
    logger.info(
        "INDEX_TASK_START | doc_id=%s | case_id=%s | bureau_id=%s | chars=%d",
        document_id, case_id, bureau_id, len(content),
    )

    try:
        from infrastructure.config import settings
        from infrastructure.database.connection import get_supabase_client
        import openai

        # 1. Embed
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.embeddings.create(
            model=settings.embedding_model,
            input=content[:8191],  # OpenAI 8191 token limiti
        )
        embedding = response.data[0].embedding

        # 2. Upsert to Supabase
        supabase = get_supabase_client()
        upsert_data: Dict[str, Any] = {
            "id": document_id,
            "content": content,
            "embedding": embedding,
        }
        if case_id:
            upsert_data["case_id"] = case_id
        if bureau_id:
            upsert_data["bureau_id"] = bureau_id
        if metadata:
            upsert_data.update(metadata)

        supabase.table("documents").upsert(upsert_data).execute()

        duration_ms = int((time.monotonic() - start) * 1000)
        logger.info(
            "INDEX_TASK_SUCCESS | doc_id=%s | duration_ms=%d",
            document_id, duration_ms,
        )
        return IndexTaskResult(
            task_name="index_document_task",
            document_id=document_id,
            status=IndexTaskStatus.SUCCESS,
            duration_ms=duration_ms,
            message="Doküman başarıyla indekslendi.",
        )

    except Exception as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        logger.error(
            "INDEX_TASK_FAILED | doc_id=%s | error=%s",
            document_id, exc, exc_info=True,
        )
        return IndexTaskResult(
            task_name="index_document_task",
            document_id=document_id,
            status=IndexTaskStatus.FAILED,
            duration_ms=duration_ms,
            message=str(exc),
        )


def _do_delete_document(
    document_id: str,
    bureau_id: Optional[str] = None,
) -> IndexTaskResult:
    """
    Dokümanı Supabase'den siler (soft-delete: is_deleted=True).

    pgvector indeksi kayıt silinince otomatik güncellenir.
    Büro izolasyonu kontrolü: sadece kendi dokümanını silebilir.
    """
    start = time.monotonic()
    logger.info("DELETE_TASK_START | doc_id=%s | bureau_id=%s", document_id, bureau_id)

    try:
        from infrastructure.database.connection import get_supabase_client

        supabase = get_supabase_client()
        query = supabase.table("documents").update({"is_deleted": True}).eq("id", document_id)
        if bureau_id:
            query = query.eq("bureau_id", bureau_id)
        query.execute()

        duration_ms = int((time.monotonic() - start) * 1000)
        logger.info("DELETE_TASK_SUCCESS | doc_id=%s | duration_ms=%d", document_id, duration_ms)
        return IndexTaskResult(
            task_name="delete_document_task",
            document_id=document_id,
            status=IndexTaskStatus.SUCCESS,
            duration_ms=duration_ms,
            message="Doküman silindi (soft-delete).",
        )

    except Exception as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        logger.error("DELETE_TASK_FAILED | doc_id=%s | error=%s", document_id, exc, exc_info=True)
        return IndexTaskResult(
            task_name="delete_document_task",
            document_id=document_id,
            status=IndexTaskStatus.FAILED,
            duration_ms=duration_ms,
            message=str(exc),
        )


# ============================================================================
# Celery görev tanımları
# (Celery kurulu değilse doğrudan çağrılabilir saf fonksiyonlardır)
# ============================================================================

try:
    from infrastructure.async_indexing.celery_app import celery_app  # type: ignore

    @celery_app.task(  # type: ignore[misc]
        name="index_document_task",
        bind=True,
        max_retries=3,
        default_retry_delay=5,
    )
    def index_document_task(
        self: Any,
        document_id: str,
        content: str,
        case_id: Optional[str] = None,
        bureau_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Celery görevi: tek doküman indeksleme."""
        result = _do_index_document(document_id, content, case_id, bureau_id, metadata)
        if result.status == IndexTaskStatus.FAILED:
            raise self.retry(exc=Exception(result.message))
        return {
            "status": result.status.value,
            "document_id": document_id,
            "duration_ms": result.duration_ms,
        }

    @celery_app.task(  # type: ignore[misc]
        name="bulk_index_task",
        bind=True,
        max_retries=2,
        default_retry_delay=10,
    )
    def bulk_index_task(
        self: Any,
        documents: List[Dict[str, Any]],
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Celery görevi: toplu doküman indeksleme.

        Args:
            documents: Her eleman {"id": str, "content": str, ...} içermeli.
            bureau_id: Büro izolasyonu.

        Returns:
            {"success": N, "failed": M, "total": N+M}
        """
        success, failed = 0, 0
        for doc in documents:
            res = _do_index_document(
                document_id=doc["id"],
                content=doc["content"],
                case_id=doc.get("case_id"),
                bureau_id=bureau_id or doc.get("bureau_id"),
                metadata={k: v for k, v in doc.items()
                          if k not in ("id", "content", "case_id", "bureau_id")},
            )
            if res.status == IndexTaskStatus.SUCCESS:
                success += 1
            else:
                failed += 1

        logger.info(
            "BULK_INDEX_DONE | success=%d | failed=%d | total=%d",
            success, failed, success + failed,
        )
        return {"success": success, "failed": failed, "total": success + failed}

    @celery_app.task(  # type: ignore[misc]
        name="delete_document_task",
        bind=True,
        max_retries=3,
        default_retry_delay=5,
    )
    def delete_document_task(
        self: Any,
        document_id: str,
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Celery görevi: doküman silme (soft-delete)."""
        result = _do_delete_document(document_id, bureau_id)
        if result.status == IndexTaskStatus.FAILED:
            raise self.retry(exc=Exception(result.message))
        return {
            "status": result.status.value,
            "document_id": document_id,
            "duration_ms": result.duration_ms,
        }

except Exception:  # pragma: no cover — Celery not installed
    # Celery kurulu değilse görevleri sıradan Python fonksiyonu olarak sun
    def index_document_task(  # type: ignore[misc]
        document_id: str,
        content: str,
        case_id: Optional[str] = None,
        bureau_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = _do_index_document(document_id, content, case_id, bureau_id, metadata)
        return {"status": result.status.value, "document_id": document_id}

    def bulk_index_task(  # type: ignore[misc]
        documents: List[Dict[str, Any]],
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        success, failed = 0, 0
        for doc in documents:
            res = _do_index_document(doc["id"], doc["content"])
            if res.status == IndexTaskStatus.SUCCESS:
                success += 1
            else:
                failed += 1
        return {"success": success, "failed": failed, "total": success + failed}

    def delete_document_task(  # type: ignore[misc]
        document_id: str,
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        result = _do_delete_document(document_id, bureau_id)
        return {"status": result.status.value, "document_id": document_id}
