-- Migration: rag_v2_step33_finance_ops_core.sql
-- Scope:
--   - Finance + operations domain for law office workflows
--   - Time entries, expenses, invoices, payments, retainers
--   - Proposals, contracts, tax config/summary, payment links
--   - Bureau scoped RLS for internal office users

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_time_source' and n.nspname = 'public'
  ) then
    create type public.finance_time_source as enum ('manual', 'timer');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_work_type' and n.nspname = 'public'
  ) then
    create type public.finance_work_type as enum (
      'hearing',
      'petition',
      'consulting',
      'research',
      'travel',
      'waiting',
      'other'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_entry_status' and n.nspname = 'public'
  ) then
    create type public.finance_entry_status as enum ('draft', 'logged', 'billed', 'void');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_expense_category' and n.nspname = 'public'
  ) then
    create type public.finance_expense_category as enum (
      'harc',
      'tebligat',
      'bilirkisi',
      'kesif',
      'uyap_noter_baro',
      'travel_accommodation',
      'courier_post',
      'translation',
      'office_expense',
      'external_consultant',
      'other'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_invoice_status' and n.nspname = 'public'
  ) then
    create type public.finance_invoice_status as enum (
      'draft',
      'issued',
      'partially_paid',
      'paid',
      'overdue',
      'cancelled'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_billing_model' and n.nspname = 'public'
  ) then
    create type public.finance_billing_model as enum ('hourly', 'fixed_fee', 'success_fee', 'retainer', 'mixed');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_invoice_item_type' and n.nspname = 'public'
  ) then
    create type public.finance_invoice_item_type as enum (
      'time_entry',
      'expense',
      'manual',
      'success_fee',
      'retainer_offset'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_payment_method' and n.nspname = 'public'
  ) then
    create type public.finance_payment_method as enum ('wire', 'eft', 'cash', 'credit_card', 'online_link');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_retainer_type' and n.nspname = 'public'
  ) then
    create type public.finance_retainer_type as enum ('service', 'expense');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_retainer_status' and n.nspname = 'public'
  ) then
    create type public.finance_retainer_status as enum ('active', 'exhausted', 'refunded', 'closed');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_payment_link_type' and n.nspname = 'public'
  ) then
    create type public.finance_payment_link_type as enum ('invoice', 'partial_invoice', 'retainer');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_payment_link_status' and n.nspname = 'public'
  ) then
    create type public.finance_payment_link_status as enum ('pending', 'paid', 'failed', 'expired', 'cancelled');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_contract_status' and n.nspname = 'public'
  ) then
    create type public.finance_contract_status as enum ('draft', 'active', 'expired', 'terminated');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_proposal_status' and n.nspname = 'public'
  ) then
    create type public.finance_proposal_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'finance_tax_period_type' and n.nspname = 'public'
  ) then
    create type public.finance_tax_period_type as enum ('monthly', 'quarterly', 'yearly');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Core config and master finance entities
-- ---------------------------------------------------------------------------
create table if not exists public.finance_tax_configs (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  vat_rate numeric(6,3) not null default 20,
  withholding_rate numeric(6,3) not null default 20,
  estimated_income_tax_rate numeric(6,3) not null default 25,
  min_billing_minutes integer not null default 6,
  billing_rounding_minutes integer not null default 6,
  default_currency text not null default 'TRY',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bureau_id)
);

create table if not exists public.finance_proposals (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  proposal_no text not null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  billing_model public.finance_billing_model not null default 'hourly',
  proposal_date date not null default current_date,
  valid_until date,
  hourly_rate numeric(14,2),
  fixed_fee_amount numeric(14,2),
  success_fee_rate numeric(6,3),
  retainer_amount numeric(14,2),
  expense_policy text,
  vat_rate numeric(6,3),
  withholding_rate numeric(6,3),
  currency text not null default 'TRY',
  status public.finance_proposal_status not null default 'draft',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, proposal_no)
);

create table if not exists public.finance_contracts (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  contract_no text not null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  proposal_id uuid references public.finance_proposals(id) on delete set null,
  billing_model public.finance_billing_model not null default 'hourly',
  signed_at date,
  starts_at date,
  ends_at date,
  hourly_rate numeric(14,2),
  fixed_fee_amount numeric(14,2),
  success_fee_rate numeric(6,3),
  monthly_retainer_amount numeric(14,2),
  vat_rate numeric(6,3),
  withholding_rate numeric(6,3),
  currency text not null default 'TRY',
  status public.finance_contract_status not null default 'draft',
  terms text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, contract_no)
);

create table if not exists public.finance_retainers (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  retainer_no text not null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  contract_id uuid references public.finance_contracts(id) on delete set null,
  retainer_type public.finance_retainer_type not null,
  status public.finance_retainer_status not null default 'active',
  received_date date not null default current_date,
  amount numeric(14,2) not null,
  used_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null,
  refundable_amount numeric(14,2) not null default 0,
  currency text not null default 'TRY',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, retainer_no)
);

create table if not exists public.finance_invoices (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  invoice_no text not null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  proposal_id uuid references public.finance_proposals(id) on delete set null,
  contract_id uuid references public.finance_contracts(id) on delete set null,
  billing_model public.finance_billing_model not null default 'hourly',
  invoice_date date not null default current_date,
  due_date date,
  currency text not null default 'TRY',
  status public.finance_invoice_status not null default 'draft',
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  vat_rate numeric(6,3) not null default 0,
  vat_total numeric(14,2) not null default 0,
  withholding_rate numeric(6,3) not null default 0,
  withholding_total numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  amount_due numeric(14,2) not null default 0,
  installment_plan jsonb,
  last_reminder_at timestamptz,
  reminder_note text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, invoice_no)
);

create table if not exists public.finance_time_entries (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  work_type public.finance_work_type not null default 'other',
  source public.finance_time_source not null default 'manual',
  status public.finance_entry_status not null default 'logged',
  work_date date not null default current_date,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes numeric(10,2) not null,
  rounded_minutes integer not null,
  min_billing_minutes integer not null default 0,
  rounding_minutes integer not null default 6,
  billable boolean not null default true,
  internal_hourly_cost numeric(14,2) not null default 0,
  sales_hourly_rate numeric(14,2) not null default 0,
  internal_cost_amount numeric(14,2) not null default 0,
  billable_amount numeric(14,2) not null default 0,
  currency text not null default 'TRY',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.finance_expenses (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  category public.finance_expense_category not null,
  expense_date date not null default current_date,
  amount numeric(14,2) not null,
  currency text not null default 'TRY',
  description text,
  document_no text,
  document_date date,
  supplier_name text,
  vat_rate numeric(6,3) not null default 0,
  vat_included boolean not null default true,
  vat_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  billable_to_client boolean not null default true,
  covered_by_retainer boolean not null default false,
  receipt_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.finance_invoice_items (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  item_type public.finance_invoice_item_type not null,
  time_entry_id uuid references public.finance_time_entries(id) on delete set null,
  expense_id uuid references public.finance_expenses(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  discount_rate numeric(6,3) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  withholding_rate numeric(6,3) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  line_discount numeric(14,2) not null default 0,
  line_vat numeric(14,2) not null default 0,
  line_withholding numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.finance_payment_links (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  link_code text not null,
  invoice_id uuid references public.finance_invoices(id) on delete set null,
  retainer_id uuid references public.finance_retainers(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  link_type public.finance_payment_link_type not null,
  status public.finance_payment_link_status not null default 'pending',
  provider text not null,
  amount numeric(14,2) not null,
  currency text not null default 'TRY',
  url text,
  expires_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  last_webhook_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, link_code)
);

create table if not exists public.finance_payments (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  payment_no text not null,
  invoice_id uuid references public.finance_invoices(id) on delete set null,
  payment_link_id uuid references public.finance_payment_links(id) on delete set null,
  retainer_id uuid references public.finance_retainers(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  payment_date date not null default current_date,
  amount numeric(14,2) not null,
  currency text not null default 'TRY',
  payment_method public.finance_payment_method not null,
  reference_no text,
  note text,
  installment_no integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bureau_id, payment_no)
);

create table if not exists public.finance_retainer_allocations (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  retainer_id uuid not null references public.finance_retainers(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  invoice_id uuid references public.finance_invoices(id) on delete set null,
  expense_id uuid references public.finance_expenses(id) on delete set null,
  payment_id uuid references public.finance_payments(id) on delete set null,
  allocation_date date not null default current_date,
  amount numeric(14,2) not null,
  currency text not null default 'TRY',
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.finance_tax_summaries (
  id uuid primary key default uuid_generate_v4(),
  bureau_id uuid not null references public.bureaus(id) on delete cascade,
  period_type public.finance_tax_period_type not null,
  period_start date not null,
  period_end date not null,
  output_vat numeric(14,2) not null default 0,
  deductible_vat numeric(14,2) not null default 0,
  net_vat_position numeric(14,2) not null default 0,
  withholding_total numeric(14,2) not null default 0,
  estimated_income_tax numeric(14,2) not null default 0,
  gross_profit numeric(14,2) not null default 0,
  net_profit_after_tax numeric(14,2) not null default 0,
  currency text not null default 'TRY',
  snapshot_payload jsonb not null default '{}'::jsonb,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bureau_id, period_type, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- 3) Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_finance_time_entries_bureau_work_date
  on public.finance_time_entries (bureau_id, work_date desc)
  where deleted_at is null;
create index if not exists idx_finance_time_entries_case_id
  on public.finance_time_entries (case_id)
  where deleted_at is null;
create index if not exists idx_finance_time_entries_client_id
  on public.finance_time_entries (client_id)
  where deleted_at is null;

create index if not exists idx_finance_expenses_bureau_expense_date
  on public.finance_expenses (bureau_id, expense_date desc)
  where deleted_at is null;
create index if not exists idx_finance_expenses_case_id
  on public.finance_expenses (case_id)
  where deleted_at is null;
create index if not exists idx_finance_expenses_client_id
  on public.finance_expenses (client_id)
  where deleted_at is null;

create index if not exists idx_finance_invoices_bureau_invoice_date
  on public.finance_invoices (bureau_id, invoice_date desc)
  where deleted_at is null;
create index if not exists idx_finance_invoices_status
  on public.finance_invoices (bureau_id, status)
  where deleted_at is null;
create index if not exists idx_finance_invoices_case_id
  on public.finance_invoices (case_id)
  where deleted_at is null;
create index if not exists idx_finance_invoices_client_id
  on public.finance_invoices (client_id)
  where deleted_at is null;

create index if not exists idx_finance_invoice_items_invoice_id
  on public.finance_invoice_items (invoice_id)
  where deleted_at is null;
create unique index if not exists idx_finance_invoice_items_time_entry_unique
  on public.finance_invoice_items (time_entry_id)
  where time_entry_id is not null and deleted_at is null;
create unique index if not exists idx_finance_invoice_items_expense_unique
  on public.finance_invoice_items (expense_id)
  where expense_id is not null and deleted_at is null;

create index if not exists idx_finance_payments_bureau_payment_date
  on public.finance_payments (bureau_id, payment_date desc)
  where deleted_at is null;
create index if not exists idx_finance_payments_invoice_id
  on public.finance_payments (invoice_id)
  where deleted_at is null;

create index if not exists idx_finance_retainers_bureau_received_date
  on public.finance_retainers (bureau_id, received_date desc)
  where deleted_at is null;

create index if not exists idx_finance_payment_links_bureau_created_at
  on public.finance_payment_links (bureau_id, created_at desc)
  where deleted_at is null;
create index if not exists idx_finance_payment_links_status
  on public.finance_payment_links (bureau_id, status)
  where deleted_at is null;

create index if not exists idx_finance_tax_summaries_bureau_period
  on public.finance_tax_summaries (bureau_id, period_start desc);

-- ---------------------------------------------------------------------------
-- 4) Updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_finance_tax_configs_updated_at on public.finance_tax_configs;
create trigger trg_finance_tax_configs_updated_at
before update on public.finance_tax_configs
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_proposals_updated_at on public.finance_proposals;
create trigger trg_finance_proposals_updated_at
before update on public.finance_proposals
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_contracts_updated_at on public.finance_contracts;
create trigger trg_finance_contracts_updated_at
before update on public.finance_contracts
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_retainers_updated_at on public.finance_retainers;
create trigger trg_finance_retainers_updated_at
before update on public.finance_retainers
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_invoices_updated_at on public.finance_invoices;
create trigger trg_finance_invoices_updated_at
before update on public.finance_invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_time_entries_updated_at on public.finance_time_entries;
create trigger trg_finance_time_entries_updated_at
before update on public.finance_time_entries
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_expenses_updated_at on public.finance_expenses;
create trigger trg_finance_expenses_updated_at
before update on public.finance_expenses
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_invoice_items_updated_at on public.finance_invoice_items;
create trigger trg_finance_invoice_items_updated_at
before update on public.finance_invoice_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_payment_links_updated_at on public.finance_payment_links;
create trigger trg_finance_payment_links_updated_at
before update on public.finance_payment_links
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_payments_updated_at on public.finance_payments;
create trigger trg_finance_payments_updated_at
before update on public.finance_payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_retainer_allocations_updated_at on public.finance_retainer_allocations;
create trigger trg_finance_retainer_allocations_updated_at
before update on public.finance_retainer_allocations
for each row execute function public.set_updated_at();

drop trigger if exists trg_finance_tax_summaries_updated_at on public.finance_tax_summaries;
create trigger trg_finance_tax_summaries_updated_at
before update on public.finance_tax_summaries
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Row Level Security
-- ---------------------------------------------------------------------------
alter table public.finance_tax_configs enable row level security;
alter table public.finance_proposals enable row level security;
alter table public.finance_contracts enable row level security;
alter table public.finance_retainers enable row level security;
alter table public.finance_invoices enable row level security;
alter table public.finance_time_entries enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_invoice_items enable row level security;
alter table public.finance_payment_links enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_retainer_allocations enable row level security;
alter table public.finance_tax_summaries enable row level security;

-- service role full access
drop policy if exists finance_tax_configs_service_role_all on public.finance_tax_configs;
create policy finance_tax_configs_service_role_all on public.finance_tax_configs for all to service_role using (true) with check (true);
drop policy if exists finance_proposals_service_role_all on public.finance_proposals;
create policy finance_proposals_service_role_all on public.finance_proposals for all to service_role using (true) with check (true);
drop policy if exists finance_contracts_service_role_all on public.finance_contracts;
create policy finance_contracts_service_role_all on public.finance_contracts for all to service_role using (true) with check (true);
drop policy if exists finance_retainers_service_role_all on public.finance_retainers;
create policy finance_retainers_service_role_all on public.finance_retainers for all to service_role using (true) with check (true);
drop policy if exists finance_invoices_service_role_all on public.finance_invoices;
create policy finance_invoices_service_role_all on public.finance_invoices for all to service_role using (true) with check (true);
drop policy if exists finance_time_entries_service_role_all on public.finance_time_entries;
create policy finance_time_entries_service_role_all on public.finance_time_entries for all to service_role using (true) with check (true);
drop policy if exists finance_expenses_service_role_all on public.finance_expenses;
create policy finance_expenses_service_role_all on public.finance_expenses for all to service_role using (true) with check (true);
drop policy if exists finance_invoice_items_service_role_all on public.finance_invoice_items;
create policy finance_invoice_items_service_role_all on public.finance_invoice_items for all to service_role using (true) with check (true);
drop policy if exists finance_payment_links_service_role_all on public.finance_payment_links;
create policy finance_payment_links_service_role_all on public.finance_payment_links for all to service_role using (true) with check (true);
drop policy if exists finance_payments_service_role_all on public.finance_payments;
create policy finance_payments_service_role_all on public.finance_payments for all to service_role using (true) with check (true);
drop policy if exists finance_retainer_allocations_service_role_all on public.finance_retainer_allocations;
create policy finance_retainer_allocations_service_role_all on public.finance_retainer_allocations for all to service_role using (true) with check (true);
drop policy if exists finance_tax_summaries_service_role_all on public.finance_tax_summaries;
create policy finance_tax_summaries_service_role_all on public.finance_tax_summaries for all to service_role using (true) with check (true);

-- authenticated internal users scoped by bureau_id
drop policy if exists finance_tax_configs_internal_all on public.finance_tax_configs;
create policy finance_tax_configs_internal_all on public.finance_tax_configs
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_proposals_internal_all on public.finance_proposals;
create policy finance_proposals_internal_all on public.finance_proposals
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_contracts_internal_all on public.finance_contracts;
create policy finance_contracts_internal_all on public.finance_contracts
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_retainers_internal_all on public.finance_retainers;
create policy finance_retainers_internal_all on public.finance_retainers
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_invoices_internal_all on public.finance_invoices;
create policy finance_invoices_internal_all on public.finance_invoices
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_time_entries_internal_all on public.finance_time_entries;
create policy finance_time_entries_internal_all on public.finance_time_entries
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_expenses_internal_all on public.finance_expenses;
create policy finance_expenses_internal_all on public.finance_expenses
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_invoice_items_internal_all on public.finance_invoice_items;
create policy finance_invoice_items_internal_all on public.finance_invoice_items
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_payment_links_internal_all on public.finance_payment_links;
create policy finance_payment_links_internal_all on public.finance_payment_links
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_payments_internal_all on public.finance_payments;
create policy finance_payments_internal_all on public.finance_payments
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_retainer_allocations_internal_all on public.finance_retainer_allocations;
create policy finance_retainer_allocations_internal_all on public.finance_retainer_allocations
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

drop policy if exists finance_tax_summaries_internal_all on public.finance_tax_summaries;
create policy finance_tax_summaries_internal_all on public.finance_tax_summaries
for all to authenticated
using (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
)
with check (
  public.is_internal_user()
  and bureau_id is not distinct from public.current_user_bureau_id()
);

-- ---------------------------------------------------------------------------
-- 6) Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.finance_tax_configs to authenticated;
grant select, insert, update, delete on table public.finance_proposals to authenticated;
grant select, insert, update, delete on table public.finance_contracts to authenticated;
grant select, insert, update, delete on table public.finance_retainers to authenticated;
grant select, insert, update, delete on table public.finance_invoices to authenticated;
grant select, insert, update, delete on table public.finance_time_entries to authenticated;
grant select, insert, update, delete on table public.finance_expenses to authenticated;
grant select, insert, update, delete on table public.finance_invoice_items to authenticated;
grant select, insert, update, delete on table public.finance_payment_links to authenticated;
grant select, insert, update, delete on table public.finance_payments to authenticated;
grant select, insert, update, delete on table public.finance_retainer_allocations to authenticated;
grant select, insert, update, delete on table public.finance_tax_summaries to authenticated;

grant all on table public.finance_tax_configs to service_role;
grant all on table public.finance_proposals to service_role;
grant all on table public.finance_contracts to service_role;
grant all on table public.finance_retainers to service_role;
grant all on table public.finance_invoices to service_role;
grant all on table public.finance_time_entries to service_role;
grant all on table public.finance_expenses to service_role;
grant all on table public.finance_invoice_items to service_role;
grant all on table public.finance_payment_links to service_role;
grant all on table public.finance_payments to service_role;
grant all on table public.finance_retainer_allocations to service_role;
grant all on table public.finance_tax_summaries to service_role;
