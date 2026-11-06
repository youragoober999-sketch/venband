-- =============================================================================
-- Category order (20261106070000)
--
-- Categories can be dragged anywhere — empty ones too. Their order is the
-- order of servers.categories (every category, empty or not). Before, the order
-- came only from channel positions, so an empty category always sat at the
-- bottom, and only Manage Server could touch servers.categories.
-- reorder_categories() needs Manage Channels (like reordering channels).
--
-- Safe to run more than once.
-- =============================================================================

create or replace function public.reorder_categories(p_server uuid, p_names text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  n text;
begin
  if not public.has_permission(p_server, 8) then raise exception 'you need Manage Channels'; end if;
  if cardinality(coalesce(p_names, '{}')) > 200 then raise exception 'too many categories'; end if;
  foreach n in array coalesce(p_names, '{}') loop
    n := left(btrim(n), 100);
    if n <> '' and not (n = any (v_out)) then v_out := v_out || n; end if;
  end loop;
  -- categories that exist only through their channels are kept (at the end)
  v_out := v_out || array(
    select distinct c.category from public.channels c
     where c.server_id = p_server and c.category <> '' and not (c.category = any (v_out)));
  update public.servers set categories = v_out where id = p_server;
  return v_out;
end;
$$;

revoke execute on function public.reorder_categories(uuid, text[]) from public, anon;
grant execute on function public.reorder_categories(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
