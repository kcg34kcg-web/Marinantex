"""Query expansion utilities for Turkish legal retrieval.

Deterministic rewrite layer:
- typo normalization
- legal synonym expansion
- filter extraction (article/clause/case identifiers)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

_WS_RE = re.compile(r"\s+")
_ARTICLE_RE = re.compile(r"\b(?:madde|md\.?)\s*(\d{1,4}(?:/[A-Za-z0-9]+)?)\b", re.IGNORECASE)
_CLAUSE_RE = re.compile(r"\b(?:fikra|fkr\.?)\s*(\d{1,3})\b", re.IGNORECASE)
_CASE_E_RE = re.compile(r"\bE\.\s*\d{4}/\d+\b", re.IGNORECASE)
_CASE_K_RE = re.compile(r"\bK\.\s*\d{4}/\d+\b", re.IGNORECASE)
_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")

_TYPO_MAP = {
    "kidem": "kidem",
    "sozlesme": "sozlesme",
    "sozlesmesi": "sozlesmesi",
    "ihtihat": "ictihat",
    "icthat": "ictihat",
    "iicra": "icra",
    "zamanasmi": "zamanasimi",
    "ihbarname": "ihtarname",
    "fesihh": "fesih",
    "mevzaut": "mevzuat",
    "kanuun": "kanun",
    "yonetmelilk": "yonetmelik",
}

_SYNONYM_MAP = {
    "kidem tazminati": ["isten ayrilma tazminati", "kidem hakki"],
    "ihbar tazminati": ["bildirim tazminati", "ihbar suresi"],
    "rekabet yasagi": ["non-compete", "rekabet etmeme"],
    "gorevsizlik": ["yetkisizlik", "gorev itirazi"],
    "zamanaimi": ["hak dusurucu sure", "sure asimi"],
    "zamanasimi": ["hak dusurucu sure", "sure asimi"],
    "kvkk": ["6698", "kisisel veri"],
    "sozlesme feshi": ["fesih", "sona erdirme"],
    "icra takibi": ["takip talebi", "haciz"],
    "ihtiyati tedbir": ["gecici hukuki koruma", "tedbir karari"],
}


@dataclass(frozen=True)
class QueryExpansionResult:
    original_query: str
    normalized_query: str
    expanded_query: str
    typo_corrections: dict[str, str] = field(default_factory=dict)
    synonyms: list[str] = field(default_factory=list)
    filter_hints: dict[str, str] = field(default_factory=dict)


class LegalQueryExpander:
    """Deterministic legal query expander for retrieval-time recall."""

    def expand(self, query: str) -> QueryExpansionResult:
        original = str(query or "").strip()
        normalized = self._normalize_whitespace(original)
        corrected, corrections = self._apply_typo_corrections(normalized)
        synonym_terms = self._collect_synonyms(corrected)
        filters = self._extract_filters(corrected)
        expanded_query = self._build_expanded_query(corrected, synonym_terms, filters)
        return QueryExpansionResult(
            original_query=original,
            normalized_query=corrected,
            expanded_query=expanded_query,
            typo_corrections=corrections,
            synonyms=synonym_terms,
            filter_hints=filters,
        )

    @staticmethod
    def _normalize_whitespace(query: str) -> str:
        return _WS_RE.sub(" ", str(query or "").strip())

    @staticmethod
    def _apply_typo_corrections(query: str) -> tuple[str, dict[str, str]]:
        words = query.split(" ")
        out: list[str] = []
        corrections: dict[str, str] = {}
        for word in words:
            token = re.sub(r"[^A-Za-z0-9_-]", "", word).lower()
            fixed = _TYPO_MAP.get(token)
            if fixed and fixed != token:
                corrections[word] = fixed
                out.append(word.lower().replace(token, fixed, 1))
            elif fixed and fixed == token:
                out.append(word)
            else:
                out.append(word)
        return " ".join(out).strip(), corrections

    @staticmethod
    def _collect_synonyms(query: str) -> list[str]:
        lowered = query.lower()
        terms: list[str] = []
        for key, values in _SYNONYM_MAP.items():
            if key in lowered:
                terms.extend(values)
        seen: set[str] = set()
        deduped: list[str] = []
        for term in terms:
            token = term.strip().lower()
            if not token or token in seen:
                continue
            seen.add(token)
            deduped.append(term.strip())
        return deduped

    @staticmethod
    def _extract_filters(query: str) -> dict[str, str]:
        hints: dict[str, str] = {}
        article = _first_match(_ARTICLE_RE, query)
        clause = _first_match(_CLAUSE_RE, query)
        case_e = _first_match(_CASE_E_RE, query)
        case_k = _first_match(_CASE_K_RE, query)
        year = _first_match(_YEAR_RE, query)

        if article:
            hints["article_no"] = article
        if clause:
            hints["clause_no"] = clause
        if case_e:
            hints["case_e_no"] = case_e.replace(" ", "")
        if case_k:
            hints["case_k_no"] = case_k.replace(" ", "")
        if year:
            hints["year"] = year
        return hints

    @staticmethod
    def _build_expanded_query(base_query: str, synonyms: list[str], filters: dict[str, str]) -> str:
        payload = base_query.strip()
        tails: list[str] = []
        if synonyms:
            tails.append("synonyms:" + ", ".join(synonyms[:8]))
        if filters:
            parts = [f"{key}={value}" for key, value in filters.items()]
            tails.append("filters:" + ", ".join(parts))
        if tails:
            payload = payload + " | " + " | ".join(tails)
        return payload.strip()


def _first_match(pattern: re.Pattern[str], query: str) -> Optional[str]:
    match = pattern.search(query)
    if not match:
        return None
    if match.groups():
        return str(match.group(1)).strip()
    return str(match.group(0)).strip()


legal_query_expander = LegalQueryExpander()
