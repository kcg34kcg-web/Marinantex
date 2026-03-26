"""Tests for RAG v3 document understanding quality gates."""

from __future__ import annotations

from infrastructure.rag_v3.chunker import LegalChunkDraft
from infrastructure.rag_v3.document_understanding import evaluate_document_understanding
from infrastructure.rag_v3.source_parser import ParsedSourceContent


def _chunk(text: str, article_no: str | None = "1") -> LegalChunkDraft:
    return LegalChunkDraft(
        article_no=article_no,
        clause_no="1",
        subclause_no=None,
        heading_path="Is Hukuku",
        text=text,
        page_range="1",
        char_start=0,
        char_end=len(text),
    )


def test_document_understanding_passes_structured_legal_text() -> None:
    parsed = ParsedSourceContent(
        text="[H1] Is Hukuku\n\nMADDE 17 - Is Kanunu kapsaminda ihbar suresi dort haftadir.\n(1) Isciya bildirilir.",
        source_format="text",
        page_count=1,
        heading_count=1,
        warnings=[],
        ocr_used=False,
    )
    report = evaluate_document_understanding(
        parsed=parsed,
        normalized_text=parsed.text,
        chunks=[
            _chunk("MADDE 17 - Is Kanunu kapsaminda ihbar suresi dort haftadir."),
            _chunk("(1) Isciya bildirilir.", article_no="17"),
        ],
        metadata={},
    )

    assert report.pass_gate is True
    assert report.quality_score >= 0.62
    assert report.parser_confidence >= 0.55


def test_document_understanding_fails_low_ocr_confidence() -> None:
    payload = "Sayfa 1\nBu metin cok kirik\nxx xx xx"
    parsed = ParsedSourceContent(
        text=payload,
        source_format="pdf",
        page_count=3,
        heading_count=0,
        warnings=["LOW_OCR_CONFIDENCE", "OCR_PAGE_FAILED:2"],
        ocr_used=True,
        ocr_confidence=0.22,
        ocr_engine="mock",
    )
    report = evaluate_document_understanding(
        parsed=parsed,
        normalized_text=payload,
        chunks=[_chunk("Bu metin cok kirik", article_no=None)],
        metadata={},
    )

    assert report.pass_gate is False
    assert "ocr_confidence_below_threshold" in report.reason_codes
    assert report.ocr_confidence < 0.45


def test_document_understanding_warns_for_layout_noise() -> None:
    payload = "\n".join(["A" * 20, "B" * 18, "C" * 17, "MADDE 1 - Kisa satirlar"] * 6)
    parsed = ParsedSourceContent(
        text=payload,
        source_format="text",
        page_count=1,
        heading_count=0,
        warnings=[],
        ocr_used=False,
    )

    report = evaluate_document_understanding(
        parsed=parsed,
        normalized_text=payload,
        chunks=[_chunk("MADDE 1 - Kisa satirlar")],
        metadata={},
    )

    assert report.layout_confidence <= 0.7
    assert report.requires_human_review is True
