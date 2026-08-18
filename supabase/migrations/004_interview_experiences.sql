create table if not exists public.interview_experiences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  title text not null default '',
  company text not null default '',
  position text not null default '',
  round text not null default '',
  tags text[] not null default '{}',
  content text not null default '',
  takeaway text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_experiences_owner_updated_idx
  on public.interview_experiences(owner_id, updated_at desc);

alter table public.interview_experiences enable row level security;

drop policy if exists interview_experiences_select on public.interview_experiences;
create policy interview_experiences_select on public.interview_experiences
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists interview_experiences_insert on public.interview_experiences;
create policy interview_experiences_insert on public.interview_experiences
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists interview_experiences_update on public.interview_experiences;
create policy interview_experiences_update on public.interview_experiences
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists interview_experiences_delete on public.interview_experiences;
create policy interview_experiences_delete on public.interview_experiences
  for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.interview_experiences to authenticated;
