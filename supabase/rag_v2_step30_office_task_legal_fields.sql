-- Step 30: Hukuk-odakli gorev alanlari (office_tasks)
-- Amaç:
--   - Görev tipini, yasal tarih tipini, risk ve gizlilik seviyesini tutmak
--   - Ek referans/AI verileri için jsonb metadata alanı sağlamak

begin;

alter table if exists public.office_tasks
  add column if not exists task_type text not null default 'follow_up';

alter table if exists public.office_tasks
  add column if not exists deadline_type text not null default 'due_date';

alter table if exists public.office_tasks
  add column if not exists risk_level text not null default 'medium';

alter table if exists public.office_tasks
  add column if not exists confidentiality_level text not null default 'team';

alter table if exists public.office_tasks
  add column if not exists metadata jsonb not null default '{}'::jsonb;

commit;
