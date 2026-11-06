-- Shareable server templates (20261106110000_server_templates.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('7a000000-0000-4000-8000-000000000001', 'tpl-owner@example.com', '{"username":"tplowner"}'),
  ('7a000000-0000-4000-8000-000000000002', 'tpl-user@example.com', '{"username":"tpluser"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000001', false);
select set_config('t.src', public.create_server('Source', '#123456', 'gaming')::text, false);
-- a custom role, a private channel only that role sees, and a role override
reset role;
insert into public.roles (id, server_id, name, color, permissions, position) values
  ('7ab00000-0000-4000-8000-000000000001', current_setting('t.src')::uuid, 'Staff', '#ff0000', 8, 1);
insert into public.channels (id, server_id, type, name, category, position, is_private) values
  ('7ac00000-0000-4000-8000-000000000001', current_setting('t.src')::uuid, 'text', 'staff-room', 'Staff', 99, true);
insert into public.channel_role_access (channel_id, role_id) values ('7ac00000-0000-4000-8000-000000000001', '7ab00000-0000-4000-8000-000000000001');
insert into public.channel_overwrites (server_id, channel_id, target_type, target_id, allow, deny) values
  (current_setting('t.src')::uuid, '7ac00000-0000-4000-8000-000000000001', 'role', '7ab00000-0000-4000-8000-000000000001', 128, 0);

set role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000001', false);
select set_config('t.code', public.create_template(current_setting('t.src')::uuid, 'Gaming Pro', 'Ranked + tournaments', true), false);

-- someone else: can't template a server they don't manage; can preview and use it
select set_config('request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000002', false);
do $t$ begin
  begin
    perform public.create_template(current_setting('t.src')::uuid, 'Stolen', '', false);
    raise exception 'made a template of someone else''s server';
  exception when others then
    if sqlerrm not like '%Manage Server%' then raise; end if;
  end;
  assert (public.template_preview(current_setting('t.code')) ->> 'name') = 'Gaming Pro';
  assert jsonb_array_length(public.template_preview(current_setting('t.code')) -> 'channels') = 12;
  assert (select count(*) from public.template_gallery('gaming')) = 1, 'public templates are listed';
end $t$;
select set_config('t.new', public.create_server_from_template(current_setting('t.code'), 'My Copy', '#654321')::text, false);

reset role;
do $t$
declare v_role uuid; v_chan uuid;
begin
  assert (select count(*) from public.channels where server_id = current_setting('t.new')::uuid) = 12, 'channels copied';
  assert (select owner_id from public.servers where id = current_setting('t.new')::uuid) = '7a000000-0000-4000-8000-000000000002';
  assert (select count(*) from public.server_members where server_id = current_setting('t.new')::uuid) = 1, 'no members copied';
  select id into v_role from public.roles where server_id = current_setting('t.new')::uuid and name = 'Staff';
  select id into v_chan from public.channels where server_id = current_setting('t.new')::uuid and name = 'staff-room';
  assert v_role is not null and v_role <> '7ab00000-0000-4000-8000-000000000001', 'role re-created with a new id';
  assert (select is_private from public.channels where id = v_chan);
  assert exists (select 1 from public.channel_role_access where channel_id = v_chan and role_id = v_role), 'private access mapped to the new role';
  assert exists (select 1 from public.channel_overwrites where channel_id = v_chan and target_id = v_role and allow = 128), 'override mapped';
  assert (select welcome_channel_id from public.servers where id = current_setting('t.new')::uuid) is not null, 'welcome channel set';
  assert (select uses from public.server_templates where code = current_setting('t.code')) = 1;
end $t$;
