-- =============================================================================
-- Lock down internal helpers (20261105020000)
--
-- Supabase exposes every function in `public` through the API unless EXECUTE is
-- revoked. These SECURITY DEFINER helpers are only meant to be called from other
-- database functions (or cron), never by the app — but anyone could call them:
--
--   * wordle_command(app, channel, ...)  — signed-out callers could make any bot
--     post into ANY channel (no membership or permission check). Proven in a test
--     database: an anonymous call added a bot message to a private channel.
--   * are_friends(a, b), is_blocked_between(a, b), shares_server_or_dm(a, b) —
--     anyone signed in could map other people's friendships and blocks.
--   * channel_perm_for_user(channel, user) — signed-out callers could read any
--     user's permissions in any channel.
--   * venband_notice(...) — any staff member could send an *official Venband* DM
--     with arbitrary text, bypassing the moderation flow and its audit log.
--   * the rest are internal helpers with no reason to be public.
--
-- Revoking is safe: none of these is referenced by an RLS policy, check
-- constraint, column default or caller-privilege function (verified against the
-- full schema), and the app never calls them. The functions that call them are
-- SECURITY DEFINER, so they keep working. Cron jobs run as the owner.
--
-- Also: wordle_games (holds each channel's ANSWER) and wordle_words had no RLS,
-- so on Supabase anyone could read today's answers or edit games through the API.
-- They are only used inside wordle_command, so direct access is closed entirely.
--
-- Safe to run more than once.
-- =============================================================================

-- Wordle tables: no direct API access (RLS on, no policies, no grants)
alter table if exists public.wordle_games enable row level security;
alter table if exists public.wordle_words enable row level security;
do $$ begin
  revoke all on public.wordle_games from anon, authenticated;
  revoke all on public.wordle_words from anon, authenticated;
exception when undefined_table then null; end $$;

-- Internal helpers: callable only by the database itself
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.wordle_command(uuid, uuid, text, text)',
    'public.wordle_feedback(text, text)',
    'public.are_friends(uuid, uuid)',
    'public.is_blocked_between(uuid, uuid)',
    'public.shares_server_or_dm(uuid, uuid)',
    'public.channel_perm_for_user(uuid, uuid)',
    'public.channel_key_recipients(uuid)',
    'public.member_count(uuid)',
    'public.deliver_scheduled_messages()',
    'public.can_ban_media(uuid)',
    'public.can_force_contact(uuid)',
    'public.mod_can_target(uuid)',
    'public.venband_notice(uuid, text, text, uuid)',
    'public.storage_console_stats()',
    'public.storage_list_auth_users()',
    'public.storage_queue_email(text, text, text)',
    'public.storage_ledger_list()',
    'public.storage_ledger_rebuild()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
