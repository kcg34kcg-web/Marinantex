-- RBAC / Invitation foundation

-- Ensure enum is compatible with assistant role before using it in policies/tables.
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

-- Invite table for invitation-only signup flow
create table if not exists public.user_invites (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  full_name text,
  username text,
  tc_identity text,
  contact_name text,
  phone text,
  party_type text,
  target_role public.user_role not null,
  token text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.user_invites add column if not exists full_name text;
alter table public.user_invites add column if not exists username text;
alter table public.user_invites add column if not exists tc_identity text;
alter table public.user_invites add column if not exists contact_name text;
alter table public.user_invites add column if not exists phone text;
alter table public.user_invites add column if not exists party_type text;

create index if not exists idx_user_invites_email on public.user_invites (lower(email));
create index if not exists idx_user_invites_expires_at on public.user_invites (expires_at);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_invites'
      and column_name = 'username'
  ) then
    execute 'create index if not exists idx_user_invites_username on public.user_invites (lower(username))';
  end if;
end
$$;

alter table public.profiles add column if not exists username text;
create unique index if not exists idx_profiles_username_unique on public.profiles (lower(username)) where username is not null;

alter table public.user_invites enable row level security;

-- Basic read/insert/update policies for internal users (lawyer + assistant)
drop policy if exists "User invites lawyer select" on public.user_invites;
create policy "User invites lawyer select"
on public.user_invites
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "User invites lawyer insert" on public.user_invites;
create policy "User invites lawyer insert"
on public.user_invites
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "User invites lawyer update" on public.user_invites;
create policy "User invites lawyer update"
on public.user_invites
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

-- Office Team communication foundation
create table if not exists public.office_threads (
  id uuid primary key default uuid_generate_v4(),
  title text,
  thread_type text not null check (thread_type in ('direct', 'group', 'role', 'broadcast')),
  target_role public.user_role,
  created_by uuid not null references public.profiles(id) on delete restrict,
  is_archived boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.office_thread_members (
  thread_id uuid not null references public.office_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  is_muted boolean not null default false,
  primary key (thread_id, user_id)
);

create table if not exists public.office_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references public.office_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint office_messages_body_not_empty check (char_length(trim(body)) > 0)
);

create table if not exists public.office_broadcasts (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  body text not null,
  target_scope text not null default 'all' check (target_scope in ('all', 'lawyer', 'assistant')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.office_tasks (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid references public.cases(id) on delete set null,
  source_message_id uuid references public.office_messages(id) on delete set null,
  thread_id uuid references public.office_threads(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.office_tasks add column if not exists case_id uuid references public.cases(id) on delete set null;

create index if not exists idx_office_threads_created_by on public.office_threads (created_by);
create index if not exists idx_office_threads_last_message_at on public.office_threads (last_message_at desc);
create index if not exists idx_office_thread_members_user_id on public.office_thread_members (user_id);
create index if not exists idx_office_messages_thread_id on public.office_messages (thread_id);
create index if not exists idx_office_messages_sender_id on public.office_messages (sender_id);
create index if not exists idx_office_messages_created_at on public.office_messages (created_at desc);
create index if not exists idx_office_broadcasts_created_at on public.office_broadcasts (created_at desc);
create index if not exists idx_office_tasks_created_by on public.office_tasks (created_by);
create index if not exists idx_office_tasks_assigned_to on public.office_tasks (assigned_to);
create index if not exists idx_office_tasks_status on public.office_tasks (status);
create index if not exists idx_office_tasks_thread_id on public.office_tasks (thread_id);
create index if not exists idx_office_tasks_case_id on public.office_tasks (case_id);

alter table public.cases add column if not exists case_code text;
alter table public.cases add column if not exists tags text[] not null default '{}';
alter table public.cases add column if not exists client_display_name text;
create unique index if not exists idx_cases_case_code_unique on public.cases (case_code) where case_code is not null;
create index if not exists idx_cases_tags_gin on public.cases using gin (tags);

alter table public.office_threads enable row level security;
alter table public.office_thread_members enable row level security;
alter table public.office_messages enable row level security;
alter table public.office_broadcasts enable row level security;
alter table public.office_tasks enable row level security;

-- Internal users are: lawyer + assistant

drop policy if exists "Office threads internal select" on public.office_threads;
create policy "Office threads internal select"
on public.office_threads
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
  and exists (
    select 1
    from public.office_thread_members m
    where m.thread_id = office_threads.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Office threads internal insert" on public.office_threads;
create policy "Office threads internal insert"
on public.office_threads
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office threads creator update" on public.office_threads;
create policy "Office threads creator update"
on public.office_threads
for update
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "Office thread members internal select" on public.office_thread_members;
create policy "Office thread members internal select"
on public.office_thread_members
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
  and exists (
    select 1
    from public.office_thread_members self_member
    where self_member.thread_id = office_thread_members.thread_id
      and self_member.user_id = auth.uid()
  )
);

drop policy if exists "Office thread members creator manage" on public.office_thread_members;
create policy "Office thread members creator manage"
on public.office_thread_members
for all
using (
  exists (
    select 1
    from public.office_threads t
    where t.id = office_thread_members.thread_id
      and t.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.office_threads t
    where t.id = office_thread_members.thread_id
      and t.created_by = auth.uid()
  )
);

drop policy if exists "Office messages internal select" on public.office_messages;
create policy "Office messages internal select"
on public.office_messages
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
  and exists (
    select 1
    from public.office_thread_members m
    where m.thread_id = office_messages.thread_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Office messages internal insert" on public.office_messages;
create policy "Office messages internal insert"
on public.office_messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
  and exists (
    select 1
    from public.office_thread_members m
    where m.thread_id = office_messages.thread_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Office messages sender update" on public.office_messages;
create policy "Office messages sender update"
on public.office_messages
for update
using (sender_id = auth.uid())
with check (sender_id = auth.uid());

drop policy if exists "Office broadcasts internal select" on public.office_broadcasts;
create policy "Office broadcasts internal select"
on public.office_broadcasts
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office broadcasts lawyer insert" on public.office_broadcasts;
create policy "Office broadcasts lawyer insert"
on public.office_broadcasts
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'lawyer'
  )
);

drop policy if exists "Office broadcasts sender update" on public.office_broadcasts;
create policy "Office broadcasts sender update"
on public.office_broadcasts
for update
using (sender_id = auth.uid())
with check (sender_id = auth.uid());

drop policy if exists "Office tasks internal select" on public.office_tasks;
create policy "Office tasks internal select"
on public.office_tasks
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office tasks internal insert" on public.office_tasks;
create policy "Office tasks internal insert"
on public.office_tasks
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office tasks owner update" on public.office_tasks;
create policy "Office tasks owner update"
on public.office_tasks
for update
using (created_by = auth.uid() or assigned_to = auth.uid())
with check (created_by = auth.uid() or assigned_to = auth.uid());
