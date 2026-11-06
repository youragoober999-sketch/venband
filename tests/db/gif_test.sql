-- GIF library uploads (20261106090000_gif_library.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('9f000000-0000-4000-8000-000000000001', 'gif1@example.com', '{"username":"gifone"}'),
  ('9f000000-0000-4000-8000-000000000002', 'gif2@example.com', '{"username":"giftwo"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000001', false);
-- your own folder: fine
insert into storage.objects (bucket_id, name) values ('gifs', '9f000000-0000-4000-8000-000000000001/a.gif');
-- every other upload still works with the GIF rule present (a policy that read
-- storage.objects from inside storage.objects recursed and broke ALL uploads)
insert into storage.objects (bucket_id, name) values ('memories', '9f000000-0000-4000-8000-000000000001/x.webp');
do $t$ begin
  assert public.my_gif_count() = 1;
end $t$;
-- someone else's folder: refused
do $t$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('gifs', '9f000000-0000-4000-8000-000000000002/b.gif');
    raise exception 'saved into someone else''s GIF folder';
  exception when insufficient_privilege then null;
  end;
end $t$;
reset role;
