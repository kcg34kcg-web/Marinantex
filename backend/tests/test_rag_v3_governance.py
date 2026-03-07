"""Tests for RAG v3 governance helpers."""

from __future__ import annotations

from datetime import date

from infrastructure.rag_v3.governance import (
    apply_norm_hierarchy,
    evaluate_policy,
    evaluate_policy_lattice,
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
    classification: str = "PUBLIC",
    acl_tags: list[str] | None = None,
) -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=f"chunk-{source_type}-{source_id}",
        document_id="doc-1",
        title="Belge",
        source_type=source_type,
        source_id=source_id,
        classification=classification,
        jurisdiction="TR",
        article_no=article_no,
        clause_no="1",
        subclause_no=None,
        heading_path=None,
        chunk_text=text,
        page_range=None,
        effective_from=effective_from,
        effective_to=effective_to,
        acl_tags=list(acl_tags or ["public"]),
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


def test_resolve_as_of_date_prefers_event_date_when_dual_temporal_input_exists() -> None:
    resolved = resolve_as_of_date(
        "ihbar suresi nedir",
        None,
        event_date=date(2010, 1, 1),
        decision_date=date(2020, 1, 1),
        today=date(2026, 3, 3),
    )
    assert resolved.as_of_date == date(2010, 1, 1)
    assert resolved.source == "event_date"
    assert "decision_date_not_used_in_single_as_of" in resolved.warnings


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


def test_policy_lattice_tightens_on_sensitive_classification() -> None:
    lattice = evaluate_policy_lattice(
        matches=[
            _match(source_type="kanun", source_id="1", classification="PUBLIC"),
            _match(source_type="sozlesme", source_id="2", classification="SENSITIVE"),
        ],
        session_policy={},
        default_provider_allowlist=["google", "openai", "anthropic", "groq"],
        self_host_provider_allowlist=["openai"],
    )
    assert lattice.sensitivity == "privileged"
    assert lattice.external_transfer == "forbidden"
    assert lattice.provider_allowlist == ["openai"]
    assert lattice.should_block_generation is False


def test_policy_lattice_blocks_prohibited_source_rights() -> None:
    lattice = evaluate_policy_lattice(
        matches=[
            _match(
                source_type="sozlesme",
                source_id="x1",
                classification="CONFIDENTIAL",
                acl_tags=["source_rights:prohibited"],
            )
        ],
        session_policy={},
        default_provider_allowlist=["openai"],
        self_host_provider_allowlist=["openai"],
    )
    assert lattice.source_rights == "prohibited"
    assert lattice.should_block_generation is True
    assert "SOURCE_RIGHTS_PROHIBITED" in lattice.policy_flags


def test_policy_lattice_intersects_session_provider_allowlist() -> None:
    lattice = evaluate_policy_lattice(
        matches=[_match(source_type="sozlesme", source_id="x2", classification="CONFIDENTIAL")],
        session_policy={"provider_allowlist": ["google", "openai"]},
        default_provider_allowlist=["google", "openai", "anthropic"],
        self_host_provider_allowlist=["openai"],
    )
    assert lattice.provider_allowlist == ["openai"]
