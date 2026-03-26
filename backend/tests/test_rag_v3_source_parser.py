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


def test_json_payload_is_converted_to_structured_path_text() -> None:
    raw_json = """{
      "kanun": {
        "madde": 17,
        "fikralar": [{"no": 1, "metin": "Bildirim suresi"}]
      }
    }"""

    parsed = parse_source_content(raw_json, "json")

    assert parsed.source_format == "json"
    assert "[H1] kanun" in parsed.text
    assert "kanun > madde: 17" in parsed.text
    assert parsed.heading_count >= 1


def test_xml_payload_is_converted_to_structured_path_text() -> None:
    raw_xml = """
    <karar>
      <mahkeme>Yargitay</mahkeme>
      <dosya esas_no="2020/1">Metin</dosya>
    </karar>
    """

    parsed = parse_source_content(raw_xml, "xml")

    assert parsed.source_format == "xml"
    assert "[H1] karar" in parsed.text
    assert "karar > mahkeme: Yargitay" in parsed.text
    assert "karar > dosya @esas_no: 2020/1" in parsed.text
    assert parsed.heading_count >= 1


def test_json_invalid_payload_falls_back_with_warning() -> None:
    parsed = parse_source_content('{"kanun":', "json")

    assert parsed.source_format == "json"
    assert "JSON_PARSE_FAILED" in parsed.warnings
    assert parsed.text.startswith('{"kanun":')


def test_xml_invalid_payload_falls_back_with_warning() -> None:
    parsed = parse_source_content("<karar><mahkeme>", "xml")

    assert parsed.source_format == "xml"
    assert "XML_PARSE_FAILED" in parsed.warnings


def test_case_law_sections_are_marked_as_headings_in_text_mode() -> None:
    raw = (
        "Yargitay 9. HD E. 2021/10 K. 2021/20\n"
        "OLAY:\n"
        "Isci fesih bildirimini tartismistir.\n"
        "GEREKCE:\n"
        "Bildirim suresi dort hafta olarak kabul edilir.\n"
        "HUKUM:\n"
        "Davaci lehine karar verilmistir.\n"
    )

    parsed = parse_source_content(raw, "text", metadata={"source_type": "ictihat"})

    assert parsed.source_format == "text"
    assert "[H2] OLAY" in parsed.text
    assert "[H2] GEREKCE" in parsed.text
    assert "[H2] HUKUM" in parsed.text
    assert parsed.heading_count >= 3


def test_eml_payload_extracts_headers_and_body() -> None:
    raw_eml = (
        "From: test@example.com\n"
        "To: law@example.com\n"
        "Subject: Dava Bilgilendirme\n"
        "Date: Tue, 01 Jan 2025 10:00:00 +0300\n"
        "Content-Type: text/plain; charset=utf-8\n"
        "\n"
        "Müvekkil için madde 17 değerlendirmesi ekte yer alır.\n"
    )

    parsed = parse_source_content(raw_eml, "eml")

    assert parsed.source_format == "eml"
    assert "Subject: Dava Bilgilendirme" in parsed.text
    assert "Müvekkil için madde 17 değerlendirmesi" in parsed.text


def test_zip_payload_extracts_annex_text_entries() -> None:
    buf = BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("annex1.txt", "MADDE 17 - Ihbar suresi dort haftadir.")
        archive.writestr("annex2.json", '{"karar":{"esas":"2024/1","karar":"2025/2"}}')
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")

    parsed = parse_source_content("", "zip", metadata={"binary_base64": encoded})

    assert parsed.source_format == "zip"
    assert "ANNEX: annex1.txt" in parsed.text
    assert "MADDE 17 - Ihbar suresi dort haftadir." in parsed.text
    assert "karar > esas: 2024/1" in parsed.text


def test_image_payload_uses_ocr_path_when_required(monkeypatch) -> None:
    image_b64 = base64.b64encode(b"fake-image-binary").decode("ascii")

    def _fake_image_ocr(_: bytes):
        return "MADDE 1 gorsel OCR metni", 0.92, "fake-image-ocr", []

    monkeypatch.setattr(source_parser_module, "_extract_image_with_ocr", _fake_image_ocr)

    parsed = parse_source_content(
        "",
        "png",
        metadata={"binary_base64": image_b64, "ocr_required": True},
    )

    assert parsed.source_format == "png"
    assert "MADDE 1 gorsel OCR metni" in parsed.text
    assert parsed.ocr_used is True
