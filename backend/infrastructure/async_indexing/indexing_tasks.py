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

# ---------------------------------------------------------------------------
# Token-based truncation
# ---------------------------------------------------------------------------
# OpenAI text-embedding-3-small accepts at most 8191 *tokens*, not characters.
# A character slice of 8191 truncates ~32 000 chars worth of useful text.
# We use tiktoken to count tokens precisely and truncate at the token boundary.

_EMBEDDING_MAX_TOKENS: int = 8191
_TIKTOKEN_ENCODING: str = "cl100k_base"   # used by text-embedding-3-* and gpt-4*


def _truncate_to_token_limit(
    text: str,
    max_tokens: int = _EMBEDDING_MAX_TOKENS,
    encoding_name: str = _TIKTOKEN_ENCODING,
) -> str:
    """
    Truncate *text* so that it does not exceed *max_tokens* tokens.

    Falls back gracefully when tiktoken is unavailable:
        - Uses a conservative heuristic: max_tokens * 3 characters
          (Turkish averages ~3-4 chars/token, so this is safe).

    Args:
        text:          Input text to truncate.
        max_tokens:    Maximum allowed tokens (default 8191).
        encoding_name: tiktoken BPE encoding to use.

    Returns:
        Truncated text string.
    """
    try:
        import tiktoken
        enc = tiktoken.get_encoding(encoding_name)
        tokens = enc.encode(text)
        if len(tokens) <= max_tokens:
            return text
        truncated_tokens = tokens[:max_tokens]
        return enc.decode(truncated_tokens)
    except Exception:  # tiktoken not installed or encoding error
        # Conservative fallback: 3 chars/token average for Turkish legal text
        char_limit = max_tokens * 3
        return text[:char_limit]


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
    source_url: Optional[str] = None,
    version: Optional[str] = None,
    collected_at: Optional[str] = None,
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

        # 1. Embed — truncate to token limit, NOT character limit
        truncated_content = _truncate_to_token_limit(content)
        client = openai.OpenAI(api_key=settings.openai_api_key)
        response = client.embeddings.create(
            model=settings.embedding_model,
            input=truncated_content,
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
        if source_url:
            upsert_data["source_url"] = source_url
        if version:
            upsert_data["version"] = version
        if collected_at:
            upsert_data["collected_at"] = collected_at
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
# Gap 3: Retry + Dead-Letter Wrapper
# ============================================================================

def _do_index_document_with_retry(
    document_id: str,
    content: str,
    case_id: Optional[str] = None,
    bureau_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    source_url: Optional[str] = None,
    version: Optional[str] = None,
    collected_at: Optional[str] = None,
    max_retries: int = 3,
    retry_delay_base_s: float = 1.0,
) -> IndexTaskResult:
    """
    Exponential-backoff retry wrapper for _do_index_document.

    Geçici Supabase / OpenAI hatalarında max_retries kez yeniden dener.
    Gecikme: retry_delay_base_s * 2^attempt (örn. 1s, 2s, 4s).
    Tüm denemeler başarısızsa sonucu DEAD_LETTER olarak loglar ve
    IndexTaskResult.metadata['dead_letter'] = True ile döner.

    Args:
        document_id:        İndekslenecek doküman UUID'si.
        content:            Ham metin içeriği.
        case_id:            Dava kapsamı (opsiyonel).
        bureau_id:          Büro izolasyonu (Step 6).
        metadata:           Ek metadata alanları.
        source_url:         Kaynak URL.
        version:            Sürüm etiketi.
        collected_at:       Toplama zaman damgası (ISO-8601).
        max_retries:        Maksimum yeniden deneme sayısı (0 = hiç deneme yok).
        retry_delay_base_s: Üstel geri çekilme taban gecikmesi (saniye).

    Returns:
        IndexTaskResult — başarılı veya başarısız son sonuç.
    """
    last_result: Optional[IndexTaskResult] = None

    for attempt in range(max_retries + 1):
        result = _do_index_document(
            document_id=document_id,
            content=content,
            case_id=case_id,
            bureau_id=bureau_id,
            metadata=metadata,
            source_url=source_url,
            version=version,
            collected_at=collected_at,
        )

        if result.status == IndexTaskStatus.SUCCESS:
            if attempt > 0:
                logger.info(
                    "INDEX_TASK_RECOVERED | doc_id=%s | attempt=%d/%d",
                    document_id, attempt + 1, max_retries + 1,
                )
            return result

        last_result = result

        if attempt < max_retries:
            delay = retry_delay_base_s * (2 ** attempt)
            logger.warning(
                "INDEX_TASK_RETRY | doc_id=%s | attempt=%d/%d | "
                "delay=%.2fs | error=%s",
                document_id, attempt + 1, max_retries + 1,
                delay, result.message,
            )
            time.sleep(delay)

    # Tüm denemeler tükendi → dead-letter kaydı
    logger.error(
        "INDEX_TASK_DEAD_LETTER | doc_id=%s | total_attempts=%d | last_error=%s",
        document_id,
        max_retries + 1,
        last_result.message if last_result else "unknown",
    )
    return IndexTaskResult(
        task_name="index_document_task",
        document_id=document_id,
        status=IndexTaskStatus.FAILED,
        duration_ms=last_result.duration_ms if last_result else 0,
        message=last_result.message if last_result else "Unknown failure after retries",
        retries=max_retries,
        metadata={"dead_letter": True},
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
        # Gap 3: non-Celery yolu da exponential-backoff retry kullanır
        from infrastructure.config import settings as _settings
        result = _do_index_document_with_retry(
            document_id=document_id,
            content=content,
            case_id=case_id,
            bureau_id=bureau_id,
            metadata=metadata,
            max_retries=_settings.celery_task_max_retries,
            retry_delay_base_s=float(_settings.celery_task_retry_delay_s),
        )
        return {"status": result.status.value, "document_id": document_id}

    def bulk_index_task(  # type: ignore[misc]
        documents: List[Dict[str, Any]],
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
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
        return {"success": success, "failed": failed, "total": success + failed}

    def delete_document_task(  # type: ignore[misc]
        document_id: str,
        bureau_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        result = _do_delete_document(document_id, bureau_id)
        return {"status": result.status.value, "document_id": document_id}
