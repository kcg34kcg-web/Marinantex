-- Hybrid RAG additions for Turkish legal retrieval
-- Run after base schema.sql

alter table public.cases
  add column if not exists case_type text;

alter table public.documents
  add column if not exists keywords_tsv tsvector generated always as (
    to_tsvector('simple', coalesce(content, ''))
  ) stored,
  add column if not exists court_level text,
  add column if not exists ruling_date date,
  add column if not exists citation text;

create index if not exists idx_documents_keywords_tsv
  on public.documents
  using gin (keywords_tsv);

create index if not exists idx_documents_ruling_date
  on public.documents (ruling_date desc);

create index if not exists idx_documents_court_level
  on public.documents (court_level);

create table if not exists public.case_must_cites (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  score double precision not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_case_must_cites_unique
  on public.case_must_cites (case_id, document_id);

create or replace function public.court_level_weight(level text)
returns double precision
language sql
immutable
as $$
  select case
    when level = 'YARGITAY_IBK' then 1.0
    when level = 'YARGITAY_HGK' then 0.9
    when level = 'YARGITAY_DAIRE' then 0.8
    when level = 'BAM' then 0.6
    else 0.4
  end;
$$;

create or replace function public.hybrid_legal_search(
  query_embedding vector(1536),
  query_text text,
  case_scope uuid default null,
  match_count int default 12
)
returns table (
  id uuid,
  case_id uuid,
  content text,
  file_path text,
  citation text,
  court_level text,
  ruling_date date,
  semantic_score double precision,
  keyword_score double precision,
  recency_score double precision,
  hierarchy_score double precision,
  final_score double precision
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
    (1 - (d.embedding <=> query_embedding)) as semantic_score,
    ts_rank_cd(d.keywords_tsv, plainto_tsquery('simple', query_text)) as keyword_score,
    greatest(0.0, 1 - ((now()::date - coalesce(d.ruling_date, now()::date))::double precision / 3650.0)) as recency_score,
    public.court_level_weight(d.court_level) as hierarchy_score
  from public.documents d
  where d.embedding is not null
    and (case_scope is null or d.case_id = case_scope)
), scored as (
  select
    c.*,
    (
      (0.45 * c.semantic_score) +
      (0.30 * c.keyword_score) +
      (0.10 * c.recency_score) +
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
  s.semantic_score,
  s.keyword_score,
  s.recency_score,
  s.hierarchy_score,
  s.final_score
from scored s
order by s.final_score desc
limit match_count;
$$;

alter table public.case_must_cites enable row level security;

drop policy if exists "Case must cites lawyer select own" on public.case_must_cites;
create policy "Case must cites lawyer select own"
on public.case_must_cites
for select
using (
  exists (
    select 1 from public.cases c
    where c.id = case_must_cites.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Case must cites lawyer upsert own" on public.case_must_cites;
create policy "Case must cites lawyer upsert own"
on public.case_must_cites
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = case_must_cites.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = case_must_cites.case_id
      and c.lawyer_id = auth.uid()
  )
);
