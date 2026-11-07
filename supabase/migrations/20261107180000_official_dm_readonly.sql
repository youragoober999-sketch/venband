-- =============================================================================
-- The official Venband chat is read-only (20261107180000)
--
--   * Nobody can send messages into their DM with the official Venband account:
--     it's reserved for official notifications (those arrive as bot messages,
--     which this doesn't touch).
--   * The Venband account's profile gets a dark graphite banner (the app shows
--     the Venband logo as its picture) instead of the default initial on pink.
--
-- Safe to run more than once.
-- =============================================================================
create or replace function public.block_official_dm() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id <> '3fff0000-0000-4000-8000-0000000000bd'
     and exists (select 1 from public.dm_participants
                  where channel_id = new.channel_id and user_id = '3fff0000-0000-4000-8000-0000000000bd') then
    raise exception 'This chat is reserved for official Venband notifications.';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_official_dm_readonly on public.messages;
create trigger messages_official_dm_readonly before insert on public.messages
  for each row execute function public.block_official_dm();

update public.profiles
   set banner_color = '#26262c',
       banner_color2 = '#0b0b0f',
       about = case when coalesce(about, '') = '' then 'The official Venband account. It only sends account notices and security alerts — and never asks for your password.' else about end
 where id = '3fff0000-0000-4000-8000-0000000000bd';

notify pgrst, 'reload schema';
