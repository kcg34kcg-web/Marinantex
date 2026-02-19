-- ============================================================================
-- V2.1 Step 7: Must-Cite RPC
-- Adds get_must_cite_documents() so the retrieval client can fetch
-- mandatory documents for a case in a single round-trip.
--
-- Run order: schema.sql → rag.sql → rag_v2_step2_metadata.sql
--            → rag_v2_step7_mustcite.sql
-- Safe to re-run: uses CREATE OR REPLACE.
-- ============================================================================

-- Returns all documents marked as must-cite for a given case, joined with
-- the full document data and scoring components so the Python client can
-- apply the same weight formula as for regular search results.
--
-- Scoring components for must-cites are computed identically to
-- hybrid_legal_search — only the final_score is different (boosted by Python).
create or replace function public.get_must_cite_documents(
  p_case_id uuid
)
returns table (
  id               uuid,
  case_id          uuid,
  content          text,
  file_path        text,
  citation         text,
  court_level      text,
  ruling_date      date,
  source_url       text,
  version          text,
  collected_at     timestamptz,
  semantic_score   double precision,
  keyword_score    double precision,
  recency_score    double precision,
  hierarchy_score  double precision,
  final_score      double precision,
  must_cite_score  double precision   -- original must_cite relevance weight
)
language sql
stable
as $$
  select
    d.id,
    d.case_id,
    d.content,
    d.file_path,
    d.citation,
    d.court_level,
    d.ruling_date,
    d.source_url,
    d.version,
    d.collected_at,
    -- Scoring components (same formula as hybrid_legal_search)
    0.0                                                              as semantic_score,
    0.0                                                              as keyword_score,
    greatest(
      0.0,
      1 - ((now()::date - coalesce(d.ruling_date, now()::date))::double precision / 3650.0)
    )                                                                as recency_score,
    public.court_level_weight(d.court_level)                         as hierarchy_score,
    mc.score                                                         as final_score,
    mc.score                                                         as must_cite_score
  from public.case_must_cites mc
  join public.documents d on d.id = mc.document_id
  where mc.case_id = p_case_id
    and d.embedding is not null
  order by mc.score desc;
$$;
