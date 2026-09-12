-- AI 面支持“指定时间 / 截止时间”。旧面试记录继续按指定时间处理。

alter table public.interviews
  add column if not exists timing_type text not null default 'scheduled';

alter table public.interviews
  drop constraint if exists interviews_timing_type_check;
alter table public.interviews
  add constraint interviews_timing_type_check
  check (timing_type in ('scheduled', 'deadline'));

notify pgrst, 'reload schema';
