"""Unit tests for RAG v3 legal text normalizer."""

from __future__ import annotations

from infrastructure.rag_v3.normalizer import LegalTextNormalizer


def test_normalizer_merges_hyphenated_and_wrapped_lines() -> None:
    normalizer = LegalTextNormalizer()
    raw = (
        "MADDE 1 -\n"
        "Bu hu-\n"
        "kum bir satir\n"
        "icerisinde devam eder.\n"
    )

    normalized = normalizer.normalize(raw)

    assert "Bu hukum bir satir icerisinde devam eder." in normalized.text
    assert any(item.startswith("hyphen_join_count=") for item in normalized.warnings)
    assert any(item.startswith("line_merge_count=") for item in normalized.warnings)


def test_normalizer_extracts_footnotes_to_metadata() -> None:
    normalizer = LegalTextNormalizer()
    raw = (
        "MADDE 2 - Metin.\n"
        "[1] Bu bir dipnot satiridir.\n"
        "Devam eden ana metin.\n"
    )

    normalized = normalizer.normalize(raw)

    assert "dipnot satiridir" not in normalized.text
    assert len(normalized.footnotes) == 1
    assert normalized.footnotes[0].startswith("[1]")
    assert any(item.startswith("footnote_count=") for item in normalized.warnings)


def test_normalizer_keeps_page_boundaries() -> None:
    normalizer = LegalTextNormalizer()
    raw = "Ilk sayfa\n\f\nIkinci sayfa"

    normalized = normalizer.normalize(raw)

    assert normalized.text.count("\f") == 1
    assert "Ilk sayfa" in normalized.text
    assert "Ikinci sayfa" in normalized.text

