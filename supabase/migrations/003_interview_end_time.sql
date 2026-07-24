-- 面试记录支持结束时间，旧记录保持为空并继续兼容。
alter table public.interviews
  add column if not exists ended_at timestamptz;
