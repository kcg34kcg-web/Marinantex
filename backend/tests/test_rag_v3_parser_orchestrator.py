"""Tests for parser orchestration fallback behavior."""

from __future__ import annotations

from infrastructure.config import settings
from infrastructure.rag_v3.parser_orchestrator import RagV3ParserOrchestrator


def test_parser_orchestrator_falls_back_to_builtin_when_optional_engines_missing(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rag_v3_parser_orchestration_enabled", True)
    monkeypatch.setattr(settings, "rag_v3_parser_engine_order", "mineru,docling,paddleocr_vl,builtin")
    monkeypatch.setattr(settings, "rag_v3_parser_mineru_enabled", True)
    monkeypatch.setattr(settings, "rag_v3_parser_docling_enabled", True)
    monkeypatch.setattr(settings, "rag_v3_parser_paddleocr_vl_enabled", True)

    orchestrator = RagV3ParserOrchestrator()
    parsed = orchestrator.parse(
        raw_text="PAGE 1\nMADDE 1 test",
        source_format="pdf",
        metadata={},
    )

    assert parsed.text
    assert any(item.startswith("PARSER_ENGINE:") for item in parsed.warnings)
    assert any(item == "PARSER_ENGINE:BUILTIN" for item in parsed.warnings)


def test_parser_orchestrator_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rag_v3_parser_orchestration_enabled", False)

    orchestrator = RagV3ParserOrchestrator()
    parsed = orchestrator.parse(
        raw_text="[H1] Baslik\n\nMADDE 10",
        source_format="text",
        metadata={},
    )

    assert "MADDE 10" in parsed.text
    assert "PARSER_ENGINE:BUILTIN" in parsed.warnings
