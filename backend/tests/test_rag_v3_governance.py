"""Tests for RAG v3 governance helpers."""

from __future__ import annotations

from datetime import date

from infrastructure.rag_v3.governance import (
    apply_norm_hierarchy,
    evaluate_policy,
    resolve_as_of_date,
    verify_claim_support,
)
from infrastructure.rag_v3.repository import RagV3ChunkMatch


def _match(
    *,
    source_type: str,
    source_id: str,
    article_no: str | None = None,
    final_score: float = 0.8,
    effective_from: date | None = None,
    effective_to: date | None = None,
    text: str = "Madde 17 ihbar suresi dort haftadir.",
) -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=f"chunk-{source_type}-{source_id}",
        document_id="doc-1",
        title="Belge",
        source_type=source_type,
        source_id=source_id,
        jurisdiction="TR",
        article_no=article_no,
        clause_no="1",
        subclause_no=None,
        heading_path=None,
        chunk_text=text,
        page_range=None,
        effective_from=effective_from,
        effective_to=effective_to,
        acl_tags=["public"],
        doc_hash="doc-hash",
        chunk_hash=f"hash-{source_type}-{source_id}",
        semantic_score=0.7,
        keyword_score=0.2,
        final_score=final_score,
    )


def test_resolve_as_of_date_parses_relative_today_keyword() -> None:
    resolved = resolve_as_of_date("bugun yururlukte olan madde nedir?", None, today=date(2026, 3, 3))
    assert resolved.as_of_date == date(2026, 3, 3)
    assert resolved.source.startswith("relative")


def test_resolve_as_of_date_parses_year_only_query() -> None:
    resolved = resolve_as_of_date("2019 yilinda hangi duzenleme vardi?", None, today=date(2026, 3, 3))
    assert resolved.as_of_date == date(2019, 12, 31)
    assert resolved.source == "query_year"


def test_apply_norm_hierarchy_boosts_source_id_and_article_match() -> None:
    rows = [
        _match(source_type="teblig", source_id="9999", article_no="12", final_score=0.89),
        _match(source_type="kanun", source_id="4857", article_no="17", final_score=0.82),
    ]
    ranked, notes = apply_norm_hierarchy(
        rows,
        query="4857 sayili kanun madde 17 ihbar suresi",
        as_of_date=date(2026, 3, 3),
    )
    assert ranked[0].source_id == "4857"
    assert "lex_specialis_source_id_hint" in notes


def test_verify_claim_support_detects_supported_claims() -> None:
    evidence = [
        _match(
            source_type="kanun",
            source_id="4857",
            article_no="17",
            text="Is Kanunu madde 17 uyarinca ihbar suresi dort haftadir.",
        )
    ]
    report = verify_claim_support(
        answer_text="Is Kanunu madde 17 uyarinca ihbar suresi dort haftadir.",
        evidence_chunks=evidence,
        cited_chunk_ids=[evidence[0].chunk_id],
        min_overlap=0.2,
        min_supported_ratio=0.7,
    )
    assert report.passed is True
    assert report.support_ratio >= 0.7


def test_verify_claim_support_flags_unsupported_claims() -> None:
    evidence = [
        _match(
            source_type="kanun",
            source_id="4857",
            article_no="17",
            text="Bu metin sadece ihbar suresi hakkindadir.",
        )
    ]
    report = verify_claim_support(
        answer_text="Kesin kazanirsiniz ve tum tazminatlar otomatik odenir.",
        evidence_chunks=evidence,
        cited_chunk_ids=[evidence[0].chunk_id],
        min_overlap=0.3,
        min_supported_ratio=0.8,
    )
    assert report.passed is False
    assert report.unsupported_claims


def test_evaluate_policy_marks_guarantee_request_as_critical() -> None:
    policy = evaluate_policy("Davayi kesin kazanir miyim, garanti ver.")
    assert policy.risk_level == "CRITICAL"
    assert "GUARANTEE_REQUEST" in policy.policy_flags
    assert policy.should_block_generation is True
