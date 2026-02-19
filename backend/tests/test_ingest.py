"""
Tests — Step 5: Türkçe Hukuk Ingest/Parsing Hattı
====================================================
Test groups:
  A. OCRCleaner          (11 tests)
  B. TurkishNormalizer    (6 tests)
  C. LegalParser         (14 tests)
  D. CitationExtractor   (10 tests)
  E. IngestPipeline       (8 tests)

Total: 49 tests
"""

from __future__ import annotations

import pytest

from infrastructure.ingest.ocr_cleaner import OCRCleaner
from infrastructure.ingest.text_normalizer import TurkishNormalizer
from infrastructure.ingest.legal_parser import (
    DocumentType,
    LegalParser,
    SegmentType,
)
from infrastructure.ingest.citation_extractor import CitationExtractor, CitationType
from infrastructure.ingest.ingest_pipeline import IngestPipeline, IngestResult

# ===========================================================================
# Shared text fixtures (module-level constants — re-used across test classes)
# ===========================================================================

# Normalised mevzuat text (en-dash separator as TurkishNormalizer would produce)
MEVZUAT_TEXT = (
    "MADDE 1 \u2013 Tan\u0131mlar\n"
    "Bu kanun kapsam\u0131nda ge\u00e7en ifadeler a\u015fa\u011f\u0131daki anlamlara gelir.\n"
    "\n"
    "MADDE 2 \u2013 Ama\u00e7\n"
    "Bu kanunun amac\u0131 hukuki d\u00fczenlemeleri belirlemektir.\n"
    "\n"
    "MADDE 3 \u2013 Kapsam\n"
    "Bu kanun T\u00fcrkiye Cumhuriyeti s\u0131n\u0131rlar\u0131 i\u00e7inde t\u00fcm ger\u00e7ek ki\u015fileri kapsar.\n"
)

# Normalised içtihat text with recognisable section markers
ICTIHAT_TEXT = (
    "YARGITAY 9. Hukuk Dairesi\n"
    "Esas No: 2023/1234\n"
    "Karar No: 2024/5678\n"
    "\n"
    "DAVA: \u0130\u015f ak\u0131d\u0131n\u0131n feshi nedeniyle k\u0131dem ve ihbar tazminat\u0131 talebine ili\u015fkin dava.\n"
    "\n"
    "GERE\u00c7\u00c7E: Taraflar aras\u0131ndaki i\u015f ili\u015fkisi incelendi\u011finde, davan\u0131n\u0131n 5 y\u0131l "
    "boyunca \u00e7al\u0131\u015ft\u0131\u011f\u0131 ve i\u015fverenin hakl\u0131 sebep olmaks\u0131z\u0131n s\u00f6zle\u015fmeyi feshetti\u011fi g\u00f6r\u00fclmektedir.\n"
    "\n"
    "KARAR: Davan\u0131n kabul\u00fcne, tazminat\u0131n davan\u0131ya \u00f6denmesine karar verildi.\n"
)


# ===========================================================================
# pytest fixtures
# ===========================================================================

@pytest.fixture
def cleaner() -> OCRCleaner:
    """OCRCleaner with tight thresholds to make warning tests easy."""
    return OCRCleaner(
        high_ligature_threshold=2,
        high_hyphen_threshold=2,
        large_reduction_pct=5.0,
    )


@pytest.fixture
def normalizer() -> TurkishNormalizer:
    return TurkishNormalizer()


@pytest.fixture
def parser() -> LegalParser:
    """LegalParser with low thresholds so FIKRA-split tests work on short text."""
    return LegalParser(min_segment_chars=5, madde_split_threshold=100)


@pytest.fixture
def extractor() -> CitationExtractor:
    return CitationExtractor()


# ===========================================================================
# A. OCRCleaner (11 tests)
# ===========================================================================

class TestOCRCleaner:

    def test_empty_input_returns_empty_and_no_warnings(self, cleaner):
        """A.1 — empty string produces ("", []) without warnings."""
        text, warnings = cleaner.clean("")
        assert text == ""
        assert warnings == []

    def test_fi_ligature_replaced(self, cleaner):
        """A.2 — ﬁ (U+FB01) ligature is expanded to 'fi'."""
        text, _ = cleaner.clean("o\ufb01s dosyas\u0131")
        assert "\ufb01" not in text
        assert "ofi" in text

    def test_ff_ligature_replaced(self, cleaner):
        """A.3 — ﬀ (U+FB00) ligature is expanded to 'ff'."""
        text, _ = cleaner.clean("e\ufb00ect")
        assert "\ufb00" not in text
        assert "effect" in text

    def test_linebreak_hyphen_rejoined(self, cleaner):
        """A.4 — Word-break hyphen at line end is rejoined: 'söz-\\nleşme' → 'sözleşme'."""
        text, _ = cleaner.clean("s\u00f6z-\nle\u015fme")
        assert "s\u00f6zle\u015fme" in text
        assert "-\n" not in text

    def test_isolated_page_number_stripped(self, cleaner):
        """A.5 — A line containing only a page number is removed."""
        text, _ = cleaner.clean("Metin ba\u015flar.\n45\nMetin devam eder.")
        assert "45" not in text
        assert "Metin ba\u015flar." in text

    def test_resmi_gazete_header_stripped(self, cleaner):
        """A.6 — Resmî Gazete header line is stripped by the footer pattern."""
        raw = "Resm\u00ee Gazete 24.05.2003 Say\u0131: 25118\nAs\u0131l metin burada."
        text, _ = cleaner.clean(raw)
        assert "Resm\u00ee Gazete" not in text
        assert "As\u0131l metin burada." in text

    def test_multi_space_collapsed(self, cleaner):
        """A.7 — Multiple consecutive spaces are collapsed to a single space."""
        text, _ = cleaner.clean("bu   bir    metin")
        assert text == "bu bir metin"

    def test_high_ligature_density_warning_triggered(self, cleaner):
        """A.8 — More than threshold (2) distinct ligature replacements → HIGH_LIGATURE_DENSITY warning."""
        text_with_ligatures = "\ufb01rst \ufb00ect \ufb02ow \ufb03cient"
        _, warnings = cleaner.clean(text_with_ligatures)
        assert any("HIGH_LIGATURE_DENSITY" in w for w in warnings)

    def test_high_hyphen_join_warning_triggered(self, cleaner):
        """A.9 — More than threshold (2) line-break hyphens → HIGH_HYPHEN_JOIN_COUNT warning."""
        raw = "s\u00f6z-\nle\u015fme ve hak-\nk\u0131nda ve i\u015f-\nyeri bilgisi"
        _, warnings = cleaner.clean(raw)
        assert any("HIGH_HYPHEN_JOIN_COUNT" in w for w in warnings)

    def test_large_reduction_warning_triggered(self, cleaner):
        """A.10 — Cleaning that removes >5% of text triggers LARGE_REDUCTION warning."""
        # 29 single-digit page-number lines get stripped; "real text" remains
        page_lines = "\n".join(str(i) for i in range(1, 30))
        raw = page_lines + "\nK\u0131sa ger\u00e7ek metin sat\u0131r\u0131."
        _, warnings = cleaner.clean(raw)
        assert any("LARGE_REDUCTION" in w for w in warnings)

    def test_null_bytes_and_control_chars_removed(self, cleaner):
        """A.11 — Null bytes (\\x00) and control characters are removed."""
        text, _ = cleaner.clean("metin\x00i\u00e7eri\u011fi\x01burada")
        assert "\x00" not in text
        assert "\x01" not in text
        assert "metin" in text


# ===========================================================================
# B. TurkishNormalizer (6 tests)
# ===========================================================================

class TestTurkishNormalizer:

    def test_empty_input_returns_empty(self, normalizer):
        """B.1 — empty string → ("", [])."""
        result, warnings = normalizer.normalize("")
        assert result == ""
        assert warnings == []

    def test_madde_separator_plain_hyphen_standardized(self, normalizer):
        """B.2 — Hyphen after MADDE number is converted to en-dash ' – '."""
        text, _ = normalizer.normalize("MADDE 1 - Tan\u0131mlar\nMetin burada.")
        assert "MADDE 1 \u2013 Tan\u0131mlar" in text

    def test_madde_separator_em_dash_standardized(self, normalizer):
        """B.3 — Em-dash (—) after MADDE number is converted to ' – '."""
        text, _ = normalizer.normalize("MADDE 5 \u2014 Ama\u00e7\nBu madde ama\u00e7lar\u0131 belirler.")
        assert "MADDE 5 \u2013 Ama\u00e7" in text

    def test_trailing_whitespace_removed_per_line(self, normalizer):
        """B.4 — Trailing spaces on each line are stripped."""
        text, _ = normalizer.normalize("sat\u0131r bir   \nsat\u0131r iki  \n")
        assert "sat\u0131r bir   " not in text
        assert "sat\u0131r iki  " not in text
        assert "sat\u0131r bir" in text

    def test_multiple_blank_lines_collapsed_to_one(self, normalizer):
        """B.5 — Three or more consecutive blank lines are reduced to one blank line."""
        text, _ = normalizer.normalize("paragraf bir\n\n\n\nparagraf iki")
        assert "\n\n\n" not in text
        assert "paragraf bir" in text
        assert "paragraf iki" in text

    def test_idempotent(self, normalizer):
        """B.6 — Normalizing twice gives the same result as normalizing once."""
        once, _ = normalizer.normalize(MEVZUAT_TEXT)
        twice, _ = normalizer.normalize(once)
        assert once == twice


# ===========================================================================
# C. LegalParser (14 tests)
# ===========================================================================

class TestLegalParser:

    def test_detect_document_type_mevzuat(self, parser):
        """C.1 — Text with 'MADDE N' pattern is classified as MEVZUAT."""
        assert parser.detect_document_type(MEVZUAT_TEXT) == DocumentType.MEVZUAT

    def test_detect_document_type_ictihat(self, parser):
        """C.2 — Text with 'Esas No' is classified as ICTIHAT."""
        assert parser.detect_document_type(ICTIHAT_TEXT) == DocumentType.ICTIHAT

    def test_detect_document_type_unknown(self, parser):
        """C.3 — Plain prose without legal signals is UNKNOWN."""
        plain = "Bu basit bir metin. Hi\u00e7bir hukuki terim i\u00e7ermez."
        assert parser.detect_document_type(plain) == DocumentType.UNKNOWN

    def test_mevzuat_madde_boundary_count(self, parser):
        """C.4 — Three MADDE markers produce exactly three MADDE segments."""
        segments = parser.parse(MEVZUAT_TEXT)
        madde_segs = [s for s in segments if s.segment_type == SegmentType.MADDE.value]
        assert len(madde_segs) == 3

    def test_mevzuat_madde_no_populated_correctly(self, parser):
        """C.5 — madde_no field is correctly extracted ('1', '2', '3')."""
        segments = parser.parse(MEVZUAT_TEXT)
        madde_nos = {s.madde_no for s in segments if s.madde_no}
        assert {"1", "2", "3"}.issubset(madde_nos)

    def test_mevzuat_long_article_split_to_fikra(self, parser):
        """C.6 — Article longer than madde_split_threshold (100) is split into FIKRAs."""
        long_madde = (
            "MADDE 7 \u2013 Uzun Madde\n"
            "(1) Birinci f\u0131kra metni olduk\u00e7a uzundur ve detayl\u0131 bilgi i\u00e7erir.\n"
            "(2) \u0130kinci f\u0131kra metni de benzer \u015fekilde uzun ve detayl\u0131 a\u00e7\u0131klamalar i\u00e7erir.\n"
        )
        segments = parser.parse(long_madde)
        fikra_segs = [s for s in segments if s.segment_type == SegmentType.FIKRA.value]
        assert len(fikra_segs) >= 2

    def test_mevzuat_fikra_madde_no_preserved(self, parser):
        """C.7 — FIKRA segments inherit the parent madde_no."""
        long_madde = (
            "MADDE 9 \u2013 Uzun Madde\n"
            "(1) Birinci f\u0131kra metni olduk\u00e7a uzundur ve detayl\u0131 bilgi i\u00e7erir.\n"
            "(2) \u0130kinci f\u0131kra metni de benzer \u015fekilde uzun ve detayl\u0131 a\u00e7\u0131klamalar i\u00e7erir.\n"
        )
        segments = parser.parse(long_madde)
        fikra_segs = [s for s in segments if s.segment_type == SegmentType.FIKRA.value]
        assert all(s.madde_no == "9" for s in fikra_segs)

    def test_mevzuat_no_boundaries_returns_full_segment(self, parser):
        """C.8 — Text with no MADDE + digit pattern yields a single FULL segment."""
        text = "Bu metin hi\u00e7bir MADDE numaras\u0131 i\u00e7ermez, dolay\u0131s\u0131yla FULL segment \u00fcretilir."
        segments = parser.parse(text)
        assert len(segments) == 1
        assert segments[0].segment_type == SegmentType.FULL.value

    def test_ictihat_header_segment_created(self, parser):
        """C.9 — ICTIHAT_HEADER segment is created for content before first section marker."""
        segments = parser.parse(ICTIHAT_TEXT)
        header_segs = [s for s in segments if s.segment_type == SegmentType.ICTIHAT_HEADER.value]
        assert len(header_segs) == 1

    def test_ictihat_karar_section_produces_hukum_segment(self, parser):
        """C.10 — KARAR section keyword produces an ICTIHAT_HUKUM segment."""
        segments = parser.parse(ICTIHAT_TEXT)
        hukum_segs = [s for s in segments if s.segment_type == SegmentType.ICTIHAT_HUKUM.value]
        assert len(hukum_segs) >= 1

    def test_ictihat_metadata_contains_esas_no(self, parser):
        """C.11 — esas_no is extracted into segment metadata from the header region."""
        segments = parser.parse(ICTIHAT_TEXT)
        all_esas = [
            s.metadata.get("esas_no")
            for s in segments
            if s.metadata.get("esas_no")
        ]
        assert "2023/1234" in all_esas

    def test_ictihat_no_section_markers_returns_single_body(self, parser):
        """C.12 — Içtihat with no section markers returns exactly one ICTIHAT_BODY."""
        text = "YARGITAY 9. Hukuk Dairesi E. 2023/999 K. 2024/111 karar\u0131 incelendi."
        segments = parser.parse(text)
        assert len(segments) == 1
        assert segments[0].segment_type == SegmentType.ICTIHAT_BODY.value

    def test_empty_text_returns_empty_list(self, parser):
        """C.13 — Empty string and whitespace-only input both return []."""
        assert parser.parse("") == []
        assert parser.parse("   \n\n  ") == []

    def test_segment_index_is_sequential_from_zero(self, parser):
        """C.14 — segment_index is assigned sequentially starting at 0."""
        segments = parser.parse(MEVZUAT_TEXT)
        for expected_idx, seg in enumerate(segments):
            assert seg.segment_index == expected_idx


# ===========================================================================
# D. CitationExtractor (10 tests)
# ===========================================================================

class TestCitationExtractor:

    def test_empty_text_returns_empty_list(self, extractor):
        """D.1 — Empty string returns []."""
        assert extractor.extract("") == []

    def test_aym_citation_extracted_with_esas_no(self, extractor):
        """D.2 — AYM citation with E./K. numbers is extracted with correct esas_no."""
        text = "Bu karar AYM, E. 2022/45, K. 2023/78 say\u0131l\u0131 kararla \u00e7eli\u015fmektedir."
        citations = extractor.extract(text)
        aym = [c for c in citations if c.citation_type == CitationType.AYM.value]
        assert len(aym) >= 1
        assert aym[0].esas_no == "2022/45"

    def test_yargitay_daire_citation_extracted(self, extractor):
        """D.3 — Yargıtay chamber citation with E./K. is extracted."""
        text = "Yarg\u0131tay 9. Hukuk Dairesi, E. 2023/1234, K. 2024/5678 karar\u0131."
        citations = extractor.extract(text)
        yarg = [c for c in citations if c.citation_type == CitationType.YARGITAY.value]
        assert len(yarg) >= 1
        assert yarg[0].esas_no == "2023/1234"

    def test_ibk_citation_extracted_as_yargitay_type(self, extractor):
        """D.4 — Yargıtay İBK citation is extracted with CitationType.YARGITAY."""
        text = "Yarg\u0131tay \u0130BK, E. 2010/1, K. 2011/3 karar\u0131 uyar\u0131nca."
        citations = extractor.extract(text)
        assert len(citations) >= 1
        assert any(c.citation_type == CitationType.YARGITAY.value for c in citations)

    def test_kanun_no_extracted(self, extractor):
        """D.5 — '4857 sayılı' law number is extracted."""
        text = "4857 say\u0131l\u0131 \u0130\u015f Kanunu'nun 17. maddesine g\u00f6re."
        citations = extractor.extract(text)
        kanun = [c for c in citations if c.citation_type == CitationType.KANUN_NO.value]
        assert len(kanun) >= 1
        assert kanun[0].kanun_no == "4857"

    def test_madde_ref_md_form_extracted(self, extractor):
        """D.6 — 'md. 17' form of article reference is extracted."""
        text = "md. 17 uyar\u0131nca i\u015fveren bildirim y\u00fcekml\u00fcl\u00fc\u011f\u00fc alt\u0131ndad\u0131r."
        citations = extractor.extract(text)
        madde = [c for c in citations if c.citation_type == CitationType.MADDE_REF.value]
        assert len(madde) >= 1
        assert madde[0].madde_ref == "17"

    def test_resmi_gazete_citation_extracted(self, extractor):
        """D.7 — Resmî Gazete citation with date is extracted."""
        text = "RG. 01.01.2024, S. 32456 tarihli yay\u0131n."
        citations = extractor.extract(text)
        rg = [c for c in citations if c.citation_type == CitationType.RESMI_GAZETE.value]
        assert len(rg) >= 1

    def test_char_start_end_positions_are_accurate(self, extractor):
        """D.8 — char_start and char_end correctly locate the match in the source text."""
        text = "Kanun 4857 say\u0131l\u0131 i\u015f kanununa at\u0131fta bulunur."
        citations = extractor.extract(text)
        kanun = next(
            (c for c in citations if c.citation_type == CitationType.KANUN_NO.value),
            None,
        )
        assert kanun is not None
        assert text[kanun.char_start : kanun.char_end] == kanun.raw_text

    def test_citation_type_field_is_string(self, extractor):
        """D.9 — citation_type field contains plain string values, not enum instances."""
        text = "4857 say\u0131l\u0131 \u0130\u015f Kanunu kapsam\u0131nda md. 17 bildirimi."
        citations = extractor.extract(text)
        for c in citations:
            assert isinstance(c.citation_type, str)

    def test_overlapping_matches_deduplicated(self, extractor):
        """D.10 — No two returned citations have overlapping character spans."""
        text = "Yarg\u0131tay \u0130BK, E. 2010/1, K. 2011/3 karar\u0131nda belirtildi\u011fi \u00fczere."
        citations = extractor.extract(text)
        sorted_cits = sorted(citations, key=lambda c: c.char_start)
        for i in range(len(sorted_cits) - 1):
            assert sorted_cits[i].char_end <= sorted_cits[i + 1].char_start, (
                f"Overlap: [{sorted_cits[i].char_start}:{sorted_cits[i].char_end}] "
                f"vs [{sorted_cits[i+1].char_start}:{sorted_cits[i+1].char_end}]"
            )


# ===========================================================================
# E. IngestPipeline (8 tests)
# ===========================================================================

class TestIngestPipeline:

    async def test_mevzuat_pipeline_returns_success_and_madde_segments(self):
        """E.1 — Full pipeline on mevzuat text: success=True, three MADDE segments."""
        pipeline = IngestPipeline()
        result = await pipeline.run(MEVZUAT_TEXT, document_id="doc-e01")
        assert result.success is True
        assert result.document_type == DocumentType.MEVZUAT.value
        madde_segs = [s for s in result.segments if s.segment_type == SegmentType.MADDE.value]
        assert len(madde_segs) == 3

    async def test_ictihat_pipeline_returns_ictihat_segments(self):
        """E.2 — Full pipeline on içtihat text returns ICTIHAT_* typed segments."""
        pipeline = IngestPipeline()
        result = await pipeline.run(ICTIHAT_TEXT, document_id="doc-e02")
        assert result.success is True
        assert result.document_type == DocumentType.ICTIHAT.value
        ictihat_types = {
            SegmentType.ICTIHAT_HEADER.value,
            SegmentType.ICTIHAT_BODY.value,
            SegmentType.ICTIHAT_HUKUM.value,
        }
        assert any(s.segment_type in ictihat_types for s in result.segments)

    async def test_citation_refs_populated_on_segments(self):
        """E.3 — citation_refs list on each segment is populated by CitationExtractor."""
        text = (
            "MADDE 1 \u2013 Kapsam\n"
            "Bu madde 4857 say\u0131l\u0131 Kanun md. 17 uyar\u0131nca uygulan\u0131r.\n"
        )
        pipeline = IngestPipeline()
        result = await pipeline.run(text, document_id="doc-e03")
        assert result.success is True
        all_refs = [ref for seg in result.segments for ref in seg.citation_refs]
        assert len(all_refs) > 0

    async def test_empty_text_returns_success_with_no_segments(self):
        """E.4 — Empty input produces success=True, segments=[], errors=[]."""
        pipeline = IngestPipeline()
        result = await pipeline.run("", document_id="doc-e04")
        assert result.success is True
        assert result.segments == []
        assert result.errors == []

    async def test_ocr_cleaner_error_recorded_in_errors_list(self):
        """E.5 — If OCRCleaner raises, error is captured and result is still returned."""

        class _BrokenCleaner(OCRCleaner):
            def clean(self, text: str):
                raise RuntimeError("simulated OCR failure")

        pipeline = IngestPipeline(cleaner=_BrokenCleaner())
        result = await pipeline.run("metin burada.", document_id="doc-e05")
        assert isinstance(result, IngestResult)
        assert any("OCR_CLEAN_ERROR" in e for e in result.errors)

    async def test_metadata_char_counts_are_correct(self):
        """E.6 — IngestMetadata.original_char_count equals len(raw_text)."""
        pipeline = IngestPipeline()
        result = await pipeline.run(MEVZUAT_TEXT, document_id="doc-e06")
        assert result.metadata.original_char_count == len(MEVZUAT_TEXT)
        assert result.metadata.segment_count == len(result.segments)
        assert result.metadata.citation_count == len(result.citations)

    async def test_doc_type_hint_overrides_auto_detection(self):
        """E.7 — doc_type_hint forces the specified DocumentType regardless of content."""
        text = (
            "E. 2020/100 K. 2021/200\n"
            "KARAR: Davan\u0131n kabul\u00fcne karar verildi.\n"
        )
        pipeline = IngestPipeline()
        result = await pipeline.run(
            text,
            document_id="doc-e07",
            doc_type_hint=DocumentType.ICTIHAT,
        )
        assert result.document_type == DocumentType.ICTIHAT.value

    async def test_ocr_warnings_propagated_to_result_warnings(self):
        """E.8 — Warnings from OCRCleaner appear in IngestResult.warnings."""
        tight_cleaner = OCRCleaner(
            high_ligature_threshold=1,
            high_hyphen_threshold=100,   # don't trigger hyphen warning
            large_reduction_pct=100.1,   # don't trigger reduction warning
        )
        text_with_ligatures = "\ufb01rst \ufb00ect example text."
        pipeline = IngestPipeline(cleaner=tight_cleaner)
        result = await pipeline.run(text_with_ligatures, document_id="doc-e08")
        assert any("HIGH_LIGATURE_DENSITY" in w for w in result.warnings)
