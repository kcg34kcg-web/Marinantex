"""Unit tests for newly introduced RAG v3 production layers."""

from __future__ import annotations

from datetime import date

import pytest

from infrastructure.config import settings
from infrastructure.rag_v3.claim_verifier import SemanticClaimVerifier, combine_claim_verification
from infrastructure.rag_v3.context_summarizer import RagV3ContextSummarizer
from infrastructure.rag_v3.delta_compare import compare_chunk_versions
from infrastructure.rag_v3.doc_retriever import RagV3DocLevelRetriever
from infrastructure.rag_v3.embedding_policy import decide_embedding_fail_open
from infrastructure.rag_v3.exact_search import apply_exact_legal_boost
from infrastructure.rag_v3.governance import ClaimVerification
from infrastructure.rag_v3.metadata_authority import extract_authority_tags, validate_metadata_contract
from infrastructure.rag_v3.parser_quality import evaluate_parser_quality
from infrastructure.rag_v3.planner import RagV3QueryPlanner
from infrastructure.rag_v3.reranker_health import assess_reranker_output
from infrastructure.rag_v3.repository import RagV3ChunkMatch
from infrastructure.rag_v3.review_assist import build_review_assist
from infrastructure.rag_v3.source_parser import ParsedSourceContent
from infrastructure.security.pii_ner import PiiNerEngine
from infrastructure.serving.qwen_deployment import resolve_qwen_serving_config


def _match(
    *,
    chunk_id: str,
    document_id: str,
    source_id: str = "4857",
    source_type: str = "kanun",
    article_no: str | None = "17",
    clause_no: str | None = "1",
    text: str = "MADDE 17 ihbar suresi dort haftadir.",
    final_score: float = 0.60,
) -> RagV3ChunkMatch:
    return RagV3ChunkMatch(
        chunk_id=chunk_id,
        document_id=document_id,
        title="Is Kanunu",
        source_type=source_type,
        source_id=source_id,
        classification="PUBLIC",
        jurisdiction="TR",
        article_no=article_no,
        clause_no=clause_no,
        subclause_no=None,
        heading_path="Is Hukuku",
        chunk_text=text,
        page_range="1",
        effective_from=None,
        effective_to=None,
        acl_tags=["public"],
        doc_hash=f"{document_id}-hash",
        chunk_hash=f"{chunk_id}-hash",
        semantic_score=0.70,
        keyword_score=0.40,
        final_score=final_score,
    )


class _MapEmbedder:
    def __init__(self, mapping: dict[str, list[float]]) -> None:
        self._mapping = mapping

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [list(self._mapping.get(text, [0.0, 0.0])) for text in texts]


class _BrokenEmbedder:
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:  # noqa: ARG002
        raise RuntimeError("embedder unavailable")


def test_query_planner_enables_exact_lane_and_doc_shortlist() -> None:
    planner = RagV3QueryPlanner()
    plan = planner.plan(
        query='source_id:4857 madde 17 fikra 1 "ihbar suresi"',
        top_k=10,
        dual_temporal_requested=False,
        jurisdiction="TR",
        as_of_date=date(2025, 1, 1),
    )

    assert plan.exact_search_enabled is True
    assert plan.retrieval_mode == "exact_hybrid"
    assert plan.doc_shortlist_size >= 3
    assert "run_exact_legal_lane" in plan.decompose_steps


def test_exact_search_boost_prioritizes_exact_match() -> None:
    rows = [
        _match(chunk_id="c1", document_id="d1", source_id="9999", article_no="5", clause_no="2", final_score=0.78),
        _match(chunk_id="c2", document_id="d2", source_id="4857", article_no="17", clause_no="1", final_score=0.60),
    ]
    result = apply_exact_legal_boost(
        query='source_id:4857 madde 17 fikra 1 "ihbar suresi"',
        matches=rows,
    )

    assert result.matched_count >= 1
    assert result.matches[0].chunk_id == "c2"


def test_doc_retriever_shortlists_by_doc_score() -> None:
    retriever = RagV3DocLevelRetriever()
    rows = [
        _match(chunk_id="a1", document_id="doc-a", final_score=0.82),
        _match(chunk_id="a2", document_id="doc-a", final_score=0.80),
        _match(chunk_id="b1", document_id="doc-b", final_score=0.71),
        _match(chunk_id="c1", document_id="doc-c", final_score=0.25),
    ]

    out = retriever.shortlist(matches=rows, max_docs=2)
    assert len(out.shortlisted_doc_ids) == 2
    assert "doc-c" not in out.shortlisted_doc_ids
    assert out.dropped_doc_count == 1
    assert all(item.document_id in set(out.shortlisted_doc_ids) for item in out.matches)


def test_parser_quality_fails_on_low_ocr_confidence() -> None:
    parsed = ParsedSourceContent(
        text="MADDE 1 test metni",
        source_format="pdf",
        page_count=2,
        heading_count=1,
        warnings=["LOW_OCR_CONFIDENCE"],
        ocr_used=True,
        ocr_confidence=0.20,
        ocr_engine="tesseract",
    )
    report = evaluate_parser_quality(parsed=parsed, normalized_text="MADDE 1 test metni " * 20)

    assert report.passed is False
    assert "parser_quality_ocr_confidence_low" in report.hard_fail_reasons


def test_metadata_authority_extracts_counts_and_validates_contract() -> None:
    authority = extract_authority_tags(
        title="Is Kanunu",
        source_type="kanun",
        source_id="4857",
        jurisdiction="TR",
        text="Resmi Gazete sayi: 12345 E. 2020/12 K. 2021/33 MADDE 17",
        metadata={},
    )
    errors = validate_metadata_contract(
        source_id="4857",
        source_type="kanun",
        jurisdiction="TR",
        effective_from=date(2024, 1, 1),
        effective_to=None,
        authority=authority,
    )

    assert authority.authority_level == "KANUN"
    assert authority.metadata.get("resmi_gazete_sayi") == "12345"
    assert int(authority.metadata.get("case_reference_count") or 0) >= 2
    assert errors == []


def test_metadata_authority_accepts_ictihat_source_type() -> None:
    authority = extract_authority_tags(
        title="Yargitay 9. Hukuk Dairesi Karari",
        source_type="ictihat",
        source_id="yargitay://9hd/2020-111/2021-222",
        jurisdiction="TR",
        text="ESAS NO: 2020/111 KARAR NO: 2021/222",
        metadata={},
    )
    errors = validate_metadata_contract(
        source_id="yargitay://9hd/2020-111/2021-222",
        source_type="ictihat",
        jurisdiction="TR",
        effective_from=date(2021, 3, 15),
        effective_to=None,
        authority=authority,
    )

    assert authority.authority_level == "YARGI_KARARI"
    assert errors == []


def test_delta_compare_detects_breaking_clause_change() -> None:
    previous = [{"article_no": "17", "clause_no": "1", "text": "Ihbar suresi dort haftadir"}]
    current = [{"article_no": "17", "clause_no": "1", "text": "Ihbar suresi sekiz haftadir"}]

    delta = compare_chunk_versions(previous_chunks=previous, current_chunks=current)
    assert delta.total_changes == 1
    assert delta.has_breaking_changes is True
    assert delta.changes[0].kind == "modified"


def test_context_summarizer_compresses_non_primary_chunks() -> None:
    summarizer = RagV3ContextSummarizer()
    long_text = (
        "MADDE 17 ihbar suresi dort haftadir. "
        "Bu madde is sozlesmesinin fesih bildirim surelerini duzenler. "
        "Uygulamada isci ve isveren acisindan farkli sonuclar dogurabilir. "
    ) * 8
    rows = [
        _match(chunk_id="c1", document_id="d1", text=long_text),
        _match(chunk_id="c2", document_id="d2", text=long_text),
        _match(chunk_id="c3", document_id="d3", text=long_text),
    ]

    replacements, meta = summarizer.summarize_matches_for_context(
        matches=rows,
        query="ihbar suresi kac haftadir",
        primary_count=1,
        target_tokens=40,
        enabled=True,
    )
    assert "c1" not in replacements
    assert "c2" in replacements and "c3" in replacements
    assert meta.summarized_count == 2


def test_review_assist_sets_p1_for_critical_risk() -> None:
    decision = build_review_assist(
        risk_level="CRITICAL",
        confidence=0.20,
        claim_support_ratio=0.40,
        reason_codes=["policy:external_transfer_forbidden", "claim_verification_failed"],
    )
    assert decision.priority == "p1"
    assert decision.sla_minutes == 60
    assert "compliance" in decision.reviewer_roles
    assert "knowledge_engineer" in decision.reviewer_roles


def test_embedding_policy_enforces_tier_and_mode() -> None:
    blocked = decide_embedding_fail_open(
        fail_open_enabled=True,
        mode="query",
        requested_tier=4,
        max_tier=3,
        allow_ingest=True,
        allow_query=True,
    )
    allowed = decide_embedding_fail_open(
        fail_open_enabled=True,
        mode="query",
        requested_tier=2,
        max_tier=3,
        allow_ingest=False,
        allow_query=True,
    )

    assert blocked.allowed is False
    assert blocked.reason == "tier_exceeds_fail_open_max"
    assert allowed.allowed is True


def test_reranker_health_reports_flat_scores_as_unhealthy() -> None:
    report = assess_reranker_output(
        [
            _match(chunk_id="c1", document_id="d1", final_score=0.50),
            _match(chunk_id="c2", document_id="d1", final_score=0.50),
            _match(chunk_id="c3", document_id="d2", final_score=0.50),
        ]
    )
    assert report.healthy is False
    assert "reranker_score_spread_too_low" in report.warnings


@pytest.mark.asyncio
async def test_semantic_claim_verifier_passes_with_embedding_support() -> None:
    answer = "Ihbar suresi dort haftadir."
    evidence = "Ihbar suresi dort haftadir ve bu sure zorunludur."
    verifier = SemanticClaimVerifier(
        embedder=_MapEmbedder(
            {
                answer: [1.0, 0.0],
                evidence: [1.0, 0.0],
            }
        )
    )
    result = await verifier.verify(
        answer_text=answer,
        evidence_chunks=[_match(chunk_id="c1", document_id="d1", text=evidence)],
        cited_chunk_ids=["c1"],
        min_similarity=0.40,
        min_overlap=0.20,
        min_supported_ratio=0.80,
    )
    assert result.passed is True
    assert result.contradiction_count == 0


@pytest.mark.asyncio
async def test_semantic_claim_verifier_falls_back_to_lexical_on_embedder_failure() -> None:
    verifier = SemanticClaimVerifier(embedder=_BrokenEmbedder())
    result = await verifier.verify(
        answer_text="Ihbar suresi dort haftadir.",
        evidence_chunks=[_match(chunk_id="c1", document_id="d1", text="Ihbar suresi dort haftadir.")],
        cited_chunk_ids=["c1"],
        min_similarity=0.99,
        min_overlap=0.20,
        min_supported_ratio=0.80,
    )
    assert result.method == "lexical_fallback"
    assert result.passed is True


@pytest.mark.asyncio
async def test_semantic_claim_verifier_detects_numeric_contradiction() -> None:
    answer = "Ihbar suresi sekiz haftadir."
    evidence = "Ihbar suresi dort haftadir."
    verifier = SemanticClaimVerifier(
        embedder=_MapEmbedder(
            {
                answer: [1.0, 0.0],
                evidence: [1.0, 0.0],
            }
        )
    )
    result = await verifier.verify(
        answer_text=answer,
        evidence_chunks=[_match(chunk_id="c1", document_id="d1", text=evidence)],
        cited_chunk_ids=["c1"],
        min_similarity=0.40,
        min_overlap=0.20,
        min_supported_ratio=0.80,
    )
    assert result.passed is False
    assert result.contradiction_count >= 1


def test_combine_claim_verification_modes() -> None:
    lexical = ClaimVerification(
        total_claims=1,
        supported_claims=0,
        support_ratio=0.0,
        unsupported_claims=["c1"],
        passed=False,
    )
    semantic_pass = type("Semantic", (), {
        "total_claims": 1,
        "supported_claims": 1,
        "support_ratio": 1.0,
        "unsupported_claims": [],
        "passed": True,
    })()

    and_result = combine_claim_verification(lexical=lexical, semantic=semantic_pass, mode="and")
    or_result = combine_claim_verification(lexical=lexical, semantic=semantic_pass, mode="or")
    sem_result = combine_claim_verification(lexical=lexical, semantic=semantic_pass, mode="semantic_only")

    assert and_result.passed is False
    assert or_result.passed is True
    assert sem_result.passed is True


def test_qwen_serving_config_prefers_sglang_when_selected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "qwen_serving_backend", "sglang", raising=False)
    monkeypatch.setattr(settings, "sglang_base_url", "http://localhost:30000/v1", raising=False)
    monkeypatch.setattr(settings, "openai_base_url", "http://localhost:8008/v1", raising=False)
    monkeypatch.setattr(settings, "qwen_served_model", "Qwen/Qwen3-Next-80B-A3B-Instruct", raising=False)
    cfg = resolve_qwen_serving_config()

    assert cfg.backend == "sglang"
    assert cfg.base_url == "http://localhost:30000/v1"
    assert cfg.health_url == "http://localhost:30000/health"


def test_qwen_serving_config_auto_uses_vllm_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "qwen_serving_backend", "auto", raising=False)
    monkeypatch.setattr(settings, "sglang_base_url", None, raising=False)
    monkeypatch.setattr(settings, "openai_base_url", "http://localhost:8008/v1", raising=False)
    monkeypatch.setattr(settings, "qwen_served_model", "Qwen/Qwen3-Next-80B-A3B-Instruct", raising=False)
    cfg = resolve_qwen_serving_config()

    assert cfg.backend == "vllm"
    assert cfg.health_url == "http://localhost:8008/models"


def test_pii_ner_fallback_detects_role_bound_person(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kvkk_presidio_enabled", False, raising=False)
    monkeypatch.setattr(settings, "kvkk_fail_closed_on_ner_error", False, raising=False)
    monkeypatch.setattr(settings, "kvkk_model_ner_fallback_enabled", True, raising=False)
    engine = PiiNerEngine()

    result = engine.detect(
        text="Muvekkil Ahmet Yilmaz dilekce verdi.",
        entities=["PERSON"],
        score_threshold=0.50,
    )
    tokens = {item.text for item in result}
    assert "Ahmet Yilmaz" in tokens
