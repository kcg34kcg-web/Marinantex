"""
Legal Deadline Engine — Step 14: Agentic Tool Calling (Matematik/Süre Hesabı)
==============================================================================
Catalogue of Turkish legal deadlines with deterministic calculation.

Purpose:
    Prevent LLM hallucination (malpractice) in deadline and statute-of-
    limitations calculations.  Every deadline is computed by a pure Python
    function — never left to an LLM to infer.

Architecture:
    DeadlineTool(str, Enum)  — named tool identifiers
    DeadlineRule             — internal data class (period + legal_basis)
    DeadlineResult           — the calculatd result returned to callers
    LegalDeadlineEngine      — detects which tool(s) apply and executes them

Deadlines Catalogue:
    IS_AKDI_IHBAR_1YIL       İş K. md. 17/I    < 6 months: 2 weeks notice
    IS_AKDI_IHBAR_6AY        İş K. md. 17/I    6-18 months: 4 weeks notice
    IS_AKDI_IHBAR_18AY       İş K. md. 17/I    18m-3y: 6 weeks notice
    IS_AKDI_IHBAR_3YIL       İş K. md. 17/I    > 3 years: 8 weeks notice
    KIDEM_TAZMINATI          İş K. md. 14      5-year limitation
    GENEL_ZAMANAŞIMI_TBK     TBK md. 146       10-year general limitation
    KISA_ZAMANAŞIMI_TBK      TBK md. 147       2-year short limitation
    TCK_DAVA_ZAMANAŞIMI_8    TCK md. 66/1-e    8-year prescription
    TCK_DAVA_ZAMANAŞIMI_15   TCK md. 66/1-d    15-year prescription
    IDARI_DAVA               İYUK md. 7        60-day admin. suit deadline
    TAM_YARGI_DAVASI         İYUK md. 13       1-year full remedy suit
    HUKUK_TEMYIZ             HMK md. 361       2-week cassation appeal
    HUKUK_ISTINAF            HMK md. 345       2-week regional appeal
    CEZA_TEMYIZ              CMK md. 291       15-day cassation appeal
    CEZA_ISTINAF             CMK md. 273       7-day regional appeal
    TAPU_TESCIL_IPTAL        MK md. 1007       20-year land-registry claim
    AYIP_IHBARI_TBK          TBK md. 223       notice of defect: reasonable time

Legal references are embedded in each rule; see ``_RULES`` dict below.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Dict, FrozenSet, List, Optional, Tuple

from infrastructure.legal.tools.date_calculator import (
    DateCalculatorResult,
    add_business_days,
    add_calendar_days,
    add_months,
    add_years,
    next_business_day,
)

logger = logging.getLogger("babylexit.legal.tools.deadline_engine")


# ============================================================================
# Enumerations
# ============================================================================


class DeadlineTool(str, Enum):
    """Named identifiers for each deterministic legal deadline tool."""

    # İş Hukuku — İhbar Süreleri
    IS_AKDI_IHBAR_1YIL    = "IS_AKDI_IHBAR_1YIL"
    IS_AKDI_IHBAR_6AY     = "IS_AKDI_IHBAR_6AY"
    IS_AKDI_IHBAR_18AY    = "IS_AKDI_IHBAR_18AY"
    IS_AKDI_IHBAR_3YIL    = "IS_AKDI_IHBAR_3YIL"

    # İş Hukuku — Kıdem Tazminatı
    KIDEM_TAZMINATI       = "KIDEM_TAZMINATI"

    # TBK — Genel Zamanaşımı
    GENEL_ZAMANASIMI_TBK  = "GENEL_ZAMANASIMI_TBK"
    KISA_ZAMANASIMI_TBK   = "KISA_ZAMANASIMI_TBK"

    # TCK — Dava Zamanaşımı
    TCK_DAVA_ZAMANASIMI_8  = "TCK_DAVA_ZAMANASIMI_8"
    TCK_DAVA_ZAMANASIMI_15 = "TCK_DAVA_ZAMANASIMI_15"

    # İdare Hukuku
    IDARI_DAVA             = "IDARI_DAVA"
    TAM_YARGI_DAVASI       = "TAM_YARGI_DAVASI"

    # Hukuk Muhakemeleri — Kanun Yolları
    HUKUK_TEMYIZ           = "HUKUK_TEMYIZ"
    HUKUK_ISTINAF          = "HUKUK_ISTINAF"

    # Ceza Muhakemesi — Kanun Yolları
    CEZA_TEMYIZ            = "CEZA_TEMYIZ"
    CEZA_ISTINAF           = "CEZA_ISTINAF"

    # Medeni Hukuk
    TAPU_TESCIL_IPTAL      = "TAPU_TESCIL_IPTAL"

    # TBK — Ayıp İhbarı
    AYIP_IHBARI_TBK        = "AYIP_IHBARI_TBK"


# ============================================================================
# Internal rule definition
# ============================================================================


@dataclass(frozen=True)
class _DeadlineRule:
    """Internal rule record. Not exposed publicly."""

    tool: DeadlineTool
    legal_basis: str        # e.g. "İş K. md. 17/I"
    description_tr: str     # Turkish description shown in result
    calendar_days: Optional[int] = None   # fixed day-count deadline
    months: Optional[int] = None          # month-based deadline
    years: Optional[int] = None           # year-based deadline
    adjust_to_business: bool = True       # shift to next business day if weekend
    use_business_days: bool = False       # if True, use add_business_days() instead of add_calendar_days()


# ============================================================================
# Deadline catalogue
# ============================================================================


_RULES: Dict[DeadlineTool, _DeadlineRule] = {
    # ── İhbar süreleri (İş K. md. 17) ───────────────────────────────────────
    DeadlineTool.IS_AKDI_IHBAR_1YIL: _DeadlineRule(
        tool=DeadlineTool.IS_AKDI_IHBAR_1YIL,
        legal_basis="İş Kanunu md. 17/I — kıdem < 6 ay",
        description_tr="İş sözleşmesi feshi ihbar süresi: kıdem 6 aydan az → 2 hafta (14 takvim günü)",
        calendar_days=14,
    ),
    DeadlineTool.IS_AKDI_IHBAR_6AY: _DeadlineRule(
        tool=DeadlineTool.IS_AKDI_IHBAR_6AY,
        legal_basis="İş Kanunu md. 17/I — 6 ay ≤ kıdem < 18 ay",
        description_tr="İş sözleşmesi feshi ihbar süresi: kıdem 6-18 ay arası → 4 hafta (28 takvim günü)",
        calendar_days=28,
    ),
    DeadlineTool.IS_AKDI_IHBAR_18AY: _DeadlineRule(
        tool=DeadlineTool.IS_AKDI_IHBAR_18AY,
        legal_basis="İş Kanunu md. 17/I — 18 ay ≤ kıdem < 3 yıl",
        description_tr="İş sözleşmesi feshi ihbar süresi: kıdem 18 ay-3 yıl arası → 6 hafta (42 takvim günü)",
        calendar_days=42,
    ),
    DeadlineTool.IS_AKDI_IHBAR_3YIL: _DeadlineRule(
        tool=DeadlineTool.IS_AKDI_IHBAR_3YIL,
        legal_basis="İş Kanunu md. 17/I — kıdem ≥ 3 yıl",
        description_tr="İş sözleşmesi feshi ihbar süresi: kıdem 3 yıl ve üzeri → 8 hafta (56 takvim günü)",
        calendar_days=56,
    ),
    # ── Kıdem tazminatı zamanaşımı ────────────────────────────────────────────
    DeadlineTool.KIDEM_TAZMINATI: _DeadlineRule(
        tool=DeadlineTool.KIDEM_TAZMINATI,
        legal_basis="İş Kanunu md. 32/8 (7444 sk. ile değişik) — 5 yıl mutlak hak düşürücü süre",
        description_tr=(
            "Kıdem tazminatı davası zamanaşımı: işten ayrılma tarihinden itibaren "
            "5 yıl (İş K. md. 32/8 — 7444 sayılı Kanun ile eklendi, yayım: 27.04.2023). "
            "Bu süre hak düşürücü nitelikte olup resen göz önünde bulundurulur; "
            "taraflar tarafından değiştirilemez."
        ),
        years=5,
        adjust_to_business=False,
    ),
    # ── TBK — Genel zamanaşımı ────────────────────────────────────────────────
    DeadlineTool.GENEL_ZAMANASIMI_TBK: _DeadlineRule(
        tool=DeadlineTool.GENEL_ZAMANASIMI_TBK,
        legal_basis="Türk Borçlar Kanunu md. 146 — 10 yıl",
        description_tr="TBK genel zamanaşımı: 10 yıl",
        years=10,
        adjust_to_business=False,
    ),
    DeadlineTool.KISA_ZAMANASIMI_TBK: _DeadlineRule(
        tool=DeadlineTool.KISA_ZAMANASIMI_TBK,
        legal_basis="Türk Borçlar Kanunu md. 147 — 2 yıl",
        description_tr="TBK kısa zamanaşımı: 2 yıl (alacağın muaccel olmasından itibaren)",
        years=2,
        adjust_to_business=False,
    ),
    # ── TCK — Dava zamanaşımı ─────────────────────────────────────────────────
    DeadlineTool.TCK_DAVA_ZAMANASIMI_8: _DeadlineRule(
        tool=DeadlineTool.TCK_DAVA_ZAMANASIMI_8,
        legal_basis="TCK md. 66/1-e — üst sınır 5-10 yıl hapis: 8 yıl",
        description_tr="TCK dava zamanaşımı: 8 yıl (cezanın üst sınırı 5-10 yıl arasında olan suçlar)",
        years=8,
        adjust_to_business=False,
    ),
    DeadlineTool.TCK_DAVA_ZAMANASIMI_15: _DeadlineRule(
        tool=DeadlineTool.TCK_DAVA_ZAMANASIMI_15,
        legal_basis="TCK md. 66/1-d — üst sınır 10-20 yıl hapis: 15 yıl",
        description_tr="TCK dava zamanaşımı: 15 yıl (cezanın üst sınırı 10-20 yıl arasında olan suçlar)",
        years=15,
        adjust_to_business=False,
    ),
    # ── İdare Hukuku ──────────────────────────────────────────────────────────
    DeadlineTool.IDARI_DAVA: _DeadlineRule(
        tool=DeadlineTool.IDARI_DAVA,
        legal_basis="İYUK md. 7/1 — tebliğden itibaren 60 gün",
        description_tr="İdari işleme karşı iptal davası açma süresi: tebliğ tarihinden itibaren 60 takvim günü",
        calendar_days=60,
        use_business_days=False,  # İYUK md. 8: takvim günü; son gün tatile denk gelirse iş gününe kayar
    ),
    DeadlineTool.TAM_YARGI_DAVASI: _DeadlineRule(
        tool=DeadlineTool.TAM_YARGI_DAVASI,
        legal_basis="İYUK md. 13/1 — zararın öğrenilmesinden itibaren 1 yıl + 5 yıl kesin süre",
        description_tr="Tam yargı (tazminat) davası süresi: zararın öğrenilmesinden itibaren 1 yıl",
        years=1,
        adjust_to_business=False,
    ),
    # ── Hukuk Muhakemeleri — Kanun yolları ────────────────────────────────────
    DeadlineTool.HUKUK_TEMYIZ: _DeadlineRule(
        tool=DeadlineTool.HUKUK_TEMYIZ,
        legal_basis="HMK md. 361/1 — tebliğden itibaren 2 hafta",
        description_tr="Hukuk mahkemesi kararına karşı temyiz süresi: tebliğden itibaren 2 hafta (14 gün)",
        calendar_days=14,
    ),
    DeadlineTool.HUKUK_ISTINAF: _DeadlineRule(
        tool=DeadlineTool.HUKUK_ISTINAF,
        legal_basis="HMK md. 345/1 — tebliğden itibaren 2 hafta",
        description_tr="Hukuk mahkemesi kararına karşı istinaf süresi: tebliğden itibaren 2 hafta (14 gün)",
        calendar_days=14,
    ),
    # ── Ceza Muhakemesi — Kanun yolları ───────────────────────────────────────
    DeadlineTool.CEZA_TEMYIZ: _DeadlineRule(
        tool=DeadlineTool.CEZA_TEMYIZ,
        legal_basis="CMK md. 291/1 — tebliğden itibaren 15 gün",
        description_tr="Ceza mahkemesi kararına karşı temyiz süresi: tebliğden itibaren 15 takvim günü",
        calendar_days=15,
    ),
    DeadlineTool.CEZA_ISTINAF: _DeadlineRule(
        tool=DeadlineTool.CEZA_ISTINAF,
        legal_basis="CMK md. 273/1 — tefhim veya tebliğden itibaren 7 gün",
        description_tr="Ceza mahkemesi kararına karşı istinaf süresi: tefhim/tebliğden itibaren 7 takvim günü",
        calendar_days=7,
    ),
    # ── Medeni Hukuk ─────────────────────────────────────────────────────────
    DeadlineTool.TAPU_TESCIL_IPTAL: _DeadlineRule(
        tool=DeadlineTool.TAPU_TESCIL_IPTAL,
        legal_basis="MK md. 1007 — devlet sorumluluğu: 20 yıl hak düşürücü süre",
        description_tr="Tapu tescilinden kaynaklanan devlet sorumluluğu davası: 20 yıl hak düşürücü süre",
        years=20,
        adjust_to_business=False,
    ),
    # ── TBK — Ayıp İhbarı ────────────────────────────────────────────────────
    DeadlineTool.AYIP_IHBARI_TBK: _DeadlineRule(
        tool=DeadlineTool.AYIP_IHBARI_TBK,
        legal_basis="TBK md. 223/2 — alıcı ayıbı öğrenmesinden sonra derhal ihbar etmeli",
        description_tr="Satım sözleşmesinde ayıp ihbar süresi: ayıbın öğrenilmesinden sonra derhal (genelde 8 gün kabul edilir)",
        calendar_days=8,
    ),
}


# ============================================================================
# Keyword → Tool mapping for intent detection
# ============================================================================


_TOOL_KEYWORDS: List[Tuple[FrozenSet[str], DeadlineTool]] = [
    # İhbar süreleri — must appear BEFORE generic "ihbar" catch
    (frozenset({"ihbar süresi", "ihbar öneli", "fesih bildirimi", "iş sözleşmesi feshi"}),
     DeadlineTool.IS_AKDI_IHBAR_6AY),   # default; engine picks correct tier

    # İhbar alt-kademeleri — belirli kıdem ifadesi içeren sorgular için
    (frozenset({"ış akdi 1 yıl", "kıdem altı aydan az", "altı aydan kısa kıdem",
               "ihbar iki hafta", "2 hafta ihbar"}),
     DeadlineTool.IS_AKDI_IHBAR_1YIL),

    (frozenset({"on sekiz ay kıdem", "18 ay ihbar", "bir buçuk yıl kıdem",
               "ihbar altı hafta", "6 hafta ihbar"}),
     DeadlineTool.IS_AKDI_IHBAR_18AY),

    (frozenset({"kıdem üç yıl", "3 yıl kıdem", "üç yıldan fazla kıdem",
               "ihbar sekiz hafta", "8 hafta ihbar"}),
     DeadlineTool.IS_AKDI_IHBAR_3YIL),

    # Kıdem tazminatı zaman aşımı
    (frozenset({"kıdem tazminatı zaman aşımı", "kıdem zaman aşımı", "kıdem davası süre",
               "kıdem tazminatı hak düşürür", "kıdem 5 yıl", "ış k md 32"}),
     DeadlineTool.KIDEM_TAZMINATI),

    # TBK genel zamanaşımı
    (frozenset({"genel zamanaşımı", "tbk 146", "on yıllık zamanaşımı", "tbk md. 146"}),
     DeadlineTool.GENEL_ZAMANASIMI_TBK),

    # TBK kısa zamanaşımı
    (frozenset({"kısa zamanaşımı", "tbk 147", "iki yıllık zamanaşımı", "tbk md. 147"}),
     DeadlineTool.KISA_ZAMANASIMI_TBK),

    # TCK dava zamanaşımı
    (frozenset({"dava zamanaşımı", "tck zamanaşımı", "ceza zamanaşımı", "tck md. 66"}),
     DeadlineTool.TCK_DAVA_ZAMANASIMI_8),
    (frozenset({"15 yıl tck", "tck 66/1-d", "on beş yıl ceza zaman aşımı",
               "ğar ceza zaman aşımı", "tck md. 66/1-d", "10-20 yıl ceza"}),
     DeadlineTool.TCK_DAVA_ZAMANASIMI_15),
    # İdari dava
    (frozenset({"idari dava", "iptal davası süre", "iyuk 7", "iyuk md. 7", "60 gün idari"}),
     DeadlineTool.IDARI_DAVA),

    # Tam yargı davası
    (frozenset({"tam yargı davası", "tazminat idari dava", "idari tazminat süresi"}),
     DeadlineTool.TAM_YARGI_DAVASI),

    # Hukuk kanun yolları
    (frozenset({"temyiz süresi hukuk", "hmk temyiz", "hmk md. 361", "hukuk temyiz"}),
     DeadlineTool.HUKUK_TEMYIZ),

    (frozenset({"istinaf süresi hukuk", "hmk istinaf", "hmk md. 345", "hukuk istinaf"}),
     DeadlineTool.HUKUK_ISTINAF),

    # Ceza kanun yolları
    (frozenset({"temyiz süresi ceza", "cmk temyiz", "cmk md. 291", "ceza temyiz"}),
     DeadlineTool.CEZA_TEMYIZ),

    (frozenset({"istinaf süresi ceza", "cmk istinaf", "cmk md. 273", "ceza istinaf"}),
     DeadlineTool.CEZA_ISTINAF),

    # Tapu
    (frozenset({"tapu tescil iptal", "mk 1007", "devlet sorumluluğu tapu"}),
     DeadlineTool.TAPU_TESCIL_IPTAL),

    # Ayıp ihbarı
    (frozenset({"ayıp ihbarı", "ayıp bildirimi", "tbk 223", "satım ayıp"}),
     DeadlineTool.AYIP_IHBARI_TBK),
]


# ============================================================================
# Domain objects
# ============================================================================


@dataclass
class DeadlineResult:
    """The calculated deadline returned to the caller."""

    tool: DeadlineTool
    legal_basis: str
    description_tr: str
    start_date: date
    deadline_date: date
    adjusted_for_weekend: bool
    calculation: DateCalculatorResult
    tool_version: str = "1.0"


# ============================================================================
# LegalDeadlineEngine
# ============================================================================


class LegalDeadlineEngine:
    """
    Detects which legal deadline tool(s) apply from a query's text and/or
    explicit parameters, then runs the deterministic calculation.

    Usage:
        engine = LegalDeadlineEngine()

        # Direct calculation (tool name known):
        result = engine.calculate(DeadlineTool.HUKUK_TEMYIZ, start_date=date(2025,1,15))

        # Intent detection from query text:
        tools = engine.detect_tools(query_text)
        results = [engine.calculate(t, start_date) for t in tools]
    """

    def detect_tools(self, query_text: str) -> List[DeadlineTool]:
        """
        Returns a list of DeadlineTool values whose keywords match ``query_text``.

        Matching is case-insensitive substring search.

        Args:
            query_text: The user's Turkish legal query.

        Returns:
            List[DeadlineTool] — may be empty if no keyword matches.
        """
        if not query_text:
            return []

        normalised = query_text.lower()
        matched: List[DeadlineTool] = []
        seen: set[DeadlineTool] = set()

        for keywords, tool in _TOOL_KEYWORDS:
            for kw in keywords:
                if kw in normalised and tool not in seen:
                    matched.append(tool)
                    seen.add(tool)
                    break

        return matched

    def calculate(
        self,
        tool: DeadlineTool,
        start_date: date,
        seniority_years: Optional[float] = None,
    ) -> DeadlineResult:
        """
        Runs the deterministic calculation for ``tool`` from ``start_date``.

        For ihbar (notice period) tools, ``seniority_years`` can override
        the automatic tool selection:
            < 0.5 years  → IS_AKDI_IHBAR_1YIL  (14 days)
            0.5–1.5 years → IS_AKDI_IHBAR_6AY  (28 days)
            1.5–3 years  → IS_AKDI_IHBAR_18AY (42 days)
            ≥ 3 years    → IS_AKDI_IHBAR_3YIL (56 days)

        Args:
            tool:             Which deadline tool to run.
            start_date:       The event / trigger date (tebliğ, suç, fesih…).
            seniority_years:  Optional — used to select the correct ihbar tier.

        Returns:
            DeadlineResult with the computed deadline_date.

        Raises:
            KeyError: If ``tool`` is not found in the catalogue (shouldn't happen).
            ValueError: If start_date is invalid.
        """
        # Auto-select ihbar tier from seniority_years
        if (
            tool in {
                DeadlineTool.IS_AKDI_IHBAR_1YIL,
                DeadlineTool.IS_AKDI_IHBAR_6AY,
                DeadlineTool.IS_AKDI_IHBAR_18AY,
                DeadlineTool.IS_AKDI_IHBAR_3YIL,
            }
            and seniority_years is not None
        ):
            tool = _ihbar_tier(seniority_years)

        rule = _RULES[tool]

        # Run the appropriate arithmetic
        if rule.calendar_days is not None:
            if rule.use_business_days:
                calc = add_business_days(start_date, rule.calendar_days)
            else:
                calc = add_calendar_days(start_date, rule.calendar_days)
        elif rule.months is not None:
            calc = add_months(start_date, rule.months)
        elif rule.years is not None:
            calc = add_years(start_date, rule.years)
        else:
            raise ValueError(f"Rule {tool} has no period defined")

        # Weekend adjustment
        adjusted = False
        deadline = calc.result_date
        if rule.adjust_to_business:
            adjusted_date = next_business_day(deadline)
            if adjusted_date != deadline:
                adjusted = True
                deadline = adjusted_date

        logger.info(
            "DEADLINE_CALC | tool=%s | start=%s | deadline=%s | adjusted=%s",
            tool.value,
            start_date.isoformat(),
            deadline.isoformat(),
            adjusted,
        )

        return DeadlineResult(
            tool=tool,
            legal_basis=rule.legal_basis,
            description_tr=rule.description_tr,
            start_date=start_date,
            deadline_date=deadline,
            adjusted_for_weekend=adjusted,
            calculation=calc,
        )

    def calculate_ihbar(
        self,
        start_date: date,
        seniority_years: float,
    ) -> DeadlineResult:
        """
        Convenience method: selects the correct ihbar tier from seniority_years
        and computes the deadline.

        Args:
            start_date:       Fesih (termination notice) date.
            seniority_years:  Length of service in decimal years.

        Returns:
            DeadlineResult with the correct ihbar period.
        """
        tool = _ihbar_tier(seniority_years)
        return self.calculate(tool, start_date, seniority_years=seniority_years)


def _ihbar_tier(seniority_years: float) -> DeadlineTool:
    """
    Maps seniority_years to the correct ihbar notice period tool.

    İş Kanunu md. 17/I tiers:
        < 0.5 yıl       → 2 hafta  (14 gün)
        0.5 – 1.5 yıl   → 4 hafta  (28 gün)
        1.5 – 3 yıl     → 6 hafta  (42 gün)
        ≥ 3 yıl         → 8 hafta  (56 gün)
    """
    if seniority_years < 0.5:
        return DeadlineTool.IS_AKDI_IHBAR_1YIL
    elif seniority_years < 1.5:
        return DeadlineTool.IS_AKDI_IHBAR_6AY
    elif seniority_years < 3.0:
        return DeadlineTool.IS_AKDI_IHBAR_18AY
    else:
        return DeadlineTool.IS_AKDI_IHBAR_3YIL


# Module-level singleton
legal_deadline_engine = LegalDeadlineEngine()
