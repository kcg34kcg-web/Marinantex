"""Query planning for RAG v3 retrieval orchestration.

This module intentionally separates retrieval planning from model routing:
- Planner decides *what* to retrieve and with which retrieval strategy.
- Router decides *which model/provider* should generate the response.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_ARTICLE_RE = re.compile(r"\b(?:madde|md\.?)\s*(\d{1,4}(?:/[A-Za-z0-9]+)?)\b", re.IGNORECASE)
_CLAUSE_RE = re.compile(r"\b(?:fikra|fkr\.?)\s*(\d{1,3})\b", re.IGNORECASE)
_CASE_RE = re.compile(r"\bE\.\s*\d{4}/\d+\b|\bK\.\s*\d{4}/\d+\b", re.IGNORECASE)
_EXACT_QUOTE_RE = re.compile(r"\"([^\"]{4,180})\"")
_EXHAUSTIVE_RE = re.compile(r"\b(tum|hepsi|eksiksiz|tamami|kapsamli|butun)\b", re.IGNORECASE)
_COMPARE_RE = re.compile(r"\b(karsilastir|fark|farki|kiyasla|hangisi)\b", re.IGNORECASE)
_ANALYSIS_RE = re.compile(r"\b(acikla|yorumla|degerlendir|analiz et)\b", re.IGNORECASE)
_FIELD_FILTER_RE = re.compile(
    r"\b(?:kaynak|source|kurum|karar tarihi|tarih|esas no|karar no|madde|fikra)\s*[:=]",
    re.IGNORECASE,
)
_LEGISLATION_RE = re.compile(
    r"\b(kanun|mevzuat|yonetmelik|teblig|resmi gazete|cumhurbaskanligi kararnamesi|cbk|madde)\b",
    re.IGNORECASE,
)
_CASE_LAW_RE = re.compile(
    r"\b(ictihat|emsal karar|yargitay|danistay|anayasa mahkemesi|aym|e\.\s*\d{4}/\d+|k\.\s*\d{4}/\d+)\b",
    re.IGNORECASE,
)
_CONTRACT_REVIEW_RE = re.compile(
    r"\b(sozlesme|kontrat|protokol|belge incele|incele|review|due diligence)\b",
    re.IGNORECASE,
)
_SUMMARIZE_RE = re.compile(r"\b(ozetle|ozet|summary|kisaca anlat)\b", re.IGNORECASE)
_PII_REDACT_RE = re.compile(
    r"\b(pi[iı]|kvkk|redact|anonimles|maskele|kimlik bilgilerini gizle|kisisel veri)\b",
    re.IGNORECASE,
)
_CITATION_VERIFY_RE = re.compile(
    r"\b(citation|atif|kaynak dogrula|kaynakla dogrula|hangi kaynak|kaynak kontrol)\b",
    re.IGNORECASE,
)
_DEEP_SEARCH_RE = re.compile(
    r"\b(deep search|derin arastir|kapsamli arastirma|tum emsaller|genis arastirma)\b",
    re.IGNORECASE,
)

_AUTHORITY_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\baym\b|anayasa mahkemesi", re.IGNORECASE), "AYM"),
    (re.compile(r"\byargitay\b", re.IGNORECASE), "YARGITAY"),
    (re.compile(r"\bdanistay\b", re.IGNORECASE), "DANISTAY"),
    (re.compile(r"\bbam\b|bolge adliye", re.IGNORECASE), "BAM"),
    (re.compile(r"\bidare mahkemesi\b", re.IGNORECASE), "IDARE_MAHKEMESI"),
]


@dataclass(frozen=True)
class RagV3QueryPlan:
    """Planner output used by retrieval pipeline."""

    task_type: str
    retrieval_mode: str
    rewritten_query: str
    doc_shortlist_size: int
    reranker_enabled: bool
    exact_search_enabled: bool
    decompose_steps: list[str] = field(default_factory=list)
    temporal_scope: dict[str, Optional[str]] = field(default_factory=dict)
    scope_split: list[str] = field(default_factory=list)
    authority_constraints: list[str] = field(default_factory=list)
    exact_search_required: bool = False
    exhaustive_mode_required: bool = False
    query_class: str = "mevzuat_sorusu"
    route_targets: list[str] = field(default_factory=list)
    rerank_top_n: int = 12
    planner_version: str = "rag_v3_query_planner.v2"
    reasons: list[str] = field(default_factory=list)


class RagV3QueryPlanner:
    """Deterministic planner for retrieval strategy selection."""

    def plan(
        self,
        *,
        query: str,
        top_k: int,
        dual_temporal_requested: bool,
        jurisdiction: str = "TR",
        as_of_date: Optional[date] = None,
        event_date: Optional[date] = None,
        decision_date: Optional[date] = None,
    ) -> RagV3QueryPlan:
        text = (query or "").strip()
        lowered = text.lower()
        reasons: list[str] = []
        decompose_steps: list[str] = []

        exact_signals = self._exact_signal_count(text)
        exact_required = exact_signals > 0
        if exact_required:
            reasons.append(f"exact_signals:{exact_signals}")
            decompose_steps.append("run_exact_legal_lane")

        exhaustive_required = bool(_EXHAUSTIVE_RE.search(text))
        if exhaustive_required:
            reasons.append("exhaustive_mode_requested")
            decompose_steps.append("expand_retrieval_depth")

        compare_required = bool(_COMPARE_RE.search(text))
        if compare_required:
            reasons.append("comparison_query_detected")
            decompose_steps.extend(
                [
                    "detect_comparison_axes",
                    "retrieve_each_axis_separately",
                ]
            )

        authority_constraints = self._authority_constraints(text)
        if authority_constraints:
            reasons.append("authority_constraints_detected")
            decompose_steps.append("apply_authority_filter")

        retrieval_mode = "hybrid"
        if dual_temporal_requested:
            retrieval_mode = "dual_temporal_hybrid"
            reasons.append("retrieval_mode:dual_temporal_hybrid")
            decompose_steps.append("run_event_and_decision_temporal_passes")
        elif exact_signals >= 2:
            retrieval_mode = "exact_hybrid"
            reasons.append("retrieval_mode:exact_hybrid")
        elif "tam metin" in lowered or "kelimesi kelimesine" in lowered:
            retrieval_mode = "sparse"
            reasons.append("retrieval_mode:sparse")
        elif _FIELD_FILTER_RE.search(text):
            retrieval_mode = "hybrid"
            reasons.append("retrieval_mode:fielded_hybrid")

        tokens = [tok for tok in _TOKEN_RE.findall(lowered) if len(tok) >= 3]
        complexity = len(tokens)
        doc_shortlist_size = max(3, min(12, int(top_k * 0.9)))
        if exhaustive_required:
            doc_shortlist_size = max(doc_shortlist_size, min(16, max(6, int(top_k * 1.5))))
        if complexity <= 8:
            doc_shortlist_size = max(3, min(8, int(top_k * 0.7)))
            reasons.append("short_query_doc_shortlist_tight")
        elif complexity >= 24:
            doc_shortlist_size = max(6, min(14, int(top_k * 1.2)))
            reasons.append("long_query_doc_shortlist_expanded")

        reranker_enabled = True
        if retrieval_mode == "sparse" and complexity <= 5 and not exhaustive_required:
            # Very short pure lexical tasks can skip reranker to avoid noise.
            reranker_enabled = False
            reasons.append("reranker_bypassed_short_sparse")

        rewritten_query = self._rewrite_for_retrieval(query=text)
        if rewritten_query != text:
            reasons.append("query_rewritten_for_retrieval")

        query_class = self._classify_query(text)
        reasons.append(f"query_class:{query_class}")
        route_targets = self._route_targets(query_class)
        if route_targets:
            reasons.append("route_targets_selected")

        if query_class == "karsilastirma_delta":
            task_type = "comparison"
        elif query_class in {"ozetleme", "arastirma_deep_search"}:
            task_type = "analysis"
        elif query_class == "pii_redaction":
            task_type = "operations"
        elif compare_required:
            task_type = "comparison"
        elif _ANALYSIS_RE.search(text):
            task_type = "analysis"
        else:
            task_type = "lookup"

        if query_class == "pii_redaction":
            # PII workflows are deterministic and should avoid expensive rerank.
            reranker_enabled = False
            exact_required = False
            reasons.append("pii_redaction_reranker_bypassed")
        elif query_class == "citation_verification":
            exact_required = True
            reasons.append("citation_verification_exact_required")
        elif query_class == "arastirma_deep_search":
            exhaustive_required = True
            reasons.append("deep_search_exhaustive_enabled")

        rerank_top_n = self._dynamic_rerank_top_n(
            top_k=top_k,
            retrieval_mode=retrieval_mode,
            query_class=query_class,
            exhaustive_required=exhaustive_required,
        )

        temporal_scope = {
            "as_of_date": as_of_date.isoformat() if as_of_date else None,
            "event_date": event_date.isoformat() if event_date else None,
            "decision_date": decision_date.isoformat() if decision_date else None,
        }
        scope_split = [str(jurisdiction or "TR").strip().upper() or "TR"]

        return RagV3QueryPlan(
            task_type=task_type,
            retrieval_mode=retrieval_mode,
            rewritten_query=rewritten_query,
            doc_shortlist_size=doc_shortlist_size,
            reranker_enabled=reranker_enabled,
            exact_search_enabled=exact_required,
            decompose_steps=list(dict.fromkeys(decompose_steps)),
            temporal_scope=temporal_scope,
            scope_split=scope_split,
            authority_constraints=authority_constraints,
            exact_search_required=exact_required,
            exhaustive_mode_required=exhaustive_required,
            query_class=query_class,
            route_targets=route_targets,
            rerank_top_n=rerank_top_n,
            reasons=reasons,
        )

    def _rewrite_for_retrieval(self, *, query: str) -> str:
        text = (query or "").strip()
        if not text:
            return ""
        text = " ".join(text.split())
        # Expand a few common Turkish legal short-forms for lexical+hybrid parity.
        replacements = {
            " md. ": " madde ",
            " md ": " madde ",
            " fkr. ": " fikra ",
            " fkr ": " fikra ",
        }
        padded = f" {text} "
        for src, dst in replacements.items():
            padded = padded.replace(src, dst)
        rewritten = " ".join(padded.split()).strip()
        return rewritten or text

    @staticmethod
    def _exact_signal_count(query: str) -> int:
        signal = 0
        if _ARTICLE_RE.search(query):
            signal += 1
        if _CLAUSE_RE.search(query):
            signal += 1
        if _CASE_RE.search(query):
            signal += 1
        if _EXACT_QUOTE_RE.search(query):
            signal += 1
        if _FIELD_FILTER_RE.search(query):
            signal += 1
        return signal

    @staticmethod
    def _authority_constraints(query: str) -> list[str]:
        matches: list[str] = []
        for pattern, label in _AUTHORITY_HINTS:
            if pattern.search(query):
                matches.append(label)
        return list(dict.fromkeys(matches))

    @staticmethod
    def _classify_query(query: str) -> str:
        text = str(query or "")
        if _PII_REDACT_RE.search(text):
            return "pii_redaction"
        if _CITATION_VERIFY_RE.search(text):
            return "citation_verification"
        if _SUMMARIZE_RE.search(text):
            return "ozetleme"
        if _COMPARE_RE.search(text):
            return "karsilastirma_delta"
        if _DEEP_SEARCH_RE.search(text):
            return "arastirma_deep_search"
        if _CONTRACT_REVIEW_RE.search(text):
            return "sozlesme_belge_inceleme"
        if _CASE_LAW_RE.search(text):
            return "ictihat_sorusu"
        if _LEGISLATION_RE.search(text):
            return "mevzuat_sorusu"
        return "mevzuat_sorusu"

    @staticmethod
    def _route_targets(query_class: str) -> list[str]:
        mapping = {
            "mevzuat_sorusu": ["dense", "sparse", "exact", "doc_shortlist"],
            "ictihat_sorusu": ["dense", "sparse", "exact", "doc_shortlist"],
            "sozlesme_belge_inceleme": ["dense", "doc_shortlist"],
            "ozetleme": ["doc_shortlist", "dense"],
            "karsilastirma_delta": ["dense", "sparse", "exact", "doc_shortlist"],
            "pii_redaction": ["sparse"],
            "citation_verification": ["exact", "dense", "sparse"],
            "arastirma_deep_search": ["dense", "sparse", "exact", "doc_shortlist"],
        }
        output = mapping.get(query_class, ["dense", "sparse", "doc_shortlist"])
        return list(dict.fromkeys(output))

    @staticmethod
    def _dynamic_rerank_top_n(
        *,
        top_k: int,
        retrieval_mode: str,
        query_class: str,
        exhaustive_required: bool,
    ) -> int:
        mode = str(retrieval_mode or "hybrid").strip().lower()
        base = max(int(top_k), 6)
        if mode in {"hybrid", "exact_hybrid", "dual_temporal_hybrid"}:
            base += 4
        if query_class in {"citation_verification", "karsilastirma_delta", "arastirma_deep_search"}:
            base += 4
        if query_class == "pii_redaction":
            base = max(int(top_k), 4)
        if exhaustive_required:
            base += 4
        return max(int(top_k), min(64, base))


rag_v3_query_planner = RagV3QueryPlanner()
