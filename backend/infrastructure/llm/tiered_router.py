"""
Tiered LLM Router  —  Step 4
==============================
Routes each RAG query to the cheapest LLM tier that can answer it.

Tiers:
    Tier 1  Groq  llama-3.3-70b-versatile       ~$0.001  /  1-2 s
    Tier 2  OpenAI  gpt-4o-mini                 ~$0.01   /  4-6 s
    Tier 3  OpenAI  gpt-4o                      ~$0.05   / 10-15 s
    Tier 4  Anthropic  claude-3-5-sonnet-...    ~$0.50+  / 30-90 s
            ── OR (settings.llm_tier4_use_reasoning=True) ──
            OpenAI  o3-mini                     ~$0.10+  / 15-60 s
            OpenAI  o1                          ~$1.00+  / 30-120 s

Routing algorithm (three independent signals):
    1. Context token count          → tier promotion if threshold exceeded
    2. Retrieved source count       → large source sets → higher tier
    3. Complex keyword detection    → AYM, İBK, hukuki memo, etc.

Fallback chain (keys unavailable):
    Tier 4 missing Anthropic key  →  Tier 3 (gpt-4o)
    Tier 1 missing Groq key       →  Tier 2 (gpt-4o-mini)
    If both OpenAI tiers unavailable  →  RuntimeError

PURE functions (classify_query_tier, estimate_tokens, has_complex_keywords)
are importable directly and have ZERO side effects — easily unit-testable.

IMPURE (LLMTieredRouter.generate) calls external APIs and should be mocked
in tests.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import IntEnum
from typing import List, Optional, Set, Tuple

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from infrastructure.config import settings

logger = logging.getLogger("babylexit.tiered_router")


# ============================================================================
# Constants
# ============================================================================

# Turkish legal complexity keywords → force Tier 3 or Tier 4
_TIER4_KEYWORDS: List[str] = [
    "aym",
    "anayasa mahkemesi",
    "içtihadı birleştirme",
    "ibk",
    "hukuki memo",
    "detaylı hukuki analiz",
    "iptal kararı",
    "anayasaya aykırılık",
    "bireysel başvuru",
]

_TIER3_KEYWORDS: List[str] = [
    "analiz et",
    "karşılaştır",
    "değerlendir",
    "hukuki görüş",
    "emsal karar",
    "içtihat",
    "yargıtay hgk",
    "genel kurul",
    "bölge adliye",
]


# ============================================================================
# Enumerations & Data Classes
# ============================================================================

class QueryTier(IntEnum):
    TIER1 = 1  # Groq — fast, cheap
    TIER2 = 2  # GPT-4o-mini — standard
    TIER3 = 3  # GPT-4o — advanced
    TIER4 = 4  # Claude 3.5 Sonnet — expert


@dataclass
class TierDecision:
    """
    Routing decision returned by `LLMTieredRouter.decide()`.

    Attributes:
        tier:           Final tier used (after fallback resolution).
        model_id:       LLM model identifier string.
        provider:       "groq" | "openai" | "anthropic".
        reason:         Human-readable explanation of the routing decision.
        fallback_used:  True when the originally classified tier was unavailable
                        and a different tier was selected automatically.
        original_tier:  The tier that was initially classified (before fallback).
    """

    tier: QueryTier
    model_id: str
    provider: str
    reason: str
    fallback_used: bool = False
    original_tier: Optional[QueryTier] = None
    is_reasoning_model: bool = False
    """True when the selected model is an OpenAI reasoning model (o1 / o3-mini).
    When True, ``_invoke()`` uses the reasoning-specific code path:
    no temperature parameter, max_completion_tokens instead of max_tokens,
    reasoning_effort for o3-mini, and system prompt merged into user message."""


# ============================================================================
# Pure helper functions — no side effects, fully testable
# ============================================================================

def estimate_tokens(text: str) -> int:
    """
    Rough token count estimate: 1 token ≈ 4 characters (works well for Turkish).

    Pure function — no imports, no state.  Intentionally avoids tiktoken to
    keep the routing path dependency-free and fast (~0 μs).
    """
    return max(1, len(text) // 4)


def has_tier4_keywords(query: str) -> bool:
    """Returns True if the query contains any Tier-4 complexity keywords."""
    lowered = query.lower()
    return any(kw in lowered for kw in _TIER4_KEYWORDS)


def has_tier3_keywords(query: str) -> bool:
    """Returns True if the query contains any Tier-3 complexity keywords."""
    lowered = query.lower()
    return any(kw in lowered for kw in _TIER3_KEYWORDS)


# ============================================================================
# Reasoning-model helpers  (Gap 2)
# ============================================================================

_REASONING_MODELS: frozenset = frozenset({
    "o1",
    "o1-mini",
    "o1-preview",
    "o3",
    "o3-mini",
})


def is_reasoning_model(model_id: str) -> bool:
    """
    Returns True when model_id identifies an OpenAI reasoning model (o1/o3 family).

    Strips provider prefix ("openai/") and fallback suffix ("+fallback") before
    lookup so all label formats are handled transparently.

    Examples:
        is_reasoning_model("o3-mini")               → True
        is_reasoning_model("openai/o3-mini")        → True
        is_reasoning_model("o3-mini+fallback")      → True
        is_reasoning_model("gpt-4o")                → False
        is_reasoning_model("claude-3-5-sonnet-...") → False

    Pure function — no side effects, directly unit-testable.
    """
    bare = model_id.split("/")[-1].split("+")[0]
    return bare in _REASONING_MODELS


def _build_reasoning_messages(
    messages: List[BaseMessage],
) -> List[BaseMessage]:
    """
    Converts a standard [SystemMessage, HumanMessage] list to reasoning-model format.

    OpenAI reasoning models (o1 / o3-mini) have restrictions on the system role:
      - Early o1 versions do NOT support the ``system`` role at all.
      - Merging system content into the user message is the safest, most
        forward-compatible approach across all o1 / o3 API versions.
      - All legal instructions are preserved; the reasoning model follows them.

    The merged message format:
        [SYSTEM INSTRUCTIONS]
        <system_prompt_text>

        <user_content>

    Args:
        messages : Standard message list (may include SystemMessage + HumanMessage).

    Returns:
        List containing a single HumanMessage with merged content.

    Pure function — no side effects, directly unit-testable.
    """
    system_text = ""
    user_text = ""
    for msg in messages:
        if isinstance(msg, SystemMessage):
            system_text = str(msg.content)
        elif isinstance(msg, HumanMessage):
            user_text = str(msg.content)
    if system_text:
        combined = f"[SYSTEM INSTRUCTIONS]\n{system_text}\n\n{user_text}"
    else:
        combined = user_text
    return [HumanMessage(content=combined)]


def classify_query_tier(
    query: str,
    context: str,
    source_count: int,
) -> QueryTier:
    """
    Classifies a query into a QueryTier based on three heuristic signals.

    Signal 1 — Context tokens (context size drives cost):
        ≤ tier1_max        → start at Tier 1
        ≤ tier2_max        → start at Tier 2
        ≤ tier3_max        → start at Tier 3
        > tier3_max        → start at Tier 4

    Signal 2 — Source count:
        > 6 sources        → at least Tier 2
        > 10 sources       → at least Tier 3

    Signal 3 — Keyword complexity:
        Tier-4 keywords    → at least Tier 4
        Tier-3 keywords    → at least Tier 3

    The MAXIMUM of all signals is the final tier.

    Args:
        query:        The user's legal question (plain text, post-PII-masking).
        context:      The assembled context block (from _build_context).
        source_count: Number of retrieved documents included in context.

    Returns:
        QueryTier
    """
    ctx_tokens = estimate_tokens(context)
    t1_max = settings.llm_tier1_max_context_tokens
    t2_max = settings.llm_tier2_max_context_tokens
    t3_max = settings.llm_tier3_max_context_tokens

    # Signal 1: context size
    if ctx_tokens > t3_max:
        size_tier = QueryTier.TIER4
    elif ctx_tokens > t2_max:
        size_tier = QueryTier.TIER3
    elif ctx_tokens > t1_max:
        size_tier = QueryTier.TIER2
    else:
        size_tier = QueryTier.TIER1

    # Signal 2: source count
    if source_count > 10:
        count_tier = QueryTier.TIER3
    elif source_count > 6:
        count_tier = QueryTier.TIER2
    else:
        count_tier = QueryTier.TIER1

    # Signal 3: keyword complexity
    if has_tier4_keywords(query):
        keyword_tier = QueryTier.TIER4
    elif has_tier3_keywords(query):
        keyword_tier = QueryTier.TIER3
    else:
        keyword_tier = QueryTier.TIER1

    final = max(size_tier, count_tier, keyword_tier)

    logger.debug(
        "classify_query_tier | ctx_tokens=%d | source_count=%d | "
        "size_tier=%d | count_tier=%d | keyword_tier=%d | final=%d",
        ctx_tokens,
        source_count,
        size_tier,
        count_tier,
        keyword_tier,
        final,
    )
    return final


# ============================================================================
# LLM Tiered Router
# ============================================================================

_TIER_META = {
    QueryTier.TIER1: {"provider": "groq",      "model_key": "llm_tier1_model"},
    QueryTier.TIER2: {"provider": "openai",    "model_key": "llm_tier2_model"},
    QueryTier.TIER3: {"provider": "openai",    "model_key": "llm_tier3_model"},
    QueryTier.TIER4: {"provider": "anthropic", "model_key": "llm_tier4_model"},
}

_FALLBACK_ORDER: List[Tuple[QueryTier, QueryTier]] = [
    # (unavailable tier, fallback to)
    (QueryTier.TIER4, QueryTier.TIER3),  # Anthropic missing → GPT-4o
    (QueryTier.TIER1, QueryTier.TIER2),  # Groq missing → GPT-4o-mini
]


class LLMTieredRouter:
    """
    Routes legal queries to the appropriate LLM tier and invokes the model.

    Lifecycle:
        1. Call `decide(query, context, source_count)` to get a TierDecision.
        2. Call `generate(query, context, source_count)` to get (answer, model_id).

    Fallback behaviour:
        - Tier 4 (Anthropic) unavailable → falls back to Tier 3 (GPT-4o)
        - Tier 1 (Groq) unavailable      → falls back to Tier 2 (GPT-4o-mini)
        - Both OpenAI tiers unavailable   → RuntimeError

    Thread-safety: stateless after __init__; safe as module-level singleton.
    """

    _SYSTEM_PROMPT: str = ""  # Overridden by zero_trust_builder.get_system_prompt() in _build_messages

    def __init__(self) -> None:
        self._available: Set[QueryTier] = self._discover_available_tiers()
        logger.info(
            "LLMTieredRouter ready | available_tiers=%s",
            sorted(int(t) for t in self._available),
        )

    # ── Tier discovery ────────────────────────────────────────────────────────

    def _discover_available_tiers(self) -> Set[QueryTier]:
        """
        Checks which tiers have API keys configured.
        Returns set of QueryTier values that are ready to use.
        """
        available: Set[QueryTier] = set()

        if settings.groq_api_key:
            available.add(QueryTier.TIER1)
            logger.info("Tier 1 (Groq / %s): AVAILABLE", settings.llm_tier1_model)
        else:
            logger.warning("Tier 1 (Groq): UNAVAILABLE — GROQ_API_KEY not set")

        if settings.openai_api_key:
            available.add(QueryTier.TIER2)
            available.add(QueryTier.TIER3)
            logger.info(
                "Tier 2 (%s) + Tier 3 (%s): AVAILABLE",
                settings.llm_tier2_model,
                settings.llm_tier3_model,
            )
        else:
            logger.warning("Tier 2/3 (OpenAI): UNAVAILABLE — OPENAI_API_KEY not set")

        if settings.llm_tier4_use_reasoning:
            # Reasoning mode: Tier 4 uses OpenAI o1/o3-mini — requires openai_api_key
            if settings.openai_api_key:
                available.add(QueryTier.TIER4)
                logger.info(
                    "Tier 4 (OpenAI Reasoning / %s, effort=%s): AVAILABLE",
                    settings.llm_tier4_reasoning_model,
                    settings.llm_tier4_reasoning_effort,
                )
            else:
                logger.info(
                    "Tier 4 (OpenAI Reasoning / %s): UNAVAILABLE — "
                    "OPENAI_API_KEY not set",
                    settings.llm_tier4_reasoning_model,
                )
        elif settings.anthropic_api_key:
            available.add(QueryTier.TIER4)
            logger.info("Tier 4 (Anthropic / %s): AVAILABLE", settings.llm_tier4_model)
        else:
            logger.info("Tier 4 (Anthropic): UNAVAILABLE — will fallback to Tier 3")

        if not available:
            raise RuntimeError(
                "LLMTieredRouter: No LLM provider keys configured. "
                "Set at least OPENAI_API_KEY or GROQ_API_KEY in .env."
            )

        return available

    # ── Decision logic ────────────────────────────────────────────────────────

    def decide(
        self,
        query: str,
        context: str,
        source_count: int,
    ) -> TierDecision:
        """
        Classifies the query and applies fallback to produce a TierDecision.

        Args:
            query:        User query (PII-masked).
            context:      Assembled context block from retrieved documents.
            source_count: Number of retrieved documents.

        Returns:
            TierDecision with final tier, model_id, provider, reason.
        """
        classified = classify_query_tier(query, context, source_count)
        return self._resolve(classified, query, context, source_count)

    def _resolve(
        self,
        desired: QueryTier,
        query: str,
        context: str,
        source_count: int,
    ) -> TierDecision:
        """
        Resolves a desired tier to an available tier, applying fallbacks.

        When ``settings.llm_tier4_use_reasoning=True`` and the desired tier is
        Tier 4, the reasoning model (o3-mini / o1) takes precedence over the
        standard Anthropic Claude path.
        """
        # ── Tier 4 reasoning override (Gap 2) ─────────────────────────────────────
        if (
            desired == QueryTier.TIER4
            and settings.llm_tier4_use_reasoning
            and desired in self._available
        ):
            model_id = settings.llm_tier4_reasoning_model
            ctx_tokens = estimate_tokens(context)
            reason = (
                f"tier=4 | REASONING/{model_id} | "
                f"effort={settings.llm_tier4_reasoning_effort} | "
                f"ctx_tokens≈{ctx_tokens} | sources={source_count}"
            )
            logger.info(
                "TIER4_REASONING | model=%s | effort=%s | ctx_tokens≈%d",
                model_id,
                settings.llm_tier4_reasoning_effort,
                ctx_tokens,
            )
            return TierDecision(
                tier=QueryTier.TIER4,
                model_id=model_id,
                provider="openai",
                reason=reason,
                is_reasoning_model=True,
            )

        # If desired tier is available → use it directly
        if desired in self._available:
            meta = _TIER_META[desired]
            model_id: str = getattr(settings, meta["model_key"])
            ctx_tokens = estimate_tokens(context)
            reason = (
                f"tier={desired} | ctx_tokens≈{ctx_tokens} | "
                f"sources={source_count}"
            )
            return TierDecision(
                tier=desired,
                model_id=model_id,
                provider=meta["provider"],
                reason=reason,
            )

        # Apply fallback chain
        for unavailable, fallback_tier in _FALLBACK_ORDER:
            if desired == unavailable and fallback_tier in self._available:
                meta = _TIER_META[fallback_tier]
                model_id = getattr(settings, meta["model_key"])
                reason = (
                    f"FALLBACK Tier {desired}→Tier {fallback_tier}: "
                    f"{meta['provider']} key missing"
                )
                logger.warning(
                    "TIER_FALLBACK | desired=%d | fallback=%d | reason=%s",
                    desired,
                    fallback_tier,
                    reason,
                )
                return TierDecision(
                    tier=fallback_tier,
                    model_id=model_id,
                    provider=meta["provider"],
                    reason=reason,
                    fallback_used=True,
                    original_tier=desired,
                )

        # If classified tier > available max, walk down
        for candidate in [QueryTier.TIER3, QueryTier.TIER2, QueryTier.TIER1]:
            if candidate in self._available and candidate <= desired:
                meta = _TIER_META[candidate]
                model_id = getattr(settings, meta["model_key"])
                reason = (
                    f"FALLBACK Tier {desired}→Tier {candidate}: "
                    f"walking down to nearest available"
                )
                logger.warning(
                    "TIER_FALLBACK_WALKDOWN | desired=%d | fallback=%d",
                    desired,
                    candidate,
                )
                return TierDecision(
                    tier=candidate,
                    model_id=model_id,
                    provider=meta["provider"],
                    reason=reason,
                    fallback_used=True,
                    original_tier=desired,
                )

        raise RuntimeError(
            f"LLMTieredRouter: No available tier for desired={desired}. "
            f"Available: {sorted(int(t) for t in self._available)}"
        )

    # ── LLM invocation ────────────────────────────────────────────────────────

    def _build_messages(self, query: str, context: str) -> List[BaseMessage]:
        """Constructs the message list for any LangChain chat model.

        Step 16: Uses ZeroTrustPromptBuilder to obtain the immutable zero-trust
        system prompt that enforces [K:N] numbered citation markers.
        Lazy import avoids circular dependency between llm and generation modules.
        """
        from infrastructure.generation.zero_trust_prompt import zero_trust_builder
        system_prompt = zero_trust_builder.get_system_prompt()
        user_content = (
            f"HUKUK KAYNAKLARI:\n\n{context}\n\n"
            f"---\n\nSORU: {query}"
        )
        return [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_content),
        ]

    async def generate(
        self,
        query: str,
        context: str,
        source_count: int,
    ) -> Tuple[str, str]:
        """
        Full pipeline: classify → decide (with fallback) → invoke LLM.

        Args:
            query:        User query (PII-masked).
            context:      Context block assembled from retrieved documents.
            source_count: Number of retrieved documents (for tier classification).

        Returns:
            (answer: str, model_label: str)
            model_label format: "{provider}/{model_id}[+fallback]"

        Raises:
            RuntimeError: If no LLM tier is available.
            Exception:    Re-raises any LLM provider error after logging.
        """
        decision = self.decide(query, context, source_count)

        logger.info(
            "LLM call | tier=%d | model=%s | provider=%s | fallback=%s",
            decision.tier,
            decision.model_id,
            decision.provider,
            decision.fallback_used,
        )

        fallback_suffix = "+fallback" if decision.fallback_used else ""

        if decision.tier == QueryTier.TIER4 and settings.llm_tier4_multi_agent_enabled:
            answer = await self._invoke_multi_agent(decision, query, context)
            model_label = (
                f"{decision.provider}/{decision.model_id}"
                f"{fallback_suffix}+multi-agent"
            )
        else:
            messages = self._build_messages(query, context)
            answer = await self._invoke(decision, messages)
            model_label = f"{decision.provider}/{decision.model_id}{fallback_suffix}"

        return answer, model_label

    async def _invoke(
        self,
        decision: TierDecision,
        messages: List[BaseMessage],
    ) -> str:
        """
        Calls the appropriate LangChain provider and returns the text answer.

        Provider dispatch:
            groq      → ChatGroq
            openai    → ChatOpenAI (standard; temperature=0.0)
            anthropic → ChatAnthropic

        When ``decision.is_reasoning_model=True`` the reasoning-specific code
        path (_invoke_reasoning) is used regardless of provider string.
        """
        # ── Reasoning model dispatch (Gap 2) ──────────────────────────────────
        if decision.is_reasoning_model:
            reasoning_msgs = _build_reasoning_messages(messages)
            return await self._invoke_reasoning(decision, reasoning_msgs)

        try:
            if decision.provider == "groq":
                from langchain_groq import ChatGroq

                llm = ChatGroq(
                    model=decision.model_id,
                    api_key=settings.groq_api_key,  # type: ignore[arg-type]
                    max_tokens=settings.llm_max_response_tokens,
                    temperature=0.0,
                )

            elif decision.provider == "openai":
                from langchain_openai import ChatOpenAI

                llm = ChatOpenAI(
                    model=decision.model_id,
                    api_key=settings.openai_api_key,  # type: ignore[arg-type]
                    max_tokens=settings.llm_max_response_tokens,
                    temperature=0.0,
                )

            elif decision.provider == "anthropic":
                from langchain_anthropic import ChatAnthropic

                llm = ChatAnthropic(  # type: ignore[call-arg]
                    model=decision.model_id,
                    api_key=settings.anthropic_api_key,  # type: ignore[arg-type]
                    max_tokens=settings.llm_max_response_tokens,
                    temperature=0.0,
                )

            else:
                raise RuntimeError(f"Unknown provider: {decision.provider!r}")

            response = await llm.ainvoke(messages)
            return str(response.content)

        except Exception as exc:
            logger.error(
                "LLM invocation failed | tier=%d | model=%s | error=%s",
                decision.tier,
                decision.model_id,
                exc,
                exc_info=True,
            )
            raise

    async def _invoke_reasoning(
        self,
        decision: TierDecision,
        messages: List[BaseMessage],
    ) -> str:
        """
        Invokes an OpenAI reasoning model (o1 / o3-mini) with reasoning-specific params.

        Key differences from the standard OpenAI chat-completion call:
          - ``temperature`` is NOT passed — reasoning models control their own sampling.
          - ``max_completion_tokens`` replaces ``max_tokens`` in the API payload.
          - ``reasoning_effort`` is passed for o3-mini ("low" | "medium" | "high").
          - No separate SystemMessage — content merged by _build_reasoning_messages().

        Args:
            decision : TierDecision with is_reasoning_model=True.
            messages : [HumanMessage] produced by _build_reasoning_messages().

        Returns:
            str — LLM answer text.

        Raises:
            Exception — Re-raises any OpenAI API error after logging.
        """
        try:
            from langchain_openai import ChatOpenAI

            model_kwargs: dict = {
                "max_completion_tokens": settings.llm_max_response_tokens,
            }
            # reasoning_effort is supported on o3-mini; not applicable to o1/o1-mini
            if "o3" in decision.model_id:
                model_kwargs["reasoning_effort"] = settings.llm_tier4_reasoning_effort

            llm = ChatOpenAI(
                model=decision.model_id,
                api_key=settings.openai_api_key,  # type: ignore[arg-type]
                model_kwargs=model_kwargs,
            )

            logger.info(
                "REASONING_LLM | model=%s | effort=%s | msg_chars=%d",
                decision.model_id,
                settings.llm_tier4_reasoning_effort if "o3" in decision.model_id else "N/A",
                sum(len(str(m.content)) for m in messages),
            )

            response = await llm.ainvoke(messages)
            return str(response.content)

        except Exception as exc:
            logger.error(
                "Reasoning LLM invocation failed | model=%s | error=%s",
                decision.model_id,
                exc,
                exc_info=True,
            )
            raise


    async def _invoke_multi_agent(
        self,
        decision: TierDecision,
        query: str,
        context: str,
    ) -> str:
        """
        Delegates Tier 4 inference to the Researcher → Critic → Synthesizer
        pipeline when ``settings.llm_tier4_multi_agent_enabled = True``.

        Args:
            decision : TierDecision with tier=TIER4.
            query    : PII-masked user query.
            context  : Assembled numbered context block.

        Returns:
            str — Final synthesized answer from MultiAgentChain.run().
        """
        from infrastructure.agents.multi_agent_chain import MultiAgentChain
        logger.info(
            "MULTI_AGENT_DISPATCH | model=%s | provider=%s",
            decision.model_id,
            decision.provider,
        )
        chain = MultiAgentChain(decision=decision)
        return await chain.run(query, context)


# ============================================================================
# Module-level singleton
# ============================================================================

llm_router = LLMTieredRouter()
