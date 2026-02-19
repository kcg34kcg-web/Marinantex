"""
Domain Entity: LegalDocument
Pure Python domain model — zero framework dependency.

Norm Hierarchy (Anayasa md. 11):
    Anayasa > Kanun > CBK > Yönetmelik > Tebliğ

STEP 3 — Hukuki Kanonik Veri Modeli:
    Adds full norm hierarchy, detailed court authority model, and
    İBKB/HGK/CGK hard-boost support to the domain entity.
    New fields: chamber, majority_type, dissent_present, norm_hierarchy.
    New property: authority_score, is_binding_precedent.

Usage:
    LegalDocument instances are created by the retrieval layer and
    consumed by the RAG service.  They are NEVER persisted directly;
    persistence is handled via Supabase SQL.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, date
from enum import Enum
from typing import Optional


# ============================================================================
# Enumerations
# ============================================================================

class NormHierarchy(str, Enum):
    """
    Turkish legal norm hierarchy per Anayasa Article 11.
    Higher tiers override lower tiers in conflicting provisions.
    Priority: ANAYASA(6) > KANUN(5) > CBK(4) > YONETMELIK(3) > TEBLIG(2) > DIGER(0)
    """

    ANAYASA   = "ANAYASA"       # Supremacy — Anayasa Mahkemesi jurisdiction
    KANUN     = "KANUN"         # TBMM statutes
    CBK       = "CBK"           # Cumhurbaşkanlığı Kararnamesi
    YONETMELIK = "YONETMELIK"   # Yönetmelik / regulation
    TEBLIG    = "TEBLIG"        # Tebliğ / communiqué
    DIGER     = "DIGER"         # Other / unknown (fallback)

    @property
    def priority(self) -> int:
        """Numeric priority: higher = more authoritative (used for conflict resolution)."""
        _map = {
            "ANAYASA":    6,
            "KANUN":      5,
            "CBK":        4,
            "YONETMELIK": 3,
            "TEBLIG":     2,
            "DIGER":      0,
        }
        return _map[self.value]

    def overrides(self, other: "NormHierarchy") -> bool:
        """Returns True if this norm tier overrides (is superior to) `other`."""
        return self.priority > other.priority


class CourtLevel(str, Enum):
    """
    Court hierarchy for authority scoring.
    Maps to the ``compute_authority_score()`` SQL function added in Step 3.

    Hard-boost tiers (is_binding_precedent = True):
        AYM, YARGITAY_IBK, YARGITAY_HGK, YARGITAY_CGK, DANISTAY_IDDK
    """

    # ── Constitutional / Highest ──────────────────────────────────────────────
    AYM              = "AYM"              # Anayasa Mahkemesi — constitutional review
    # ── Binding precedent (İçtihat Birleştirme / Genel Kurul) ─────────────────
    YARGITAY_IBK     = "YARGITAY_IBK"     # İçtihadı Birleştirme Kurulu — BINDING
    YARGITAY_HGK     = "YARGITAY_HGK"     # Hukuk Genel Kurulu — BINDING
    YARGITAY_CGK     = "YARGITAY_CGK"     # Ceza Genel Kurulu  — BINDING
    DANISTAY_IDDK    = "DANISTAY_IDDK"    # İdari Dava Daireleri Kurulu — administrative BINDING
    # ── Standard appellate ────────────────────────────────────────────────────
    YARGITAY_DAIRE   = "YARGITAY_DAIRE"   # Yargıtay hukuk/ceza daireleri
    DANISTAY         = "DANISTAY"         # Danıştay daireleri (administrative)
    # ── Regional / First instance ─────────────────────────────────────────────
    BAM              = "BAM"              # Bölge Adliye Mahkemesi
    ILKDERECE        = "ILKDERECE"        # First-instance courts (asliye, sulh, ağır ceza)


class MajorityType(str, Enum):
    """
    Voting outcome of a court decision — affects authority_score.

    OY_BIRLIGI  (unanimous):     highest certainty, full weight
    OY_COKLUGU  (majority):      standard certainty
    KARSI_OY    (with dissent):  lower certainty — dissent signals doctrinal tension
    """

    OY_BIRLIGI = "OY_BIRLIGI"   # Unanimous
    OY_COKLUGU = "OY_COKLUGU"   # Majority
    KARSI_OY   = "KARSI_OY"     # Majority with noted dissent

class AymIptalDurumu(str, Enum):
    """
    AYM cancellation / validity status for a legal provision.

    YURURLUKTE:          The provision is currently in force (default).
    IPTAL_EDILDI:        The provision has been cancelled by the Anayasa
                         Mahkemesi; cancellation may or may not be in effect
                         yet (check iptal_yururluk_tarihi).
    IPTAL_EDILDI_ERTELENDI:
                         AYM cancelled the provision but explicitly delayed
                         the effective date of cancellation to allow
                         legislative correction (AY md. 153/3).
    KISMI_IPTAL:         The provision is partially cancelled; remaining
                         parts remain in force.  Warning is mandatory.
    """

    YURURLUKTE            = "YURURLUKTE"             # In force
    IPTAL_EDILDI          = "IPTAL_EDILDI"           # Cancelled
    IPTAL_EDILDI_ERTELENDI = "IPTAL_EDILDI_ERTELENDI" # Cancelled, erteleme
    KISMI_IPTAL           = "KISMI_IPTAL"            # Partially cancelled

# ── Court-level base weights (mirrors SQL compute_authority_score) ─────────────
_COURT_LEVEL_BASE_WEIGHT: dict[str, float] = {
    "AYM":            1.00,
    "YARGITAY_IBK":   1.00,
    "YARGITAY_HGK":   0.95,
    "YARGITAY_CGK":   0.95,
    "DANISTAY_IDDK":  0.88,
    "YARGITAY_DAIRE": 0.75,
    "DANISTAY":       0.70,
    "BAM":            0.50,
    "ILKDERECE":      0.30,
}

_MAJORITY_MULTIPLIER: dict[str, float] = {
    "OY_BIRLIGI": 1.00,
    "OY_COKLUGU": 0.92,
    "KARSI_OY":   0.82,
}

# Court levels that carry binding-precedent status (triggers hard boost in ranking)
_BINDING_COURT_LEVELS: frozenset[str] = frozenset({
    "AYM",
    "YARGITAY_IBK",
    "YARGITAY_HGK",
    "YARGITAY_CGK",
    "DANISTAY_IDDK",
})


# ============================================================================
# Domain Entity
# ============================================================================

@dataclass
class LegalDocument:
    """
    Immutable domain entity representing a single retrieved legal document.

    PROVENANCE CONTRACT (Step 2 — Kaynak Envanteri):
        Every LegalDocument carries three traceability fields:
        - source_url:   Where the document was sourced from.
        - version:      Which version/revision was ingested.
        - collected_at: When it was ingested.
        A document is "verifiable" only when BOTH source_url and collected_at
        are non-None.

    HARD-FAIL TRIGGER (Step 1):
        The RAGService checks `retrieved_docs` for emptiness before calling
        the LLM.  This entity itself does not raise; the service layer owns
        that responsibility.

    AUTHORITY MODEL (Step 3 — Hukuki Kanonik Veri Modeli):
        authority_score is a computed property that combines:
          - court_level base weight   (e.g. IBK=1.0, DAIRE=0.75)
          - majority_type multiplier  (OY_BIRLIGI=1.0, OY_COKLUGU=0.92)
          - dissent_present penalty   (-0.04 if dissent is noted)
        is_binding_precedent is True for AYM, IBK, HGK, CGK, DANISTAY_IDDK.
        These trigger a hard ranking boost in the retrieval layer.
    """

    # ── Identity ──────────────────────────────────────────────────────────────
    id: str
    content: str

    # Optional DB/file metadata — default to "" / None for testing convenience
    case_id: str = field(default="")
    file_path: str = field(default="")
    created_at: Optional[datetime] = field(default=None)

    # ── Step 2: Source Provenance ─────────────────────────────────────────────
    source_url: Optional[str] = field(default=None)
    """Canonical URL of the original legal source.
    e.g. 'https://www.mevzuat.gov.tr/...' or 'https://karararama.yargitay.gov.tr/...'
    None → provenance unknown → provenance warning logged."""

    version: Optional[str] = field(default=None)
    """Version identifier.
    Laws:           effective date string 'YYYY-MM-DD'.
    Court decisions: decision number '2023/456 E., 2024/789 K.'."""

    collected_at: Optional[datetime] = field(default=None)
    """Ingestion timestamp.  None → Hard-Fail risk; provenance cannot be confirmed."""

    # ── Legal Classification ──────────────────────────────────────────────────
    court_level: Optional[str] = field(default=None)
    """CourtLevel enum value as string (from DB)."""

    ruling_date: Optional[date] = field(default=None)
    """Date of court ruling or law's enactment / last amendment."""

    citation: Optional[str] = field(default=None)
    """Short canonical citation, e.g. 'Yargıtay 2 HD, E.2023/1234, K.2024/5678'."""

    norm_hierarchy: Optional[str] = field(default=None)
    """NormHierarchy enum value as string (from DB).
    e.g. 'KANUN', 'CBK', 'YONETMELIK'.  None for court decisions."""

    # ── Step 3: Detailed Court Authority ─────────────────────────────────────
    chamber: Optional[str] = field(default=None)
    """The specific court chamber / daire name.
    e.g. '9. Hukuk Dairesi', '2. Hukuk Dairesi', '4. İdare Dairesi'.
    None for legislative/regulatory documents."""

    majority_type: Optional[str] = field(default=None)
    """MajorityType enum value as string (from DB).
    OY_BIRLIGI (unanimous) > OY_COKLUGU (majority) > KARSI_OY (with dissent).
    Affects authority_score computation."""

    dissent_present: bool = field(default=False)
    """True if the decision contains a noted dissenting opinion (karşı oy).
    Reduces authority_score by a small penalty even when majority_type is
    OY_COKLUGU, because doctrinal tension is signalled."""

    # ── Step 4: Granular Versioning + AYM Cancellation ───────────────────────
    effective_date: Optional[date] = field(default=None)
    """Date from which this bent/fıkra/madde entered into force.
    For laws: the date the provision became effective (may differ from
    enactment date due to erteleme clauses or amendment effective dates).
    None = unknown / not applicable for court decisions."""

    expiry_date: Optional[date] = field(default=None)
    """Date on which this version was superseded by a later amendment or
    explicitly repealed.  None = still in force (or unknown).
    When expiry_date <= today, is_currently_effective returns False."""

    aym_iptal_durumu: Optional[str] = field(default=None)
    """AymIptalDurumu enum value as string.
    None / YURURLUKTE = no AYM cancellation issue.
    IPTAL_EDILDI / IPTAL_EDILDI_ERTELENDI / KISMI_IPTAL = mandatory warning."""

    iptal_yururluk_tarihi: Optional[date] = field(default=None)
    """The date the AYM cancellation takes effect.
    AYM may grant a delay (erteleme) under Anayasa md. 153/3 to give the
    legislature time to correct the unconstitutional provision.
    If this date is in the future, the provision is still technically in
    force but carries a mandatory warning."""

    aym_karar_no: Optional[str] = field(default=None)
    """AYM decision number. e.g. '2023/45 E., 2024/78 K.'.
    Used in the mandatory warning text surfaced to the user."""

    aym_karar_tarihi: Optional[date] = field(default=None)
    """Date of the AYM decision (not to be confused with the date the
    cancellation takes effect, which is iptal_yururluk_tarihi)."""

    # ── Scoring (populated by hybrid_legal_search) ────────────────────────────
    semantic_score: float = field(default=0.0)
    keyword_score: float = field(default=0.0)
    recency_score: float = field(default=0.0)
    hierarchy_score: float = field(default=0.0)
    final_score: float = field(default=0.0)

    # ── Step 6: Multi-tenancy ─────────────────────────────────────────────────
    bureau_id: Optional[str] = field(default=None)
    """Bureau UUID that owns this document.
    None = public document visible to all tenants
    (documents.bureau_id IS NULL in DB)."""

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def has_verifiable_provenance(self) -> bool:
        """
        True only when both source_url AND collected_at are present.
        A document without full provenance will trigger a WARNING in the
        RAGResponse validator (schema layer), but is still included in results.
        Only a totally empty retrieved list triggers the Hard-Fail (HTTP 422).
        """
        return self.source_url is not None and self.collected_at is not None

    @property
    def authority_score(self) -> float:
        """
        Computed authority score [0.0, 1.0] based on court level, majority
        type, and dissent presence.

        Formula (mirrors SQL ``compute_authority_score``):
            base  = _COURT_LEVEL_BASE_WEIGHT[court_level]  (default 0.40)
            mult  = _MAJORITY_MULTIPLIER[majority_type]     (default 0.92)
            pen   = 0.04 if dissent_present else 0.0
            score = clamp(base * mult - pen, 0.0, 1.0)

        Note:
            This is a DOMAIN property — it represents the inherent legal
            authority of the source.  The retrieval ``hierarchy_score`` maps
            to the same computation but may differ slightly due to SQL rounding.
        """
        base = _COURT_LEVEL_BASE_WEIGHT.get(self.court_level or "", 0.40)
        mult = _MAJORITY_MULTIPLIER.get(self.majority_type or "", 0.92)
        penalty = 0.04 if self.dissent_present else 0.0
        return max(0.0, min(1.0, base * mult - penalty))

    @property
    def is_binding_precedent(self) -> bool:
        """
        True for court levels that produce binding precedents:
            AYM, YARGITAY_IBK, YARGITAY_HGK, YARGITAY_CGK, DANISTAY_IDDK.

        These documents receive a configurable hard boost in the retrieval
        scoring layer (``settings.retrieval_binding_hard_boost``) to guarantee
        they rank above ordinary appellate decisions for the same query.
        """
        return (self.court_level or "") in _BINDING_COURT_LEVELS

    @property
    def court_level_enum(self) -> Optional[CourtLevel]:
        """Safe conversion to CourtLevel enum; returns None on unknown value."""
        if self.court_level is None:
            return None
        try:
            return CourtLevel(self.court_level)
        except ValueError:
            return None

    @property
    def norm_hierarchy_enum(self) -> Optional[NormHierarchy]:
        """Safe conversion to NormHierarchy enum; returns None on unknown value."""
        if self.norm_hierarchy is None:
            return None
        try:
            return NormHierarchy(self.norm_hierarchy)
        except ValueError:
            return None

    @property
    def majority_type_enum(self) -> Optional[MajorityType]:
        """Safe conversion to MajorityType enum; returns None on unknown value."""
        if self.majority_type is None:
            return None
        try:
            return MajorityType(self.majority_type)
        except ValueError:
            return None

    @property
    def is_cancelled(self) -> bool:
        """
        True when the AYM has issued a cancellation or partial cancellation
        decision for this provision, regardless of whether the cancellation
        has yet taken effect.

        YURURLUKTE and None both return False.
        """
        return self.aym_iptal_durumu in (
            AymIptalDurumu.IPTAL_EDILDI,
            AymIptalDurumu.IPTAL_EDILDI_ERTELENDI,
            AymIptalDurumu.KISMI_IPTAL,
            # Handle raw string DB values alongside enum instances:
            "IPTAL_EDILDI",
            "IPTAL_EDILDI_ERTELENDI",
            "KISMI_IPTAL",
        )

    @property
    def is_currently_effective(self) -> bool:
        """
        True when the provision is in legal force today.

        Checks (in order):
          1. effective_date <= today  (provision has entered force)
          2. expiry_date is None or expiry_date > today  (not superseded)
          3. If IPTAL_EDILDI / IPTAL_EDILDI_ERTELENDI:
               - iptal_yururluk_tarihi is None  → immediate cancellation → False
               - iptal_yururluk_tarihi <= today → cancellation in force   → False
               - iptal_yururluk_tarihi > today  → erteleme ongoing        → True
          4. KISMI_IPTAL → True (partial; remaining parts still in force)
        """
        today = date.today()

        # Not yet enacted
        if self.effective_date is not None and self.effective_date > today:
            return False

        # Superseded by later amendment
        if self.expiry_date is not None and self.expiry_date <= today:
            return False

        status = self.aym_iptal_durumu
        if status in ("IPTAL_EDILDI", AymIptalDurumu.IPTAL_EDILDI,
                      "IPTAL_EDILDI_ERTELENDI", AymIptalDurumu.IPTAL_EDILDI_ERTELENDI):
            if self.iptal_yururluk_tarihi is None:
                # Immediate cancellation — no grace period
                return False
            return self.iptal_yururluk_tarihi > today

        # KISMI_IPTAL: partially cancelled, remainder still in force
        return True

    @property
    def requires_aym_warning(self) -> bool:
        """
        True when the response MUST include a mandatory AYM cancellation
        warning.  Covers IPTAL_EDILDI, IPTAL_EDILDI_ERTELENDI, KISMI_IPTAL.
        YURURLUKTE and None → False.
        """
        return self.aym_iptal_durumu not in (None, "YURURLUKTE", AymIptalDurumu.YURURLUKTE)

    @property
    def aym_warning_text(self) -> str:
        """
        Generates a mandatory Turkish-language warning string for UI display.
        Returns empty string when requires_aym_warning is False.

        Warning format:
          ⚠️ AYM İPTAL UYARISI: Bu hüküm Anayasa Mahkemesi'nin [karar_no] sayılı
          ([karar_tarihi] tarihli) kararıyla iptal edilmiştir. ...
        """
        if not self.requires_aym_warning:
            return ""

        karar_ref = self.aym_karar_no or "bilinmiyor"
        karar_tarih = (
            self.aym_karar_tarihi.strftime("%d.%m.%Y")
            if self.aym_karar_tarihi else "bilinmiyor"
        )
        status = self.aym_iptal_durumu

        if status in ("KISMI_IPTAL", AymIptalDurumu.KISMI_IPTAL):
            return (
                f"⚠️ KISMI İPTAL UYARISI: Bu hükmün bir bölümü Anayasa Mahkemesi'nin "
                f"{karar_ref} sayılı ({karar_tarih} tarihli) kararıyla kısmen iptal "
                f"edilmiştir. Yürürlükteki kısımlar için karar metnini inceleyiniz."
            )

        if self.iptal_yururluk_tarihi:
            tarih_str = self.iptal_yururluk_tarihi.strftime("%d.%m.%Y")
            if self.iptal_yururluk_tarihi > date.today():
                return (
                    f"⚠️ AYM İPTAL UYARISI: Bu hüküm Anayasa Mahkemesi'nin "
                    f"{karar_ref} sayılı ({karar_tarih} tarihli) kararıyla iptal edilmiştir. "
                    f"İptal kararı {tarih_str} tarihinde yürürlüğe girecektir. "
                    f"Bu hüküm geçici olarak yürürlüktedir; İptal sonrası uygulanamaz."
                )
            return (
                f"⚠️ AYM İPTAL UYARISI: Bu hüküm Anayasa Mahkemesi'nin "
                f"{karar_ref} sayılı ({karar_tarih} tarihli) kararıyla iptal edilmiş "
                f"ve {tarih_str} tarihinden itibaren yürürlükten kalkmıştır. "
                f"Bu kaynak yalnızca tarihsel referans için kullanılabilir."
            )

        # IPTAL_EDILDI with no explicit effective date — immediate cancellation
        return (
            f"⚠️ AYM İPTAL UYARISI: Bu hüküm Anayasa Mahkemesi'nin "
            f"{karar_ref} sayılı ({karar_tarih} tarihli) kararıyla iptal edilmiştir. "
            f"Bu kaynak yürürlükte değildir ve yasal daırda uygulanamaz."
        )

    def __repr__(self) -> str:
        return (
            f"LegalDocument("
            f"id={self.id!r}, "
            f"citation={self.citation!r}, "
            f"court_level={self.court_level!r}, "
            f"binding={self.is_binding_precedent}, "
            f"authority={self.authority_score:.3f}, "
            f"aym_iptal={self.aym_iptal_durumu!r}, "
            f"score={self.final_score:.3f}, "
            f"provenance={'✓' if self.has_verifiable_provenance else '✗'}"
            f")"
        )
