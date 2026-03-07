"""Unit tests for RAG v3 source parser."""

from __future__ import annotations

import base64
import zipfile
from io import BytesIO

import infrastructure.rag_v3.source_parser as source_parser_module
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


def test_docx_binary_extracts_heading_and_paragraph_text() -> None:
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>Is Hukuku</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Madde metni aciklamasi.</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>
    """
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

    parsed = parse_source_content(
        "DOCX_BINARY_UPLOAD",
        "docx",
        metadata={"binary_base64": encoded},
    )

    assert parsed.source_format == "docx"
    assert "[H1] Is Hukuku" in parsed.text
    assert "Madde metni aciklamasi." in parsed.text
    assert parsed.heading_count == 1


def test_pdf_ocr_fallback_uses_fallback_text_when_ocr_empty(monkeypatch) -> None:
    dummy_pdf_b64 = base64.b64encode(b"%PDF-dummy").decode("ascii")

    def _fake_ocr(_: bytes):
        return "", 1, 0.0, "fake-ocr", ["OCR_ENGINE_UNAVAILABLE"]

    monkeypatch.setattr(source_parser_module, "_extract_pdf_with_ocr", _fake_ocr)

    parsed = parse_source_content(
        "",
        "pdf",
        metadata={
            "binary_base64": dummy_pdf_b64,
            "ocr_required": True,
            "fallback_text": "PAGE 1\nMADDE 1 metni.",
        },
    )

    assert parsed.source_format == "pdf"
    assert "MADDE 1 metni." in parsed.text
    assert "OCR_FALLBACK_TO_EXTRACTED_TEXT" in parsed.warnings
    assert parsed.ocr_used is True
