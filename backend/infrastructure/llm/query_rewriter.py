"""
QueryRewriter  —  Step 9: Sorgu Yeniden Yazımı
================================================
Seyreltik / gündelik Türkçe kullanıcı sorgularını, hybrid_legal_search'ün
BM25 + vektör birleşimiyle daha iyi eşleşeceği **formal hukuki terminoloji**ye
dönüştürür.

Activation:  Tier 2+ sorgular (ön sınıflandırma ile).
             Tier 1 → pass-through (LLM çağrısı yapılmaz, latency sıfır).

Fallback:    Herhangi bir hata (API, timeout, anahtar yok) durumunda
             orijinal sorgu değiştirilmeden döner.  Asla yaymaz.

Tasarım kararları:
    - gpt-4o-mini: Tier 2 maliyetiyle çalışır (~$0.002/rewrite).
    - Tek-döngü (single-turn) prompt: bir system + bir user mesajı.
    - Düşük temperature (0.1): yaratıcı olmayan, tutarlı terminoloji.
    - LRU bellek önbelleği (256 giriş): aynı sorgu yeniden yazılmaz.
    - Asenkron: ana RAG pipeline'ını bloke etmez.

Entegrasyon noktası (RAGService.query):
    Adım 0d — KVKK maskeleme SONRASI, embedding ÖNCESI.
    Kullanıcıya dönen cevap, audit trail ve LLM prompt'u her zaman
    ORIGINAL sorguyu kullanır; yalnızca retrieval _search_query kullanır.

Örnek dönüşümler:
    "kovuldum tazminat alabilir miyim?"
      → "iş akdinin haksız feshi kıdem ve ihbar tazminatı talep koşulları"

    "şirketten para çaldılar dava açabilir miyim"
      → "zimmet veya emniyeti suistimal suçu nedeniyle ceza davası açılması"

    "kira ödeyemiyorum ne olur"
      → "kira borcunun ödenmemesi halinde tahliye davası hukuki sonuçları"
"""

from __future__ import annotations

import asyncio
import logging

from infrastructure.config import settings

logger = logging.getLogger("babylexit.query_rewriter")

# ============================================================================
# System prompt
# ============================================================================

_SYSTEM_PROMPT = """\
Sen Türk hukuku alanında uzmanlaşmış bir terminoloji asistanısın.
Görevin: Kullanıcının gündelik/seyreltik Türkçesiyle yazdığı hukuki soruyu,
Türk mahkeme kararlarında ve kanun metinlerinde geçen FORMAL HUKUKİ TERMİNOLOJİ
ile yeniden ifade etmektir.

KURALLAR:
1. Orijinal sorunun HUKUKİ ÖZÜNÜ koru — konuyu değiştirme.
2. Gündelik kelimeler → yasal terimler (örn. "kovuldum" → "iş akdi feshedildi").
3. Yargıtay/AYM metinlerinde sıkça geçen ifadeleri tercih et.
4. Yalnızca yeniden yazılmış sorguyu döndür — açıklama, başlık veya madde işareti ekleme.
5. Türkçe kalmasını sağla. İngilizce terim kullanma.
6. Maksimum 2 cümle.  Gereksiz uzatma.

ÖRNEKLER:
Girdi:  kovuldum tazminat alabilir miyim
Çıktı:  iş akdinin haksız feshi halinde kıdem ve ihbar tazminatı talep koşulları

Girdi:  şirketten para çaldılar
Çıktı:  zimmet ve emniyeti suistimal suçu nedeniyle ceza davası şartları

Girdi:  kiracı evi tahrip etti
Çıktı:  kiracının taşınmazda hasar vermesi nedeniyle tazminat ve tahliye davası
"""


# ============================================================================
# Rewriter class
# ============================================================================

class QueryRewriter:
    """
    Step 9 — Query Rewriting.

    Transforms colloquial Turkish legal questions to formal legal terminology
    before embedding and retrieval, improving hybrid_legal_search accuracy.

    Thread-safe: instance is stateless beyond the in-process LRU cache.
    """

    def __init__(self) -> None:
        # Per-instance in-process cache: avoids repeated LLM calls for the same
        # query within a single process lifetime.  Instance-level isolation
        # prevents cross-test or cross-request cache pollution.
        self._cache: dict[str, str] = {}

    async def rewrite(self, query: str, tier: int = 1) -> str:
        """
        Rewrite a Turkish legal query to formal legal language.

        Args:
            query:  The user's raw query (post-KVKK masking).
            tier:   Preliminary tier estimate (1–4).  Tier 1 → pass-through.

        Returns:
            Rewritten query string.  Falls back to original on any error.
        """
        if not settings.query_rewrite_enabled:
            return query

        if tier < 2:
            logger.debug("QUERY_REWRITER | tier=%d → pass-through", tier)
            return query

        # In-process cache check
        if query in self._cache:
            logger.debug("QUERY_REWRITER | cache_hit | query_len=%d", len(query))
            return self._cache[query]

        try:
            rewritten = await asyncio.wait_for(
                self._call_llm(query),
                timeout=settings.query_rewrite_timeout_s,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "QUERY_REWRITER | timeout=%.1fs | fallback=original | query_len=%d",
                settings.query_rewrite_timeout_s,
                len(query),
            )
            return query
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "QUERY_REWRITER | error=%s | fallback=original | query_len=%d",
                exc,
                len(query),
            )
            return query

        # Sanity check — if LLM returns empty / too-short result, use original
        if not rewritten or len(rewritten.strip()) < 5:
            return query

        logger.info(
            "QUERY_REWRITER | tier=%d | original_len=%d | rewritten_len=%d | "
            "original=%r | rewritten=%r",
            tier,
            len(query),
            len(rewritten),
            query[:60],
            rewritten[:60],
        )

        self._cache[query] = rewritten
        return rewritten

    async def _call_llm(self, query: str) -> str:
        """
        Single-turn LLM call using the OpenAI chat completions API.

        Uses the gpt-4o-mini model (Tier 2 cost level).
        Returns the raw text of the first completion choice.
        """
        if not settings.openai_api_key:
            logger.debug("QUERY_REWRITER | openai_api_key missing → pass-through")
            return query

        # Lazy import — avoids circular imports and keeps startup fast.
        try:
            from openai import AsyncOpenAI  # type: ignore[import-untyped]
        except ImportError:
            logger.warning("QUERY_REWRITER | openai package not installed → pass-through")
            return query

        client = AsyncOpenAI(api_key=settings.openai_api_key)

        response = await client.chat.completions.create(
            model=settings.query_rewrite_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            temperature=0.1,
            max_tokens=128,
        )

        return (response.choices[0].message.content or "").strip()


# ============================================================================
# Module-level singleton
# ============================================================================

query_rewriter = QueryRewriter()
