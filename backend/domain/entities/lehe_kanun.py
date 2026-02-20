"""
Lehe Kanun (Favor Rei) Domain Objects — Step 10
================================================
Implements the Turkish criminal-law "favor rei" (failin lehi) doctrine.

Legal Basis — TCK Madde 7/2:
    "Suçun işlendiği zaman yürürlükte bulunan kanun ile sonradan
    yürürlüğe giren kanunların hükümleri farklı ise; failin lehine
    olan kanun uygulanır ve infaz olunur."

    (If the provisions of the law in force when an offence was committed
    differ from the provisions of a subsequently enacted law, the provision
    more favourable to the offender shall apply and be enforced.)

TCK Madde 7/3 (Zamanaşımı):
    Lehe kanun ilkesi dava zamanaşımı ve ceza zamanaşımına da uygulanır.

Scope:
    CEZA      — Turkish Criminal Code (TCK) + Criminal Procedure (CMK)
    IDARI_CEZA — Administrative sanctions (Kabahatler Kanunu)
    VERGI_CEZA — Tax penalties under Vergi Usul Kanunu (VUK)
    DIGER     — Civil / Commercial / Labour — lehe kanun does NOT apply

Architecture:
    These domain objects are pure Python (no framework dependency).
    LeheKanunEngine (infrastructure/legal/lehe_kanun_engine.py) contains
    the detection + decision logic.  RAGService consumes the result to
    decide whether to fetch two document versions and how to annotate
    the response.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional


# ============================================================================
# LawDomain — legal domain classification
# ============================================================================

class LawDomain(str, Enum):
    """
    Legal domain of the incoming query.

    Determines whether the lehe kanun (favor rei) principle is applicable.

    CEZA:
        Turkish Criminal Code (TCK) and Criminal Procedure Code (CMK).
        Lehe kanun is MANDATORY — TCK md. 7/2 leaves no discretion.
        Covers: homicide, theft, fraud, narcotics, bribery, corruption, etc.

    IDARI_CEZA:
        Administrative sanctions under Kabahatler Kanunu (Law No. 5326).
        Lehe kanun applies to the penalty amount comparison.
        Covers: traffic fines, municipal penalties, regulatory sanctions.

    VERGI_CEZA:
        Tax penalty provisions under Vergi Usul Kanunu (VUK).
        Lehe kanun applies to penalty calculation, NOT the tax itself.
        Covers: vergi ziyaı cezası, usulsüzlük cezası, kaçakçılık cezası.

    DIGER:
        Private / commercial / labour / administrative (non-penal) law.
        Lehe kanun does NOT apply — lex posterior rule governs.
        Covers: rental disputes, employment claims, company law, etc.

    UNKNOWN:
        Domain could not be determined from the query text alone.
        LeheKanunEngine will not activate lehe kanun for unknown domains.
    """

    CEZA       = "CEZA"
    IDARI_CEZA = "IDARI_CEZA"
    VERGI_CEZA = "VERGI_CEZA"
    DIGER      = "DIGER"
    UNKNOWN    = "UNKNOWN"

    @property
    def lehe_applicable(self) -> bool:
        """
        True when the lehe kanun principle is legally applicable for this domain.

        Returns False for DIGER and UNKNOWN — no lehe comparison is performed.
        """
        return self in (LawDomain.CEZA, LawDomain.IDARI_CEZA, LawDomain.VERGI_CEZA)


# ============================================================================
# LeheKanunResult — outcome of a lehe kanun analysis
# ============================================================================

@dataclass(frozen=True)
class LeheKanunResult:
    """
    Immutable outcome of a LeheKanunEngine.check() call.

    Consumed by RAGService to:
        1. Decide whether to call the retriever a second time with decision_date.
        2. Build a LeheKanunNoticeSchema for the API response.
        3. Instruct the LLM to surface BOTH versions for the lawyer's comparison.

    Fields:
        law_domain:
            Detected legal domain of the query.

        event_date:
            The date the legal event / offence occurred.
            Used to retrieve the law version in force on that date.

        decision_date:
            The date a criminal verdict is being rendered (or today).
            Used to retrieve the current law version for comparison.

        lehe_applicable:
            True when:
              - law_domain.lehe_applicable is True, AND
              - both event_date and decision_date are available, AND
              - event_date differs from decision_date.
            When False, only the single version from event_date is fetched.

        both_versions_needed:
            True when lehe_applicable is True.  The RAGService must call
            retrieval twice — once for event_date, once for decision_date —
            and merge the results into the context window.

        reason:
            Human-readable Turkish explanation of the decision
            (surfaced as lehe_kanun_notice.reason in the API response).
    """

    law_domain: LawDomain
    event_date: date
    decision_date: date
    lehe_applicable: bool
    both_versions_needed: bool
    reason: str
    legal_basis: str = field(default="TCK Madde 7/2 — Lehe kanun ilkesi")

    def __post_init__(self) -> None:
        """Invariants: both_versions_needed implies lehe_applicable; event_date <= decision_date."""
        if self.both_versions_needed and not self.lehe_applicable:
            raise ValueError(
                "both_versions_needed can only be True when lehe_applicable is True"
            )
        if self.event_date > self.decision_date:
            raise ValueError(
                f"event_date ({self.event_date}) karar tarihinden "
                f"({self.decision_date}) sonra olamaz."
            )

    @classmethod
    def not_applicable(
        cls,
        law_domain: LawDomain,
        event_date: date,
        decision_date: date,
        reason: str,
    ) -> "LeheKanunResult":
        """Factory for the common 'not applicable' case."""
        return cls(
            law_domain=law_domain,
            event_date=event_date,
            decision_date=decision_date,
            lehe_applicable=False,
            both_versions_needed=False,
            reason=reason,
        )

    @classmethod
    def applicable(
        cls,
        law_domain: LawDomain,
        event_date: date,
        decision_date: date,
        reason: str,
    ) -> "LeheKanunResult":
        """Factory for the 'lehe kanun applies — fetch both versions' case."""
        return cls(
            law_domain=law_domain,
            event_date=event_date,
            decision_date=decision_date,
            lehe_applicable=True,
            both_versions_needed=True,
            reason=reason,
        )
