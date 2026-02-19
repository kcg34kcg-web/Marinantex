"""
Lehe Kanun Engine — Step 10: Time-Travel Search ve "Lehe Kanun" Motoru
=======================================================================
Stateless rule engine that classifies the legal domain of a query and
decides whether the lehe kanun (favor rei) doctrine applies.

Architecture:
    1. classify_domain(query_text)  — keyword matching, O(N*K), zero cost
    2. check(query_text, event_date, decision_date) → LeheKanunResult

    The engine is intentionally DOMAIN-DETECTION ONLY.  It does NOT try to
    automatically determine which law version is "more favourable" — that
    comparison requires actual legal analysis of the content, which is the
    LLM's job.  The engine's role is to:
        • Detect when lehe kanun is legally required.
        • Signal the retrieval layer to fetch BOTH versions (event + decision).
        • Provide the LLM with both versions in the context window for comparison.

Design Principles:
    - Pure functions + singleton: easy to unit-test, no mocking needed.
    - Turkish legal vocabulary: handles ı/i/İ/Ğ/Ş/Ç/Ö/Ü normalisation.
    - No external API calls; zero latency overhead.
    - Keywords are deliberately broad (better recall than precision —
      a false positive just fetches an extra doc version, not a legal error).

Legal References:
    TCK md. 7/2  — Lehe kanun (ceza hukuku)
    TCK md. 7/3  — Zamanaşımı sürelerine de uygulanır
    Kabahatler Kanunu md. 5 — İdari yaptırımlarda lehe kanun
    VUK md. 360  — Vergi cezalarında lehe hüküm uygulaması
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional, FrozenSet

from domain.entities.lehe_kanun import LawDomain, LeheKanunResult

logger = logging.getLogger("babylexit.lehe_kanun")


# ============================================================================
# Keyword registries — Turkish legal vocabulary
# ============================================================================

# Criminal law (TCK / CMK) — lehe kanun MANDATORY under TCK md. 7/2
_CEZA_KEYWORDS: FrozenSet[str] = frozenset({
    # Codes / abbreviations
    "tck", "cmk", "ceza kanunu", "türk ceza kanunu", "ceza muhakemesi",
    # Offence types
    "suç", "suç", "suçu", "suçun", "suçla", "suça",
    "hırsızlık", "dolandırıcılık", "sahtecilik", "zimmet", "irtikap",
    "rüşvet", "hakaret", "tehdit", "şantaj", "öldürme", "yaralama",
    "taksirle", "kasten", "uyuşturucu", "uyuşturucudan", "kaçakçılık",
    "cinsel istismar", "fuhuş", "müstehcenlik",
    # Procedural / sentencing
    "sanık", "sanik", "mahkumiyet", "mahkûmiyet", "mahkum", "mahkûm",
    "beraat", "tutuklu tahliye", "tutukluluk", "tutuklu", "gözaltı", "gozalti",
    "hapis cezası", "hapis", "adli para cezası", "erteleme",
    "denetimli serbestlik", "tecil", "müsadere",
    "kovuşturma", "soruşturma", "iddianame", "suçlama",
    # Time / prescription
    "dava zamanaşımı", "ceza zamanaşımı", "zamanaşımı süresi",
    "hak düşürücü süre ceza",
    # Lehe kanun specific
    "lehe kanun", "lehe hüküm", "failin lehi", "sanığın lehi",
    "lehe olan", "lehe düzenleme",
})

# Administrative sanctions (Kabahatler Kanunu) — lehe kanun applies
_IDARI_CEZA_KEYWORDS: FrozenSet[str] = frozenset({
    "kabahat", "kabahati", "kabahatler", "kabahatler kanunu",
    "idari para cezası", "idari yaptırım", "idari ceza",
    "trafik cezası", "trafik para cezası",
    "belediye cezası", "çevre cezası",
    "idari iptali", "idari işlem ceza",
})

# Tax penalty (VUK) — lehe kanun applies to the penalty part only
_VERGI_CEZA_KEYWORDS: FrozenSet[str] = frozenset({
    "vuk", "vergi usul", "vergi ziyaı", "vergi ziyai",
    "vergi ziyaı cezası", "vergi cezası", "vergi cezasi",
    "usulsüzlük cezası", "usulsuzluk cezasi",
    "özel usulsüzlük", "kaçakçılık suçu vuk",
    "vergi kaçakçılığı ceza",
})

# Private / civil / labour / commercial — lehe kanun does NOT apply
_DIGER_KEYWORDS: FrozenSet[str] = frozenset({
    "kira", "kiracı", "kiralandı", "tahliye tazminat",
    "iş akdi", "ihbar tazminatı", "kıdem tazminatı", "işe iade",
    "boşanma", "nafaka", "velayet", "miras", "vasiyetname",
    "ticaret hukuku", "anonim şirket", "limited şirket",
    "icra", "haciz", "iflas", "konkordato",
    "idare hukuku", "idari dava", "iptal davası",
})

# Normalisation map for common Turkish character confusions in search
_NORM = str.maketrans("ıİğĞşŞçÇöÖüÜâÂêÊîÎûÛ",
                       "iIgGsScCoOuUaAeEiIuU")


# ============================================================================
# Pure helper functions
# ============================================================================

def _normalise(text: str) -> str:
    """
    Replaces Turkish-specific characters then lowercases.

    ORDER MATTERS: translate() first, then lower().
    Python's str.lower() decomposes 'İ' (İ, U+0130) into 'i̇' (two code
    points), which would then miss the translate() mapping.  By translating
    first ('\u0130' → 'I') and lowercasing second ('I' → 'i'), all Turkish
    uppercase/lowercase pairs resolve correctly.

    Used only for keyword matching — does NOT modify the original query.
    """
    return text.translate(_NORM).lower()


def _score_keywords(
    text_lower: str,
    keywords: FrozenSet[str],
) -> int:
    """
    Counts how many keywords from ``keywords`` appear as substrings in
    ``text_lower`` (already normalised).

    Keywords are normalised on-the-fly so Turkish chars in the frozenset
    (e.g. 'ı' in 'kiracı') are compared correctly against the normalised text.
    Substring matching is intentional: "mahkumiyet" matches "mahkumiyetini".
    """
    return sum(1 for kw in keywords if _normalise(kw) in text_lower)


def classify_domain(query_text: str) -> LawDomain:
    """
    Classifies the legal domain of ``query_text`` using keyword scoring.

    Scoring order (highest wins):
        CEZA > IDARI_CEZA > VERGI_CEZA > DIGER > UNKNOWN

    Ties are broken by the order above (criminal law takes priority).
    Returns UNKNOWN when no keyword set achieves a score > 0.

    Args:
        query_text: Raw user query string (any encoding accepted).

    Returns:
        LawDomain enum value.

    Note:
        This function is pure (no side effects) and deterministic.
        Average runtime for a 200-token query: < 0.1 ms.
    """
    normalised = _normalise(query_text)

    scores = {
        LawDomain.CEZA:       _score_keywords(normalised, _CEZA_KEYWORDS),
        LawDomain.IDARI_CEZA: _score_keywords(normalised, _IDARI_CEZA_KEYWORDS),
        LawDomain.VERGI_CEZA: _score_keywords(normalised, _VERGI_CEZA_KEYWORDS),
        LawDomain.DIGER:      _score_keywords(normalised, _DIGER_KEYWORDS),
    }

    best_domain, best_score = LawDomain.UNKNOWN, 0
    # Priority order: CEZA first ensures it wins ties with IDARI_CEZA
    for domain in (LawDomain.CEZA, LawDomain.IDARI_CEZA, LawDomain.VERGI_CEZA, LawDomain.DIGER):
        if scores[domain] > best_score:
            best_score = scores[domain]
            best_domain = domain

    logger.debug(
        "LEHE_DOMAIN_CLASSIFY | domain=%s | scores=%s",
        best_domain.value, scores,
    )
    return best_domain


# ============================================================================
# LeheKanunEngine
# ============================================================================

class LeheKanunEngine:
    """
    Stateless lehe kanun (favor rei) rule engine.

    Responsibilities:
        1. classify_domain(): keyword-based domain detection
        2. check():           decides whether both law versions are needed

    Usage:
        engine = LeheKanunEngine()
        result = engine.check(
            query_text="Sanığın işlediği hırsızlık suçu için hangi kanun uygulanır?",
            event_date=date(2020, 6, 1),
            decision_date=date(2026, 2, 1),
        )
        if result.both_versions_needed:
            # Fetch documents at event_date AND decision_date
            ...
    """

    def check(
        self,
        query_text: str,
        event_date: date,
        decision_date: date,
    ) -> LeheKanunResult:
        """
        Evaluates whether the lehe kanun principle applies to this query.

        Logic:
            1. Classify domain.
            2. If domain is not lehe-applicable → not_applicable().
            3. If event_date == decision_date → same version, not applicable.
            4. Otherwise → applicable(), both_versions_needed=True.

        Args:
            query_text:     Raw user query.
            event_date:     Date the legal event / offence occurred.
            decision_date:  Date a verdict is being rendered (today or future).

        Returns:
            LeheKanunResult (frozen).
        """
        domain = classify_domain(query_text)

        if not domain.lehe_applicable:
            reason = (
                f"Lehe kanun ilkesi '{domain.value}' hukuku alanında "
                "uygulanmaz. Bu ilke yalnızca ceza, idari ceza ve vergi "
                "ceza hukukunda geçerlidir."
            )
            logger.debug("LEHE_NOT_APPLICABLE | domain=%s | reason=%s", domain.value, reason)
            return LeheKanunResult.not_applicable(
                law_domain=domain,
                event_date=event_date,
                decision_date=decision_date,
                reason=reason,
            )

        if event_date == decision_date:
            reason = (
                "Olay tarihi ve karar tarihi aynı olduğundan karşılaştırılacak "
                "farklı bir yasa sürümü yoktur."
            )
            logger.debug("LEHE_SAME_DATE | domain=%s", domain.value)
            return LeheKanunResult.not_applicable(
                law_domain=domain,
                event_date=event_date,
                decision_date=decision_date,
                reason=reason,
            )

        reason = (
            f"TCK Madde 7/2 gereği '{domain.value}' hukuku alanında lehe kanun "
            f"ilkesi uygulanır. Olay tarihi ({event_date}) ve karar tarihi "
            f"({decision_date}) itibariyle yürürlükteki her iki yasa sürümü "
            "de getirilmiş; failin lehine olan hüküm uygulanmalıdır."
        )
        logger.info(
            "LEHE_APPLICABLE | domain=%s | event_date=%s | decision_date=%s",
            domain.value, event_date, decision_date,
        )
        return LeheKanunResult.applicable(
            law_domain=domain,
            event_date=event_date,
            decision_date=decision_date,
            reason=reason,
        )


# ============================================================================
# Module-level singleton
# ============================================================================

lehe_kanun_engine = LeheKanunEngine()
