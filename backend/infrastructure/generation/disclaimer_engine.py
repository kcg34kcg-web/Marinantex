"""
Legal Disclaimer Engine  —  Step 16
=====================================
Generates mandatory, context-aware Turkish legal disclaimers for every
RAG response.

Disclaimer types (additive — multiple can be active simultaneously):
  GENEL_HUKUKI       — Always present.  Base disclaimer: "Bu sistem hukuki
                        tavsiye niteliği taşımaz; yalnızca bilgi amaçlıdır."
  AYM_IPTAL_UYARISI  — Activated when the response contains at least one
                        AYM-cancelled / AYM-restricted source.
  LEHE_KANUN         — Activated when lehe kanun (TCK md. 7/2) engine fires.
  UZMAN_ZORUNLU      — Activated for Tier 3/4 queries (complex legal analysis)
                        where professional legal review is strongly advised.

Design:
  - `generate()` is a pure(-ish) function — same inputs → same outputs.
  - Severity escalates: INFO → WARNING → CRITICAL as more risk types activate.
  - `LegalDisclaimerSchema` is the Pydantic output model (defined in api/schemas).
  - The engine accepts Optional inputs for all risk signals so it degrades
    gracefully when called with partial information.

Legal basis references:
  - Avukatlık Kanunu md. 35 (hukuki danışmanlık münhasıriyeti)
  - TBB Meslek Kuralları md. 3 (avukat bağımsızlığı)
  - Kişisel Verileri Koruma Kanunu (KVKK) md. 12 (gizlilik)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

logger = logging.getLogger("babylexit.disclaimer_engine")


# ---------------------------------------------------------------------------
# Disclaimer type enumeration
# ---------------------------------------------------------------------------

class DisclaimerType(str, Enum):
    """
    Enumeration of all disclaimer categories that can be activated.

    Each value is a stable string identifier safe to store in the database
    or serialise to JSON (str mixin ensures value comparison works directly).
    """

    GENEL_HUKUKI = "GENEL_HUKUKI"
    """Base disclaimer: always attached; states this is not legal advice."""

    AYM_IPTAL_UYARISI = "AYM_IPTAL_UYARISI"
    """AYM cancellation warning: one or more sources carry an AYM iptal status."""

    LEHE_KANUN = "LEHE_KANUN"
    """Lehe kanun notice: TCK md. 7/2 favour-of-the-accused comparison required."""

    UZMAN_ZORUNLU = "UZMAN_ZORUNLU"
    """Expert review required: complex legal analysis — consult a qualified lawyer."""


# ---------------------------------------------------------------------------
# Severity levels
# ---------------------------------------------------------------------------

class DisclaimerSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


# ---------------------------------------------------------------------------
# Disclaimer text templates
# ---------------------------------------------------------------------------

_TEXTS: dict[DisclaimerType, str] = {
    DisclaimerType.GENEL_HUKUKI: (
        "⚖️ HUKUKİ UYARI: Bu sistem yapay zeka destekli bir hukuki bilgi "
        "aracıdır. Sunulan bilgiler hukuki tavsiye niteliği taşımaz ve bir "
        "avukat görüşünün yerini tutamaz. Avukatlık Kanunu md. 35 gereği hukuki "
        "danışmanlık yalnızca avukatlar tarafından verilebilir. Sistemi kullanan "
        "kişi bu sınırlamayı kabul etmiş sayılır."
    ),
    DisclaimerType.AYM_IPTAL_UYARISI: (
        "🚨 AYM İPTAL UYARISI: Yanıtta atıfta bulunulan kaynak(lar)dan bir veya "
        "birkaçı Anayasa Mahkemesi tarafından iptal edilmiş veya kısıtlanmıştır. "
        "İptal kararının yürürlük tarihi ve etkisi konusunda güncel mevzuatı "
        "bizzat inceleyiniz ya da alanında uzman bir avukata danışınız."
    ),
    DisclaimerType.LEHE_KANUN: (
        "⚠️ LEHE KANUN (TCK md. 7/2): Her iki yasa sürümü getirilmiştir. "
        "Olay tarihi ile karar tarihi arasında kanun değişikliği bulunduğundan "
        "fail lehine olan sürümün tespiti avukat tarafından yapılmalıdır. "
        "Lehe kanun değerlendirmesi yalnızca yetkili hukuk uzmanınca "
        "gerçekleştirilebilir."
    ),
    DisclaimerType.UZMAN_ZORUNLU: (
        "🔴 UZMAN GÖRÜŞÜ GEREKLİ: Bu sorgu karmaşık hukuki analiz içermektedir. "
        "Yapay zeka çıktısı hatalı veya eksik olabilir. Dava açmadan, sözleşme "
        "imzalamadan veya hukuki işlem yapmadan önce mutlaka alanında uzman bir "
        "avukata danışınız. TBB Meslek Kuralları md. 3 gereği bağımsız hukuki "
        "değerlendirme zorunludur."
    ),
}

_LEGAL_BASIS = (
    "Avukatlık Kanunu md. 35 | TBB Meslek Kuralları md. 3 | KVKK md. 12"
)


# ---------------------------------------------------------------------------
# Pure builder functions
# ---------------------------------------------------------------------------

def _compute_severity(types: List[DisclaimerType]) -> DisclaimerSeverity:
    """
    Computes the overall disclaimer severity from the active disclaimer types.

    Rules:
      - UZMAN_ZORUNLU or AYM_IPTAL_UYARISI → CRITICAL
      - LEHE_KANUN                           → WARNING
      - GENEL_HUKUKI only                    → INFO
    """
    type_set = set(types)
    if (
        DisclaimerType.UZMAN_ZORUNLU in type_set
        or DisclaimerType.AYM_IPTAL_UYARISI in type_set
    ):
        return DisclaimerSeverity.CRITICAL
    if DisclaimerType.LEHE_KANUN in type_set:
        return DisclaimerSeverity.WARNING
    return DisclaimerSeverity.INFO


def _combine_disclaimer_text(types: List[DisclaimerType]) -> str:
    """
    Concatenates disclaimer texts for all active types, separated by newlines.

    GENEL_HUKUKI is always first; remaining types appear in declaration order.
    """
    ordered: List[DisclaimerType] = [DisclaimerType.GENEL_HUKUKI]
    for t in [
        DisclaimerType.AYM_IPTAL_UYARISI,
        DisclaimerType.LEHE_KANUN,
        DisclaimerType.UZMAN_ZORUNLU,
    ]:
        if t in types and t not in ordered:
            ordered.append(t)
    return "\n\n".join(_TEXTS[t] for t in ordered)


# ---------------------------------------------------------------------------
# Disclaimer Engine
# ---------------------------------------------------------------------------

class LegalDisclaimerEngine:
    """
    Generates context-aware mandatory legal disclaimers.

    The engine is stateless — all context is passed to `generate()`.
    Safe for use as a module-level singleton.

    Usage:
        engine = LegalDisclaimerEngine()
        disclaimer = engine.generate(
            has_aym_warnings=True,
            has_lehe_notice=False,
            tier_value=3,
        )
    """

    def generate(
        self,
        has_aym_warnings: bool = False,
        has_lehe_notice: bool = False,
        tier_value: int = 1,
        expert_review_min_tier: int = 3,
    ) -> "LegalDisclaimerData":
        """
        Produces a LegalDisclaimerData object for inclusion in the RAGResponse.

        Args:
            has_aym_warnings       : True when the response carries AYM-cancelled sources.
            has_lehe_notice        : True when the lehe kanun engine was activated.
            tier_value             : QueryTier.value (1-4) — determines UZMAN_ZORUNLU.
            expert_review_min_tier : Tier threshold at which UZMAN_ZORUNLU activates.
                                     Default 3 (Tier 3 = complex legal analysis).

        Returns:
            LegalDisclaimerData with combined disclaimer text, types, severity, etc.
        """
        active_types: List[DisclaimerType] = [DisclaimerType.GENEL_HUKUKI]

        if has_aym_warnings:
            active_types.append(DisclaimerType.AYM_IPTAL_UYARISI)

        if has_lehe_notice:
            active_types.append(DisclaimerType.LEHE_KANUN)

        if tier_value >= expert_review_min_tier:
            if DisclaimerType.UZMAN_ZORUNLU not in active_types:
                active_types.append(DisclaimerType.UZMAN_ZORUNLU)

        severity = _compute_severity(active_types)
        combined_text = _combine_disclaimer_text(active_types)
        requires_expert = DisclaimerType.UZMAN_ZORUNLU in active_types

        logger.info(
            "DISCLAIMER_GEN | types=%s | severity=%s | expert=%s",
            [t.value for t in active_types],
            severity.value,
            requires_expert,
        )

        return LegalDisclaimerData(
            disclaimer_text=combined_text,
            disclaimer_types=[t.value for t in active_types],
            severity=severity.value,
            requires_expert_review=requires_expert,
            generated_at=datetime.now(tz=timezone.utc),
            legal_basis=_LEGAL_BASIS,
        )


# ---------------------------------------------------------------------------
# LegalDisclaimerData — lightweight dataclass (NOT a Pydantic model)
# This is the internal transfer object; the Pydantic schema lives in api/schemas.
# ---------------------------------------------------------------------------

from dataclasses import dataclass


@dataclass
class LegalDisclaimerData:
    """
    Internal disclaimer object produced by LegalDisclaimerEngine.generate().

    Converted to LegalDisclaimerSchema (Pydantic) in rag_service.py before
    being attached to RAGResponse.
    """

    disclaimer_text: str
    disclaimer_types: List[str]
    severity: str
    requires_expert_review: bool
    generated_at: datetime
    legal_basis: Optional[str] = None


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

disclaimer_engine = LegalDisclaimerEngine()
