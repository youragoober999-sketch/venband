-- Slowmode and reminders (20261106140000_slowmode_reminders.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('51000000-0000-4000-8000-000000000001', 'slow-owner@example.com', '{"username":"slowowner"}'),
  ('51000000-0000-4000-8000-000000000002', 'slow-member@example.com', '{"username":"slowmember"}');
insert into public.user_keys (key_id, user_id, enc_public, sign_public) values
  ('slowOwnerKey00000001', '51000000-0000-4000-8000-000000000001', 'e', 's'),
  ('slowMemberKey0000001', '51000000-0000-4000-8000-000000000002', 'e', 's');
insert into public.servers (id, owner_id, name) values
  ('51500000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Slow');
insert into public.server_members (server_id, user_id) values
  ('51500000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001'),
  ('51500000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')
on conflict do nothing;
insert into public.channels (id, server_id, type, name, settings) values
  ('51c00000-0000-4000-8000-000000000001', '51500000-0000-4000-8000-000000000001', 'text', 'slow', '{"slowmode": 30}');
insert into public.channel_epochs (channel_id, epoch, key_check, created_by)
  values ('51c00000-0000-4000-8000-000000000001', 1, 'kc', '51000000-0000-4000-8000-000000000001');

create function pg_temp.post(p_user uuid, p_key text) returns uuid language sql as $$
  insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values ('51c00000-0000-4000-8000-000000000001', p_user, p_key, 1, 'iv', 'ct', 'sig') returning id $$;

do $t$
declare v uuid;
begin
  -- a member posts once, then has to wait
  perform pg_temp.post('51000000-0000-4000-8000-000000000002', 'slowMemberKey0000001');
  begin
    perform pg_temp.post('51000000-0000-4000-8000-000000000002', 'slowMemberKey0000001');
    raise exception 'slowmode let a second message through';
  exception when others then
    if sqlerrm not like 'slowmode: wait %' then raise; end if;
  end;
  -- the owner (manage messages) is exempt
  perform pg_temp.post('51000000-0000-4000-8000-000000000001', 'slowOwnerKey00000001');
  perform pg_temp.post('51000000-0000-4000-8000-000000000001', 'slowOwnerKey00000001');
  -- turning slowmode off lets the member post again
  update public.channels set settings = '{"slowmode": 0}' where id = '51c00000-0000-4000-8000-000000000001';
  v := pg_temp.post('51000000-0000-4000-8000-000000000002', 'slowMemberKey0000001');
  -- a malformed setting never blocks posting
  update public.channels set settings = '{"slowmode": "soon"}' where id = '51c00000-0000-4000-8000-000000000001';
  perform pg_temp.post('51000000-0000-4000-8000-000000000002', 'slowMemberKey0000001');
  perform set_config('t.slowmsg', v::text, false);
end $t$;

-- reminders ride on saved messages and stay private
set role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
insert into public.saved_messages (message_id, channel_id, remind_at)
  values (current_setting('t.slowmsg')::uuid, '51c00000-0000-4000-8000-000000000001', now() + interval '1 hour');
do $t$ begin
  assert (select count(*) from public.saved_messages where remind_at is not null) = 1;
  begin
    update public.saved_messages set remind_at = now() + interval '5 years';
    raise exception 'a reminder years away was accepted';
  exception when check_violation then null;
  end;
end $t$;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $t$ begin
  assert (select count(*) from public.saved_messages) = 0, 'someone else''s reminders are hidden';
end $t$;
reset role;
