"""Planner tests for explicit legal query planning contract."""

from __future__ import annotations

from datetime import date

from infrastructure.rag_v3.planner import RagV3QueryPlanner


def test_planner_emits_explicit_legal_plan_fields() -> None:
    planner = RagV3QueryPlanner()
    plan = planner.plan(
        query='AYM kararını karşılaştır, "hak ihlali" ifadesini esas al, madde 17 fikra 1 için tamami',
        top_k=10,
        dual_temporal_requested=False,
        jurisdiction="TR",
        as_of_date=date(2024, 1, 1),
        event_date=None,
        decision_date=None,
    )

    assert plan.task_type in {"comparison", "analysis", "lookup"}
    assert plan.retrieval_mode in {"hybrid", "exact_hybrid", "sparse", "dual_temporal_hybrid"}
    assert isinstance(plan.decompose_steps, list)
    assert "run_exact_legal_lane" in plan.decompose_steps
    assert isinstance(plan.temporal_scope, dict)
    assert plan.temporal_scope.get("as_of_date") == "2024-01-01"
    assert plan.scope_split == ["TR"]
    assert "AYM" in plan.authority_constraints
    assert plan.exact_search_required is True
    assert plan.exhaustive_mode_required is True


def test_planner_uses_dual_temporal_mode_when_requested() -> None:
    planner = RagV3QueryPlanner()
    plan = planner.plan(
        query="Madde 7 olay ve karar tarihi arasindaki fark nedir?",
        top_k=8,
        dual_temporal_requested=True,
        jurisdiction="TR",
        as_of_date=None,
        event_date=date(2010, 1, 1),
        decision_date=date(2020, 1, 1),
    )

    assert plan.retrieval_mode == "dual_temporal_hybrid"
    assert "run_event_and_decision_temporal_passes" in plan.decompose_steps
    assert plan.temporal_scope.get("event_date") == "2010-01-01"
    assert plan.temporal_scope.get("decision_date") == "2020-01-01"


def test_planner_classifies_pii_redaction_and_disables_reranker() -> None:
    planner = RagV3QueryPlanner()
    plan = planner.plan(
        query="Bu metindeki TC kimlik ve IBAN bilgilerini KVKK icin anonimlestir.",
        top_k=8,
        dual_temporal_requested=False,
    )

    assert plan.query_class == "pii_redaction"
    assert plan.reranker_enabled is False
    assert plan.exact_search_enabled is False
    assert "sparse" in plan.route_targets


def test_planner_classifies_citation_verification_and_raises_rerank_depth() -> None:
    planner = RagV3QueryPlanner()
    plan = planner.plan(
        query="Bu iddiayi kaynakla dogrula ve citation kontrolu yap.",
        top_k=8,
        dual_temporal_requested=False,
    )

    assert plan.query_class == "citation_verification"
    assert plan.exact_search_required is True
    assert plan.rerank_top_n >= 8
    assert "exact" in plan.route_targets
