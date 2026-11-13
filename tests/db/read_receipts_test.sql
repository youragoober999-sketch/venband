-- Read receipts are only visible to the author and honor the recipient's setting.
begin;
reset role;
do $$
declare
  sender uuid := 'd0000000-0000-4000-8000-000000000001';
  recipient uuid := 'd0000000-0000-4000-8000-000000000002';
  outsider uuid := 'd0000000-0000-4000-8000-000000000003';
  chat uuid := 'dc000000-0000-4000-8000-000000000001';
  msg uuid := 'dd000000-0000-4000-8000-000000000001';
  sent timestamptz := statement_timestamp() - interval '1 minute';
begin
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.user_keys (key_id, user_id, enc_public, sign_public)
  values (repeat('a', 64), sender, 'enc', 'sign');
  insert into public.channel_epochs (channel_id, epoch, created_by, key_check)
  values (chat, 1, sender, 'check');
  insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, created_at)
  values (msg, chat, sender, repeat('a', 64), 1, 'iv', 'cipher', 'sig', sent);

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform public.mark_channel_read(chat, sent);
  assert not exists (select 1 from public.read_states where user_id = outsider and channel_id = chat);
  assert public.dm_seen_count(chat, msg) = 0;

  perform set_config('request.jwt.claim.sub', recipient::text, true);
  perform public.mark_all_channels_read();
  assert (select last_read_at >= sent and seen_at is null from public.read_states where user_id = recipient and channel_id = chat);
  perform public.mark_channel_read(chat, sent);
  assert public.dm_seen_count(chat, msg) = 0;

  perform set_config('request.jwt.claim.sub', sender::text, true);
  assert public.dm_seen_count(chat, msg) = 1;
  insert into public.user_settings (user_id, data)
  values (recipient, '{"chat":{"readReceipts":false}}')
  on conflict (user_id) do update set data = excluded.data;
  assert public.dm_seen_count(chat, msg) = 0;
end $$;
rollback;
