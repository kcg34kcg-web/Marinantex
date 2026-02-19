"""
Synonym Store — Step 11: Hibrit Arama Eşanlam Sözlüğü
======================================================
Türk hukuku terminolojisi için donmuş (immutable) bir eşanlam deposu.

Mimari Tasarım Kararları:
    1. SÖZLÜK TABANLI (sıfır gecikme): Harici bir API veya model çağrısı
       yapılmaz.  Tüm eşanlamlar bu modülde kodlanmıştır.
    2. İKİ YÖNLÜ GENIŞLEME: "İhbar tazminatı" → "bildirim tazminatı" ve
       "bildirim tazminatı" → "ihbar tazminatı" otomatik eklenir.
    3. CANONICAL NORMALIZE: Tüm terimler Türkçe normalize edilip
       küçük harfe indirilir; arama zamanında karşılaştırma güvenilirdir.
    4. GENIŞLEME SINIRI: Bir sorgu maksimum ``MAX_EXPANSIONS`` benzersiz
       terim üretir — token patlamasını önler.

Kapsam:
    - İş hukuku: ihbar, kıdem, işe iade, fesih
    - Ceza hukuku: suç, sanık, mahkumiyet, hapis
    - Medeni hukuk: boşanma, nafaka, velayet, miras
    - Ticaret hukuku: iflas, konkordato, haciz, icra
    - İdare hukuku: iptal, idari para cezası, kabahat
    - Vergi hukuku: vergi ziyaı, usulsüzlük, VUK

Kullanım:
    from infrastructure.search.synonym_store import synonym_store
    expanded = synonym_store.expand("ihbar tazminatı")
    # → frozenset({"ihbar tazminatı", "bildirim tazminatı",
    #              "ihbar öneli", "bildirim süresi"})
"""

from __future__ import annotations

import logging
from typing import FrozenSet, Dict, List, Set

logger = logging.getLogger("babylexit.search.synonym_store")

# ---------------------------------------------------------------------------
# Hard limit — prevents query-string explosion
# ---------------------------------------------------------------------------
MAX_EXPANSIONS: int = 8

# ---------------------------------------------------------------------------
# Normalisation map (same as lehe_kanun_engine for consistency)
# ---------------------------------------------------------------------------
_NORM = str.maketrans("ıİğĞşŞçÇöÖüÜâÂêÊîÎûÛ",
                       "iIgGsScCoOuUaAeEiIuU")


def _n(text: str) -> str:
    """Normalise: Turkish char substitution → lower."""
    return text.translate(_NORM).lower()


# ---------------------------------------------------------------------------
# Synonym groups — each list is a clique; every member is a synonym of every other
# ---------------------------------------------------------------------------
_SYNONYM_GROUPS: List[List[str]] = [

    # ── İş Hukuku ─────────────────────────────────────────────────────────
    ["ihbar tazminatı", "bildirim tazminatı", "ihbar öneli", "bildirim süresi"],
    ["kıdem tazminatı", "hizmet tazminatı", "kıdem ikramiyesi"],
    ["işe iade", "göreve iade", "işe geri dönme", "işe iadesi"],
    ["iş akdi feshi", "iş sözleşmesi feshi", "hizmet akdi feshi", "iş akdi sona erme"],
    ["deneme süresi", "deneme dönemi", "tecrübe süresi"],
    ["fazla mesai", "fazla çalışma", "mesai ücreti", "fazla mesai ücreti"],
    ["yıllık izin", "yıllık ücretli izin", "yıllık tatil"],
    ["işçi", "çalışan", "hizmetli", "personel"],
    ["işveren", "müstahdem eden", "patron"],
    ["toplu iş sözleşmesi", "toplu sözleşme", "TİS"],

    # ── Ceza Hukuku ───────────────────────────────────────────────────────
    ["sanık", "şüpheli", "fail", "maznun"],
    ["mahkumiyet", "mahkûmiyet", "suçlu bulunma", "cezalandırma"],
    ["beraat", "aklanma", "suçsuz bulunma"],
    ["hapis cezası", "özgürlüğü bağlayıcı ceza", "hapis"],
    ["dava zamanaşımı", "zamanaşımı süresi ceza", "ceza zamanaşımı"],
    ["uyuşturucu", "narkotik", "uyuşturucu madde", "madde bağımlılığı"],
    ["dolandırıcılık", "sahtecilik", "dolandırma"],
    ["hırsızlık", "çalma", "gasp"],
    ["tehdit", "yıldırma", "korkutma"],
    ["hakaret", "aşağılama", "onur kırıcı davranış"],

    # ── Ceza Muhakemesi ───────────────────────────────────────────────────
    ["kovuşturma", "cezai takibat", "yargılama"],
    ["soruşturma", "tahkikat", "inceleme"],
    ["tutukluluk", "tutuklu kalma", "gözaltı"],
    ["tahliye", "serbest bırakma", "salıverme"],
    ["iddianame", "itham belgesi", "suçlama"],

    # ── Medeni Hukuk / Aile Hukuku ────────────────────────────────────────
    ["boşanma", "evlilik birliğinin sona ermesi", "evliliğin iptali"],
    ["nafaka", "geçim yardımı", "yoksulluk nafakası", "iştirak nafakası"],
    ["velayet", "çocuğun velayeti", "ebeveyn hakları"],
    ["miras", "tereke", "kalıt"],
    ["vasiyetname", "vasiyet", "son irade beyanı"],
    ["evlat edinme", "evlat edinimi", "evlatlık"],

    # ── Ticaret Hukuku ────────────────────────────────────────────────────
    ["iflas", "iflâs", "konkordato", "borç ödeme güçsüzlüğü"],
    ["haciz", "mal varlığına el koyma", "icra"],
    ["şirket birleşmesi", "şirket birleşme", "merger", "devralma"],
    ["limited şirket", "ltd. şti.", "LTD"],
    ["anonim şirket", "a.ş.", "AŞ", "joint stock company"],
    ["kira sözleşmesi", "kiralama sözleşmesi", "kira kontratı"],
    ["kiracı", "kiralayan", "kiracının hakları"],

    # ── İdare Hukuku ──────────────────────────────────────────────────────
    ["iptal davası", "idari iptal", "idari işlem iptali"],
    ["idari para cezası", "para cezası", "idari yaptırım"],
    ["kabahat", "hafif suç", "düzene aykırılık"],
    ["idari dava", "idare mahkemesi davası"],
    ["tam yargı davası", "tazminat davası idare", "idari tazminat"],

    # ── Vergi Hukuku ──────────────────────────────────────────────────────
    ["vergi ziyaı", "vergi kaçağı", "vergi kaybı"],
    ["usulsüzlük cezası", "vergi usulsüzlüğü", "idari para cezası vergi"],
    ["vergi incelemesi", "vergi denetimi", "vergi teftişi"],
    ["vergi itirazı", "vergi uyuşmazlığı", "vergi itiraz"],
    ["KDV", "katma değer vergisi", "value added tax"],
    ["gelir vergisi", "GV", "şahsi gelir vergisi"],
    ["kurumlar vergisi", "KV", "şirket vergisi"],

    # ── Gayrimenkul / Tapu ────────────────────────────────────────────────
    ["tapu", "tapu senedi", "mülkiyet belgesi"],
    ["ipotek", "rehin", "mortgage"],
    ["kat mülkiyeti", "apartman mülkiyeti", "daire mülkiyeti"],

    # ── Hukuki Terimler (Genel) ───────────────────────────────────────────
    ["dava", "hukuki uyuşmazlık", "yargılama"],
    ["temyiz", "bozma", "istinaf"],
    ["kesinleşme", "kesin hüküm", "nihai karar"],
    ["tazminat", "zarar ziyan", "maddi manevi tazminat"],
    ["vekalet", "yetki belgesi", "vekaletname"],
    ["sözleşme", "akit", "mukavele", "anlaşma"],
    ["ihtarname", "ihtar", "uyarı mektubu"],
]

# ---------------------------------------------------------------------------
# Build bidirectional index at import time — O(1) lookup during query expansion
# ---------------------------------------------------------------------------

# normalised_term → frozenset of all synonyms (including itself)
_INDEX: Dict[str, FrozenSet[str]] = {}

for _group in _SYNONYM_GROUPS:
    # normalise all members
    _norm_group: List[str] = [_n(t) for t in _group]
    _fs = frozenset(_norm_group)
    for _term in _norm_group:
        existing = _INDEX.get(_term, frozenset())
        _INDEX[_term] = existing | _fs  # union in case a term appears in >1 group

logger.debug("SynonymStore built | %d terms indexed", len(_INDEX))


# ============================================================================
# SynonymStore
# ============================================================================

class SynonymStore:
    """
    Immutable Turkish legal synonym registry.

    Public API:
        expand(term)        → frozenset of related terms (including the input)
        has_synonyms(term)  → bool
        all_terms           → frozenset of all registered terms

    Thread-safe: instance is stateless after __init__.
    """

    def __init__(self) -> None:
        self._index: Dict[str, FrozenSet[str]] = _INDEX

    # ── Public API ──────────────────────────────────────────────────────────

    def expand(self, term: str) -> FrozenSet[str]:
        """
        Returns all synonyms for ``term``, including ``term`` itself.

        Normalises the input before lookup so callers don't need to worry
        about Turkish character case.  Unknown terms return a singleton set
        containing only the normalised input.

        Expansion is capped at MAX_EXPANSIONS terms to prevent query explosion.

        Args:
            term: Raw query term (any case, any Turkish encoding).

        Returns:
            frozenset of normalised synonym strings (1 … MAX_EXPANSIONS members).

        Example:
            store.expand("İhbar Tazminatı")
            # → frozenset({"ihbar tazminati", "bildirim tazminati",
            #              "ihbar oneli", "bildirim suresi"})
        """
        norm = _n(term)
        synonyms = self._index.get(norm, frozenset({norm}))

        # Cap at MAX_EXPANSIONS — deterministic: sort, then take first N
        if len(synonyms) > MAX_EXPANSIONS:
            synonyms = frozenset(sorted(synonyms)[:MAX_EXPANSIONS])

        logger.debug(
            "SYNONYM_EXPAND | term=%r | expansions=%d | terms=%s",
            term, len(synonyms), sorted(synonyms),
        )
        return synonyms

    def expand_query(self, query: str, max_terms: int = MAX_EXPANSIONS) -> FrozenSet[str]:
        """
        Splits ``query`` into tokens, expands each, returns the union.

        Also includes the full original query as a term (phrase matching).
        Useful for expanding multi-word search queries before passing to BM25.

        Args:
            query:     Multi-word query string.
            max_terms: Hard cap on the returned set size.

        Returns:
            frozenset of all terms (original + synonyms, up to max_terms).
        """
        norm_query = _n(query)
        result: Set[str] = {norm_query}

        # Expand each space-delimited token
        for token in norm_query.split():
            result.update(self._index.get(token, set()))

        # Also attempt a direct phrase lookup
        result.update(self._index.get(norm_query, set()))

        # Cap
        if len(result) > max_terms:
            result = set(sorted(result)[:max_terms])

        return frozenset(result)

    def has_synonyms(self, term: str) -> bool:
        """Returns True if ``term`` has registered synonyms beyond itself."""
        norm = _n(term)
        syns = self._index.get(norm, frozenset())
        return len(syns) > 1

    @property
    def all_terms(self) -> FrozenSet[str]:
        """Frozenset of every registered normalised term."""
        return frozenset(self._index.keys())

    def __len__(self) -> int:
        return len(self._index)

    def __repr__(self) -> str:
        return f"SynonymStore(terms={len(self._index)})"


# ============================================================================
# Module-level singleton
# ============================================================================

synonym_store = SynonymStore()
