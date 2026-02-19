-- LexSphere / Portal onboarding helpers

-- 1) Table
create table if not exists public.portal_announcements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_portal_announcements_user_id on public.portal_announcements (user_id);

-- 2) RLS
alter table public.portal_announcements enable row level security;

drop policy if exists "Portal announcements select own" on public.portal_announcements;
create policy "Portal announcements select own"
on public.portal_announcements
for select
using (auth.uid() = user_id);

drop policy if exists "Portal announcements insert own" on public.portal_announcements;
create policy "Portal announcements insert own"
on public.portal_announcements
for insert
with check (auth.uid() = user_id);
