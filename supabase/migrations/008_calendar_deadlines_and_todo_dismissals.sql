-- 支持“指定时间 / 截止时间”两类笔试，并持久化用户主动忽略的待做提醒。
-- 本迁移不会删除或改写现有日程；旧日程统一按“指定时间”处理。

alter table public.recruitment_events
  add column if not exists timing_type text not null default 'scheduled';

alter table public.recruitment_events
  drop constraint if exists recruitment_events_timing_type_check;
alter table public.recruitment_events
  add constraint recruitment_events_timing_type_check
  check (timing_type in ('scheduled', 'deadline'));

create table if not exists public.todo_dismissals (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reminder_key text not null check (char_length(reminder_key) between 1 and 300),
  dismissed_at timestamptz not null default now(),
  primary key (owner_id, reminder_key)
);

alter table public.todo_dismissals enable row level security;

drop policy if exists todo_dismissals_read on public.todo_dismissals;
create policy todo_dismissals_read on public.todo_dismissals
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists todo_dismissals_insert on public.todo_dismissals;
create policy todo_dismissals_insert on public.todo_dismissals
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists todo_dismissals_update on public.todo_dismissals;
create policy todo_dismissals_update on public.todo_dismissals
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists todo_dismissals_delete on public.todo_dismissals;
create policy todo_dismissals_delete on public.todo_dismissals
  for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.todo_dismissals to authenticated;

notify pgrst, 'reload schema';
