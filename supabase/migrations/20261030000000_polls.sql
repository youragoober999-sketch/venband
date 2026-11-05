-- =============================================================================
-- Polls cleanup (20261030000000)
--
-- An earlier version of this file re-declared polls with a different, incompatible
-- design (id/question/options columns). Polls are already defined in
-- 20261004000000_messaging.sql (message_id-based) and that is what the app uses
-- (Chat.tsx, chatExtras.ts). The old version:
--   * failed on any fresh database ("policy polls_insert already exists"),
--     aborting setup of every later migration, and
--   * where it partly ran, added `using (true)` policies that let ANY signed-in
--     user read every poll and vote, including in private channels.
--
-- This file now only removes those leftovers if they exist. Safe to run any time.
-- =============================================================================

drop policy if exists polls_read on public.polls;
drop policy if exists votes_read on public.poll_votes;
drop policy if exists votes_insert on public.poll_votes;
drop policy if exists votes_delete on public.poll_votes;

drop function if exists public.create_poll(uuid, text, text[], boolean, integer);
drop function if exists public.vote_poll(uuid, integer);
