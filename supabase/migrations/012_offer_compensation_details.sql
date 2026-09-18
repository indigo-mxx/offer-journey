alter table public.applications
  add column if not exists offer_compensation_details jsonb not null default '{}'::jsonb;

comment on column public.applications.offer_compensation_details is
  'Structured CNY offer compensation inputs used to estimate annual/monthly gross income, social insurance, housing fund and individual income tax.';
