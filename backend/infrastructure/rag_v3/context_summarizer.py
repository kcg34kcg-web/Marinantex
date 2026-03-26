"""Context compression policy for RAG v3 query pipeline."""

from __future__ import annotations

import re
from dataclasses import dataclass

from infrastructure.rag_v3.repository import RagV3ChunkMatch

_SENTENCE_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
_TOKEN_RE = re.compile(r"[A-Za-z0-9_\u00c0-\u024f]+")


@dataclass(frozen=True)
class ContextCompressionMeta:
    summarized_count: int
    total_count: int
    estimated_tokens_saved: int


class RagV3ContextSummarizer:
    """Compresses lower-ranked chunks while preserving high-ranked evidence."""

    def compress_chunk_text(
        self,
        *,
        chunk_text: str,
        query: str,
        target_tokens: int,
    ) -> str:
        text = " ".join((chunk_text or "").split()).strip()
        if not text:
            return ""
        max_chars = max(120, target_tokens * 4)
        if len(text) <= max_chars:
            return text

        query_tokens = {tok.lower() for tok in _TOKEN_RE.findall(query or "") if len(tok) >= 3}
        sentences = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
        if not sentences:
            return text[:max_chars]

        scored: list[tuple[float, str]] = []
        for sent in sentences:
            sent_tokens = {tok.lower() for tok in _TOKEN_RE.findall(sent) if len(tok) >= 3}
            overlap = 0.0
            if query_tokens and sent_tokens:
                overlap = float(len(query_tokens & sent_tokens)) / float(max(1, len(query_tokens)))
            score = (0.70 * overlap) + (0.30 * min(1.0, len(sent) / 240.0))
            scored.append((score, sent))
        scored.sort(key=lambda item: item[0], reverse=True)

        out: list[str] = []
        size = 0
        for _, sentence in scored:
            if size >= max_chars:
                break
            out.append(sentence)
            size += len(sentence) + 1
        compact = " ".join(out).strip()
        if not compact:
            compact = text[:max_chars]
        if len(compact) > max_chars:
            compact = compact[:max_chars].rstrip()
        return compact

    def summarize_matches_for_context(
        self,
        *,
        matches: list[RagV3ChunkMatch],
        query: str,
        primary_count: int,
        target_tokens: int,
        enabled: bool,
    ) -> tuple[dict[str, str], ContextCompressionMeta]:
        if not enabled or not matches:
            return {}, ContextCompressionMeta(
                summarized_count=0,
                total_count=len(matches),
                estimated_tokens_saved=0,
            )

        replacements: dict[str, str] = {}
        summarized = 0
        tokens_saved = 0
        for idx, row in enumerate(matches, start=1):
            if idx <= max(1, int(primary_count)):
                continue
            original = " ".join((row.chunk_text or "").split()).strip()
            if not original:
                continue
            before_tokens = _estimate_tokens(original)
            compressed = self.compress_chunk_text(
                chunk_text=original,
                query=query,
                target_tokens=target_tokens,
            )
            after_tokens = _estimate_tokens(compressed)
            if compressed and compressed != original:
                replacements[row.chunk_id] = compressed
                summarized += 1
                tokens_saved += max(0, before_tokens - after_tokens)

        return replacements, ContextCompressionMeta(
            summarized_count=summarized,
            total_count=len(matches),
            estimated_tokens_saved=max(0, tokens_saved),
        )


def _estimate_tokens(text: str) -> int:
    body = (text or "").strip()
    if not body:
        return 0
    return max(1, int(len(body) / 4))


rag_v3_context_summarizer = RagV3ContextSummarizer()

