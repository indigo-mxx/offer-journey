-- 公司画像字段：支持多行业标签、公司规模以及按标签筛选。
alter table public.applications
  add column if not exists industry_tags text[] not null default '{}';

alter table public.applications
  add column if not exists company_scale text not null default '';

create index if not exists applications_industry_tags_idx
  on public.applications using gin (industry_tags);
