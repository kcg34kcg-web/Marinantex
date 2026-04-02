-- =============================================================================
-- Portal V2 - Enterprise Multi-Tenant Foundation (Non-Breaking)
-- =============================================================================
-- Goals:
--   1) Keep existing legal office workflows running (no destructive changes).
--   2) Add tenant-safe tables required for enterprise client portal rollout.
--   3) Enforce append-only audit evidence chain + strict tenant policies.
--   4) Support phased enablement via tenant feature flags.
--
-- Notes:
--   - This migration is additive only.
--   - Existing tables are preserved; legacy paths continue to work.
--   - "tenant_id" is standardized while current "bureau_id" compatibility remains.
-- =============================================================================

begin;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.portal_current_bureau_id()
returns uuid
language sql
stable
as $$
  select p.bureau_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.portal_is_internal_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = coalesce(p_user_id, auth.uid())
      and p.role::text in ('lawyer', 'assistant', 'admin', 'owner')
  );
$$;

create or replace function public.portal_current_client_id()
returns uuid
language sql
stable
as $$
  select c.id
  from public.clients c
  where c.profile_id = auth.uid()
    and c.deleted_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Tenant compatibility columns on existing entities (additive)
-- ---------------------------------------------------------------------------
alter table if exists public.cases add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.documents add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.clients add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.case_clients add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.case_documents add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.case_timeline_events add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.case_updates add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.ai_case_summaries add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;
alter table if exists public.notifications add column if not exists tenant_id uuid references public.bureaus(id) on delete set null;

update public.cases set tenant_id = bureau_id where tenant_id is null and bureau_id is not null;
update public.documents set tenant_id = bureau_id where tenant_id is null and bureau_id is not null;
update public.clients c
set tenant_id = p.bureau_id
from public.profiles p
where c.tenant_id is null
  and c.profile_id = p.id
  and p.bureau_id is not null;
update public.case_clients cc
set tenant_id = c.bureau_id
from public.cases c
where cc.tenant_id is null
  and cc.case_id = c.id
  and c.bureau_id is not null;
update public.case_documents d
set tenant_id = c.bureau_id
from public.cases c
where d.tenant_id is null
  and d.case_id = c.id
  and c.bureau_id is not null;
update public.case_timeline_events e
set tenant_id = c.bureau_id
from public.cases c
where e.tenant_id is null
  and e.case_id = c.id
  and c.bureau_id is not null;
update public.case_updates u
set tenant_id = c.bureau_id
from public.cases c
where u.tenant_id is null
  and u.case_id = c.id
  and c.bureau_id is not null;
update public.ai_case_summaries s
set tenant_id = c.bureau_id
from public.cases c
where s.tenant_id is null
  and s.case_id = c.id
  and c.bureau_id is not null;
update public.notifications n
set tenant_id = p.bureau_id
from public.profiles p
where n.tenant_id is null
  and n.recipient_id = p.id
  and p.bureau_id is not null;

create index if not exists idx_cases_tenant_id on public.cases (tenant_id) where tenant_id is not null;
create index if not exists idx_clients_tenant_id on public.clients (tenant_id) where tenant_id is not null;
create index if not exists idx_case_clients_tenant_id on public.case_clients (tenant_id) where tenant_id is not null;
create index if not exists idx_case_documents_tenant_id on public.case_documents (tenant_id) where tenant_id is not null;
create index if not exists idx_case_timeline_events_tenant_id on public.case_timeline_events (tenant_id) where tenant_id is not null;
create index if not exists idx_case_updates_tenant_id on public.case_updates (tenant_id) where tenant_id is not null;
create index if not exists idx_ai_case_summaries_tenant_id on public.ai_case_summaries (tenant_id) where tenant_id is not null;
create index if not exists idx_notifications_tenant_id on public.notifications (tenant_id) where tenant_id is not null;

-- ---------------------------------------------------------------------------
-- Feature flags (phased rollout)
-- ---------------------------------------------------------------------------
create table if not exists public.portal_feature_flags (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  rollout_percentage integer not null default 0 check (rollout_percentage between 0 and 100),
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key)
);

create index if not exists idx_portal_feature_flags_tenant on public.portal_feature_flags (tenant_id, flag_key);

alter table public.portal_feature_flags enable row level security;

drop policy if exists portal_feature_flags_service_role_all on public.portal_feature_flags;
create policy portal_feature_flags_service_role_all
  on public.portal_feature_flags for all to service_role
  using (true)
  with check (true);

drop policy if exists portal_feature_flags_tenant_read on public.portal_feature_flags;
create policy portal_feature_flags_tenant_read
  on public.portal_feature_flags for select to authenticated
  using (tenant_id is not distinct from public.portal_current_bureau_id());

drop policy if exists portal_feature_flags_internal_write on public.portal_feature_flags;
create policy portal_feature_flags_internal_write
  on public.portal_feature_flags for all to authenticated
  using (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  )
  with check (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

-- ---------------------------------------------------------------------------
-- RBAC matrix: roles, permissions, role_permissions
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  code text not null,
  label text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.permissions (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  scope text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.user_role_assignments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists idx_user_role_assignments_active
  on public.user_role_assignments (tenant_id, user_id, role_id)
  where revoked_at is null;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_role_assignments enable row level security;

drop policy if exists roles_service_role_all on public.roles;
create policy roles_service_role_all on public.roles for all to service_role using (true) with check (true);
drop policy if exists roles_tenant_read on public.roles;
create policy roles_tenant_read
  on public.roles for select to authenticated
  using (tenant_id is not distinct from public.portal_current_bureau_id());
drop policy if exists roles_internal_write on public.roles;
create policy roles_internal_write
  on public.roles for all to authenticated
  using (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  )
  with check (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

drop policy if exists permissions_read_authenticated on public.permissions;
create policy permissions_read_authenticated
  on public.permissions for select to authenticated
  using (auth.uid() is not null);
drop policy if exists permissions_internal_write on public.permissions;
create policy permissions_internal_write
  on public.permissions for all to authenticated
  using (public.portal_is_internal_user())
  with check (public.portal_is_internal_user());
drop policy if exists permissions_service_role_all on public.permissions;
create policy permissions_service_role_all on public.permissions for all to service_role using (true) with check (true);

drop policy if exists role_permissions_service_role_all on public.role_permissions;
create policy role_permissions_service_role_all
  on public.role_permissions for all to service_role
  using (true)
  with check (true);
drop policy if exists role_permissions_tenant_read on public.role_permissions;
create policy role_permissions_tenant_read
  on public.role_permissions for select to authenticated
  using (
    exists (
      select 1
      from public.roles r
      where r.id = role_permissions.role_id
        and r.tenant_id is not distinct from public.portal_current_bureau_id()
    )
  );
drop policy if exists role_permissions_internal_write on public.role_permissions;
create policy role_permissions_internal_write
  on public.role_permissions for all to authenticated
  using (
    public.portal_is_internal_user()
    and exists (
      select 1
      from public.roles r
      where r.id = role_permissions.role_id
        and r.tenant_id is not distinct from public.portal_current_bureau_id()
    )
  )
  with check (
    public.portal_is_internal_user()
    and exists (
      select 1
      from public.roles r
      where r.id = role_permissions.role_id
        and r.tenant_id is not distinct from public.portal_current_bureau_id()
    )
  );

drop policy if exists user_role_assignments_service_role_all on public.user_role_assignments;
create policy user_role_assignments_service_role_all
  on public.user_role_assignments for all to service_role
  using (true)
  with check (true);
drop policy if exists user_role_assignments_tenant_read on public.user_role_assignments;
create policy user_role_assignments_tenant_read
  on public.user_role_assignments for select to authenticated
  using (tenant_id is not distinct from public.portal_current_bureau_id());
drop policy if exists user_role_assignments_internal_write on public.user_role_assignments;
create policy user_role_assignments_internal_write
  on public.user_role_assignments for all to authenticated
  using (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  )
  with check (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

-- ---------------------------------------------------------------------------
-- Sessions (JWT refresh/session management + device/IP tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  refresh_token_hash text not null,
  device_id text not null,
  device_name text,
  ip_address inet,
  user_agent_hash text,
  two_factor_method text,
  two_factor_verified_at timestamptz,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_tenant_user on public.sessions (tenant_id, user_id, last_seen_at desc);
create unique index if not exists idx_sessions_refresh_token_hash on public.sessions (refresh_token_hash);
create index if not exists idx_sessions_device on public.sessions (tenant_id, user_id, device_id);

alter table public.sessions enable row level security;

drop policy if exists sessions_service_role_all on public.sessions;
create policy sessions_service_role_all on public.sessions for all to service_role using (true) with check (true);
drop policy if exists sessions_owner_select on public.sessions;
create policy sessions_owner_select
  on public.sessions for select to authenticated
  using (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists sessions_owner_insert on public.sessions;
create policy sessions_owner_insert
  on public.sessions for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists sessions_owner_update on public.sessions;
create policy sessions_owner_update
  on public.sessions for update to authenticated
  using (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  )
  with check (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

-- ---------------------------------------------------------------------------
-- Consents (GDPR/KVKK explicit consent + versioning)
-- ---------------------------------------------------------------------------
create table if not exists public.consents (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null,
  consent_version text not null,
  legal_basis text,
  accepted boolean not null default true,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  locale text not null default 'tr-TR',
  proof_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, consent_type, consent_version)
);

create index if not exists idx_consents_tenant_user on public.consents (tenant_id, user_id, consent_type, accepted_at desc);

alter table public.consents enable row level security;

drop policy if exists consents_service_role_all on public.consents;
create policy consents_service_role_all on public.consents for all to service_role using (true) with check (true);
drop policy if exists consents_owner_read on public.consents;
create policy consents_owner_read
  on public.consents for select to authenticated
  using (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists consents_owner_write on public.consents;
create policy consents_owner_write
  on public.consents for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists consents_internal_read on public.consents;
create policy consents_internal_read
  on public.consents for select to authenticated
  using (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

-- ---------------------------------------------------------------------------
-- AI requests (security & governance ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_requests (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  document_id uuid references public.case_documents(id) on delete set null,
  request_type text not null,
  provider text not null,
  model text not null,
  prompt_hash text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'timeout', 'blocked')),
  confidence_score numeric(5,4),
  input_token_count integer,
  output_token_count integer,
  latency_ms integer,
  prompt_injection_detected boolean not null default false,
  pii_detected boolean not null default false,
  disclaimer_shown boolean not null default false,
  no_retention_mode boolean not null default false,
  policy_flags text[] not null default '{}',
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_requests_tenant_case on public.ai_requests (tenant_id, case_id, created_at desc);
create index if not exists idx_ai_requests_tenant_user on public.ai_requests (tenant_id, user_id, created_at desc);
create index if not exists idx_ai_requests_status on public.ai_requests (tenant_id, status, created_at desc);

alter table public.ai_requests enable row level security;

drop policy if exists ai_requests_service_role_all on public.ai_requests;
create policy ai_requests_service_role_all on public.ai_requests for all to service_role using (true) with check (true);
drop policy if exists ai_requests_owner_read on public.ai_requests;
create policy ai_requests_owner_read
  on public.ai_requests for select to authenticated
  using (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists ai_requests_internal_read on public.ai_requests;
create policy ai_requests_internal_read
  on public.ai_requests for select to authenticated
  using (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );
drop policy if exists ai_requests_owner_insert on public.ai_requests;
create policy ai_requests_owner_insert
  on public.ai_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

-- ---------------------------------------------------------------------------
-- Portal messages (immutable case-based threads for clients)
-- ---------------------------------------------------------------------------
create table if not exists public.portal_case_messages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint portal_case_messages_body_not_empty check (char_length(trim(body)) > 0)
);

create table if not exists public.portal_message_reads (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  message_id uuid not null references public.portal_case_messages(id) on delete cascade,
  reader_user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, reader_user_id)
);

create index if not exists idx_portal_case_messages_tenant_case
  on public.portal_case_messages (tenant_id, case_id, created_at desc);
create index if not exists idx_portal_case_messages_client
  on public.portal_case_messages (tenant_id, client_id, created_at desc);
create index if not exists idx_portal_message_reads_message
  on public.portal_message_reads (tenant_id, message_id, read_at desc);

alter table public.portal_case_messages enable row level security;
alter table public.portal_message_reads enable row level security;

drop policy if exists portal_case_messages_service_role_all on public.portal_case_messages;
create policy portal_case_messages_service_role_all
  on public.portal_case_messages for all to service_role
  using (true)
  with check (true);

drop policy if exists portal_case_messages_tenant_read on public.portal_case_messages;
create policy portal_case_messages_tenant_read
  on public.portal_case_messages for select to authenticated
  using (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and (
      public.portal_is_internal_user()
      or sender_user_id = auth.uid()
      or client_id = public.portal_current_client_id()
    )
  );

drop policy if exists portal_case_messages_client_insert on public.portal_case_messages;
create policy portal_case_messages_client_insert
  on public.portal_case_messages for insert to authenticated
  with check (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and sender_user_id = auth.uid()
    and client_id = public.portal_current_client_id()
    and exists (
      select 1
      from public.case_clients cc
      where cc.case_id = portal_case_messages.case_id
        and cc.client_id = portal_case_messages.client_id
        and cc.deleted_at is null
    )
  );

drop policy if exists portal_case_messages_internal_insert on public.portal_case_messages;
create policy portal_case_messages_internal_insert
  on public.portal_case_messages for insert to authenticated
  with check (
    public.portal_is_internal_user()
    and tenant_id is not distinct from public.portal_current_bureau_id()
  );

drop policy if exists portal_message_reads_service_role_all on public.portal_message_reads;
create policy portal_message_reads_service_role_all
  on public.portal_message_reads for all to service_role
  using (true)
  with check (true);

drop policy if exists portal_message_reads_tenant_read on public.portal_message_reads;
create policy portal_message_reads_tenant_read
  on public.portal_message_reads for select to authenticated
  using (tenant_id is not distinct from public.portal_current_bureau_id());

drop policy if exists portal_message_reads_tenant_insert on public.portal_message_reads;
create policy portal_message_reads_tenant_insert
  on public.portal_message_reads for insert to authenticated
  with check (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and reader_user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Document versions (portal document version history)
-- ---------------------------------------------------------------------------
create table if not exists public.document_versions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  document_id uuid not null references public.case_documents(id) on delete cascade,
  version_no integer not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  storage_path text,
  checksum_sha256 text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

create index if not exists idx_document_versions_tenant_document
  on public.document_versions (tenant_id, document_id, version_no desc);

alter table public.document_versions enable row level security;

drop policy if exists document_versions_service_role_all on public.document_versions;
create policy document_versions_service_role_all
  on public.document_versions for all to service_role
  using (true)
  with check (true);

drop policy if exists document_versions_internal_read on public.document_versions;
create policy document_versions_internal_read
  on public.document_versions for select to authenticated
  using (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and public.portal_is_internal_user()
  );

drop policy if exists document_versions_client_read on public.document_versions;
create policy document_versions_client_read
  on public.document_versions for select to authenticated
  using (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and exists (
      select 1
      from public.case_documents d
      join public.case_clients cc
        on cc.case_id = d.case_id
       and cc.deleted_at is null
      where d.id = document_versions.document_id
        and cc.client_id = public.portal_current_client_id()
    )
  );

drop policy if exists document_versions_internal_insert on public.document_versions;
create policy document_versions_internal_insert
  on public.document_versions for insert to authenticated
  with check (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and public.portal_is_internal_user()
  );

-- ---------------------------------------------------------------------------
-- Audit logs (immutable append-only evidence grade)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.bureaus(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  object_type text not null,
  object_id text,
  request_id text,
  ip_address inet,
  user_agent_hash text,
  result text not null default 'success' check (result in ('success', 'denied', 'error')),
  reason_code text,
  data_classification text not null default 'general',
  metadata jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_tenant_occurred_at on public.audit_logs (tenant_id, occurred_at desc);
create index if not exists idx_audit_logs_tenant_event_type on public.audit_logs (tenant_id, event_type, occurred_at desc);
create index if not exists idx_audit_logs_object on public.audit_logs (tenant_id, object_type, object_id);
create unique index if not exists idx_audit_logs_event_hash_unique on public.audit_logs (event_hash) where event_hash is not null;

create or replace function public.portal_set_audit_hash_chain()
returns trigger
language plpgsql
as $$
declare
  previous_event_hash text;
begin
  select a.event_hash
    into previous_event_hash
  from public.audit_logs a
  where a.tenant_id = new.tenant_id
  order by a.occurred_at desc, a.id desc
  limit 1;

  new.previous_hash := previous_event_hash;
  new.event_hash := encode(
    digest(
      concat_ws(
        '|',
        coalesce(new.previous_hash, ''),
        coalesce(new.tenant_id::text, ''),
        coalesce(new.actor_user_id::text, ''),
        coalesce(new.event_type, ''),
        coalesce(new.object_type, ''),
        coalesce(new.object_id, ''),
        coalesce(new.request_id, ''),
        coalesce(new.result, ''),
        coalesce(new.data_classification, ''),
        coalesce(new.metadata::text, ''),
        coalesce(new.occurred_at::text, now()::text)
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create or replace function public.portal_prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only and cannot be mutated';
end;
$$;

drop trigger if exists trg_audit_logs_hash_chain on public.audit_logs;
create trigger trg_audit_logs_hash_chain
before insert on public.audit_logs
for each row execute function public.portal_set_audit_hash_chain();

drop trigger if exists trg_audit_logs_no_update on public.audit_logs;
create trigger trg_audit_logs_no_update
before update on public.audit_logs
for each row execute function public.portal_prevent_audit_mutation();

drop trigger if exists trg_audit_logs_no_delete on public.audit_logs;
create trigger trg_audit_logs_no_delete
before delete on public.audit_logs
for each row execute function public.portal_prevent_audit_mutation();

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_service_role_all on public.audit_logs;
create policy audit_logs_service_role_all
  on public.audit_logs for all to service_role
  using (true)
  with check (true);

drop policy if exists audit_logs_tenant_insert on public.audit_logs;
create policy audit_logs_tenant_insert
  on public.audit_logs for insert to authenticated
  with check (tenant_id is not distinct from public.portal_current_bureau_id());

drop policy if exists audit_logs_internal_read on public.audit_logs;
create policy audit_logs_internal_read
  on public.audit_logs for select to authenticated
  using (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and public.portal_is_internal_user()
  );

drop policy if exists audit_logs_actor_read on public.audit_logs;
create policy audit_logs_actor_read
  on public.audit_logs for select to authenticated
  using (
    tenant_id is not distinct from public.portal_current_bureau_id()
    and actor_user_id = auth.uid()
  );

-- Backward-compatible read alias.
create or replace view public.portal_audit_logs as
select
  id,
  tenant_id,
  actor_user_id,
  event_type,
  object_type,
  object_id,
  request_id,
  ip_address::text as ip_address,
  user_agent_hash,
  result,
  reason_code,
  data_classification,
  metadata,
  previous_hash,
  event_hash,
  occurred_at,
  created_at
from public.audit_logs;

commit;
