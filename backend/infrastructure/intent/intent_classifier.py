"""
Intent Classifier (Step 11)
===========================
Cheap, deterministic intent classifier executed before router/retrieval.

Goal:
    - Route simple social chat away from legal retrieval.
    - Keep legal intents in grounded pipeline.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class IntentClass(str, Enum):
    SOCIAL_SIMPLE = "social_simple"
    LEGAL_QUERY = "legal_query"
    LEGAL_DRAFTING = "legal_drafting"
    LEGAL_ANALYSIS = "legal_analysis"
    DOCUMENT_TASK = "document_task"


@dataclass(frozen=True)
class IntentDecision:
    intent_class: IntentClass
    reason: str

    @property
    def is_social_simple(self) -> bool:
        return self.intent_class == IntentClass.SOCIAL_SIMPLE

    @property
    def is_legal(self) -> bool:
        return self.intent_class != IntentClass.SOCIAL_SIMPLE


_SOCIAL_PATTERNS = [
    r"^\s*(merhaba|selam|selamlar|hey|hi|hello)\s*[!.?]*\s*$",
    r"^\s*(nasılsın|nasilsin|naber|iyi misin)\s*[!.?]*\s*$",
    r"^\s*(teşekkürler|tesekkurler|sağ ol|sag ol|eyvallah)\s*[!.?]*\s*$",
    r"^\s*(günaydın|gunaydin|iyi akşamlar|iyi aksamlar|iyi geceler)\s*[!.?]*\s*$",
]

_DRAFTING_KEYWORDS = (
    "dilekçe", "dilekce", "taslak", "ihtarname", "sözleşme", "sozlesme",
    "mütalaa", "mutalaa", "metin yaz", "hazırla", "hazirla", "draft",
)

_ANALYSIS_KEYWORDS = (
    "analiz", "değerlendir", "degerlendir", "karşılaştır", "karsilastir",
    "gerekçe", "gerekce", "yorumla", "içtihat", "ictihat", "uygulanır",
    "uygulanir", "madde", "norm", "yargıtay", "yargitay", "danıştay", "danistay",
)

_LEGAL_CUES = (
    "kanun", "tck", "tbk", "hmk", "cmk", "anayasa", "hukuk", "dava",
    "icra", "ceza", "işçi", "isci", "işveren", "isveren", "yargı", "yargi",
)


class IntentClassifier:
    """Heuristic classifier tuned for low latency and zero model cost."""

    def classify(self, query: str, chat_mode: Optional[str] = None) -> IntentDecision:
        text = (query or "").strip()
        lowered = text.lower()
        mode = (chat_mode or "").strip().lower()

        if mode == "document_analysis":
            return IntentDecision(
                intent_class=IntentClass.DOCUMENT_TASK,
                reason="chat_mode=document_analysis",
            )

        if self._is_social_simple(lowered):
            return IntentDecision(
                intent_class=IntentClass.SOCIAL_SIMPLE,
                reason="short social greeting/small-talk pattern",
            )

        if any(keyword in lowered for keyword in _DRAFTING_KEYWORDS):
            return IntentDecision(
                intent_class=IntentClass.LEGAL_DRAFTING,
                reason="drafting keyword match",
            )

        if any(keyword in lowered for keyword in _ANALYSIS_KEYWORDS):
            return IntentDecision(
                intent_class=IntentClass.LEGAL_ANALYSIS,
                reason="analysis keyword match",
            )

        if any(keyword in lowered for keyword in _LEGAL_CUES):
            return IntentDecision(
                intent_class=IntentClass.LEGAL_QUERY,
                reason="legal cue keyword match",
            )

        # Conservative default: unknown requests stay in legal pipeline.
        return IntentDecision(
            intent_class=IntentClass.LEGAL_QUERY,
            reason="fallback_to_legal_for_safety",
        )

    def _is_social_simple(self, lowered: str) -> bool:
        if len(lowered) > 80:
            return False
        return any(re.match(pattern, lowered) for pattern in _SOCIAL_PATTERNS)


intent_classifier = IntentClassifier()
