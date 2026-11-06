-- =============================================================================
-- Slowmode and message reminders (20261106140000)
--
-- Slowmode: a channel's settings.slowmode (seconds, 0–21600) limits how often
-- each member can post there. People who can manage messages or channels are
-- exempt. Enforced here, so a modified client can't skip it.
--
-- Reminders: "Remind me" on a message saves it (saved_messages) with a time.
-- When the time comes the app notifies you and clears remind_at; the message
-- stays in Saved. Nothing about the reminder is readable by anyone else.
--
-- Safe to run more than once.
-- =============================================================================

create index if not exists messages_author_recent_idx on public.messages (channel_id, author_id, created_at desc);

create or replace function public.check_slowmode()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_secs integer;
  v_last timestamptz;
begin
  select least(21600, greatest(0, coalesce((c.settings ->> 'slowmode')::integer, 0)))
    into v_secs
    from public.channels c where c.id = new.channel_id;
  if coalesce(v_secs, 0) = 0
     or public.channel_has_permission(new.channel_id, 256, new.author_id)   -- manage messages
     or public.channel_has_permission(new.channel_id, 8, new.author_id) then -- manage channels
    return new;
  end if;
  select max(m.created_at) into v_last
    from public.messages m
   where m.channel_id = new.channel_id and m.author_id = new.author_id
     and m.created_at > now() - make_interval(secs => v_secs);
  if v_last is not null then
    raise exception 'slowmode: wait % seconds', ceil(extract(epoch from (v_last + make_interval(secs => v_secs) - now())))::integer
      using errcode = 'P0001';
  end if;
  return new;
exception when invalid_text_representation then
  return new; -- a malformed setting never blocks posting
end;
$$;
drop trigger if exists messages_slowmode_check on public.messages;
create trigger messages_slowmode_check before insert on public.messages
  for each row execute function public.check_slowmode();

alter table public.saved_messages add column if not exists remind_at timestamptz;
do $$ begin
  alter table public.saved_messages add constraint saved_messages_remind_sane
    check (remind_at is null or remind_at < now() + interval '400 days');
exception when duplicate_object then null; end $$;
create index if not exists saved_messages_remind_idx on public.saved_messages (user_id, remind_at) where remind_at is not null;

notify pgrst, 'reload schema';
