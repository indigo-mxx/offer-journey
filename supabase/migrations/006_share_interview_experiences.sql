alter table public.interview_experiences
  add column if not exists group_id uuid references public.groups(id) on delete set null,
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'full'));

create index if not exists interview_experiences_group_visibility_idx
  on public.interview_experiences(group_id, visibility);

drop policy if exists interview_experiences_select on public.interview_experiences;
create policy interview_experiences_select on public.interview_experiences
  for select to authenticated using (
    owner_id = auth.uid()
    or (
      visibility = 'full'
      and group_id is not null
      and public.is_group_member(group_id)
    )
  );

drop policy if exists interview_experiences_insert on public.interview_experiences;
create policy interview_experiences_insert on public.interview_experiences
  for insert to authenticated with check (
    owner_id = auth.uid()
    and (
      (visibility = 'private' and group_id is null)
      or (visibility = 'full' and group_id is not null and public.is_group_member(group_id))
    )
  );

drop policy if exists interview_experiences_update on public.interview_experiences;
create policy interview_experiences_update on public.interview_experiences
  for update to authenticated using (owner_id = auth.uid()) with check (
    owner_id = auth.uid()
    and (
      (visibility = 'private' and group_id is null)
      or (visibility = 'full' and group_id is not null and public.is_group_member(group_id))
    )
  );
