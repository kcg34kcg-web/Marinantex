-- Migration: rag_v2_step27_clients_cases_office_flow.sql
-- Scope:
--   - Clients/Cases many-to-many relation
--   - Client messaging + delivery states
--   - Case documents, timeline, overview notes, AI case summary
--   - Office feed posts/comments
--   - App-level audit log for critical operations

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.generate_public_ref(p_prefix text)
returns text
language plpgsql
volatile
as $$
declare
  cleaned_prefix text;
  token text;
begin
  cleaned_prefix := upper(regexp_replace(coalesce(p_prefix, 'REF'), '[^A-Z0-9]+', '', 'g'));
  if cleaned_prefix = '' then
    cleaned_prefix := 'REF';
  end if;

  token := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  return cleaned_prefix || '-' || token;
end;
$$;

create or replace function public.is_internal_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = coalesce(p_user_id, auth.uid())
      and p.role::text in ('lawyer', 'assistant')
  );
$$;

create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  source_invite_id uuid,
  public_ref_code text not null unique default public.generate_public_ref('CLI'),
  full_name text not null,
  email text,
  phone text,
  tc_identity text,
  party_type text check (party_type in ('plaintiff', 'defendant', 'consultant') or party_type is null),
  file_no text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'invited', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.user_invites add column if not exists invited_client_id uuid references public.clients(id) on delete set null;
alter table public.user_invites add column if not exists delivery_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_source_invite_id_fkey'
  ) then
    alter table public.clients
      add constraint clients_source_invite_id_fkey
      foreign key (source_invite_id) references public.user_invites(id) on delete set null;
  end if;
end
$$;

alter table public.cases add column if not exists file_no text;
alter table public.cases add column if not exists overview_notes text not null default '';
alter table public.cases add column if not exists overview_notes_updated_at timestamptz;
alter table public.cases add column if not exists overview_notes_updated_by uuid references public.profiles(id) on delete set null;

create table if not exists public.case_clients (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  public_ref_code text not null unique default public.generate_public_ref('CLS'),
  relation_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (case_id, client_id)
);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  public_ref_code text not null unique default public.generate_public_ref('MSG'),
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  message_type text not null default 'direct' check (message_type in ('direct', 'announcement', 'system')),
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.message_deliveries (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references public.messages(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  error_message text,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, channel)
);

create table if not exists public.case_documents (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  public_ref_code text not null unique default public.generate_public_ref('DOC'),
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  content_base64 text,
  storage_path text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.case_timeline_events (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  event_type text not null check (event_type in ('note', 'document_upload', 'message_sent', 'status_change', 'reminder', 'user_action')),
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.ai_case_summaries (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null unique references public.cases(id) on delete cascade,
  summary_text text,
  status text not null default 'placeholder' check (status in ('placeholder', 'generating', 'ready', 'failed')),
  source_snapshot jsonb not null default '{}'::jsonb,
  last_generated_at timestamptz,
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feed_posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  post_type text not null check (post_type in ('announcement', 'short_note', 'task_reminder', 'file_link')),
  title text,
  body text not null,
  case_id uuid references public.cases(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.feed_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.app_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_clients_email on public.clients (lower(email));
create index if not exists idx_clients_file_no on public.clients (file_no);
create index if not exists idx_clients_status on public.clients (status);
create index if not exists idx_clients_profile_id on public.clients (profile_id);
create index if not exists idx_case_clients_case_id on public.case_clients (case_id) where deleted_at is null;
create index if not exists idx_case_clients_client_id on public.case_clients (client_id) where deleted_at is null;
create index if not exists idx_messages_client_id on public.messages (client_id) where deleted_at is null;
create index if not exists idx_messages_case_id on public.messages (case_id) where deleted_at is null;
create index if not exists idx_messages_created_at on public.messages (created_at desc);
create index if not exists idx_message_deliveries_message_id on public.message_deliveries (message_id);
create index if not exists idx_message_deliveries_status on public.message_deliveries (status);
create index if not exists idx_case_documents_case_id on public.case_documents (case_id) where deleted_at is null;
create index if not exists idx_case_timeline_case_id on public.case_timeline_events (case_id) where deleted_at is null;
create index if not exists idx_case_timeline_created_at on public.case_timeline_events (created_at desc);
create index if not exists idx_ai_case_summaries_case_id on public.ai_case_summaries (case_id);
create index if not exists idx_feed_posts_created_at on public.feed_posts (created_at desc) where deleted_at is null;
create index if not exists idx_feed_comments_post_id on public.feed_comments (post_id) where deleted_at is null;
create index if not exists idx_app_audit_logs_created_at on public.app_audit_logs (created_at desc);
create index if not exists idx_app_audit_logs_action on public.app_audit_logs (action);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

drop trigger if exists trg_message_deliveries_updated_at on public.message_deliveries;
create trigger trg_message_deliveries_updated_at
before update on public.message_deliveries
for each row execute function public.set_updated_at();

drop trigger if exists trg_case_timeline_events_updated_at on public.case_timeline_events;
create trigger trg_case_timeline_events_updated_at
before update on public.case_timeline_events
for each row execute function public.set_updated_at();

drop trigger if exists trg_ai_case_summaries_updated_at on public.ai_case_summaries;
create trigger trg_ai_case_summaries_updated_at
before update on public.ai_case_summaries
for each row execute function public.set_updated_at();

drop trigger if exists trg_feed_posts_updated_at on public.feed_posts;
create trigger trg_feed_posts_updated_at
before update on public.feed_posts
for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.case_clients enable row level security;
alter table public.messages enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.case_documents enable row level security;
alter table public.case_timeline_events enable row level security;
alter table public.ai_case_summaries enable row level security;
alter table public.feed_posts enable row level security;
alter table public.feed_comments enable row level security;
alter table public.app_audit_logs enable row level security;

drop policy if exists clients_internal_all on public.clients;
create policy clients_internal_all
on public.clients for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists clients_linked_profile_select on public.clients;
create policy clients_linked_profile_select
on public.clients for select
using (profile_id = auth.uid());

drop policy if exists case_clients_internal_all on public.case_clients;
create policy case_clients_internal_all
on public.case_clients for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists messages_internal_all on public.messages;
create policy messages_internal_all
on public.messages for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists message_deliveries_internal_all on public.message_deliveries;
create policy message_deliveries_internal_all
on public.message_deliveries for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists case_documents_internal_all on public.case_documents;
create policy case_documents_internal_all
on public.case_documents for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists case_timeline_events_internal_all on public.case_timeline_events;
create policy case_timeline_events_internal_all
on public.case_timeline_events for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists ai_case_summaries_internal_all on public.ai_case_summaries;
create policy ai_case_summaries_internal_all
on public.ai_case_summaries for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists feed_posts_internal_all on public.feed_posts;
create policy feed_posts_internal_all
on public.feed_posts for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists feed_comments_internal_all on public.feed_comments;
create policy feed_comments_internal_all
on public.feed_comments for all
using (public.is_internal_user())
with check (public.is_internal_user());

drop policy if exists app_audit_logs_internal_insert on public.app_audit_logs;
create policy app_audit_logs_internal_insert
on public.app_audit_logs for insert
with check (public.is_internal_user());

drop policy if exists app_audit_logs_internal_select on public.app_audit_logs;
create policy app_audit_logs_internal_select
on public.app_audit_logs for select
using (public.is_internal_user());

-- Migrate existing profile-based clients to clients table (idempotent best-effort)
insert into public.clients (profile_id, full_name, email, status)
select p.id, p.full_name, null, 'active'
from public.profiles p
where p.role = 'client'
  and not exists (
    select 1 from public.clients c where c.profile_id = p.id
  );

-- Backfill many-to-many links from legacy cases.client_id
insert into public.case_clients (case_id, client_id, created_by)
select c.id, cl.id, c.lawyer_id
from public.cases c
join public.clients cl on cl.profile_id = c.client_id
where c.client_id is not null
  and not exists (
    select 1
    from public.case_clients cc
    where cc.case_id = c.id
      and cc.client_id = cl.id
  );

