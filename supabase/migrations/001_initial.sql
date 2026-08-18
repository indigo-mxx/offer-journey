create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'progress', 'full')),
  company text not null,
  position text not null,
  base text not null default '',
  industry_tags text[] not null default '{}',
  company_scale text not null default '',
  batch text not null default '秋招',
  status text not null default '准备投递',
  applied_at date,
  channel text not null default '',
  link text not null default '',
  salary text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_at timestamptz not null,
  ended_at timestamptz,
  round text not null default '一面',
  format text not null default '视频面试',
  interviewer text not null default '',
  result text not null default '待进行',
  summary text not null default '',
  next_steps text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_owner_idx on public.applications(owner_id);
create index if not exists applications_group_idx on public.applications(group_id);
create index if not exists applications_updated_idx on public.applications(updated_at desc);
create index if not exists applications_industry_tags_idx on public.applications using gin (industry_tags);
create index if not exists interviews_application_idx on public.interviews(application_id);
create index if not exists interviews_scheduled_idx on public.interviews(scheduled_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
drop trigger if exists applications_touch_updated_at on public.applications;
create trigger applications_touch_updated_at before update on public.applications
for each row execute function public.touch_updated_at();
drop trigger if exists interviews_touch_updated_at on public.interviews;
create trigger interviews_touch_updated_at before update on public.interviews
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = target_group and user_id = auth.uid()
  );
$$;

create or replace function public.create_group(group_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  created public.groups;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.groups (name, owner_id, invite_code)
  values (
    left(coalesce(nullif(trim(group_name), ''), '秋招搭子小组'), 80),
    auth.uid(),
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ) returning * into created;
  insert into public.group_members (group_id, user_id, role)
  values (created.id, auth.uid(), 'owner');
  return created;
end;
$$;

create or replace function public.join_group(invite text)
returns uuid language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into target from public.groups where invite_code = upper(trim(invite));
  if target is null then raise exception 'invite_not_found'; end if;
  insert into public.group_members (group_id, user_id, role)
  values (target, auth.uid(), 'member') on conflict do nothing;
  return target;
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.applications enable row level security;
alter table public.interviews enable row level security;


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
create index if not exists interview_experiences_owner_updated_idx on public.interview_experiences(owner_id, updated_at desc);
alter table public.interview_experiences enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.group_members mine
  join public.group_members theirs on theirs.group_id = mine.group_id
  where mine.user_id = auth.uid() and theirs.user_id = profiles.id
));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated
using (owner_id = auth.uid() or public.is_group_member(id));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members for select to authenticated using (public.is_group_member(group_id));
drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.groups where id = group_id and owner_id = auth.uid()));

drop policy if exists applications_read on public.applications;
create policy applications_read on public.applications for select to authenticated
using (owner_id = auth.uid() or (visibility <> 'private' and group_id is not null and public.is_group_member(group_id)));
drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists applications_delete on public.applications;
create policy applications_delete on public.applications for delete to authenticated using (owner_id = auth.uid());

drop policy if exists interviews_read on public.interviews;
create policy interviews_read on public.interviews for select to authenticated
using (owner_id = auth.uid() or exists (select 1 from public.applications a where a.id = application_id and a.visibility = 'full' and a.group_id is not null and public.is_group_member(a.group_id)));
drop policy if exists interviews_insert on public.interviews;
create policy interviews_insert on public.interviews for insert to authenticated with check (owner_id = auth.uid() and exists (select 1 from public.applications a where a.id = application_id and a.owner_id = auth.uid()));
drop policy if exists interviews_update on public.interviews;
create policy interviews_update on public.interviews for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists interviews_delete on public.interviews;
create policy interviews_delete on public.interviews for delete to authenticated using (owner_id = auth.uid());


drop policy if exists interview_experiences_select on public.interview_experiences;
create policy interview_experiences_select on public.interview_experiences for select to authenticated using (owner_id = auth.uid());
drop policy if exists interview_experiences_insert on public.interview_experiences;
create policy interview_experiences_insert on public.interview_experiences for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists interview_experiences_update on public.interview_experiences;
create policy interview_experiences_update on public.interview_experiences for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists interview_experiences_delete on public.interview_experiences;
create policy interview_experiences_delete on public.interview_experiences for delete to authenticated using (owner_id = auth.uid());
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
