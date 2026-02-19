-- Strategic Legal Finance Intelligence schema
-- Run after schema.sql and rag.sql

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'reference_rate_code'
      and n.nspname = 'public'
  ) then
    create type public.reference_rate_code as enum ('yasal', 'ticari_avans', 'reeskont');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'ledger_direction'
      and n.nspname = 'public'
  ) then
    create type public.ledger_direction as enum ('in', 'out');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'ledger_type'
      and n.nspname = 'public'
  ) then
    create type public.ledger_type as enum ('payment', 'expense', 'interest_accrual');
  end if;
end
$$;

create table if not exists public.reference_interest_rates (
  id uuid primary key default uuid_generate_v4(),
  code public.reference_rate_code not null,
  rate_annual numeric(8,4) not null,
  effective_date date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_reference_interest_rates_unique
  on public.reference_interest_rates (code, effective_date);

create table if not exists public.fee_constants (
  key text not null,
  value numeric(10,4) not null,
  valid_from date not null,
  created_at timestamptz not null default now(),
  primary key (key, valid_from)
);

create table if not exists public.case_ledgers (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  direction public.ledger_direction not null,
  type public.ledger_type not null,
  category text not null,
  amount numeric(18,2) not null,
  currency text not null default 'TRY',
  transaction_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_ledgers_case_id_date
  on public.case_ledgers (case_id, transaction_date desc);

create table if not exists public.smm_configs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_kdv_exempt boolean not null default false,
  default_stopaj_rate numeric(6,3) not null default 20,
  default_kdv_rate numeric(6,3) not null default 20,
  updated_at timestamptz not null default now()
);

create or replace function public.prevent_case_ledgers_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'case_ledgers immutable: update/delete operations are not allowed';
end;
$$;

drop trigger if exists trg_case_ledgers_no_update on public.case_ledgers;
create trigger trg_case_ledgers_no_update
before update on public.case_ledgers
for each row
execute function public.prevent_case_ledgers_mutation();

drop trigger if exists trg_case_ledgers_no_delete on public.case_ledgers;
create trigger trg_case_ledgers_no_delete
before delete on public.case_ledgers
for each row
execute function public.prevent_case_ledgers_mutation();

alter table public.reference_interest_rates enable row level security;
alter table public.fee_constants enable row level security;
alter table public.case_ledgers enable row level security;
alter table public.smm_configs enable row level security;

drop policy if exists "Reference rates read authenticated" on public.reference_interest_rates;
create policy "Reference rates read authenticated"
on public.reference_interest_rates
for select
using (auth.uid() is not null);

drop policy if exists "Fee constants read authenticated" on public.fee_constants;
create policy "Fee constants read authenticated"
on public.fee_constants
for select
using (auth.uid() is not null);

drop policy if exists "Case ledger lawyer insert own" on public.case_ledgers;
create policy "Case ledger lawyer insert own"
on public.case_ledgers
for insert
with check (
  exists (
    select 1 from public.cases c
    where c.id = case_ledgers.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Case ledger lawyer select own" on public.case_ledgers;
create policy "Case ledger lawyer select own"
on public.case_ledgers
for select
using (
  exists (
    select 1 from public.cases c
    where c.id = case_ledgers.case_id
      and c.lawyer_id = auth.uid()
  )
);

drop policy if exists "Case ledger client select own" on public.case_ledgers;
create policy "Case ledger client select own"
on public.case_ledgers
for select
using (
  exists (
    select 1 from public.cases c
    where c.id = case_ledgers.case_id
      and c.client_id = auth.uid()
  )
);

drop policy if exists "SMM config own select" on public.smm_configs;
create policy "SMM config own select"
on public.smm_configs
for select
using (auth.uid() = user_id);

drop policy if exists "SMM config own upsert" on public.smm_configs;
create policy "SMM config own upsert"
on public.smm_configs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into public.fee_constants (key, value, valid_from)
values
  ('tahsil_harci_prepayment', 4.55, current_date),
  ('tahsil_harci_haciz', 9.10, current_date),
  ('tahsil_harci_satis', 11.38, current_date),
  ('cezaevi_harci_default', 2.00, current_date)
on conflict (key, valid_from) do nothing;
