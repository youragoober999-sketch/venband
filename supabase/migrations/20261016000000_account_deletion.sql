-- =============================================================================
-- Immediate account deletion (Settings → My Account).
--
-- Typing the exact phrase "I want to delete my account" permanently deletes
-- the account and everything tied to it: the user's 1:1 DMs, their files and
-- pictures in object storage, and — cascading from auth.users → profiles —
-- their profile, username, email, messages, keys, friends and memberships.
--
-- This file also removes the old 14-day grace deletion path
-- (request_account_deletion / cancel_account_deletion / deletion_requested_at).
-- purge_deleted() keeps running but only reclaims deleted servers now.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- delete_my_account(p_confirm)
--   * refuses when the account still owns a server (those reference the
--     profile, so the account can only be removed once they're gone)
--   * 1:1 DMs the user is in are deleted outright, for both sides
--   * group chats just lose the user (their messages and keys go with the
--     profile); the chat stays for the remaining members
--   * file objects (attachments, pictures, banners) are removed from storage
--   * the auth.users row is deleted; profiles.id -> auth.users cascades the
--     rest of the user's data.
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account(p_confirm text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(coalesce(p_confirm, '')) <> 'I want to delete my account' then
    raise exception using message = 'type the exact phrase to confirm';
  end if;

  -- Deleted servers are already on their way out; let the account go with them.
  delete from public.servers where owner_id = v_uid and status = 'deleted';
  if exists (select 1 from public.servers where owner_id = v_uid) then
    raise exception using message = 'transfer or delete the servers you own first';
  end if;

  -- 1:1 DMs: gone, for both people.
  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d
                where d.channel_id = c.id and d.user_id = v_uid);

  -- Group chats: the user no longer participates (their messages and channel
  -- keys are cleaned up when the profile cascades away).
  delete from public.dm_participants where user_id = v_uid;

  -- Files, avatars and banners uploaded to object storage.
  delete from storage.objects where owner = v_uid;

  -- Everything else cascades from auth.users -> profiles.
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Remove the old 14-day grace deletion path.
-- -----------------------------------------------------------------------------
drop function if exists public.cancel_account_deletion();
drop function if exists public.request_account_deletion();
alter table public.profiles drop column if exists deletion_requested_at;

-- purge_deleted() now only reclaims deleted servers (it used to fire the
-- 14-day account purge too).
create or replace function public.purge_deleted()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.servers where status = 'deleted' and deleted_at < now() - interval '7 days';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-purge-deleted';
    perform cron.schedule('venband-purge-deleted', '17 * * * *', 'select public.purge_deleted()');
  end if;
exception when others then
  raise notice 'pg_cron not available: deleted servers will be purged once it is turned on';
end $$;

-- export_my_data() referenced the dropped column; include the full profile row.
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Messages are end-to-end encrypted; export a conversation from its menu to get readable copies.',
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user', case when f.user_a = auth.uid() then f.user_b else f.user_a end,
                                                            'accepted', f.accepted, 'since', f.created_at)), '[]')
                from public.friendships f where auth.uid() in (f.user_a, f.user_b)),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'joined_at', m.joined_at, 'owner', s.owner_id = auth.uid())), '[]')
                from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'reason', r.reason, 'status', r.status, 'at', r.created_at)), '[]')
                      from public.reports r where r.reporter_id = auth.uid()),
    'warnings', (select coalesce(jsonb_agg(jsonb_build_object('server', w.server_id, 'reason', w.reason, 'at', w.created_at)), '[]')
                 from public.member_warnings w where w.user_id = auth.uid()),
    'applications', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'preset', a.preset, 'created_at', a.created_at)), '[]')
                     from public.applications a where a.owner_id = auth.uid()),
    'voogle', (select coalesce(jsonb_agg(jsonb_build_object('server', v.server_id, 'result', v.result, 'at', v.updated_at)), '[]')
               from public.voogle_verifications v where v.user_id = auth.uid()),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('signed_in', s.created_at, 'last_active', coalesce(s.refreshed_at::timestamptz, s.updated_at))), '[]')
                from auth.sessions s where s.user_id = auth.uid())
  );
$$;