-- =============================================================================
-- Realtime topic for activities (20261106130000)
--
-- Games you play together in a channel (Stackdown, …) sync over the realtime
-- topic "act:<channel id>". Anyone who can see the channel can join.
--
-- Safe to run more than once.
-- =============================================================================

create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id_text text := split_part(p_topic, ':', 2);
  v_id uuid;
begin
  if v_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := v_id_text::uuid;
  if v_kind = 'scope' then
    return public.is_server_member(v_id)
        or exists (select 1 from public.dm_participants where channel_id = v_id and user_id = auth.uid());
  elsif v_kind = 'chan' then
    return public.can_view_channel(v_id);
  elsif v_kind in ('dmb', 'dmc') then  -- bot DM feeds (presence / commands)
    return public.can_view_channel(v_id);
  elsif v_kind = 'dbs' then   -- database change feed for a server
    return public.is_server_member(v_id);
  elsif v_kind = 'dbc' then   -- database change feed for a channel
    return public.can_view_channel(v_id);
  elsif v_kind = 'dbu' then   -- database change feed for the user themself
    return v_id = auth.uid();
  elsif v_kind = 'call' then
    return public.channel_has_permission(v_id, 512)
       and exists (select 1 from public.channels c where c.id = v_id and c.type in ('voice', 'dm'));
  elsif v_kind = 'act' then   -- a game played together in this channel
    return public.can_view_channel(v_id);
  end if;
  return false;
end;
$$;

notify pgrst, 'reload schema';
