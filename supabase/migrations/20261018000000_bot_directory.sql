-- =============================================================================
-- Bot discovery + direct install (Server Settings → Integrations & Bots).
-- Server staff can browse every active bot — with the official Venband bot
-- pinned first — and add one to their server without pasting invite codes.
-- =============================================================================

-- bot_directory(p_server): all active applications the caller could add to
-- this server, with an install count and whether they're already here (or
-- have a pending join request).
create or replace function public.bot_directory(p_server uuid)
returns table (id uuid, owner_id uuid, name text, description text, preset text,
               icon_url text, banner_url text, color text, token_hint text,
               status text, created_at timestamptz,
               installs bigint, installed boolean, requested boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.owner_id, a.name, a.description, a.preset, a.icon_url, a.banner_url,
         a.color, null::text, a.status, a.created_at,
         count(sb.server_id)::bigint,
         exists (select 1 from public.server_bots x where x.server_id = p_server and x.app_id = a.id),
         exists (select 1 from public.bot_join_requests r where r.server_id = p_server and r.app_id = a.id)
  from public.applications a
  left join public.server_bots sb on sb.app_id = a.id
  where a.status = 'active' and public.is_server_member(p_server)
  group by a.id
  order by (a.preset = 'venband') desc, count(sb.server_id) desc, a.created_at
$$;

revoke execute on function public.bot_directory(uuid) from public, anon;
grant execute on function public.bot_directory(uuid) to authenticated;

-- bot_add_to_server(p_app, p_server): a server admin with Manage Integrations
-- adds an active bot to the server directly.
create or replace function public.bot_add_to_server(p_app uuid, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.servers where id = p_server) <> 'active' then raise exception 'this server is not available right now'; end if;
  if not public.has_permission(p_server, 16777216) then raise exception 'you need Manage Integrations here'; end if;
  if (select status from public.applications where id = p_app) <> 'active' then raise exception 'this application is disabled'; end if;
  if exists (select 1 from public.server_bots where server_id = p_server and app_id = p_app) then
    return jsonb_build_object('status', 'already');
  end if;
  perform public.install_bot(p_server, p_app, auth.uid());
  return jsonb_build_object('status', 'joined');
end;
$$;

revoke execute on function public.bot_add_to_server(uuid, uuid) from public, anon;
grant execute on function public.bot_add_to_server(uuid, uuid) to authenticated;