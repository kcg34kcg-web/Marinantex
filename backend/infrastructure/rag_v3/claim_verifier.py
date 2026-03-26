"""Semantic claim verification for RAG v3 outputs."""

from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from typing import Optional

from infrastructure.embeddings.embedder import QueryEmbedder, query_embedder
from infrastructure.rag_v3.governance import ClaimVerification
from infrastructure.rag_v3.repository import RagV3ChunkMatch

_SENTENCE_SPLIT_RE = re.compile(r"(?:[\r\n]+|(?<=[.!?;])\s+)")
_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
_NEGATION_RE = re.compile(r"\b(degil|değil|yok|bulunmadi|bulunamad[iı]|olmadi|not|none|without)\b", re.IGNORECASE)

_NUMBER_WORDS = frozenset(
    {
        "sifir",
        "bir",
        "iki",
        "uc",
        "u\u00e7",
        "dort",
        "d\u00f6rt",
        "bes",
        "be\u015f",
        "alti",
        "alt\u0131",
        "yedi",
        "sekiz",
        "dokuz",
        "on",
        "yirmi",
        "otuz",
        "kirk",
        "k\u0131rk",
        "elli",
        "altmis",
        "altm\u0131\u015f",
        "yetmis",
        "yetmi\u015f",
        "seksen",
        "doksan",
        "yuz",
        "y\u00fcz",
        "bin",
    }
)


@dataclass(frozen=True)
class SemanticClaimVerification:
    total_claims: int
    supported_claims: int
    support_ratio: float
    unsupported_claims: list[str]
    contradiction_claims: list[str]
    contradiction_count: int
    passed: bool
    method: str = "embedding_cosine+lexical+contradiction"


class SemanticClaimVerifier:
    """Embedding-assisted claim verifier with lexical fallback."""

    def __init__(self, *, embedder: Optional[QueryEmbedder] = None) -> None:
        self._embedder = embedder or query_embedder

    async def verify(
        self,
        *,
        answer_text: str,
        evidence_chunks: list[RagV3ChunkMatch],
        cited_chunk_ids: list[str],
        min_similarity: float,
        min_overlap: float,
        min_supported_ratio: float,
    ) -> SemanticClaimVerification:
        claims = _split_claims(answer_text)
        claims = [item for item in claims if len(_tokenize(item)) >= 3]
        if not claims:
            return SemanticClaimVerification(
                total_claims=0,
                supported_claims=0,
                support_ratio=1.0,
                unsupported_claims=[],
                contradiction_claims=[],
                contradiction_count=0,
                passed=True,
            )

        evidence = _select_evidence_pool(evidence_chunks, cited_chunk_ids)
        if not evidence:
            return SemanticClaimVerification(
                total_claims=len(claims),
                supported_claims=0,
                support_ratio=0.0,
                unsupported_claims=[item[:200] for item in claims[:5]],
                contradiction_claims=[],
                contradiction_count=0,
                passed=False,
            )

        try:
            claim_vectors, evidence_vectors = await asyncio.gather(
                self._embedder.embed_texts(claims),
                self._embedder.embed_texts(evidence),
            )
            return _verify_with_embeddings(
                claims=claims,
                evidence=evidence,
                claim_vectors=claim_vectors,
                evidence_vectors=evidence_vectors,
                min_similarity=min_similarity,
                min_overlap=min_overlap,
                min_supported_ratio=min_supported_ratio,
            )
        except Exception:
            # Embedding provider might be unavailable; keep deterministic fallback.
            return _verify_lexical_only(
                claims=claims,
                evidence=evidence,
                min_overlap=min_overlap,
                min_supported_ratio=min_supported_ratio,
            )


def combine_claim_verification(
    *,
    lexical: ClaimVerification,
    semantic: SemanticClaimVerification,
    mode: str = "and",
) -> ClaimVerification:
    token = (mode or "and").strip().lower()
    if token == "or":
        passed = bool(lexical.passed or semantic.passed)
    elif token == "semantic_only":
        passed = bool(semantic.passed)
    else:
        passed = bool(lexical.passed and semantic.passed)
    total = max(int(lexical.total_claims), int(semantic.total_claims))
    supported = min(int(lexical.supported_claims), int(semantic.supported_claims))
    if token == "or":
        supported = max(int(lexical.supported_claims), int(semantic.supported_claims))
    ratio = _clamp01(supported / float(max(1, total)))
    unsupported = list(dict.fromkeys([*lexical.unsupported_claims, *semantic.unsupported_claims]))[:8]
    return ClaimVerification(
        total_claims=total,
        supported_claims=supported,
        support_ratio=ratio,
        unsupported_claims=unsupported,
        passed=passed,
    )


def _verify_with_embeddings(
    *,
    claims: list[str],
    evidence: list[str],
    claim_vectors: list[list[float]],
    evidence_vectors: list[list[float]],
    min_similarity: float,
    min_overlap: float,
    min_supported_ratio: float,
) -> SemanticClaimVerification:
    supported = 0
    unsupported: list[str] = []
    contradictions: list[str] = []
    for idx, claim in enumerate(claims):
        claim_tokens = _tokenize(claim)
        best_cos = 0.0
        best_overlap = 0.0
        best_evidence = ""
        for ev_idx, ev in enumerate(evidence):
            overlap = _token_overlap(claim_tokens, _tokenize(ev))
            if overlap > best_overlap:
                best_overlap = overlap
                best_evidence = ev
            cos = _cosine(claim_vectors[idx], evidence_vectors[ev_idx])
            if cos > best_cos:
                best_cos = cos
                best_evidence = ev
        contradiction = _is_contradiction(claim, best_evidence)
        ok = ((best_overlap >= _clamp01(min_overlap)) or (best_cos >= _clamp01(min_similarity))) and (not contradiction)
        if ok:
            supported += 1
        elif len(unsupported) < 5:
            unsupported.append(claim[:200])
        if contradiction and len(contradictions) < 5:
            contradictions.append(claim[:200])
    total = len(claims)
    ratio = _clamp01(supported / float(max(1, total)))
    passed = (ratio >= _clamp01(min_supported_ratio)) and (len(contradictions) == 0)
    return SemanticClaimVerification(
        total_claims=total,
        supported_claims=supported,
        support_ratio=ratio,
        unsupported_claims=unsupported,
        contradiction_claims=contradictions,
        contradiction_count=len(contradictions),
        passed=passed,
    )


def _verify_lexical_only(
    *,
    claims: list[str],
    evidence: list[str],
    min_overlap: float,
    min_supported_ratio: float,
) -> SemanticClaimVerification:
    supported = 0
    unsupported: list[str] = []
    threshold = _clamp01(min_overlap)
    evidence_tokens = [_tokenize(item) for item in evidence]
    contradictions: list[str] = []
    for claim in claims:
        claim_tokens = _tokenize(claim)
        best = 0.0
        best_idx = -1
        for idx, ev in enumerate(evidence_tokens):
            overlap = _token_overlap(claim_tokens, ev)
            if overlap > best:
                best = overlap
                best_idx = idx
        contradiction = False
        if best_idx >= 0 and best_idx < len(evidence):
            contradiction = _is_contradiction(claim, evidence[best_idx])
        if best >= threshold and (not contradiction):
            supported += 1
        elif len(unsupported) < 5:
            unsupported.append(claim[:200])
        if contradiction and len(contradictions) < 5:
            contradictions.append(claim[:200])
    total = len(claims)
    ratio = _clamp01(supported / float(max(1, total)))
    return SemanticClaimVerification(
        total_claims=total,
        supported_claims=supported,
        support_ratio=ratio,
        unsupported_claims=unsupported,
        contradiction_claims=contradictions,
        contradiction_count=len(contradictions),
        passed=((ratio >= _clamp01(min_supported_ratio)) and len(contradictions) == 0),
        method="lexical_fallback",
    )


def _split_claims(answer: str) -> list[str]:
    parts = [part.strip() for part in _SENTENCE_SPLIT_RE.split(answer or "") if part.strip()]
    return parts[:40]


def _select_evidence_pool(evidence_chunks: list[RagV3ChunkMatch], cited_chunk_ids: list[str]) -> list[str]:
    by_id = {row.chunk_id: row.chunk_text for row in evidence_chunks if row.chunk_id and row.chunk_text}
    selected: list[str] = []
    for chunk_id in cited_chunk_ids:
        text = by_id.get(chunk_id)
        if text:
            selected.append(text)
    if selected:
        return selected
    return [row.chunk_text for row in evidence_chunks[:12] if row.chunk_text]


def _tokenize(text: str) -> set[str]:
    return {tok.lower() for tok in _TOKEN_RE.findall(text or "") if len(tok) >= 3}


def _token_overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return float(len(a & b)) / float(max(1, len(a)))


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += float(x) * float(y)
        norm_a += float(x) * float(x)
        norm_b += float(y) * float(y)
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return _clamp01(dot / (math.sqrt(norm_a) * math.sqrt(norm_b)))


def _is_contradiction(claim: str, evidence: str) -> bool:
    claim_text = (claim or "").strip()
    evidence_text = (evidence or "").strip()
    if not claim_text or not evidence_text:
        return False

    claim_tokens = _tokenize(claim_text)
    evidence_tokens = _tokenize(evidence_text)
    overlap = _token_overlap(claim_tokens, evidence_tokens)
    if overlap < 0.25:
        return False

    claim_nums = _extract_numeric_markers(claim_text)
    evidence_nums = _extract_numeric_markers(evidence_text)
    if claim_nums and evidence_nums and claim_nums.isdisjoint(evidence_nums) and overlap >= 0.40:
        return True

    claim_neg = bool(_NEGATION_RE.search(claim_text))
    evidence_neg = bool(_NEGATION_RE.search(evidence_text))
    if claim_neg != evidence_neg and overlap >= 0.35:
        return True
    return False


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)


def _extract_numeric_markers(text: str) -> set[str]:
    body = (text or "").lower()
    out = {item.replace(",", ".") for item in _NUM_RE.findall(body)}
    for token in _TOKEN_RE.findall(body):
        if token in _NUMBER_WORDS:
            out.add(token)
    return out


semantic_claim_verifier = SemanticClaimVerifier()
