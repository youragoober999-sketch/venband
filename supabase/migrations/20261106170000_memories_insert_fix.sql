-- =============================================================================
-- Fix: adding a memory failed with "new row violates row-level security policy
-- for table memories" (20261106170000)
--
-- The app inserts and reads the new row back in one request (INSERT …
-- RETURNING). The read-back runs the SELECT policy, which looked the memory up
-- by id through memory_visible() — and that lookup can't see a row inserted by
-- the same statement, so the owner's own new memory was "invisible". The owner
-- now matches straight from the row's own user_id first.
--
-- Safe to run more than once.
-- =============================================================================

drop policy if exists memories_select on public.memories;
create policy memories_select on public.memories for select to authenticated
  using (user_id = auth.uid() or public.memory_visible(id));

notify pgrst, 'reload schema';
