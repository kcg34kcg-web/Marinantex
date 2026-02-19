"""
Legal Reranker — Step 12: Hiyerarşi, Otorite ve Çatışma Duyarlı Re-Ranking
============================================================================
RRF çıktısını, Türk hukuku norm hiyerarşisi, yargı otoritesi ve evrensel
hukuk kurallarına (Lex Specialis / Lex Posterior) göre yeniden sıralar.

RE-RANKING KATMANLARI (aşamalı — her katman öncekinin üstüne biner):
─────────────────────────────────────────────────────────────────────
  1. BASE_SCORE          : RRF final_score (semantik + BM25 füzyon)
  2. AUTHORITY_BOOST     : Yargı otoritesi × ağırlık
                           (IBK/HGK/CGK=1.0, AYM=1.0, Daire=0.75 …)
  3. HIERARCHY_BOOST     : Norm hiyerarşisi ek puanı
                           (Anayasa+0.20, Kanun+0.12, CBK+0.08 …)
  4. BINDING_BOOST       : Bağlayıcı içtihat (AYM/IBK/HGK/CGK/DANISTAY_IDDK)
                           için sabit hard boost
  5. LEX_SPECIALIS_BOOST : Aynı norm seviyesinde daha özel hüküm
                           (domain-specific chamber) üstün gelir
  6. LEX_POSTERIOR_BOOST : Aynı norm seviyesinde daha yeni hüküm
                           (effective_date / ruling_date) üstün gelir

KURALLAR:
  - Lex Specialis (Özel Kanun): Aynı hiyerarşi seviyesinde, sorgunun
    domain'ine özelleşmiş mahkeme dairesinden gelen karar genel olanın
    önüne geçer. (örn: iş uyuşmazlığında 9. HD > 1. HD)
  - Lex Posterior (Sonraki Kanun): Aynı hiyerarşi seviyesinde, daha
    sonraki tarihli hüküm/karar öncekini geçersiz kılar.
  - Her iki kural da sadece AYNI norm seviyesi içinde uygulanır.
    Farklı seviyeler arasında hiyerarşi kuralı (step 3) zaten geçerlidir.

Referanslar:
  - Anayasa md. 11 (norm hiyerarşisi)
  - TCK md. 7 / CMK md. 2 (özel kanun önceliği)
  - Yargıtay İBK kararlarının bağlayıcılığı (Yargıtay Kanunu md. 45)
  - Cormack & al., 2009 (RRF) — bu modül onun üzerine inşa edilir
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Dict, FrozenSet, List, Optional, Tuple

from domain.entities.legal_document import LegalDocument
from infrastructure.config import settings

logger = logging.getLogger("babylexit.reranking.legal_reranker")


# ============================================================================
# Norm Hiyerarşisi Ek Boost Tablosu
# ============================================================================

_NORM_BOOST: Dict[str, float] = {
    "ANAYASA":    0.20,   # Anayasa — kesin üstünlük
    "KANUN":      0.12,   # TBMM kanunu
    "CBK":        0.08,   # Cumhurbaşkanlığı Kararnamesi
    "YONETMELIK": 0.04,   # Yönetmelik
    "TEBLIG":     0.02,   # Tebliğ
    "DIGER":      0.00,   # Bilinmeyen / diğer
}


# ============================================================================
# Domain Keyword Sözlüğü — Lex Specialis için alan tespiti
# ============================================================================

_DOMAIN_KEYWORDS: Dict[str, FrozenSet[str]] = {
    "is_hukuku": frozenset({
        "işçi", "işveren", "kıdem", "ihbar", "fesih", "iş akdi",
        "çalışan", "ücret", "iş kanunu", "sgk", "işe iade", "fazla mesai",
        "yıllık izin", "kıdem tazminatı", "ihbar tazminatı",
    }),
    "ceza": frozenset({
        "suç", "ceza", "hapis", "sanık", "mahkumiyet", "beraat",
        "savcı", "tck", "cmk", "uyuşturucu", "hırsızlık", "dolandırıcılık",
        "kasten", "taksirle", "dava zamanaşımı",
    }),
    "medeni": frozenset({
        "boşanma", "nafaka", "velayet", "evlilik", "miras", "medeni kanun",
        "tmk", "aile", "evlat edinme", "miras payı", "mirasçı",
    }),
    "ticaret": frozenset({
        "şirket", "ticaret", "konkordato", "iflas", "ticari",
        "ttk", "anonim", "limited", "alacak", "haciz", "icra",
    }),
    "idare": frozenset({
        "idare", "kamu", "belediye", "ihale", "idari",
        "idare mahkemesi", "danıştay", "yürütmeyi durdurma",
        "idari işlem", "iptal davası",
    }),
    "vergi": frozenset({
        "vergi", "kdv", "gelir", "kurumlar", "vuk", "gvk", "gib",
        "vergi ziyaı", "usulsüzlük", "cezası",
    }),
    "kira": frozenset({
        "kira", "kiracı", "kiraya veren", "tahliye",
        "kira bedeli", "kira sözleşmesi", "ecrimisil",
    }),
}


# ============================================================================
# Uzman Daire Eşleme — hangi chamber hangi domain'e özgüdür
# ============================================================================

_SPECIALIZED_CHAMBERS: Dict[str, FrozenSet[str]] = {
    "is_hukuku": frozenset({
        "9. hukuk", "22. hukuk", "7. hukuk",
        "iş mahkemesi", "iş dairesi",
    }),
    "ceza": frozenset({
        "ceza dairesi", "1. ceza", "2. ceza", "4. ceza",
        "ceza genel", "cgk", "ağır ceza",
    }),
    "medeni": frozenset({
        "2. hukuk", "aile mahkemesi", "3. hukuk",
    }),
    "ticaret": frozenset({
        "ticaret mahkemesi", "11. hukuk", "23. hukuk", "ticaret dairesi",
    }),
    "idare": frozenset({
        "danıştay", "idare mahkemesi", "iddk", "idari dava",
    }),
    "vergi": frozenset({
        "vergi mahkemesi", "4. daire", "7. daire", "vergi dairesi",
    }),
    "kira": frozenset({
        "sulh hukuk", "3. hukuk", "6. hukuk",
    }),
}


# ============================================================================
# Veri Nesneleri
# ============================================================================

@dataclass
class RerankScore:
    """
    Tek bir belgenin re-ranking skoru — her katmanın katkısı ayrı tutulur.

    Alanlar:
        base_score:           RRF final_score (giriş puanı)
        authority_boost:      Yargı otoritesi katkısı
        hierarchy_boost:      Norm hiyerarşisi katkısı
        binding_boost:        Bağlayıcı içtihat hard boost
        lex_specialis_boost:  Lex Specialis kural motoru katkısı
        lex_posterior_boost:  Lex Posterior kural motoru katkısı
        total:                Tüm katmanların toplamı (sıralama için kullanılır)
    """
    base_score: float = 0.0
    authority_boost: float = 0.0
    hierarchy_boost: float = 0.0
    binding_boost: float = 0.0
    lex_specialis_boost: float = 0.0
    lex_posterior_boost: float = 0.0

    @property
    def total(self) -> float:
        """Tüm bileşenlerin toplamı — re-ranking sıralama kriteri."""
        return (
            self.base_score
            + self.authority_boost
            + self.hierarchy_boost
            + self.binding_boost
            + self.lex_specialis_boost
            + self.lex_posterior_boost
        )

    def to_dict(self) -> Dict[str, float]:
        """Audit trail / log için serileştir."""
        return {
            "base_score":          self.base_score,
            "authority_boost":     self.authority_boost,
            "hierarchy_boost":     self.hierarchy_boost,
            "binding_boost":       self.binding_boost,
            "lex_specialis_boost": self.lex_specialis_boost,
            "lex_posterior_boost": self.lex_posterior_boost,
            "total":               self.total,
        }


@dataclass
class RerankResult:
    """
    Re-ranking sonucu: belge + skor dökümü + çatışma notları.

    conflict_notes:
        LEX_SPECIALIS veya LEX_POSTERIOR kuralının uygulandığı durumlarda
        hangi belgenin hangi belgenin önüne geçtiğini açıklayan metin listesi.
        Audit trail ve LLM system prompt için kullanılır.
    """
    document: LegalDocument
    score: RerankScore
    conflict_notes: List[str] = field(default_factory=list)

    def __repr__(self) -> str:
        return (
            f"RerankResult("
            f"id={self.document.id!r}, "
            f"total={self.score.total:.4f}, "
            f"binding={self.document.is_binding_precedent}, "
            f"conflicts={len(self.conflict_notes)})"
        )


# ============================================================================
# Lex Kural Fonksiyonları — saf, yan etkisiz
# ============================================================================

def detect_query_domain(query_text: str) -> Optional[str]:
    """
    Sorgu metninden birincil hukuk alanını tespit eder.

    Her alan için anahtar kelime sayısı hesaplanır; en yüksek eşleşme
    sayısına sahip alan döndürülür. Hiç eşleşme yoksa None.

    Args:
        query_text: Kullanıcının ham sorgu metni.

    Returns:
        'is_hukuku' | 'ceza' | 'medeni' | 'ticaret' | 'idare' | 'vergi'
        | 'kira' | None
    """
    if not query_text:
        return None
    q_lower = query_text.lower()
    best_domain: Optional[str] = None
    best_count = 0
    for domain, keywords in _DOMAIN_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in q_lower)
        if count > best_count:
            best_count = count
            best_domain = domain
    return best_domain if best_count > 0 else None


def is_specialized_for_domain(doc: LegalDocument, domain: Optional[str]) -> bool:
    """
    Belgenin mahkeme dairesinin verilen domain'e özgüleşip özgüleşmediğini
    kontrol eder.

    Lex Specialis tespitinin temel bileşeni: Eğer bir belge, sorgunun
    domain'inde uzmanlaşmış bir daireden geliyorsa, aynı norm seviyesindeki
    genel daire kararının önüne geçer.

    Args:
        doc:    Kontrol edilecek belge.
        domain: detect_query_domain() tarafından tespit edilen hukuk alanı.

    Returns:
        True → daire domain'e özgüleşmiş.
        False → domain yok, chamber yok, veya eşleşme yok.
    """
    if domain is None or doc.chamber is None:
        return False
    chambers = _SPECIALIZED_CHAMBERS.get(domain, frozenset())
    chamber_lower = doc.chamber.lower()
    return any(c in chamber_lower for c in chambers)


def lex_specialis_boost(
    doc: LegalDocument,
    all_docs: List[LegalDocument],
    domain: Optional[str],
    boost_value: float,
) -> Tuple[float, List[str]]:
    """
    Lex Specialis kuralını uygular: Aynı norm seviyesinde daha özel hüküm
    daha genel hükmün önüne geçer.

    Koşul:
        - doc.norm_hierarchy == other.norm_hierarchy (aynı seviye)
        - doc domain-specific chamber'dan geliyor
        - other domain-specific değil

    Args:
        doc:         Boost hesaplanacak belge.
        all_docs:    Tüm adaylar listesi (rakip belgeleri içerir).
        domain:      Tespit edilmiş hukuk alanı.
        boost_value: Uygulanacak boost miktarı (settings.lex_specialis_weight).

    Returns:
        (boost_amount, conflict_notes)
    """
    notes: List[str] = []

    # Bu belge zaten domain'e özgüleşmemişse boost yok
    if not is_specialized_for_domain(doc, domain):
        return 0.0, notes

    for other in all_docs:
        if other.id == doc.id:
            continue
        if other.norm_hierarchy != doc.norm_hierarchy:
            continue
        # Rakip aynı norm seviyesinde ama genel → lex specialis uygulanır
        if not is_specialized_for_domain(other, domain):
            notes.append(
                f"LEX_SPECIALIS: '{doc.id}' daha özel "
                f"(domain={domain}, chamber={doc.chamber!r}) → "
                f"'{other.id}' ({other.chamber!r}) üzerinde öncelikli."
            )
            return boost_value, notes

    return 0.0, notes


def lex_posterior_boost(
    doc: LegalDocument,
    all_docs: List[LegalDocument],
    boost_value: float,
) -> Tuple[float, List[str]]:
    """
    Lex Posterior kuralını uygular: Aynı norm seviyesinde daha sonraki
    tarihli hüküm/karar öncekini geçersiz kılar.

    Tarih kaynağı: effective_date (mevzuat) veya ruling_date (içtihat).
    Her ikisi de None ise bu belge için boost hesaplanamaz.

    Args:
        doc:         Boost hesaplanacak belge.
        all_docs:    Tüm adaylar listesi.
        boost_value: Uygulanacak boost miktarı (settings.lex_posterior_weight).

    Returns:
        (boost_amount, conflict_notes)
    """
    notes: List[str] = []

    doc_date: Optional[date] = doc.effective_date or doc.ruling_date
    if doc_date is None:
        return 0.0, notes

    for other in all_docs:
        if other.id == doc.id:
            continue
        if other.norm_hierarchy != doc.norm_hierarchy:
            continue
        other_date: Optional[date] = other.effective_date or other.ruling_date
        if other_date is None:
            continue
        if doc_date > other_date:
            notes.append(
                f"LEX_POSTERIOR: '{doc.id}' ({doc_date}) daha yeni → "
                f"'{other.id}' ({other_date}) üzerinde öncelikli."
            )
            return boost_value, notes

    return 0.0, notes


# ============================================================================
# LegalReranker
# ============================================================================

class LegalReranker:
    """
    Türk hukuku norm hiyerarşisi, yargı otoritesi ve evrensel hukuk
    ilkelerine (Lex Specialis / Lex Posterior) dayalı re-ranking motoru.

    Pipeline (aşamalı):
        1. Base score  → RRF final_score
        2. Authority   → doc.authority_score × settings.reranking_authority_weight
        3. Hierarchy   → _NORM_BOOST[norm_hierarchy] × settings.reranking_hierarchy_weight
        4. Binding     → settings.reranking_binding_boost (AYM/IBK/HGK/CGK/DANISTAY_IDDK)
        5. Lex Spec.   → domain tespiti + uzman daire kontrolü
        6. Lex Post.   → effective_date / ruling_date karşılaştırması

    settings.reranking_enabled=False → pass-through (RRF sırası korunur).

    Kullanım:
        results = legal_reranker.rerank(docs, query_text="ihbar tazminatı ...")
        ranked_docs = [r.document for r in results]
    """

    def __init__(self) -> None:
        logger.info(
            "LegalReranker initialised | enabled=%s | "
            "lex_specialis_weight=%.3f | lex_posterior_weight=%.3f | "
            "reranking_binding_boost=%.3f",
            settings.reranking_enabled,
            settings.lex_specialis_weight,
            settings.lex_posterior_weight,
            settings.reranking_binding_boost,
        )

    def rerank(
        self,
        docs: List[LegalDocument],
        query_text: str,
    ) -> List[RerankResult]:
        """
        Re-ranking ana giriş noktası.

        Args:
            docs:       RRF çıktısı belgeler (desc sıralı final_score).
            query_text: Kullanıcı sorgusu — domain tespiti için kullanılır.

        Returns:
            List[RerankResult] — re-rank skoru ile desc sıralı.
        """
        if not docs:
            return []

        if not settings.reranking_enabled:
            logger.debug("Reranking disabled — pass-through (RRF order preserved).")
            return [
                RerankResult(
                    document=doc,
                    score=RerankScore(base_score=doc.final_score),
                )
                for doc in docs
            ]

        domain = detect_query_domain(query_text)
        logger.info(
            "RERANK_START | docs=%d | query_domain=%s | query_len=%d",
            len(docs), domain, len(query_text),
        )

        results: List[RerankResult] = []
        for doc in docs:
            score, conflict_notes = self._compute_score(doc, docs, domain)
            results.append(RerankResult(
                document=doc,
                score=score,
                conflict_notes=conflict_notes,
            ))

        results.sort(key=lambda r: r.score.total, reverse=True)

        lex_spec_count = sum(1 for r in results if r.score.lex_specialis_boost > 0)
        lex_post_count = sum(1 for r in results if r.score.lex_posterior_boost > 0)
        binding_count  = sum(1 for r in results if r.score.binding_boost > 0)

        logger.info(
            "RERANK_COMPLETE | docs=%d | top_score=%.4f | "
            "binding_boosted=%d | lex_specialis=%d | lex_posterior=%d",
            len(results),
            results[0].score.total,
            binding_count,
            lex_spec_count,
            lex_post_count,
        )

        return results

    # ── Özel Metodlar ────────────────────────────────────────────────────────

    def _compute_score(
        self,
        doc: LegalDocument,
        all_docs: List[LegalDocument],
        domain: Optional[str],
    ) -> Tuple[RerankScore, List[str]]:
        """
        Tek bir belge için tam RerankScore ve çatışma notlarını hesaplar.

        Returns:
            (RerankScore, conflict_notes)
        """
        s = settings

        # 1. Base score — RRF çıktısı
        base = doc.final_score

        # 2. Authority boost — mahkeme otoritesi × ağırlık
        authority_b = doc.authority_score * s.reranking_authority_weight

        # 3. Norm hierarchy boost — Anayasa > Kanun > … × ağırlık
        norm_key = doc.norm_hierarchy or "DIGER"
        hierarchy_b = _NORM_BOOST.get(norm_key, 0.0) * s.reranking_hierarchy_weight

        # 4. Binding precedent hard boost
        binding_b = s.reranking_binding_boost if doc.is_binding_precedent else 0.0

        # 5. Lex Specialis
        lex_spec_b, spec_notes = lex_specialis_boost(
            doc, all_docs, domain, s.lex_specialis_weight
        )

        # 6. Lex Posterior
        lex_post_b, post_notes = lex_posterior_boost(doc, all_docs, s.lex_posterior_weight)

        score = RerankScore(
            base_score=base,
            authority_boost=authority_b,
            hierarchy_boost=hierarchy_b,
            binding_boost=binding_b,
            lex_specialis_boost=lex_spec_b,
            lex_posterior_boost=lex_post_b,
        )
        return score, spec_notes + post_notes


# ============================================================================
# Module-level singleton
# ============================================================================

legal_reranker = LegalReranker()
