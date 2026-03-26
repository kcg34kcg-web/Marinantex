from __future__ import annotations

from application.services.rag_v3_service import (
    RagV3Citation,
    _enforce_sentence_grounding,
    _sanitize_answer_output,
)


def test_sanitize_answer_output_redacts_reasoning_blocks() -> None:
    raw = """
<think>internal chain</think>
```reasoning
hidden analysis
```
Bu cevap kullaniciya gorunmelidir.
"""

    clean = _sanitize_answer_output(raw)

    assert "internal chain" not in clean
    assert "hidden analysis" not in clean
    assert "Bu cevap kullaniciya gorunmelidir." in clean


def test_sentence_grounding_passes_with_evidence_overlap() -> None:
    citations = [
        RagV3Citation(
            chunk_id="c1",
            document_id="d1",
            title="Doc",
            source_id="src-1",
            source_type="mevzuat",
            article_no="138",
            clause_no=None,
            subclause_no=None,
            page_range=None,
            source_url="https://www.mevzuat.gov.tr/",
            source_char_start=0,
            source_char_end=120,
            paragraph_start=1,
            paragraph_end=1,
            citation_date="2011-02-04",
            issuing_authority="Resmi Gazete",
            decision_no=None,
            evidence_text="Asiri ifa guclugu halinde sozlesmenin uyarlanmasi talep edilebilir.",
        )
    ]

    passed, ratio, unsupported = _enforce_sentence_grounding(
        answer_text="Asiri ifa guclugu halinde sozlesmenin uyarlanmasi talep edilebilir.",
        citations=citations,
        min_overlap=0.2,
    )

    assert passed is True
    assert ratio >= 0.99
    assert unsupported == []


def test_sentence_grounding_fails_without_matching_evidence() -> None:
    citations = [
        RagV3Citation(
            chunk_id="c1",
            document_id="d1",
            title="Doc",
            source_id="src-1",
            source_type="ictihat",
            article_no=None,
            clause_no=None,
            subclause_no=None,
            page_range=None,
            source_url="https://karararama.yargitay.gov.tr/",
            source_char_start=0,
            source_char_end=90,
            paragraph_start=1,
            paragraph_end=1,
            citation_date="2022-01-01",
            issuing_authority="Yargitay",
            decision_no="2022/1234",
            evidence_text="Kira tespit davasi farkli unsurlarla degerlendirilir.",
        )
    ]

    passed, ratio, unsupported = _enforce_sentence_grounding(
        answer_text="Ceza sorusturmasinda tutuklama kosullari olusmamistir.",
        citations=citations,
        min_overlap=0.35,
    )

    assert passed is False
    assert ratio == 0.0
    assert len(unsupported) == 1
