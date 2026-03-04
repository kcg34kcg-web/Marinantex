"""Unit tests for RAG v3 legal chunker."""

from __future__ import annotations

from infrastructure.rag_v3.chunker import LegalStructuredChunker


def test_chunks_follow_article_clause_integrity() -> None:
    chunker = LegalStructuredChunker(target_min_tokens=50, target_max_tokens=900)
    text = (
        "MADDE 1 - Genel Hukumler\n"
        "(1) Birinci fikra metni burada.\n"
        "(2) Ikinci fikra metni burada.\n\n"
        "MADDE 2 - Diger Hukum\n"
        "Bu madde tek parca kalir.\n"
    )

    chunks = chunker.chunk(text)

    assert len(chunks) == 3
    assert chunks[0].article_no == "1"
    assert chunks[0].clause_no == "1"
    assert chunks[1].article_no == "1"
    assert chunks[1].clause_no == "2"
    assert chunks[2].article_no == "2"
    assert chunks[2].clause_no is None


def test_detects_gecici_and_ek_madde_patterns() -> None:
    chunker = LegalStructuredChunker()
    text = (
        "GECICI MADDE 1 - Gecis\n"
        "Bu gecici maddedir.\n\n"
        "EK MADDE 2 - Ek duzenleme\n"
        "Bu da ek maddedir.\n"
    )

    chunks = chunker.chunk(text)
    article_nos = [chunk.article_no for chunk in chunks]

    assert "GECICI 1" in article_nos
    assert "EK 2" in article_nos


def test_heading_markers_are_propagated_to_heading_path() -> None:
    chunker = LegalStructuredChunker()
    text = (
        "[H1] Is Hukuku\n"
        "[H2] Kidem Tazminati\n\n"
        "MADDE 14 - Kidem hakki\n"
        "(1) Isci belirli sartlarda kidem alir.\n"
    )

    chunks = chunker.chunk(text)

    assert len(chunks) >= 1
    assert chunks[0].heading_path == "Is Hukuku > Kidem Tazminati"


def test_page_range_tracks_form_feed_boundaries() -> None:
    chunker = LegalStructuredChunker()
    text = (
        "MADDE 1 - Uzun madde\n"
        "Bu metin ilk sayfada baslar.\n"
        "\f"
        "Ikinci sayfada devam eder.\n"
    )

    chunks = chunker.chunk(text)

    assert len(chunks) == 1
    assert chunks[0].page_range == "1-2"
