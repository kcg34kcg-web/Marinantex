"""Tests for RAG v3 metadata authority/version/scope validator."""

from __future__ import annotations

from datetime import date

import pytest

from infrastructure.config import settings
from infrastructure.rag_v3.chunker import LegalChunkDraft
from infrastructure.rag_v3.metadata_governance import MetadataValidationInput, validate_ingest_metadata


def _chunk(article: str | None, clause: str | None = "1") -> LegalChunkDraft:
    text = "MADDE 17 - Is Kanunu kapsaminda ihbar suresi dort haftadir." if article else "Genel metin"
    return LegalChunkDraft(
        article_no=article,
        clause_no=clause,
        subclause_no=None,
        heading_path=None,
        text=text,
        page_range="1",
        char_start=0,
        char_end=len(text),
    )


def test_metadata_validation_passes_for_legal_source_with_required_fields() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Is Kanunu",
            source_type="kanun",
            source_id="4857",
            jurisdiction="TR",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            metadata={
                "authority_type": "KANUN",
                "authority_rank": 90,
                "canonical_citation": "4857 sayili Kanun md. 17",
                "source_scope": "national",
                "version": "2024-01-01",
            },
            normalized_text="MADDE 17 - Is Kanunu kapsaminda ihbar suresi dort haftadir.",
            chunks=[_chunk("17")],
        )
    )

    assert result.passed is True
    assert result.errors == []
    assert result.normalized_metadata["authority_type"] == "KANUN"
    assert result.normalized_metadata["canonical_citation"]


def test_metadata_validation_fails_when_effective_range_is_invalid() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Belge",
            source_type="kanun",
            source_id="4857",
            jurisdiction="TR",
            effective_from=date(2025, 1, 1),
            effective_to=date(2024, 1, 1),
            metadata={"authority_type": "KANUN", "authority_rank": 90},
            normalized_text="MADDE 17 - Metin",
            chunks=[_chunk("17")],
        )
    )

    assert result.passed is False
    assert "effective_to_before_effective_from" in result.errors


def test_metadata_validation_fails_when_canonical_citation_missing_for_legal_source() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Belge",
            source_type="kanun",
            source_id="4857",
            jurisdiction="TR",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            metadata={"authority_type": "KANUN", "authority_rank": 90, "canonical_citation": ""},
            normalized_text="MADDE 17 - Metin",
            chunks=[_chunk("17")],
        )
    )

    assert result.passed is False
    assert "canonical_citation_missing" in result.errors


def test_metadata_validation_allows_non_legal_note_with_minimal_fields() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Ic Not",
            source_type="note",
            source_id="note-1",
            jurisdiction="TR",
            effective_from=None,
            effective_to=None,
            metadata={},
            normalized_text="Toplanti notu",
            chunks=[_chunk(None, None)],
        )
    )

    assert result.passed is False  # mandatory fields still enforced in strict mode
    assert "canonical_citation_missing" in result.errors


def test_metadata_validation_extracts_case_law_contract_fields() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Yargitay 9. Hukuk Dairesi Karari",
            source_type="ictihat",
            source_id="yargitay://9hd/2020-111/2021-222",
            jurisdiction="TR",
            effective_from=date(2021, 3, 15),
            effective_to=None,
            metadata={
                "authority_type": "ICTIHAT",
                "authority_rank": 85,
                "canonical_citation": "Yargitay 9. HD E.2020/111 K.2021/222",
            },
            normalized_text=(
                "Yargitay 9. Hukuk Dairesi E. 2020/111 K. 2021/222 "
                "Karar Tarihi: 15.03.2021 Kidem tazminati alacagi."
            ),
            chunks=[_chunk("17")],
        )
    )

    assert result.passed is True
    assert result.normalized_metadata["court"] == "Yargitay"
    assert result.normalized_metadata["chamber"] is not None
    assert result.normalized_metadata["esas_no"] == "2020/111"
    assert result.normalized_metadata["karar_no"] == "2021/222"
    assert result.normalized_metadata["decision_date"] == "2021-03-15"
    assert "is_hukuku" in result.normalized_metadata["topic_tags"]


def test_metadata_validation_fails_when_case_law_contract_fields_missing() -> None:
    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Mahkeme karari",
            source_type="case_law",
            source_id="case://missing-fields",
            jurisdiction="TR",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            metadata={
                "authority_type": "ICTIHAT",
                "authority_rank": 85,
                "canonical_citation": "Mahkeme Karari",
            },
            normalized_text="Karar metni genel aciklama icerir.",
            chunks=[_chunk(None, None)],
        )
    )

    assert result.passed is False
    assert "case_law_court_missing" in result.errors
    assert "case_law_esas_no_missing" in result.errors
    assert "case_law_karar_no_missing" in result.errors
    assert "case_law_decision_date_missing" in result.errors


def test_metadata_validation_fails_when_temporal_and_topic_missing_for_legal_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rag_v3_metadata_require_effective_dates_for_legal", False)

    result = validate_ingest_metadata(
        MetadataValidationInput(
            title="Belge",
            source_type="kanun",
            source_id="4857",
            jurisdiction="TR",
            effective_from=None,
            effective_to=None,
            metadata={
                "authority_type": "KANUN",
                "authority_rank": 90,
                "canonical_citation": "4857 sayili Kanun",
            },
            normalized_text="Genel hukumler metni.",
            chunks=[_chunk(None, None)],
        )
    )

    assert result.passed is False
    assert "temporal_metadata_missing_for_legal_source" in result.errors
    assert "topic_tags_missing_for_legal_source" in result.errors
