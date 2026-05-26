-- Supabase schema for Execution Panel.
-- Run this in Supabase SQL Editor after enabling Auth.

create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  goal text not null default '',
  next_practice_focus text not null default '',
  default_estimate_sec integer not null default 1500,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.item_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  text text not null,
  type text not null default 'action' check (type in ('action', 'check', 'warning', 'improvement')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.item_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  title text not null default '',
  url text not null,
  position integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  item_name_snapshot text not null default '',
  task_title text not null default '',
  goal_snapshot text not null default '',
  focus text not null default '',
  planned_sec integer not null default 0,
  actual_sec integer not null default 0,
  result text not null check (result in ('success', 'fail')),
  progress_rating text check (progress_rating in ('closer', 'same', 'off')),
  quality_score integer check (quality_score between 1 and 5),
  difficulty_score integer check (difficulty_score between 1 and 5),
  focus_score integer check (focus_score between 1 and 5),
  energy_score integer check (energy_score between 1 and 5),
  steps_total integer not null default 0,
  steps_checked integer not null default 0,
  links_opened_count integer not null default 0,
  links_added_count integer not null default 0,
  fail_reason text,
  fail_trigger text,
  note text not null default '',
  reminder text not null default '',
  added_reminder_to_steps boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.practice_steps (
  practice_id uuid not null references public.practices(id) on delete cascade,
  step_id uuid references public.item_steps(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_text_snapshot text not null default '',
  step_type_snapshot text not null default 'action',
  position_snapshot integer not null default 0,
  checked boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (practice_id, position_snapshot)
);

create table if not exists public.practice_links (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  link_id uuid references public.item_links(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('opened', 'added')),
  title_snapshot text not null default '',
  url_snapshot text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inbox_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text not null default '',
  status text not null default 'todo' check (status in ('todo', 'done')),
  promoted_to_item_id uuid references public.items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_items_user_updated on public.items(user_id, updated_at desc);
create index if not exists idx_item_steps_user_item on public.item_steps(user_id, item_id, position);
create index if not exists idx_item_links_user_item on public.item_links(user_id, item_id, position);
create index if not exists idx_practices_user_started on public.practices(user_id, started_at desc);
create index if not exists idx_practices_user_item on public.practices(user_id, item_id, started_at desc);
create index if not exists idx_practice_steps_user_practice on public.practice_steps(user_id, practice_id);
create index if not exists idx_practice_links_user_practice on public.practice_links(user_id, practice_id);
create index if not exists idx_inbox_tasks_user_updated on public.inbox_tasks(user_id, updated_at desc);

alter table public.items enable row level security;
alter table public.item_steps enable row level security;
alter table public.item_links enable row level security;
alter table public.practices enable row level security;
alter table public.practice_steps enable row level security;
alter table public.practice_links enable row level security;
alter table public.inbox_tasks enable row level security;

create policy "items_select_own" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "items_insert_own" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "items_update_own" on public.items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "items_delete_own" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "item_steps_select_own" on public.item_steps
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "item_steps_insert_own" on public.item_steps
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "item_steps_update_own" on public.item_steps
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "item_steps_delete_own" on public.item_steps
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "item_links_select_own" on public.item_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "item_links_insert_own" on public.item_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "item_links_update_own" on public.item_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "item_links_delete_own" on public.item_links
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "practices_select_own" on public.practices
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "practices_insert_own" on public.practices
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "practices_update_own" on public.practices
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "practices_delete_own" on public.practices
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "practice_steps_select_own" on public.practice_steps
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "practice_steps_insert_own" on public.practice_steps
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "practice_steps_update_own" on public.practice_steps
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "practice_steps_delete_own" on public.practice_steps
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "practice_links_select_own" on public.practice_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "practice_links_insert_own" on public.practice_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "practice_links_update_own" on public.practice_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "practice_links_delete_own" on public.practice_links
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "inbox_tasks_select_own" on public.inbox_tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "inbox_tasks_insert_own" on public.inbox_tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "inbox_tasks_update_own" on public.inbox_tasks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "inbox_tasks_delete_own" on public.inbox_tasks
  for delete to authenticated using ((select auth.uid()) = user_id);
