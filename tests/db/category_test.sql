-- Category order (20261106070000_category_order.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-4000-8000-000000000001', 'cat-owner@example.com', '{"username":"catowner"}'),
  ('ca000000-0000-4000-8000-000000000002', 'cat-member@example.com', '{"username":"catmember"}');
insert into public.servers (id, owner_id, name, categories) values
  ('ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Cats', array['General', 'Empty']);
insert into public.server_members (server_id, user_id) values
  ('ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001'),
  ('ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')
on conflict do nothing;
insert into public.channels (server_id, type, name, category) values ('ca500000-0000-4000-8000-000000000001', 'text', 'games', 'Games');

set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', false);
do $t$ begin
  -- an empty category moves to the top; duplicates / blanks dropped; categories that
  -- only exist through channels ("Games") are kept at the end
  assert public.reorder_categories('ca500000-0000-4000-8000-000000000001', array['Empty', ' General ', 'Empty', '']) = array['Empty', 'General', 'Games'];
  assert (select categories from public.servers where id = 'ca500000-0000-4000-8000-000000000001') = array['Empty', 'General', 'Games'];
end $t$;
-- a member without Manage Channels can't
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000002', false);
do $t$ begin
  begin
    perform public.reorder_categories('ca500000-0000-4000-8000-000000000001', array['General']);
    raise exception 'member reordered categories';
  exception when others then
    if sqlerrm not like '%Manage Channels%' then raise; end if;
  end;
end $t$;
reset role;
