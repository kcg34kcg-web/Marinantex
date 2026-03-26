"""Doc-level shortlist helper for chunk retrieval pipelines."""

from __future__ import annotations

from dataclasses import dataclass, replace

from infrastructure.rag_v3.repository import RagV3ChunkMatch

_SOURCE_TYPE_AUTHORITY = {
    "anayasa": 1.00,
    "kanun": 0.95,
    "cbk": 0.90,
    "yonetmelik": 0.80,
    "teblig": 0.72,
    "yargitay_ibk": 0.95,
    "yargitay_hgk": 0.90,
    "yargitay_cgk": 0.90,
    "yargitay": 0.82,
    "danistay_iddk": 0.88,
    "danistay": 0.80,
    "aym": 0.93,
}


@dataclass(frozen=True)
class DocShortlistResult:
    matches: list[RagV3ChunkMatch]
    shortlisted_doc_ids: list[str]
    dropped_doc_count: int


class RagV3DocLevelRetriever:
    """Aggregates chunk candidates into document-level shortlist."""

    def shortlist(
        self,
        *,
        matches: list[RagV3ChunkMatch],
        max_docs: int,
    ) -> DocShortlistResult:
        if not matches:
            return DocShortlistResult(matches=[], shortlisted_doc_ids=[], dropped_doc_count=0)
        bounded_max_docs = max(1, int(max_docs))

        bucket: dict[str, list[RagV3ChunkMatch]] = {}
        for row in matches:
            bucket.setdefault(str(row.document_id), []).append(row)

        doc_scores: list[tuple[str, float]] = []
        for doc_id, rows in bucket.items():
            top = max(float(item.final_score) for item in rows)
            avg = sum(float(item.final_score) for item in rows) / float(max(1, len(rows)))
            authority = _source_authority(rows[0].source_type)
            doc_score = _clamp01((0.62 * top) + (0.28 * avg) + (0.10 * authority))
            doc_scores.append((doc_id, doc_score))

        doc_scores.sort(key=lambda pair: pair[1], reverse=True)
        shortlisted_doc_ids = [doc_id for doc_id, _ in doc_scores[:bounded_max_docs]]
        doc_score_map = dict(doc_scores)
        shortlist_set = set(shortlisted_doc_ids)

        rescored: list[RagV3ChunkMatch] = []
        for row in matches:
            if row.document_id not in shortlist_set:
                continue
            doc_score = doc_score_map.get(row.document_id, 0.0)
            boosted = _clamp01((0.82 * float(row.final_score)) + (0.18 * doc_score))
            rescored.append(replace(row, final_score=boosted))

        rescored.sort(key=lambda item: item.final_score, reverse=True)
        dropped_doc_count = max(0, len(bucket) - len(shortlisted_doc_ids))
        return DocShortlistResult(
            matches=rescored,
            shortlisted_doc_ids=shortlisted_doc_ids,
            dropped_doc_count=dropped_doc_count,
        )


def _source_authority(source_type: str) -> float:
    token = str(source_type or "").strip().lower()
    if not token:
        return 0.5
    if token in _SOURCE_TYPE_AUTHORITY:
        return _SOURCE_TYPE_AUTHORITY[token]
    for key, value in _SOURCE_TYPE_AUTHORITY.items():
        if key in token:
            return value
    return 0.5


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return float(value)


rag_v3_doc_retriever = RagV3DocLevelRetriever()

