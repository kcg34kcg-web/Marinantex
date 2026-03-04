-- Social domain bootstrap for Marinantex
-- Safe to run multiple times.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Profile columns required by social/profile pages
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists reputation integer not null default 0;
alter table public.profiles add column if not exists credits integer not null default 0;
alter table public.profiles add column if not exists biography text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists university text;
alter table public.profiles add column if not exists is_private boolean not null default false;
alter table public.profiles add column if not exists is_social_private boolean not null default false;
alter table public.profiles add column if not exists is_academic_private boolean not null default false;

-- ---------------------------------------------------------------------------
-- Social feed tables
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  image_url text,
  category text default 'general',
  is_event boolean not null default false,
  event_date timestamptz,
  event_location jsonb,
  event_status text check (event_status in ('upcoming', 'live', 'archived')) default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_reactions (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('woow', 'doow', 'adil')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comment_reactions (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('woow', 'doow', 'adil')),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create table if not exists public.follows (
  id uuid primary key default uuid_generate_v4(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('like', 'comment', 'reply', 'follow', 'system')),
  title text,
  body text,
  resource_type text,
  resource_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.social_post_interactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('not_interested')),
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create table if not exists public.social_user_controls (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('mute', 'block')),
  created_at timestamptz not null default now(),
  unique (user_id, target_user_id)
);

-- ---------------------------------------------------------------------------
-- Poll tables
-- ---------------------------------------------------------------------------
create table if not exists public.polls (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  question text not null,
  is_anonymous boolean not null default false,
  is_closed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default uuid_generate_v4(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_text text not null,
  display_order integer not null default 0,
  vote_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (poll_id, display_order)
);

create table if not exists public.poll_votes (
  id uuid primary key default uuid_generate_v4(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Direct message tables
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  media_url text,
  media_type text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Direct message legacy-compatibility fixups
-- NOTE: If DM tables were created previously with different column names
-- (e.g. camelCase), CREATE TABLE IF NOT EXISTS will not repair them.
-- These fixups normalize columns so later indexes/policies do not fail.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old text;
begin
  -- conversation_participants: conversationId/userId/lastReadAt/createdAt -> snake_case
  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversation_participants'
    and lower(column_name) = 'conversationid'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_participants'
        and column_name = 'conversation_id'
    )
  then
    execute format(
      'alter table public.conversation_participants rename column %I to conversation_id',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversation_participants'
    and lower(column_name) = 'userid'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_participants'
        and column_name = 'user_id'
    )
  then
    execute format(
      'alter table public.conversation_participants rename column %I to user_id',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversation_participants'
    and lower(column_name) = 'lastreadat'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_participants'
        and column_name = 'last_read_at'
    )
  then
    execute format(
      'alter table public.conversation_participants rename column %I to last_read_at',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'conversation_participants'
    and lower(column_name) = 'createdat'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_participants'
        and column_name = 'created_at'
    )
  then
    execute format(
      'alter table public.conversation_participants rename column %I to created_at',
      v_old
    );
  end if;

  -- messages: conversationId/senderId/mediaUrl/mediaType/deletedAt/createdAt -> snake_case
  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'conversationid'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'conversation_id'
    )
  then
    execute format(
      'alter table public.messages rename column %I to conversation_id',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'senderid'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'sender_id'
    )
  then
    execute format(
      'alter table public.messages rename column %I to sender_id',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'mediaurl'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'media_url'
    )
  then
    execute format(
      'alter table public.messages rename column %I to media_url',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'mediatype'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'media_type'
    )
  then
    execute format(
      'alter table public.messages rename column %I to media_type',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'deletedat'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'deleted_at'
    )
  then
    execute format(
      'alter table public.messages rename column %I to deleted_at',
      v_old
    );
  end if;

  v_old := null;
  select column_name into v_old
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and lower(column_name) = 'createdat'
  limit 1;
  if v_old is not null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'created_at'
    )
  then
    execute format(
      'alter table public.messages rename column %I to created_at',
      v_old
    );
  end if;
end
$$;

alter table public.conversations add column if not exists created_by uuid;
alter table public.conversations add column if not exists last_message_preview text;
alter table public.conversations add column if not exists created_at timestamptz not null default now();
alter table public.conversations add column if not exists updated_at timestamptz not null default now();

alter table public.conversation_participants add column if not exists conversation_id uuid;
alter table public.conversation_participants add column if not exists user_id uuid;
alter table public.conversation_participants add column if not exists last_read_at timestamptz;
alter table public.conversation_participants add column if not exists created_at timestamptz not null default now();

alter table public.messages add column if not exists conversation_id uuid;
alter table public.messages add column if not exists sender_id uuid;
alter table public.messages add column if not exists content text;
alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_participants'
      and column_name = 'conversation_id'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_participants'
      and column_name = 'user_id'
  ) then
    delete from public.conversation_participants a
    using public.conversation_participants b
    where a.ctid > b.ctid
      and a.conversation_id is not distinct from b.conversation_id
      and a.user_id is not distinct from b.user_id;
  end if;
end
$$;

create unique index if not exists uq_conversation_participants_conversation_user
on public.conversation_participants (conversation_id, user_id);

-- ---------------------------------------------------------------------------
-- Debate tables
-- ---------------------------------------------------------------------------
create table if not exists public.social_debates (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text not null default '',
  category text default 'general',
  option_a text not null default 'Katılıyorum',
  option_b text not null default 'Katılmıyorum',
  ai_summary text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  is_daily_featured boolean not null default false,
  featured_date date,
  vote_count_a integer not null default 0,
  vote_count_b integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_debate_votes (
  id uuid primary key default uuid_generate_v4(),
  debate_id uuid not null references public.social_debates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice text not null check (choice in ('A', 'B')),
  change_count integer not null default 0,
  convinced_by_comment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (debate_id, user_id)
);

create table if not exists public.social_debate_comments (
  id uuid primary key default uuid_generate_v4(),
  debate_id uuid not null references public.social_debates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  content text not null,
  persuasion_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (debate_id, user_id)
);

create table if not exists public.social_persuasions (
  id uuid primary key default uuid_generate_v4(),
  debate_id uuid not null references public.social_debates(id) on delete cascade,
  comment_id uuid not null references public.social_debate_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  persuaded_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, persuaded_user_id),
  check (author_id <> persuaded_user_id)
);

create table if not exists public.social_comment_votes (
  id uuid primary key default uuid_generate_v4(),
  comment_id uuid not null references public.social_debate_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote_type smallint not null check (vote_type in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_posts_user_created on public.posts (user_id, created_at desc);
create index if not exists idx_posts_created on public.posts (created_at desc);
create index if not exists idx_posts_event_date on public.posts (event_date) where is_event = true;

create index if not exists idx_post_reactions_post on public.post_reactions (post_id);
create index if not exists idx_post_reactions_user on public.post_reactions (user_id);
create index if not exists idx_post_reactions_type on public.post_reactions (reaction_type);

create index if not exists idx_comments_post on public.comments (post_id, created_at asc);
create index if not exists idx_comments_parent on public.comments (parent_id);
create index if not exists idx_comment_reactions_comment on public.comment_reactions (comment_id);

create index if not exists idx_follows_following on public.follows (following_id, status);
create index if not exists idx_follows_follower on public.follows (follower_id, status);

create index if not exists idx_notifications_recipient_created on public.notifications (recipient_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications (recipient_id, is_read) where is_read = false;

create index if not exists idx_polls_created on public.polls (created_at desc);
create index if not exists idx_polls_expires on public.polls (expires_at);
create index if not exists idx_poll_options_poll on public.poll_options (poll_id, display_order);
create index if not exists idx_poll_votes_poll on public.poll_votes (poll_id);
create index if not exists idx_poll_votes_option on public.poll_votes (option_id);

create index if not exists idx_conversation_participants_user on public.conversation_participants (user_id);
create index if not exists idx_messages_conversation_created on public.messages (conversation_id, created_at desc);

create index if not exists idx_social_debates_active_created on public.social_debates (is_active, created_at desc);
create index if not exists idx_social_debates_daily on public.social_debates (is_daily_featured, featured_date desc);
create index if not exists idx_social_debate_votes_debate on public.social_debate_votes (debate_id);
create index if not exists idx_social_debate_comments_debate on public.social_debate_comments (debate_id, persuasion_count desc);
create index if not exists idx_social_persuasions_comment on public.social_persuasions (comment_id);
create index if not exists idx_social_comment_votes_comment on public.social_comment_votes (comment_id);

create index if not exists idx_social_post_interactions_user_post on public.social_post_interactions (user_id, post_id);
create index if not exists idx_social_user_controls_user_target on public.social_user_controls (user_id, target_user_id);

-- ---------------------------------------------------------------------------
-- Shared trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists trg_comments_updated_at on public.comments;
create trigger trg_comments_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

drop trigger if exists trg_polls_updated_at on public.polls;
create trigger trg_polls_updated_at
before update on public.polls
for each row execute function public.set_updated_at();

drop trigger if exists trg_poll_votes_updated_at on public.poll_votes;
create trigger trg_poll_votes_updated_at
before update on public.poll_votes
for each row execute function public.set_updated_at();

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists trg_social_debates_updated_at on public.social_debates;
create trigger trg_social_debates_updated_at
before update on public.social_debates
for each row execute function public.set_updated_at();

drop trigger if exists trg_social_debate_votes_updated_at on public.social_debate_votes;
create trigger trg_social_debate_votes_updated_at
before update on public.social_debate_votes
for each row execute function public.set_updated_at();

drop trigger if exists trg_social_debate_comments_updated_at on public.social_debate_comments;
create trigger trg_social_debate_comments_updated_at
before update on public.social_debate_comments
for each row execute function public.set_updated_at();

drop trigger if exists trg_social_comment_votes_updated_at on public.social_comment_votes;
create trigger trg_social_comment_votes_updated_at
before update on public.social_comment_votes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Views used by social components/actions
-- ---------------------------------------------------------------------------
create or replace view public.posts_with_stats as
select
  p.*,
  pr.full_name as author_name,
  pr.username as author_username,
  pr.avatar_url as author_avatar,
  coalesce(pr.reputation, 0) as author_reputation,
  coalesce(r.woow_count, 0)::int as woow_count,
  coalesce(r.doow_count, 0)::int as doow_count,
  coalesce(r.adil_count, 0)::int as adil_count,
  coalesce(c.comment_count, 0)::int as comment_count
from public.posts p
join public.profiles pr on pr.id = p.user_id
left join (
  select
    post_id,
    count(*) filter (where reaction_type = 'woow') as woow_count,
    count(*) filter (where reaction_type = 'doow') as doow_count,
    count(*) filter (where reaction_type = 'adil') as adil_count
  from public.post_reactions
  group by post_id
) r on r.post_id = p.id
left join (
  select post_id, count(*) as comment_count
  from public.comments
  group by post_id
) c on c.post_id = p.id;

create or replace view public.comments_with_stats as
select
  c.id,
  c.post_id,
  c.parent_id,
  c.user_id,
  c.content,
  c.created_at,
  c.updated_at,
  p.full_name as author_name,
  p.username as author_username,
  p.avatar_url as author_avatar,
  coalesce(cr.woow_count, 0)::int as woow_count,
  coalesce(cr.doow_count, 0)::int as doow_count,
  coalesce(cr.adil_count, 0)::int as adil_count,
  (
    select count(*)
    from public.comments child
    where child.parent_id = c.id
  )::int as reply_count,
  (
    coalesce(cr.woow_count, 0)
    - coalesce(cr.doow_count, 0)
    + coalesce(cr.adil_count, 0)
  )::int as score
from public.comments c
join public.profiles p on p.id = c.user_id
left join (
  select
    comment_id,
    count(*) filter (where reaction_type = 'woow') as woow_count,
    count(*) filter (where reaction_type = 'doow') as doow_count,
    count(*) filter (where reaction_type = 'adil') as adil_count
  from public.comment_reactions
  group by comment_id
) cr on cr.comment_id = c.id;

-- ---------------------------------------------------------------------------
-- Functions used by social actions/components
-- ---------------------------------------------------------------------------
create or replace function public.fetch_feed_candidates(viewer_id uuid)
returns table (
  id uuid,
  user_id uuid,
  author_id uuid,
  content text,
  image_url text,
  category text,
  is_event boolean,
  event_date timestamptz,
  event_location jsonb,
  event_status text,
  created_at timestamptz,
  woow_count int,
  doow_count int,
  adil_count int,
  comment_count int,
  my_reaction text,
  author_name text,
  author_username text,
  author_avatar text,
  author_reputation int,
  is_following boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.user_id,
    p.user_id as author_id,
    p.content,
    p.image_url,
    p.category,
    p.is_event,
    p.event_date,
    p.event_location,
    p.event_status,
    p.created_at,
    coalesce(pr_counts.woow_count, 0)::int as woow_count,
    coalesce(pr_counts.doow_count, 0)::int as doow_count,
    coalesce(pr_counts.adil_count, 0)::int as adil_count,
    coalesce(c_counts.comment_count, 0)::int as comment_count,
    my_reaction.reaction_type as my_reaction,
    author.full_name as author_name,
    author.username as author_username,
    author.avatar_url as author_avatar,
    coalesce(author.reputation, 0)::int as author_reputation,
    (f.status = 'accepted') as is_following
  from public.posts p
  join public.profiles author on author.id = p.user_id
  left join (
    select
      post_id,
      count(*) filter (where reaction_type = 'woow') as woow_count,
      count(*) filter (where reaction_type = 'doow') as doow_count,
      count(*) filter (where reaction_type = 'adil') as adil_count
    from public.post_reactions
    group by post_id
  ) pr_counts on pr_counts.post_id = p.id
  left join (
    select post_id, count(*) as comment_count
    from public.comments
    group by post_id
  ) c_counts on c_counts.post_id = p.id
  left join public.post_reactions my_reaction
    on my_reaction.post_id = p.id
   and my_reaction.user_id = viewer_id
  left join public.follows f
    on f.follower_id = viewer_id
   and f.following_id = p.user_id
   and f.status = 'accepted'
  where not exists (
    select 1
    from public.social_post_interactions spi
    where spi.user_id = viewer_id
      and spi.post_id = p.id
      and spi.action = 'not_interested'
  )
  and not exists (
    select 1
    from public.social_user_controls suc
    where suc.user_id = viewer_id
      and suc.target_user_id = p.user_id
      and suc.action in ('mute', 'block')
  )
  order by p.created_at desc
  limit 120;
$$;

create or replace function public.handle_reaction(
  p_target_id uuid,
  p_target_type text,
  p_reaction_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing text;
begin
  if v_user_id is null then
    raise exception 'auth required';
  end if;

  if p_target_type not in ('post', 'comment') then
    raise exception 'invalid target type';
  end if;

  if p_reaction_type is not null and p_reaction_type not in ('woow', 'doow', 'adil') then
    raise exception 'invalid reaction type';
  end if;

  if p_target_type = 'post' then
    select reaction_type into v_existing
    from public.post_reactions
    where post_id = p_target_id and user_id = v_user_id;

    if p_reaction_type is null then
      delete from public.post_reactions where post_id = p_target_id and user_id = v_user_id;
    elsif v_existing is null then
      insert into public.post_reactions(post_id, user_id, reaction_type)
      values (p_target_id, v_user_id, p_reaction_type);
    elsif v_existing = p_reaction_type then
      delete from public.post_reactions where post_id = p_target_id and user_id = v_user_id;
      p_reaction_type := null;
    else
      update public.post_reactions
      set reaction_type = p_reaction_type, created_at = now()
      where post_id = p_target_id and user_id = v_user_id;
    end if;
  else
    select reaction_type into v_existing
    from public.comment_reactions
    where comment_id = p_target_id and user_id = v_user_id;

    if p_reaction_type is null then
      delete from public.comment_reactions where comment_id = p_target_id and user_id = v_user_id;
    elsif v_existing is null then
      insert into public.comment_reactions(comment_id, user_id, reaction_type)
      values (p_target_id, v_user_id, p_reaction_type);
    elsif v_existing = p_reaction_type then
      delete from public.comment_reactions where comment_id = p_target_id and user_id = v_user_id;
      p_reaction_type := null;
    else
      update public.comment_reactions
      set reaction_type = p_reaction_type, created_at = now()
      where comment_id = p_target_id and user_id = v_user_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'reaction', p_reaction_type);
end;
$$;

create or replace function public.get_or_create_dm(recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'auth required';
  end if;

  if recipient_id is null or recipient_id = v_user_id then
    raise exception 'invalid recipient';
  end if;

  select c.id
  into v_conversation_id
  from public.conversations c
  join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = v_user_id
  join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = recipient_id
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.conversations (created_by)
  values (v_user_id)
  returning id into v_conversation_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values
    (v_conversation_id, v_user_id),
    (v_conversation_id, recipient_id)
  on conflict do nothing;

  return v_conversation_id;
end;
$$;

create or replace function public.get_debate_feed(
  p_user_id uuid,
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null
)
returns table (
  id uuid,
  title text,
  description text,
  option_a text,
  option_b text,
  ai_summary text,
  created_at timestamptz,
  created_by_data jsonb,
  stats_a int,
  stats_b int,
  user_vote text,
  user_change_count int,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    d.title,
    d.description,
    d.option_a,
    d.option_b,
    d.ai_summary,
    d.created_at,
    jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'username', p.username,
      'avatar_url', p.avatar_url
    ) as created_by_data,
    d.vote_count_a::int as stats_a,
    d.vote_count_b::int as stats_b,
    dv.choice as user_vote,
    coalesce(dv.change_count, 0)::int as user_change_count,
    d.is_active
  from public.social_debates d
  join public.profiles p on p.id = d.created_by
  left join public.social_debate_votes dv
    on dv.debate_id = d.id
   and dv.user_id = p_user_id
  where d.is_active = true
    and (
      p_search is null
      or d.title ilike ('%' || p_search || '%')
      or d.description ilike ('%' || p_search || '%')
      or d.category ilike ('%' || p_search || '%')
    )
  order by d.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

create or replace function public.handle_vote_transaction(
  p_debate_id uuid,
  p_user_id uuid,
  p_new_choice text
)
returns table (new_stats_a int, new_stats_b int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote record;
  v_debate record;
begin
  if p_new_choice not in ('A', 'B') then
    raise exception 'invalid choice';
  end if;

  select id, vote_count_a, vote_count_b
  into v_debate
  from public.social_debates
  where id = p_debate_id
  for update;

  if v_debate.id is null then
    raise exception 'debate not found';
  end if;

  select id, choice, change_count
  into v_vote
  from public.social_debate_votes
  where debate_id = p_debate_id and user_id = p_user_id
  for update;

  if v_vote.id is null then
    insert into public.social_debate_votes (debate_id, user_id, choice, change_count)
    values (p_debate_id, p_user_id, p_new_choice, 0);

    if p_new_choice = 'A' then
      v_debate.vote_count_a := v_debate.vote_count_a + 1;
    else
      v_debate.vote_count_b := v_debate.vote_count_b + 1;
    end if;
  elsif v_vote.choice = p_new_choice then
    null;
  else
    if coalesce(v_vote.change_count, 0) >= 3 then
      raise exception 'Fikir değiştirme limitiniz doldu.';
    end if;

    if v_vote.choice = 'A' then
      v_debate.vote_count_a := greatest(0, v_debate.vote_count_a - 1);
      v_debate.vote_count_b := v_debate.vote_count_b + 1;
    else
      v_debate.vote_count_b := greatest(0, v_debate.vote_count_b - 1);
      v_debate.vote_count_a := v_debate.vote_count_a + 1;
    end if;

    update public.social_debate_votes
    set
      choice = p_new_choice,
      change_count = coalesce(change_count, 0) + 1,
      updated_at = now()
    where id = v_vote.id;
  end if;

  update public.social_debates
  set
    vote_count_a = v_debate.vote_count_a,
    vote_count_b = v_debate.vote_count_b,
    updated_at = now()
  where id = p_debate_id;

  return query select v_debate.vote_count_a::int, v_debate.vote_count_b::int;
end;
$$;

create or replace function public.increment_persuasion(row_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.social_debate_comments
  set persuasion_count = coalesce(persuasion_count, 0) + 1
  where id = row_id;
$$;

create or replace function public.increment_counter(
  table_name text,
  row_id uuid,
  col_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if table_name = 'social_debate_comments' and col_name = 'persuasion_count' then
    update public.social_debate_comments
    set persuasion_count = coalesce(persuasion_count, 0) + 1
    where id = row_id;
  else
    raise exception 'unsupported increment target';
  end if;
end;
$$;

grant execute on function public.fetch_feed_candidates(uuid) to authenticated;
grant execute on function public.handle_reaction(uuid, text, text) to authenticated;
grant execute on function public.get_or_create_dm(uuid) to authenticated;
grant execute on function public.get_debate_feed(uuid, integer, integer, text) to authenticated;
grant execute on function public.handle_vote_transaction(uuid, uuid, text) to authenticated;
grant execute on function public.increment_persuasion(uuid) to authenticated;
grant execute on function public.increment_counter(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.follows enable row level security;
alter table public.notifications enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.social_debates enable row level security;
alter table public.social_debate_votes enable row level security;
alter table public.social_debate_comments enable row level security;
alter table public.social_persuasions enable row level security;
alter table public.social_comment_votes enable row level security;
alter table public.social_post_interactions enable row level security;
alter table public.social_user_controls enable row level security;

drop policy if exists profiles_select_public_social on public.profiles;
create policy profiles_select_public_social
on public.profiles
for select
using (true);

drop policy if exists profiles_insert_self_social on public.profiles;
create policy profiles_insert_self_social
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists profiles_update_self_social on public.profiles;
create policy profiles_update_self_social
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists posts_select_all_social on public.posts;
create policy posts_select_all_social
on public.posts
for select
using (true);

drop policy if exists posts_insert_own_social on public.posts;
create policy posts_insert_own_social
on public.posts
for insert
with check (auth.uid() = user_id);

drop policy if exists posts_update_own_social on public.posts;
create policy posts_update_own_social
on public.posts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists posts_delete_own_social on public.posts;
create policy posts_delete_own_social
on public.posts
for delete
using (auth.uid() = user_id);

drop policy if exists post_reactions_select_all_social on public.post_reactions;
create policy post_reactions_select_all_social
on public.post_reactions
for select
using (true);

drop policy if exists post_reactions_mutate_own_social on public.post_reactions;
create policy post_reactions_mutate_own_social
on public.post_reactions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists comments_select_all_social on public.comments;
create policy comments_select_all_social
on public.comments
for select
using (true);

drop policy if exists comments_insert_own_social on public.comments;
create policy comments_insert_own_social
on public.comments
for insert
with check (auth.uid() = user_id);

drop policy if exists comments_update_own_social on public.comments;
create policy comments_update_own_social
on public.comments
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists comments_delete_own_social on public.comments;
create policy comments_delete_own_social
on public.comments
for delete
using (auth.uid() = user_id);

drop policy if exists comment_reactions_select_all_social on public.comment_reactions;
create policy comment_reactions_select_all_social
on public.comment_reactions
for select
using (true);

drop policy if exists comment_reactions_mutate_own_social on public.comment_reactions;
create policy comment_reactions_mutate_own_social
on public.comment_reactions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists follows_select_all_social on public.follows;
create policy follows_select_all_social
on public.follows
for select
using (true);

drop policy if exists follows_insert_own_social on public.follows;
create policy follows_insert_own_social
on public.follows
for insert
with check (auth.uid() = follower_id);

drop policy if exists follows_delete_own_social on public.follows;
create policy follows_delete_own_social
on public.follows
for delete
using (auth.uid() = follower_id);

drop policy if exists notifications_select_recipient_social on public.notifications;
create policy notifications_select_recipient_social
on public.notifications
for select
using (auth.uid() = recipient_id);

drop policy if exists notifications_update_recipient_social on public.notifications;
create policy notifications_update_recipient_social
on public.notifications
for update
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

drop policy if exists notifications_insert_actor_social on public.notifications;
create policy notifications_insert_actor_social
on public.notifications
for insert
with check (auth.uid() = actor_id or actor_id is null);

drop policy if exists polls_select_all_social on public.polls;
create policy polls_select_all_social
on public.polls
for select
using (true);

drop policy if exists polls_insert_creator_social on public.polls;
create policy polls_insert_creator_social
on public.polls
for insert
with check (auth.uid() = creator_id);

drop policy if exists polls_update_creator_social on public.polls;
create policy polls_update_creator_social
on public.polls
for update
using (auth.uid() = creator_id)
with check (auth.uid() = creator_id);

drop policy if exists poll_options_select_all_social on public.poll_options;
create policy poll_options_select_all_social
on public.poll_options
for select
using (true);

drop policy if exists poll_options_insert_creator_social on public.poll_options;
create policy poll_options_insert_creator_social
on public.poll_options
for insert
with check (
  poll_id in (
    select p.id
    from public.polls p
    where p.creator_id = auth.uid()
  )
);

drop policy if exists poll_votes_select_all_social on public.poll_votes;
create policy poll_votes_select_all_social
on public.poll_votes
for select
using (true);

drop policy if exists poll_votes_insert_own_social on public.poll_votes;
create policy poll_votes_insert_own_social
on public.poll_votes
for insert
with check (auth.uid() = user_id);

drop policy if exists poll_votes_update_own_social on public.poll_votes;
create policy poll_votes_update_own_social
on public.poll_votes
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists poll_votes_delete_own_social on public.poll_votes;
create policy poll_votes_delete_own_social
on public.poll_votes
for delete
using (auth.uid() = user_id);

drop policy if exists conversations_member_select_social on public.conversations;
create policy conversations_member_select_social
on public.conversations
for select
using (
  id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
);

drop policy if exists conversations_create_social on public.conversations;
create policy conversations_create_social
on public.conversations
for insert
with check (auth.uid() = created_by);

drop policy if exists conversations_update_member_social on public.conversations;
create policy conversations_update_member_social
on public.conversations
for update
using (
  id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
)
with check (
  id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
);

drop policy if exists conversation_participants_select_own_social on public.conversation_participants;
create policy conversation_participants_select_own_social
on public.conversation_participants
for select
using (
  auth.uid() = user_id
  or conversation_id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
);

drop policy if exists conversation_participants_insert_member_social on public.conversation_participants;
create policy conversation_participants_insert_member_social
on public.conversation_participants
for insert
with check (
  auth.uid() = user_id
  or conversation_id in (
    select c.id
    from public.conversations c
    where c.created_by = auth.uid()
  )
);

drop policy if exists messages_member_select_social on public.messages;
create policy messages_member_select_social
on public.messages
for select
using (
  conversation_id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
);

drop policy if exists messages_member_insert_social on public.messages;
create policy messages_member_insert_social
on public.messages
for insert
with check (
  auth.uid() = sender_id
  and conversation_id in (
    select cp.conversation_id
    from public.conversation_participants cp
    where cp.user_id = auth.uid()
  )
);

drop policy if exists social_debates_select_all_social on public.social_debates;
create policy social_debates_select_all_social
on public.social_debates
for select
using (true);

drop policy if exists social_debates_insert_creator_social on public.social_debates;
create policy social_debates_insert_creator_social
on public.social_debates
for insert
with check (auth.uid() = created_by);

drop policy if exists social_debates_update_creator_social on public.social_debates;
create policy social_debates_update_creator_social
on public.social_debates
for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

drop policy if exists social_debate_votes_select_own_social on public.social_debate_votes;
create policy social_debate_votes_select_own_social
on public.social_debate_votes
for select
using (auth.uid() = user_id);

drop policy if exists social_debate_votes_mutate_own_social on public.social_debate_votes;
create policy social_debate_votes_mutate_own_social
on public.social_debate_votes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists social_debate_comments_select_all_social on public.social_debate_comments;
create policy social_debate_comments_select_all_social
on public.social_debate_comments
for select
using (true);

drop policy if exists social_debate_comments_insert_own_social on public.social_debate_comments;
create policy social_debate_comments_insert_own_social
on public.social_debate_comments
for insert
with check (auth.uid() = user_id);

drop policy if exists social_debate_comments_update_own_social on public.social_debate_comments;
create policy social_debate_comments_update_own_social
on public.social_debate_comments
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists social_persuasions_select_own_social on public.social_persuasions;
create policy social_persuasions_select_own_social
on public.social_persuasions
for select
using (auth.uid() = persuaded_user_id or auth.uid() = author_id);

drop policy if exists social_persuasions_insert_own_social on public.social_persuasions;
create policy social_persuasions_insert_own_social
on public.social_persuasions
for insert
with check (auth.uid() = persuaded_user_id);

drop policy if exists social_comment_votes_select_own_social on public.social_comment_votes;
create policy social_comment_votes_select_own_social
on public.social_comment_votes
for select
using (auth.uid() = user_id);

drop policy if exists social_comment_votes_mutate_own_social on public.social_comment_votes;
create policy social_comment_votes_mutate_own_social
on public.social_comment_votes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists social_post_interactions_select_own_social on public.social_post_interactions;
create policy social_post_interactions_select_own_social
on public.social_post_interactions
for select
using (auth.uid() = user_id);

drop policy if exists social_post_interactions_mutate_own_social on public.social_post_interactions;
create policy social_post_interactions_mutate_own_social
on public.social_post_interactions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists social_user_controls_select_own_social on public.social_user_controls;
create policy social_user_controls_select_own_social
on public.social_user_controls
for select
using (auth.uid() = user_id);

drop policy if exists social_user_controls_mutate_own_social on public.social_user_controls;
create policy social_user_controls_mutate_own_social
on public.social_user_controls
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
