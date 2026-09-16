alter table public.applications
  add column if not exists offer_received_at timestamptz,
  add column if not exists offer_deadline timestamptz,
  add column if not exists offer_onboard_date date,
  add column if not exists offer_compensation text not null default '',
  add column if not exists offer_benefits text not null default '',
  add column if not exists offer_contact text not null default '',
  add column if not exists offer_note text not null default '',
  add column if not exists offer_shared boolean not null default false;

comment on column public.applications.offer_shared is
  'When true, offer details are visible to members who can read the fully shared application.';
