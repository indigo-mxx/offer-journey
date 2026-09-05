-- Allow Chinese usernames while preserving the existing case-insensitive uniqueness rule.
alter table public.profiles drop constraint if exists profiles_username_format;

alter table public.profiles add constraint profiles_username_format
  check (
    username is null or (
      username = trim(username)
      and char_length(username) between 2 and 20
      and username ~ '^[a-zA-Z0-9_一-鿿㐀-䶿]+$'
    )
  );
