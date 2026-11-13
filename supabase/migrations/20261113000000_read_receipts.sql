alter table public.read_states add column if not exists seen_at timestamptz;

-- Advance a read marker without moving it backwards on a second device.
create or replace function public.mark_channel_read(p_channel uuid, p_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into public.read_states as r (user_id, channel_id, last_read_at, manual_unread, seen_at)
  select auth.uid(), p_channel, least(p_at, statement_timestamp()), false,
    case when coalesce((select data #> '{chat,readReceipts}' from public.user_settings where user_id = auth.uid()), 'true'::jsonb) = 'true'::jsonb
      then least(p_at, statement_timestamp()) end
  where auth.uid() is not null and p_at is not null
    and public.can_view_channel(p_channel, auth.uid())
  on conflict (user_id, channel_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
        seen_at = greatest(r.seen_at, excluded.seen_at),
        manual_unread = case when excluded.last_read_at >= r.last_read_at then false else r.manual_unread end,
        updated_at = statement_timestamp()
    where excluded.last_read_at >= r.last_read_at or excluded.seen_at > r.seen_at
      or (r.seen_at is null and excluded.seen_at is not null);
$$;

create or replace function public.mark_all_channels_read()
returns void language sql security definer set search_path = '' as $$
  insert into public.read_states as r (user_id, channel_id, last_read_at, manual_unread)
  select auth.uid(), c.id, statement_timestamp(), false
  from public.channels c
  where auth.uid() is not null
    and public.can_view_channel(c.id, auth.uid())
  order by c.id
  on conflict (user_id, channel_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
        manual_unread = false, updated_at = statement_timestamp();
$$;

-- Return only the count for a message the caller actually sent in this DM.
create or replace function public.dm_seen_count(p_channel uuid, p_message uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.messages m
  join public.channels c on c.id = m.channel_id and c.type = 'dm'
  join public.dm_participants d on d.channel_id = c.id and d.user_id <> auth.uid()
  join public.read_states r on r.channel_id = c.id and r.user_id = d.user_id
  left join public.user_settings s on s.user_id = d.user_id
  where m.id = p_message and m.channel_id = p_channel and m.author_id = auth.uid()
    and public.can_view_channel(c.id, auth.uid())
    and r.seen_at >= m.created_at
    and coalesce(s.data #> '{chat,readReceipts}', 'true'::jsonb) = 'true'::jsonb;
$$;

revoke execute on function public.mark_channel_read(uuid,timestamptz),
  public.mark_all_channels_read(), public.dm_seen_count(uuid,uuid) from public, anon;
grant execute on function public.mark_channel_read(uuid,timestamptz),
  public.mark_all_channels_read(), public.dm_seen_count(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
