-- Memories: 30 kept / 10 showing, archive, expiry, audience, media access, reports
-- (20261106060000_memories_archive.sql). Runs after all migrations.
create function pg_temp.mt_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    -- real Supabase: row-level security filters the rows instead of raising
    get diagnostics n = row_count;
    if n = 0 and p_expect is null and p_sql ~* '^\s*(update|delete)\s' then return; end if;
  exception when others then
    if p_expect is not null and position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception 'failed for the wrong reason: % (wanted "%") — %', sqlerrm, p_expect, p_sql;
    end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;
create function pg_temp.mt_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false);
$$;
create function pg_temp.mt_add(p_n integer, p_active boolean default true) returns void language plpgsql as $$
begin
  for i in 1..p_n loop
    insert into public.memories (user_id, path, media_type, active)
    values (auth.uid(), auth.uid()::text || '/' || gen_random_uuid()::text || '.webp', 'image', p_active);
  end loop;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('ae000000-0000-4000-8000-000000000001', 'mem-owner@example.com', '{"username":"memowner"}'),
  ('ae000000-0000-4000-8000-000000000002', 'mem-friend@example.com', '{"username":"memfriend"}'),
  ('ae000000-0000-4000-8000-000000000003', 'mem-member@example.com', '{"username":"memmember"}');
-- friend + a shared server so the member can see the owner's profile
insert into public.friendships (user_a, user_b, requester, accepted)
values ('ae000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000001', true);
insert into public.servers (id, owner_id, name) values ('ae500000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'Mem test');
insert into public.server_members (server_id, user_id) values
  ('ae500000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001'),
  ('ae500000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000003')
on conflict do nothing;

set role authenticated;
select pg_temp.mt_as('ae000000-0000-4000-8000-000000000001');
-- the app adds a memory and reads it back in one request (insert … returning):
-- the owner must be able to see their own brand-new row
do $t$
declare v uuid;
begin
  insert into public.memories (user_id, path, media_type, active)
  values (auth.uid(), auth.uid()::text || '/first.webp', 'image', true) returning id into v;
  assert v is not null;
  delete from public.memories where id = v;
end $t$;
-- 10 can show at once…
select pg_temp.mt_add(10);
select pg_temp.mt_must_fail($$select pg_temp.mt_add(1)$$, 'Up to 10 memories can show');
-- …the rest go to the archive, up to 30 in total
select pg_temp.mt_add(20, false);
select pg_temp.mt_must_fail($$select pg_temp.mt_add(1, false)$$, 'up to 30');
-- showing an archived one needs a free slot
select pg_temp.mt_must_fail($$update public.memories set active = true where id = (select id from public.memories where not active limit 1)$$, 'Up to 10');
update public.memories set active = false where id = (select id from public.memories where active order by created_at limit 1);
update public.memories set active = true where id = (select id from public.memories where not active order by created_at desc limit 1);
-- an expired memory frees its slot
update public.memories set expires_at = now() + interval '1 second' where id = (select id from public.memories where active order by created_at limit 1);
select pg_temp.mt_must_fail($$update public.memories set expires_at = now() + interval '2 years' where id = (select id from public.memories limit 1)$$, 'within the next year');

-- audience: one friends-only, one only-me
update public.memories set audience = 'friends' where id = (select id from public.memories where active order by created_at desc limit 1);
update public.memories set audience = 'only_me' where id = (select id from public.memories where active order by created_at desc offset 1 limit 1);
reset role;
update public.memories set expires_at = now() - interval '1 minute' where expires_at is not null; -- (time passes)
create temp table mt_ids as
  select (select id from public.memories where audience = 'friends' and user_id = 'ae000000-0000-4000-8000-000000000001') as friends_only,
         (select id from public.memories where audience = 'only_me' and user_id = 'ae000000-0000-4000-8000-000000000001') as only_me,
         (select path from public.memories where audience = 'friends' and user_id = 'ae000000-0000-4000-8000-000000000001') as friends_path,
         (select path from public.memories where not active and user_id = 'ae000000-0000-4000-8000-000000000001' limit 1) as archived_path;
grant select on mt_ids to authenticated;
insert into storage.objects (bucket_id, name) select 'memories', friends_path from mt_ids union all select 'memories', archived_path from mt_ids;

set role authenticated;
select pg_temp.mt_as('ae000000-0000-4000-8000-000000000001');
do $t$ begin
  assert (select count(*) from public.memories) = 30, 'the owner sees all 30';
end $t$;
-- the friend sees the showing ones incl. friends-only, not only-me / expired / archived
select pg_temp.mt_as('ae000000-0000-4000-8000-000000000002');
do $t$ begin
  assert (select count(*) from public.memories) = 8, 'friend: 10 showing − 1 expired − 1 only-me = 8, got ' || (select count(*) from public.memories);
  assert exists (select 1 from public.memories where id = (select friends_only from mt_ids));
  assert (select count(*) from storage.objects where bucket_id = 'memories' and name = (select friends_path from mt_ids)) = 1, 'friend can fetch friends-only media';
  assert (select count(*) from storage.objects where bucket_id = 'memories' and name = (select archived_path from mt_ids)) = 0, 'archived media is not listed';
end $t$;
-- a server member who isn't a friend: no friends-only either
select pg_temp.mt_as('ae000000-0000-4000-8000-000000000003');
do $t$ begin
  assert (select count(*) from public.memories) = 7, 'member: 7, got ' || (select count(*) from public.memories);
  assert (select count(*) from storage.objects where bucket_id = 'memories' and name = (select friends_path from mt_ids)) = 0, 'no friends-only media';
end $t$;
-- reporting a memory: only one you can see
select pg_temp.mt_must_fail($$select public.report_item('memory', (select friends_only from mt_ids), 'not ok')$$, 'not found');
select public.report_item('memory', (select id from public.memories limit 1), 'This is not okay');
-- nobody else edits or deletes your memories
update public.memories set caption = 'hacked';
delete from public.memories;
reset role;
do $t$ begin
  assert (select count(*) from public.memories where user_id = 'ae000000-0000-4000-8000-000000000001') = 30;
  assert not exists (select 1 from public.memories where caption = 'hacked');
  assert exists (select 1 from public.reports where kind = 'memory');
end $t$;
