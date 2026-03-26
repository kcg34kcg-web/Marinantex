"""Tests for RAG v3 prompt registry loading and scenario resolution."""

from __future__ import annotations

import json

import pytest

from infrastructure.rag_v3.prompt_registry import (
    PromptRegistry,
    PromptRegistryError,
    compose_prompted_query,
)


def _registry_payload() -> dict:
    return {
        "registry_version": "rag_v3.prompt_registry.vtest",
        "required_scenarios": [
            "safe_intent",
            "mevzuat_explanation",
            "case_law_analysis",
            "contract_review",
            "draft_generation",
        ],
        "scenarios": {
            "safe_intent": {
                "prompt_version": "safe_intent.v1",
                "instruction": "Yalnizca operasyonel destek ver; hukuki gorus uretme ve adimlari net sirala.",
            },
            "mevzuat_explanation": {
                "prompt_version": "mevzuat.v1",
                "instruction": "Mevzuat aciklamasinda madde/fikra numarasini yaz ve kaynak disina cikma.",
            },
            "case_law_analysis": {
                "prompt_version": "case_law.v1",
                "instruction": "Ictihat analizinde olay, gerekce ve hukum ayrimini acikca belirt.",
            },
            "contract_review": {
                "prompt_version": "contract.v1",
                "instruction": "Sozlesme risklerini madde bazinda cikar ve belirsizlikleri acikla.",
            },
            "draft_generation": {
                "prompt_version": "draft.v1",
                "instruction": "Taslak metinde dogrulanmis ve yorum bolumlerini net ayir.",
            },
        },
    }


def test_prompt_registry_resolves_case_law_scenario(tmp_path) -> None:
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(_registry_payload(), ensure_ascii=False), encoding="utf-8")
    registry = PromptRegistry(registry_path=str(registry_path))

    scenario = registry.resolve(
        query="Yargitay kararlari arasindaki celiskiyi analiz et",
        task_type="analysis",
        source_types=["ictihat"],
        bypass_rag=False,
    )
    prompted = compose_prompted_query(base_query="test soru", scenario=scenario)

    assert scenario.scenario == "case_law_analysis"
    assert scenario.prompt_version == "case_law.v1"
    assert "SENARYO=case_law_analysis" in prompted


def test_prompt_registry_raises_on_missing_required_scenario(tmp_path) -> None:
    payload = _registry_payload()
    del payload["scenarios"]["contract_review"]
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    registry = PromptRegistry(registry_path=str(registry_path))
    with pytest.raises(PromptRegistryError):
        registry.load(force=True)
