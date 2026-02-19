-- 1) Extensions (must be first)
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- 2) Enums
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role'
      and n.nspname = 'public'
  ) then
    create type public.user_role as enum ('lawyer', 'assistant', 'client');
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role'
      and n.nspname = 'public'
  ) then
    alter type public.user_role add value if not exists 'assistant';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'case_status'
      and n.nspname = 'public'
  ) then
    create type public.case_status as enum ('open', 'in_progress', 'closed', 'archived');
  end if;
end
$$;

-- 3) Tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text,
  role public.user_role not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  case_code text,
  tags text[] not null default '{}',
  client_display_name text,
  status public.case_status not null default 'open',
  lawyer_id uuid not null references public.profiles(id) on delete restrict,
  client_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.case_updates (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  message text not null,
  date timestamptz not null default now(),
  is_public_to_client boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_chats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_cases_lawyer_id on public.cases (lawyer_id);
create index if not exists idx_cases_client_id on public.cases (client_id);
alter table public.profiles add column if not exists username text;
create unique index if not exists idx_profiles_username_unique on public.profiles (lower(username)) where username is not null;
create unique index if not exists idx_cases_case_code_unique on public.cases (case_code) where case_code is not null;
create index if not exists idx_cases_tags_gin on public.cases using gin (tags);
create index if not exists idx_documents_case_id on public.documents (case_id);
create index if not exists idx_case_updates_case_id on public.case_updates (case_id);
create index if not exists idx_case_updates_is_public on public.case_updates (is_public_to_client);
create index if not exists idx_ai_chats_user_id on public.ai_chats (user_id);

-- Optional: vector search index (IVFFlat) for cosine distance
create index if not exists idx_documents_embedding_cosine
  on public.documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Trigger helper for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_cases_updated_at on public.cases;
create trigger trg_cases_updated_at
before update on public.cases
for each row
execute function public.set_updated_at();

drop trigger if exists trg_ai_chats_updated_at on public.ai_chats;
create trigger trg_ai_chats_updated_at
before update on public.ai_chats
for each row
execute function public.set_updated_at();

-- 4) RLS Policies (critical)
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.documents enable row level security;
alter table public.case_updates enable row level security;
alter table public.ai_chats enable row level security;

-- Profiles: users can read/update self; lawyers can read clients they are linked with
drop policy if exists "Profiles select own" on public.profiles;
create policy "Profiles select own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Profiles insert own" on public.profiles;
create policy "Profiles insert own"
on public.profiles
for insert
with check (auth.uid() = id);

-- Cases
-- Lawyer full CRUD on own cases
drop policy if exists "Cases lawyer select own" on public.cases;
create policy "Cases lawyer select own"
on public.cases
for select
using (
  auth.uid() = lawyer_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

drop policy if exists "Cases lawyer insert own" on public.cases;
create policy "Cases lawyer insert own"
on public.cases
for insert
with check (
  auth.uid() = lawyer_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

drop policy if exists "Cases lawyer update own" on public.cases;
create policy "Cases lawyer update own"
on public.cases
for update
using (
  auth.uid() = lawyer_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
)
with check (
  auth.uid() = lawyer_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

drop policy if exists "Cases lawyer delete own" on public.cases;
create policy "Cases lawyer delete own"
on public.cases
for delete
using (
  auth.uid() = lawyer_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

-- Client can only SELECT their assigned cases
drop policy if exists "Cases client select own" on public.cases;
create policy "Cases client select own"
on public.cases
for select
using (auth.uid() = client_id);

-- Documents
-- Lawyer full access via case ownership
drop policy if exists "Documents lawyer full via case" on public.documents;
create policy "Documents lawyer full via case"
on public.documents
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = documents.case_id
      and c.lawyer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = documents.case_id
      and c.lawyer_id = auth.uid()
  )
);

-- Client read-only documents via assigned case
drop policy if exists "Documents client select via case" on public.documents;
create policy "Documents client select via case"
on public.documents
for select
using (
  exists (
    select 1 from public.cases c
    where c.id = documents.case_id
      and c.client_id = auth.uid()
  )
);

-- Case updates
-- Lawyer full access via case ownership
drop policy if exists "Case updates lawyer full via case" on public.case_updates;
create policy "Case updates lawyer full via case"
on public.case_updates
for all
using (
  exists (
    select 1 from public.cases c
    where c.id = case_updates.case_id
      and c.lawyer_id = auth.uid()
  )
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
)
with check (
  exists (
    select 1 from public.cases c
    where c.id = case_updates.case_id
      and c.lawyer_id = auth.uid()
  )
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

-- Client can only SELECT public updates for own case
drop policy if exists "Case updates client select public" on public.case_updates;
create policy "Case updates client select public"
on public.case_updates
for select
using (
  is_public_to_client = true
  and exists (
    select 1 from public.cases c
    where c.id = case_updates.case_id
      and c.client_id = auth.uid()
  )
);

-- AI chats: user owns their chats
drop policy if exists "AI chats select own" on public.ai_chats;
create policy "AI chats select own"
on public.ai_chats
for select
using (auth.uid() = user_id);

drop policy if exists "AI chats insert own" on public.ai_chats;
create policy "AI chats insert own"
on public.ai_chats
for insert
with check (auth.uid() = user_id);

drop policy if exists "AI chats update own" on public.ai_chats;
create policy "AI chats update own"
on public.ai_chats
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "AI chats delete own" on public.ai_chats;
create policy "AI chats delete own"
on public.ai_chats
for delete
using (auth.uid() = user_id);
