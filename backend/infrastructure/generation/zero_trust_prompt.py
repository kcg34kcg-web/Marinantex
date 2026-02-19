"""
Zero-Trust Prompt Builder  —  Step 16
======================================
Enforces grounded (Zero-Trust) generation by:

  1. Numbering every context document [K:1] … [K:N] before they reach the LLM.
  2. Providing an ironclad system prompt that forbids ungrounded claims.
  3. Parsing the LLM's raw answer to extract per-sentence citation markers [K:N].
  4. Validating that every meaningful sentence is anchored to at least one source.

Design principles:
  - PURE functions (build_system_prompt, build_numbered_context, parse_answer_sentences,
    validate_grounding) have ZERO side-effects and are fully unit-testable.
  - The only stateful class ZeroTrustPromptBuilder is a thin, dependency-injectable
    wrapper around the pure functions — safe as a module-level singleton.
  - All citation markers use the [K:N] format (K = Kaynak, N = 1-based index)
    to avoid collision with Markdown footnotes or other bracket patterns.

Citation marker format:
  - Single source    : [K:1]
  - Multiple sources : [K:1][K:3]
  - Regex pattern    : \\[K:(\\d+)\\]

Ungrouped sentence detection:
  - Sentences of ≥ MIN_SENTENCE_CHARS characters without any [K:N] marker are
    flagged as "ungrouped" (potentially hallucinated).
  - The system logs a warning; it does NOT hard-fail (the LLM sometimes joins
    adjacent citation markers to the previous sentence).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Set, Tuple

logger = logging.getLogger("babylexit.zero_trust_prompt")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CITATION_RE = re.compile(r"\[K:(\d+)\]")

# Sentence boundaries: period/exclamation/question followed by whitespace or EOS
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+")

# Minimum character length for a sentence fragment to be evaluated for citation
MIN_SENTENCE_CHARS: int = 20


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ParsedSentence:
    """
    A single sentence extracted from the LLM's raw answer.

    Attributes:
        sentence_id : 0-based ordinal of this sentence in the answer.
        text        : Raw sentence text (including [K:N] markers).
        source_refs : 1-based source indices referenced by [K:N] markers.
                      Empty set → sentence has no citation.
    """
    sentence_id: int
    text: str
    source_refs: frozenset = field(default_factory=frozenset)


@dataclass(frozen=True)
class GroundingReport:
    """
    Summary of citation coverage for an LLM answer.

    Attributes:
        total_sentences        : Total number of non-trivial sentences.
        grounded_sentences     : Sentences carrying ≥1 valid citation.
        ungrouped_sentences    : Sentences without any citation.
        invalid_refs           : [K:N] references whose N exceeds source_count.
        grounding_ratio        : grounded / total (1.0 = fully grounded).
        is_fully_grounded      : True when grounding_ratio == 1.0.
    """
    total_sentences: int
    grounded_sentences: int
    ungrouped_sentences: int
    invalid_refs: List[int]
    grounding_ratio: float
    is_fully_grounded: bool


# ---------------------------------------------------------------------------
# Pure helper functions
# ---------------------------------------------------------------------------

def build_system_prompt() -> str:
    """
    Returns the immutable Zero-Trust system prompt.

    This prompt is injected as the SystemMessage for EVERY LLM call.
    It forbids ungrounded generation and mandates [K:N] citation markers.

    Returns:
        Turkish-language system prompt string.
    """
    return (
        "Sen Türk hukuku alanında uzman, SIFIR GÜVEN (Zero-Trust) ilkesiyle "
        "çalışan bir yapay zeka hukuk asistanısın.\n\n"
        "### SIFIR GÜVEN ÜRETİM KURALLARI — KESİN VE İHLAL EDİLEMEZ:\n\n"
        "1. **YALNIZCA** aşağıda numaralandırılmış HUKUK KAYNAKLARI bölümündeki "
        "belgelere dayanarak cevap ver. Bu belgeler dışında hiçbir bilgi ekleme.\n\n"
        "2. **Her cümlenin sonuna**, dayandığı kaynağın numarasını [K:N] formatında "
        "yaz (N = kaynak numarası). Örnek: \"...hükmü uygulanır. [K:1]\"\n\n"
        "3. **Birden fazla kaynağa** dayanıyorsan, tüm numaraları art arda yaz: "
        "[K:1][K:3]\n\n"
        "4. Kaynakta **OLMAYAN** bir bilgiyi KESİNLİKLE ekleme, tahmin yürütme, "
        "içtihat icat etme.\n\n"
        "5. Cevap veremiyorsan şunu yaz ve dur: "
        "\"Mevcut kaynaklarda bu konuda yeterli bilgi bulunamadı.\"\n\n"
        "6. Yanıtının sonunda **KULLANILAN KAYNAKLAR** başlığı altında "
        "atıfta bulunduğun kaynak numaralarını ve kısa atıf bilgisini listele.\n\n"
        "7. Kaynaklar bölümünde listelenen numaralar dışında ([K:99] gibi) "
        "hiçbir kaynak numarası icat etme."
    )


def build_numbered_context(citations: List[str], contents: List[str]) -> str:
    """
    Formats retrieved documents as a numbered context block for the LLM.

    Each document is prefixed with [K:N] so the LLM can reference it by number.

    Args:
        citations : Short citation strings (e.g. "Yargıtay 9HD, E.2023/1234").
                    Length must equal len(contents).
        contents  : Document content strings.

    Returns:
        Formatted numbered context block as a single string.

    Raises:
        ValueError: If citations and contents have different lengths.
    """
    if len(citations) != len(contents):
        raise ValueError(
            f"citations ({len(citations)}) and contents ({len(contents)}) "
            "must have the same length."
        )
    if not citations:
        return ""

    blocks: List[str] = []
    for idx, (cit, content) in enumerate(zip(citations, contents), start=1):
        header = f"[K:{idx}] KAYNAK: {cit or f'Kaynak {idx}'}"
        blocks.append(f"{header}\n{content.strip()}")

    return "\n\n---\n\n".join(blocks)


def parse_answer_sentences(
    raw_answer: str,
    source_count: int,
) -> Tuple[List[ParsedSentence], List[int]]:
    """
    Splits the LLM's raw answer into sentences and extracts citation markers.

    Algorithm:
      1. Split on sentence boundaries (. ! ? followed by whitespace or EOS).
      2. Merge any fragment that contains ONLY [K:N] markers (no substantive
         text) back into the preceding fragment.  This handles the common LLM
         pattern where citations follow the period: "...hükmü uygulanır. [K:1]"
      3. For each merged fragment, extract all [K:N] markers.
      4. Validate N is within [1, source_count].
      5. Return (sentences, invalid_refs).

    Args:
        raw_answer   : Full raw text returned by the LLM.
        source_count : Number of documents that were provided as context.
                       Used to flag out-of-range citation markers as invalid.

    Returns:
        sentences    : List of ParsedSentence (one per non-empty fragment).
        invalid_refs : List of ref numbers that exceed source_count.
    """
    if not raw_answer:
        return [], []

    # Step 1: Split on sentence boundaries
    fragments = _SENTENCE_SPLIT_RE.split(raw_answer.strip())

    # Step 2: Merge pure citation fragments back into the preceding sentence.
    # A fragment is "pure citation" if stripping all [K:N] markers leaves
    # nothing but whitespace / punctuation.
    merged: List[str] = []
    for frag in fragments:
        frag = frag.strip()
        if not frag:
            continue
        without_markers = _CITATION_RE.sub("", frag).strip().strip(".,;:!?")
        if not without_markers and merged:
            # Pure citation markers — attach to the previous fragment
            merged[-1] = merged[-1] + " " + frag
        else:
            merged.append(frag)

    # Step 3-5: Parse each merged fragment
    sentences: List[ParsedSentence] = []
    invalid_refs: List[int] = []
    sid = 0

    for fragment in merged:
        fragment = fragment.strip()
        if not fragment:
            continue

        # Extract all [K:N] markers
        raw_refs = [int(m) for m in _CITATION_RE.findall(fragment)]

        # Validate range
        valid_refs: Set[int] = set()
        for ref in raw_refs:
            if 1 <= ref <= source_count:
                valid_refs.add(ref)
            else:
                if ref not in invalid_refs:
                    invalid_refs.append(ref)

        sentences.append(
            ParsedSentence(
                sentence_id=sid,
                text=fragment,
                source_refs=frozenset(valid_refs),
            )
        )
        sid += 1

    return sentences, invalid_refs


def validate_grounding(
    sentences: List[ParsedSentence],
    source_count: int,
    invalid_refs: List[int],
) -> GroundingReport:
    """
    Analyses citation coverage of the parsed sentences.

    A sentence is "non-trivial" if it is ≥ MIN_SENTENCE_CHARS characters long.
    Non-trivial sentences without any citation are "ungrouped" (potentially
    ungrounded).

    Args:
        sentences    : Output of parse_answer_sentences().
        source_count : Number of context documents (for denominator guard).
        invalid_refs : Out-of-range citation references detected during parsing.

    Returns:
        GroundingReport summarising citation coverage.
    """
    non_trivial = [s for s in sentences if len(s.text) >= MIN_SENTENCE_CHARS]
    total = len(non_trivial)

    if total == 0:
        return GroundingReport(
            total_sentences=0,
            grounded_sentences=0,
            ungrouped_sentences=0,
            invalid_refs=invalid_refs,
            grounding_ratio=1.0,
            is_fully_grounded=True,
        )

    grounded = sum(1 for s in non_trivial if s.source_refs)
    ungrouped = total - grounded
    ratio = grounded / total

    if ungrouped:
        logger.warning(
            "ZERO_TRUST_GROUNDING | ungrouped=%d/%d | ratio=%.2f | "
            "invalid_refs=%s",
            ungrouped,
            total,
            ratio,
            invalid_refs,
        )

    return GroundingReport(
        total_sentences=total,
        grounded_sentences=grounded,
        ungrouped_sentences=ungrouped,
        invalid_refs=invalid_refs,
        grounding_ratio=ratio,
        is_fully_grounded=(ungrouped == 0 and not invalid_refs),
    )


# ---------------------------------------------------------------------------
# ZeroTrustPromptBuilder — thin injectable wrapper
# ---------------------------------------------------------------------------

class ZeroTrustPromptBuilder:
    """
    Stateless orchestrator for Zero-Trust prompt construction and answer parsing.

    Usage (production):
        builder = ZeroTrustPromptBuilder()
        system_prompt = builder.get_system_prompt()
        numbered_ctx  = builder.build_context(citations, contents)
        sentences, inv = builder.parse(raw_answer, source_count)
        report        = builder.validate(sentences, source_count, inv)

    Usage (test — override with custom system_prompt_fn):
        builder = ZeroTrustPromptBuilder(
            system_prompt_fn=lambda: "Test system prompt"
        )
    """

    def __init__(
        self,
        system_prompt_fn=None,
    ) -> None:
        self._system_prompt_fn = system_prompt_fn or build_system_prompt

    def get_system_prompt(self) -> str:
        """Returns the immutable Zero-Trust system prompt."""
        return self._system_prompt_fn()

    def build_context(
        self,
        citations: List[str],
        contents: List[str],
    ) -> str:
        """
        Formats retrieved documents as a numbered [K:N] context block.

        Args:
            citations : Short citation strings for each document.
            contents  : Chunk text of each document.

        Returns:
            Numbered context block string.
        """
        return build_numbered_context(citations, contents)

    def parse(
        self,
        raw_answer: str,
        source_count: int,
    ) -> Tuple[List[ParsedSentence], List[int]]:
        """
        Parses the LLM's raw answer into sentences with citation refs.

        Returns:
            (sentences, invalid_refs)
        """
        return parse_answer_sentences(raw_answer, source_count)

    def validate(
        self,
        sentences: List[ParsedSentence],
        source_count: int,
        invalid_refs: List[int],
    ) -> GroundingReport:
        """Validates citation coverage and returns a GroundingReport."""
        return validate_grounding(sentences, source_count, invalid_refs)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

zero_trust_builder = ZeroTrustPromptBuilder()
