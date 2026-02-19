-- Court-Ready Litigation Intelligence schema
-- Run after schema.sql, rag.sql, finance.sql

create table if not exists public.temporal_fact_nodes (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  label text not null,
  factual_occurrence_date date,
  epistemic_discovery_date date,
  source_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.extraction_staging (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence_score numeric(5,2) not null,
  verification_status text not null default 'pending',
  extraction_model text not null,
  extracted_at timestamptz not null default now()
);

create table if not exists public.contradiction_candidates (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  left_statement_id uuid not null,
  right_statement_id uuid not null,
  semantic_similarity numeric(6,5) not null,
  nli_label text,
  nli_confidence numeric(6,5),
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_chain_logs (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  stage text not null,
  payload_hash text not null,
  previous_hash text,
  chain_hash text not null,
  merkle_root text,
  created_at timestamptz not null default now()
);

create table if not exists public.bundle_exports (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  final_bundle_sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bates_registry (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  global_exhibit_id text not null,
  presentation_bates_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (case_id, global_exhibit_id)
);

create table if not exists public.limitation_acceptances (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  estimated_date date not null,
  accepted_by_user boolean not null,
  accepted_at timestamptz not null default now()
);

create table if not exists public.jurisdiction_rule_sets (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  version text not null,
  config jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.temporal_fact_nodes enable row level security;
alter table public.extraction_staging enable row level security;
alter table public.contradiction_candidates enable row level security;
alter table public.evidence_chain_logs enable row level security;
alter table public.bundle_exports enable row level security;
alter table public.bates_registry enable row level security;
alter table public.limitation_acceptances enable row level security;
alter table public.jurisdiction_rule_sets enable row level security;

drop policy if exists "Temporal facts lawyer own" on public.temporal_fact_nodes;
create policy "Temporal facts lawyer own"
on public.temporal_fact_nodes
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = temporal_fact_nodes.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = temporal_fact_nodes.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Extraction staging lawyer own" on public.extraction_staging;
create policy "Extraction staging lawyer own"
on public.extraction_staging
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = extraction_staging.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = extraction_staging.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Contradiction candidates lawyer own" on public.contradiction_candidates;
create policy "Contradiction candidates lawyer own"
on public.contradiction_candidates
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = contradiction_candidates.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = contradiction_candidates.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Evidence chain lawyer own" on public.evidence_chain_logs;
create policy "Evidence chain lawyer own"
on public.evidence_chain_logs
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = evidence_chain_logs.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = evidence_chain_logs.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Bundle exports lawyer own" on public.bundle_exports;
create policy "Bundle exports lawyer own"
on public.bundle_exports
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = bundle_exports.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = bundle_exports.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Bates registry lawyer own" on public.bates_registry;
create policy "Bates registry lawyer own"
on public.bates_registry
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = bates_registry.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = bates_registry.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Limitation acceptance lawyer own" on public.limitation_acceptances;
create policy "Limitation acceptance lawyer own"
on public.limitation_acceptances
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = limitation_acceptances.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = limitation_acceptances.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Jurisdiction rules read authenticated" on public.jurisdiction_rule_sets;
create policy "Jurisdiction rules read authenticated"
on public.jurisdiction_rule_sets
for select
using (auth.uid() is not null);
