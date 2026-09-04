-- 招聘日历：面试继续使用 interviews，笔试、测评、截止事项等存放在 recruitment_events。
-- 本迁移仅新增字段与表，不删除或改写现有岗位、面试、面经数据。

alter table public.interviews
  add column if not exists location text not null default '',
  add column if not exists event_url text not null default '';

create table if not exists public.recruitment_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('written_test', 'assessment', 'deadline', 'hr_contact', 'other')),
  title text not null check (char_length(title) between 1 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  mode text not null default '',
  location text not null default '',
  event_url text not null default '',
  status text not null default '待进行' check (status in ('待进行', '已完成', '已取消')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_events_time_order check (ends_at is null or ends_at >= starts_at)
);

create index if not exists recruitment_events_owner_starts_idx
  on public.recruitment_events(owner_id, starts_at);
create index if not exists recruitment_events_application_starts_idx
  on public.recruitment_events(application_id, starts_at);

drop trigger if exists recruitment_events_touch_updated_at on public.recruitment_events;
create trigger recruitment_events_touch_updated_at before update on public.recruitment_events
for each row execute function public.touch_updated_at();

alter table public.recruitment_events enable row level security;

drop policy if exists recruitment_events_read on public.recruitment_events;
create policy recruitment_events_read on public.recruitment_events
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.applications application
      where application.id = application_id
        and application.visibility = 'full'
        and application.group_id is not null
        and public.is_group_member(application.group_id)
    )
  );

drop policy if exists recruitment_events_insert on public.recruitment_events;
create policy recruitment_events_insert on public.recruitment_events
  for insert to authenticated with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.applications application
      where application.id = application_id and application.owner_id = auth.uid()
    )
  );

drop policy if exists recruitment_events_update on public.recruitment_events;
create policy recruitment_events_update on public.recruitment_events
  for update to authenticated using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.applications application
      where application.id = application_id and application.owner_id = auth.uid()
    )
  );

drop policy if exists recruitment_events_delete on public.recruitment_events;
create policy recruitment_events_delete on public.recruitment_events
  for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.recruitment_events to authenticated;

-- 立即让 PostgREST 刷新 schema cache，避免新表或字段短时间内提示“找不到列”。
notify pgrst, 'reload schema';
