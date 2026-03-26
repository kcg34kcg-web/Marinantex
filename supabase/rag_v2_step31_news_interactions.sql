-- Step 31: Dashboard news interaction state (read/save/share)

create table if not exists public.office_news_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  news_id text not null,
  is_read boolean not null default false,
  is_saved boolean not null default false,
  share_count integer not null default 0 check (share_count >= 0),
  last_shared_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint office_news_interactions_news_id_not_empty check (char_length(trim(news_id)) > 0),
  constraint office_news_interactions_user_news_unique unique (user_id, news_id)
);

create index if not exists idx_office_news_interactions_user_updated
  on public.office_news_interactions (user_id, updated_at desc);

create index if not exists idx_office_news_interactions_saved
  on public.office_news_interactions (user_id, is_saved);

drop trigger if exists trg_office_news_interactions_updated_at on public.office_news_interactions;
create trigger trg_office_news_interactions_updated_at
before update on public.office_news_interactions
for each row execute function public.set_updated_at();

alter table public.office_news_interactions enable row level security;

drop policy if exists "Office news interactions internal select" on public.office_news_interactions;
create policy "Office news interactions internal select"
on public.office_news_interactions
for select
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office news interactions internal insert" on public.office_news_interactions;
create policy "Office news interactions internal insert"
on public.office_news_interactions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office news interactions internal update" on public.office_news_interactions;
create policy "Office news interactions internal update"
on public.office_news_interactions
for update
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('lawyer', 'assistant')
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('lawyer', 'assistant')
  )
);

drop policy if exists "Office news interactions internal delete" on public.office_news_interactions;
create policy "Office news interactions internal delete"
on public.office_news_interactions
for delete
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('lawyer', 'assistant')
  )
);
