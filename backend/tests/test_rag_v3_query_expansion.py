"""Tests for deterministic legal query expansion layer."""

from __future__ import annotations

from infrastructure.rag_v3.query_expansion import legal_query_expander


def test_query_expansion_extracts_filters_and_synonyms() -> None:
    result = legal_query_expander.expand("KVKK madde 12 fikra 1 E. 2020/10 K. 2021/20")

    assert result.filter_hints.get("article_no") == "12"
    assert result.filter_hints.get("clause_no") == "1"
    assert result.filter_hints.get("case_e_no") == "E.2020/10"
    assert result.filter_hints.get("case_k_no") == "K.2021/20"
    assert any(term.lower() == "6698" for term in result.synonyms)


def test_query_expansion_corrects_common_typos() -> None:
    result = legal_query_expander.expand("mevzaut ve iicra sureci")

    assert "mevzaut" in result.typo_corrections
    assert "iicra" in result.typo_corrections
    assert "mevzuat" in result.expanded_query
    assert "icra" in result.expanded_query
