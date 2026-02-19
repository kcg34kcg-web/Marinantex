-- ============================================================================
-- V2.1 Step 2: Kaynak Envanteri Metadata Migration
-- Adds provenance columns to `documents` and extends hybrid_legal_search.
--
-- Run order: schema.sql → rag.sql → rag_v2_step2_metadata.sql
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ============================================================================

-- ─── 1. New Columns ──────────────────────────────────────────────────────────

-- source_url: canonical URL of the original legal source
--   e.g. "https://www.mevzuat.gov.tr/MevzuatMetin/1.5.4721.pdf"
--        "https://karararama.yargitay.gov.tr/..."
alter table public.documents
  add column if not exists source_url text;

-- version: which version/revision of the source was ingested
--   For laws     → effective date as text "YYYY-MM-DD"
--   For decisions → decision number    "2023/456 E., 2024/789 K."
alter table public.documents
  add column if not exists version text;

-- collected_at: when the document was fetched/ingested
--   NULL means provenance is UNVERIFIABLE → Hard-Fail is triggered upstream.
alter table public.documents
  add column if not exists collected_at timestamptz;

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

-- Freshness / TTL audits
create index if not exists idx_documents_collected_at
  on public.documents (collected_at desc nulls last);

-- Version-based lookups (time-travel search, Step 10)
create index if not exists idx_documents_version
  on public.documents (version)
  where version is not null;

-- ─── 3. Column Comments ──────────────────────────────────────────────────────

comment on column public.documents.source_url is
  'Canonical URL of the original legal source (Resmi Gazete, Mevzuat.gov.tr, '
  'Yargıtay kararlar sistemi, etc.). NULL = provenance unknown → Hard-Fail.';

comment on column public.documents.version is
  'Version identifier for the source text. '
  'Laws: effective date (YYYY-MM-DD). Court decisions: decision number.';

comment on column public.documents.collected_at is
  'Timestamp when the document was fetched and ingested into the system. '
  'NULL triggers Hard-Fail in the RAG pipeline (Step 1 policy).';

-- ─── 4. Update hybrid_legal_search to surface provenance fields ──────────────
--
--   The original function in rag.sql does NOT return source_url, version, or
--   collected_at.  We replace it here so the RAG service receives full metadata
--   without an extra round-trip to Supabase.
--
create or replace function public.hybrid_legal_search(
  query_embedding vector(1536),
  query_text       text,
  case_scope       uuid    default null,
  match_count      int     default 12
)
returns table (
  id               uuid,
  case_id          uuid,
  content          text,
  file_path        text,
  citation         text,
  court_level      text,
  ruling_date      date,
  -- ── Step 2: provenance ─────────────────────────────────────────────────────
  source_url       text,
  version          text,
  collected_at     timestamptz,
  -- ── Scoring ────────────────────────────────────────────────────────────────
  semantic_score   double precision,
  keyword_score    double precision,
  recency_score    double precision,
  hierarchy_score  double precision,
  final_score      double precision
)
language sql
stable
as $$
with candidates as (
  select
    d.id,
    d.case_id,
    d.content,
    d.file_path,
    d.citation,
    d.court_level,
    d.ruling_date,
    -- Step 2 columns
    d.source_url,
    d.version,
    d.collected_at,
    -- Scoring components
    (1 - (d.embedding <=> query_embedding))                                              as semantic_score,
    ts_rank_cd(d.keywords_tsv, plainto_tsquery('simple', query_text))                   as keyword_score,
    greatest(
      0.0,
      1 - ((now()::date - coalesce(d.ruling_date, now()::date))::double precision / 3650.0)
    )                                                                                    as recency_score,
    public.court_level_weight(d.court_level)                                             as hierarchy_score
  from public.documents d
  where d.embedding is not null
    and (case_scope is null or d.case_id = case_scope)
),
scored as (
  select
    c.*,
    (
      (0.45 * c.semantic_score)  +
      (0.30 * c.keyword_score)   +
      (0.10 * c.recency_score)   +
      (0.15 * c.hierarchy_score)
    ) as final_score
  from candidates c
)
select
  s.id,
  s.case_id,
  s.content,
  s.file_path,
  s.citation,
  s.court_level,
  s.ruling_date,
  s.source_url,
  s.version,
  s.collected_at,
  s.semantic_score,
  s.keyword_score,
  s.recency_score,
  s.hierarchy_score,
  s.final_score
from scored s
order by s.final_score desc
limit match_count;
$$;
