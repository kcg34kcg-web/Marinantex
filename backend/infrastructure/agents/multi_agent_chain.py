"""
Multi-Agent Chain  —  Gap 3
============================
Implements a three-stage Researcher → Critic → Synthesizer pipeline for
Tier 4 queries when ``settings.llm_tier4_multi_agent_enabled = True``.

Pipeline:
    Stage 1 — Researcher:   Extracts key legal findings from retrieved sources.
    Stage 2 — Critic:       Validates citations; rejects hallucinated references.
    Stage 3 — Synthesizer:  Produces the final zero-trust answer with [K:N] markers.

Activation:
    Only runs when ALL of:
      - The routed tier == TIER4
      - settings.llm_tier4_multi_agent_enabled = True

The chain inherits the already-resolved TierDecision (provider, model_id,
is_reasoning_model) so it works transparently with both Claude and o3-mini.

JSON contract for inter-agent communication:
    ResearchResult carries:   summary, key_findings, relevant_source_indices,
                              legal_principles, contradictions
    CriticResult carries:     passed, confidence, issues, verified_findings, notes

Design goals:
    - Stateless per-request: instantiated freshly for every generate() call.
    - Graceful degradation: JSON parse failures fall back to raw text without
      breaking the pipeline — the Synthesizer always produces a final answer.
    - Provider-agnostic: works with Anthropic Claude, OpenAI GPT-4o, and
      OpenAI reasoning models (o3-mini / o1) via the same _call_llm() path.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, List

from langchain_core.messages import HumanMessage, SystemMessage

from infrastructure.config import settings

logger = logging.getLogger("babylexit.agents.multi_agent_chain")


# ============================================================================
# Turkish legal system prompts
# ============================================================================

_RESEARCHER_SYSTEM = """\
Sen bir Türk hukuku araştırma uzmanısın. Görevin, sağlanan hukuki kaynaklardan
ilgili bilgileri çıkarmak ve kullanıcının sorusunu yanıtlamak için en önemli
hukuki ilkeleri, maddeleri ve emsal kararları belirlemektir.

Her kaynağı dikkatlice analiz et:
- Soruyla en alakalı kaynakları belirle (indeks numaralarını sıfır-tabanlı ver)
- Temel hukuki bulguları ve sonuçları çıkar
- Uygulanabilir hukuki ilkeleri ve madde numaralarını listele
- Kaynaklardaki çelişkileri not et

Yanıtını YALNIZCA şu JSON formatında ver (başka açıklama ekleme):
{
  "summary": "Kaynakların kısa özeti",
  "key_findings": ["Bulgu 1", "Bulgu 2"],
  "relevant_source_indices": [0, 1],
  "legal_principles": ["İlke 1"],
  "contradictions": []
}\
"""

_CRITIC_SYSTEM = """\
Sen bir Türk hukuku atıf denetçisisin. Görevin, araştırma bulgularını
orijinal kaynaklara göre doğrulamak ve hallüsinasyonları tespit etmektir.

Şunları kontrol et:
1. Atıf yapılan madde numaraları kaynaklarda gerçekten var mı?
2. İddia edilen hukuki ilkeler kaynaklarda destekleniyor mu?
3. Tarihler, numaralar ve özel bilgiler doğru mu?
4. Kaynaklarda bulunmayan bilgiler iddia ediliyor mu?

Yanıtını YALNIZCA şu JSON formatında ver (başka açıklama ekleme):
{
  "passed": true,
  "confidence": 0.90,
  "issues": [],
  "verified_findings": ["Doğrulanmış bulgu"],
  "notes": "Genel değerlendirme"
}\
"""

_SYNTHESIZER_SYSTEM = """\
Sen bir Türk hukuku sentez uzmanısın. Araştırma ve denetim sonuçlarını
kullanarak kullanıcının sorusuna kapsamlı, sıfır güven ilkesine dayalı bir
yanıt hazırla.

ZORUNLU KURALLAR:
1. Yalnızca sağlanan kaynaklara dayan; [K:N] formatında atıf yap (K:1, K:2, vb.)
2. Her önemli iddia için kaynak numarası göster
3. Kaynaklarda bulunmayan bilgi ekleme; belirsizsen "Kaynaklarda bu bilgiye
   ulaşılamadı" yaz
4. Denetimde işaretlenen sorunları yanıtına yansıt
5. Türkçe yaz, hukuki terminoloji kullan
6. Yanıtın sonuna kısa bir sorumluluk reddi ekle\
"""


# ============================================================================
# Data classes
# ============================================================================

@dataclass
class ResearchResult:
    """
    Output of the Researcher agent stage.

    Attributes:
        summary:                  High-level synthesis of retrieved sources.
        key_findings:             List of concrete legal findings.
        relevant_source_indices:  Zero-based indices of the most relevant docs.
        legal_principles:         Identified statutory principles and article numbers.
        contradictions:           Notes on conflicting sources, if any.
        raw_response:             Verbatim LLM output — preserved for audit/debug.
    """
    summary: str = ""
    key_findings: List[str] = field(default_factory=list)
    relevant_source_indices: List[int] = field(default_factory=list)
    legal_principles: List[str] = field(default_factory=list)
    contradictions: List[str] = field(default_factory=list)
    raw_response: str = ""


@dataclass
class CriticResult:
    """
    Output of the Critic agent stage.

    Attributes:
        passed:             True if no hallucinations or citation errors detected.
        confidence:         Confidence score in [0.0, 1.0].
        issues:             List of specific citation/factual issues found.
        verified_findings:  Subset of research findings confirmed by the critic.
        notes:              Overall assessment comment.
        raw_response:       Verbatim LLM output — preserved for audit/debug.
    """
    passed: bool = True
    confidence: float = 1.0
    issues: List[str] = field(default_factory=list)
    verified_findings: List[str] = field(default_factory=list)
    notes: str = ""
    raw_response: str = ""


# ============================================================================
# Multi-agent chain
# ============================================================================

class MultiAgentChain:
    """
    Orchestrates the three-stage legal reasoning pipeline.

    The chain is instantiated per-request (not a singleton) to avoid shared
    state between concurrent requests.

    Args:
        decision:  TierDecision produced by LLMTieredRouter.decide().
                   Provides provider, model_id, and is_reasoning_model flag.
    """

    def __init__(self, decision: Any) -> None:  # TierDecision — avoid circular import
        self.decision = decision

    async def run(self, query: str, context: str) -> str:
        """
        Executes the full Researcher → Critic → Synthesizer pipeline.

        Args:
            query:   PII-masked user query.
            context: Numbered context block assembled from retrieved documents.

        Returns:
            str — Final synthesized answer with [K:N] citation markers.
        """
        logger.info(
            "MULTI_AGENT_START | model=%s | provider=%s",
            self.decision.model_id,
            self.decision.provider,
        )

        research = await self._run_researcher(query, context)
        logger.info(
            "RESEARCHER_DONE | findings=%d | sources=%d | contradictions=%d",
            len(research.key_findings),
            len(research.relevant_source_indices),
            len(research.contradictions),
        )

        critique = await self._run_critic(query, context, research)
        logger.info(
            "CRITIC_DONE | passed=%s | issues=%d | confidence=%.2f",
            critique.passed,
            len(critique.issues),
            critique.confidence,
        )

        answer = await self._run_synthesizer(query, context, research, critique)
        logger.info("SYNTHESIZER_DONE | answer_chars=%d", len(answer))

        return answer

    async def _run_researcher(self, query: str, context: str) -> ResearchResult:
        """
        Stage 1: Extract key legal findings from retrieved sources.

        The researcher scans all numbered context blocks for relevant statutes,
        precedents, and legal principles, then returns a structured JSON
        analysis of what was found.
        """
        user_content = (
            f"HUKUK KAYNAKLARI:\n\n{context}\n\n"
            f"---\n\n"
            f"ARAŞTIRMA SORUSU: {query}"
        )
        raw = await self._call_llm(_RESEARCHER_SYSTEM, user_content)

        result = ResearchResult(raw_response=raw)
        try:
            clean = _strip_code_fences(raw)
            data = json.loads(clean)
            result.summary = str(data.get("summary", ""))
            result.key_findings = list(data.get("key_findings", []))
            result.relevant_source_indices = list(data.get("relevant_source_indices", []))
            result.legal_principles = list(data.get("legal_principles", []))
            result.contradictions = list(data.get("contradictions", []))
        except (json.JSONDecodeError, AttributeError, TypeError) as exc:
            logger.warning("RESEARCHER_JSON_PARSE_FAIL | %s — using raw as summary", exc)
            result.summary = raw

        return result

    async def _run_critic(
        self,
        query: str,
        context: str,
        research: ResearchResult,
    ) -> CriticResult:
        """
        Stage 2: Validate citations and detect hallucinations.

        The critic cross-references the researcher's findings against the
        original numbered sources, flagging any claims that cannot be
        verified from the provided documents.
        """
        user_content = (
            f"ORIJINAL KAYNAKLAR:\n\n{context}\n\n"
            f"---\n\n"
            f"ARAŞTIRMA BULGULARI:\n"
            f"Özet: {research.summary}\n"
            f"Ana Bulgular: {', '.join(research.key_findings)}\n"
            f"Hukuki İlkeler: {', '.join(research.legal_principles)}\n\n"
            f"---\n\n"
            f"SORU: {query}\n\n"
            f"Yukarıdaki araştırma bulgularını orijinal kaynaklara göre doğrula."
        )
        raw = await self._call_llm(_CRITIC_SYSTEM, user_content)

        result = CriticResult(raw_response=raw)
        try:
            clean = _strip_code_fences(raw)
            data = json.loads(clean)
            result.passed = bool(data.get("passed", True))
            result.confidence = float(data.get("confidence", 1.0))
            result.issues = list(data.get("issues", []))
            result.verified_findings = list(data.get("verified_findings", []))
            result.notes = str(data.get("notes", ""))
        except (json.JSONDecodeError, AttributeError, TypeError) as exc:
            logger.warning(
                "CRITIC_JSON_PARSE_FAIL | %s — defaulting to passed=True", exc
            )
            result.passed = True
            result.notes = raw

        return result

    async def _run_synthesizer(
        self,
        query: str,
        context: str,
        research: ResearchResult,
        critique: CriticResult,
    ) -> str:
        """
        Stage 3: Produce the final zero-trust answer with [K:N] citation markers.

        The synthesizer combines the research findings and critic feedback into
        a coherent legal response, explicitly flagging any issues identified
        during the critic stage so the user is aware of low-confidence claims.
        """
        issues_block = ""
        if not critique.passed and critique.issues:
            issues_block = (
                f"\n\nDENETİM UYARILARI (güvenilirliği düşük bulgular):\n"
                + "\n".join(f"- {issue}" for issue in critique.issues)
            )

        user_content = (
            f"HUKUK KAYNAKLARI:\n\n{context}\n\n"
            f"---\n\n"
            f"ARAŞTIRMA ÖZETİ: {research.summary}\n"
            f"ANA BULGULAR: {', '.join(research.key_findings)}\n"
            f"HUKUKİ İLKELER: {', '.join(research.legal_principles)}"
            f"{issues_block}\n\n"
            f"---\n\n"
            f"SORU: {query}\n\n"
            f"Araştırma ve denetim sonuçlarına dayanarak kapsamlı bir hukuki yanıt yaz."
        )
        return await self._call_llm(_SYNTHESIZER_SYSTEM, user_content)

    async def _call_llm(self, system_prompt: str, user_content: str) -> str:
        """
        Invokes the LLM for a single agent stage.

        Reuses the TierDecision's provider/model_id/is_reasoning_model so the
        multi-agent chain is consistent with the main router's dispatch logic.

        For reasoning models (o3-mini / o1), the system prompt is merged into
        the user message using _build_reasoning_messages().
        """
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_content),
        ]

        if self.decision.is_reasoning_model:
            from infrastructure.llm.tiered_router import _build_reasoning_messages
            messages = _build_reasoning_messages(messages)
            from langchain_openai import ChatOpenAI
            model_kwargs: dict = {
                "max_completion_tokens": settings.llm_max_response_tokens,
            }
            if "o3" in self.decision.model_id:
                model_kwargs["reasoning_effort"] = settings.llm_tier4_reasoning_effort
            llm = ChatOpenAI(
                model=self.decision.model_id,
                api_key=settings.openai_api_key,  # type: ignore[arg-type]
                model_kwargs=model_kwargs,
            )
        elif self.decision.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            llm = ChatAnthropic(  # type: ignore[call-arg]
                model=self.decision.model_id,
                api_key=settings.anthropic_api_key,  # type: ignore[arg-type]
                max_tokens=settings.llm_max_response_tokens,
                temperature=0.0,
            )
        elif self.decision.provider == "openai":
            from langchain_openai import ChatOpenAI
            llm = ChatOpenAI(
                model=self.decision.model_id,
                api_key=settings.openai_api_key,  # type: ignore[arg-type]
                max_tokens=settings.llm_max_response_tokens,
                temperature=0.0,
            )
        else:
            raise RuntimeError(
                f"MultiAgentChain: unsupported provider '{self.decision.provider}'"
            )

        response = await llm.ainvoke(messages)
        return str(response.content)


# ============================================================================
# Pure helpers
# ============================================================================

def _strip_code_fences(text: str) -> str:
    """
    Removes Markdown code fences (```json ... ```) from an LLM response.

    Many LLMs wrap JSON output in triple-backtick fences even when instructed
    not to. This function strips them to allow clean json.loads() parsing.

    Pure function — no side effects, directly unit-testable.
    """
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        # Drop first line (``` or ```json) and last ``` line
        inner_lines = lines[1:]
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        return "\n".join(inner_lines)
    return stripped
