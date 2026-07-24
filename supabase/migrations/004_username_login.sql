-- Add username column to profiles for username-based login
alter table public.profiles add column if not exists username text;

-- Create unique index on username (case-insensitive, only for non-null values)
create unique index if not exists profiles_username_idx on public.profiles (lower(username)) where username is not null;

-- Add check constraint: username must be 3-20 chars, alphanumeric + underscore
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or (char_length(username) between 3 and 20 and username ~ '^[a-zA-Z0-9_]+$'));

-- RPC: look up email by username (used for username-based login)
-- Security definer so it can bypass RLS; only returns email, nothing else
create or replace function public.get_email_by_username(input text)
returns text language sql security definer set search_path = public as $$
  select email from public.profiles where username = lower(trim(input));
$$;

-- Grant execute to anon so pre-login API can call it
grant execute on function public.get_email_by_username(text) to anon, authenticated;