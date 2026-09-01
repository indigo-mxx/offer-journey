alter table public.interview_experiences
  add column if not exists interview_id uuid references public.interviews(id) on delete set null;

create index if not exists interview_experiences_interview_idx
  on public.interview_experiences(interview_id);

-- Link existing notes when the application and normalized round identify one interview.
with candidates as (
  select
    experience.id as experience_id,
    interview.id as interview_id,
    row_number() over (
      partition by experience.id
      order by interview.scheduled_at desc, interview.updated_at desc
    ) as candidate_rank
  from public.interview_experiences experience
  join public.interviews interview
    on interview.application_id = experience.application_id
   and interview.owner_id = experience.owner_id
   and regexp_replace(lower(interview.round), '(技术|面试|面|轮|第|[[:space:]])', '', 'g')
       = regexp_replace(lower(experience.round), '(技术|面试|面|轮|第|[[:space:]])', '', 'g')
  where experience.interview_id is null
)
update public.interview_experiences experience
set interview_id = candidates.interview_id
from candidates
where experience.id = candidates.experience_id
  and candidates.candidate_rank = 1;
