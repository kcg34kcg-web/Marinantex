"""Unit tests for RAG v3 source parser."""

from __future__ import annotations

from infrastructure.rag_v3.source_parser import parse_source_content


def test_html_preserves_heading_hierarchy_markers() -> None:
    raw_html = """
    <html>
      <body>
        <h1>Borclar Hukuku</h1>
        <h2>Genel Hukumler</h2>
        <p>Madde metni aciklamasi.</p>
      </body>
    </html>
    """

    parsed = parse_source_content(raw_html, "html")

    assert parsed.source_format == "html"
    assert "[H1] Borclar Hukuku" in parsed.text
    assert "[H2] Genel Hukumler" in parsed.text
    assert "Madde metni aciklamasi." in parsed.text
    assert parsed.heading_count == 2


def test_pdf_page_markers_are_converted_to_form_feed() -> None:
    raw_pdf_text = "PAGE 1\nMADDE 1 metni.\nPAGE 2\nMADDE 2 metni."

    parsed = parse_source_content(raw_pdf_text, "pdf")

    assert parsed.source_format == "pdf"
    assert "\f" in parsed.text
    assert parsed.page_count == 2
    assert "MADDE 1 metni." in parsed.text
    assert "MADDE 2 metni." in parsed.text


def test_pdf_existing_form_feed_is_kept() -> None:
    raw_pdf_text = "MADDE 1\n\f\nMADDE 2"

    parsed = parse_source_content(raw_pdf_text, "pdf")

    assert parsed.text.count("\f") == 1
    assert parsed.page_count == 2

