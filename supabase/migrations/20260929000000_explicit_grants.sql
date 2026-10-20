-- =============================================================================
-- Explicit API grants
--
-- Newer Supabase projects no longer expose new tables/functions in `public` to
-- the API roles automatically ("permission denied for table ..."). Grant
-- exactly what the app needs. Row Level Security still decides which ROWS a
-- user can touch; these grants only decide which OPERATIONS are possible.
--
-- Safe to run more than once.
-- =============================================================================

-- anon (not signed in) gets nothing except the username check on signup.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- ------------------------------------------------------------- tables ----
grant select                         on public.profiles            to authenticated;
grant update (display_name, avatar_color, about)
                                     on public.profiles            to authenticated;

grant select, insert                 on public.user_keys           to authenticated;
grant select, insert, update         on public.user_private_keys   to authenticated;

grant select, update, delete         on public.servers             to authenticated;

grant select, delete                 on public.server_members      to authenticated;
grant update (nickname)              on public.server_members      to authenticated;

grant select, insert, update, delete on public.roles               to authenticated;
grant select, insert, delete         on public.member_roles        to authenticated;

grant select, insert, delete         on public.channels            to authenticated;
grant update (name, topic, category, position, is_private)
                                     on public.channels            to authenticated;

grant select, insert, delete         on public.channel_role_access to authenticated;
grant select                         on public.dm_participants     to authenticated;
grant select, delete                 on public.invites             to authenticated;
grant select, insert, delete         on public.bans                to authenticated;
grant select, insert                 on public.channel_epochs      to authenticated;
grant select, insert                 on public.channel_keys        to authenticated;

grant select, insert, delete         on public.messages            to authenticated;
grant update (epoch, iv, ciphertext, signature, author_key_id)
                                     on public.messages            to authenticated;

-- service_role (dashboard / admin scripts) keeps full access
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------- functions ----
grant execute on function
  public.is_server_member(uuid, uuid),
  public.server_permissions(uuid, uuid),
  public.has_permission(uuid, bigint, uuid),
  public.member_top_position(uuid, uuid),
  public.can_view_channel(uuid, uuid),
  public.channel_has_permission(uuid, bigint, uuid),
  public.shares_server_or_dm(uuid, uuid),
  public.create_server(text, text),
  public.create_invite(uuid, integer, integer),
  public.join_server(text),
  public.open_dm(uuid),
  public.find_user(text),
  public.channel_key_recipients(uuid),
  public.channel_missing_keys(uuid),
  public.realtime_topic_allowed(text),
  public.storage_channel_allowed(text)
to authenticated;
