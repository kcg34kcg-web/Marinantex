from __future__ import annotations

from application.services.rag_v3_service import RagV3Citation, _enforce_citation_core_fields


def test_citation_core_fields_require_source_url_and_spans() -> None:
    citations = [
        RagV3Citation(
            chunk_id="chunk-1",
            document_id="doc-1",
            title="Test",
            source_id="src-1",
            source_type="ictihat",
            article_no="12",
            clause_no=None,
            subclause_no=None,
            page_range="1",
            final_score=0.9,
            citation_date="2024-01-01",
            issuing_authority="Yargitay",
            decision_no="2024/123",
            source_url=None,
            source_char_start=None,
            source_char_end=None,
            paragraph_start=None,
            paragraph_end=None,
        )
    ]

    kept, violations = _enforce_citation_core_fields(citations)

    assert kept == []
    assert violations
    assert "source_url" in violations[0]
    assert "source_char_span" in violations[0]
    assert "paragraph_span" in violations[0]
