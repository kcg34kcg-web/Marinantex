"""Prompt registry loader and scenario resolver for RAG v3."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from infrastructure.config import settings

_DEFAULT_PATH = "prompts/rag_v3/registry.json"
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT.parent
_CASE_LAW_RE = re.compile(r"\b(?:ictihat|yargitay|danistay|aym|karar)\b", re.IGNORECASE)
_CONTRACT_RE = re.compile(r"\b(?:sozlesme|kloz|ek protokol|taahhutname)\b", re.IGNORECASE)
_DRAFT_RE = re.compile(r"\b(?:taslak|dilekce|mukteza|memo|gorus taslagi)\b", re.IGNORECASE)


@dataclass(frozen=True)
class PromptScenario:
    scenario: str
    prompt_version: str
    instruction: str
    registry_version: str


class PromptRegistryError(RuntimeError):
    pass


class PromptRegistry:
    def __init__(self, *, registry_path: Optional[str] = None) -> None:
        configured = registry_path or str(getattr(settings, "rag_v3_prompt_registry_path", "") or "").strip()
        path = configured or _DEFAULT_PATH
        self._path = self._resolve_path(path)
        self._cache: dict[str, Any] | None = None

    @property
    def path(self) -> Path:
        return self._path

    @staticmethod
    def _resolve_path(path: str) -> Path:
        raw = Path(path)
        if raw.is_absolute():
            return raw.resolve()

        candidates = [
            (_BACKEND_ROOT / raw).resolve(),
            (_REPO_ROOT / raw).resolve(),
            (Path.cwd() / raw).resolve(),
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return candidates[0]

    def load(self, *, force: bool = False) -> dict[str, Any]:
        if self._cache is not None and not force:
            return self._cache
        if not self._path.exists():
            raise PromptRegistryError(f"Prompt registry missing: {self._path}")
        with open(self._path, encoding="utf-8") as handle:
            payload = json.load(handle)
        validate_prompt_registry(payload)
        self._cache = payload
        return payload

    def resolve(
        self,
        *,
        query: str,
        task_type: str,
        source_types: list[str],
        bypass_rag: bool,
    ) -> PromptScenario:
        payload = self.load()
        registry_version = str(payload.get("registry_version") or "unknown")
        scenarios = dict(payload.get("scenarios") or {})

        scenario = "mevzuat_explanation"
        query_text = str(query or "")
        source_hint = " ".join(source_types).lower()

        if bypass_rag:
            scenario = "safe_intent"
        elif _DRAFT_RE.search(query_text):
            scenario = "draft_generation"
        elif _CONTRACT_RE.search(query_text) or "contract" in source_hint or "sozlesme" in source_hint:
            scenario = "contract_review"
        elif _CASE_LAW_RE.search(query_text) or task_type in {"analysis", "comparison"}:
            scenario = "case_law_analysis"

        config = dict(scenarios.get(scenario) or {})
        if not config:
            raise PromptRegistryError(f"Prompt scenario not found: {scenario}")

        return PromptScenario(
            scenario=scenario,
            prompt_version=str(config.get("prompt_version") or f"{scenario}.unknown"),
            instruction=str(config.get("instruction") or "").strip(),
            registry_version=registry_version,
        )


def validate_prompt_registry(payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise PromptRegistryError("Prompt registry must be a JSON object.")
    if not isinstance(payload.get("registry_version"), str) or not str(payload.get("registry_version")).strip():
        raise PromptRegistryError("Prompt registry requires non-empty registry_version.")

    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, dict) or not scenarios:
        raise PromptRegistryError("Prompt registry requires non-empty scenarios object.")

    required = payload.get("required_scenarios")
    if not isinstance(required, list) or not required:
        raise PromptRegistryError("Prompt registry requires required_scenarios list.")

    for key in required:
        token = str(key or "").strip()
        if not token:
            raise PromptRegistryError("required_scenarios contains empty key.")
        scenario_cfg = scenarios.get(token)
        if not isinstance(scenario_cfg, dict):
            raise PromptRegistryError(f"Missing scenario config: {token}")
        prompt_version = str(scenario_cfg.get("prompt_version") or "").strip()
        instruction = str(scenario_cfg.get("instruction") or "").strip()
        if not prompt_version:
            raise PromptRegistryError(f"Scenario prompt_version missing: {token}")
        if len(instruction) < 20:
            raise PromptRegistryError(f"Scenario instruction too short: {token}")


def compose_prompted_query(*, base_query: str, scenario: PromptScenario) -> str:
    query = str(base_query or "").strip()
    instruction = scenario.instruction.strip()
    if not instruction:
        return query
    return (
        f"SENARYO={scenario.scenario}\\n"
        f"PROMPT_VERSION={scenario.prompt_version}\\n"
        f"TALIMAT={instruction}\\n"
        f"SORU={query}"
    )


prompt_registry = PromptRegistry()
