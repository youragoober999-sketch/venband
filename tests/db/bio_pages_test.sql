begin;
insert into auth.users (id, email, raw_user_meta_data)
values ('b1000000-0000-4000-8000-000000000001', 'biofixture@example.com', '{"username":"biofixture"}'),
       ('b1000000-0000-4000-8000-000000000002', 'bioother@example.com', '{"username":"bioother"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.save_bio_page('{"title":"Draft"}', null, 'draft');
do $$ begin
  assert public.public_bio_page('biofixture') is null;
end $$;
select public.save_bio_page('{"title":"Draft"}', '{"title":"Published"}', 'publish');
select public.save_bio_page('{"title":"Changed"}', null, 'draft');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  assert public.public_bio_page('BIOFIXTURE') #>> '{page,title}' = 'Published';
  assert not (public.public_bio_page('biofixture') ? 'draft');
  assert not has_table_privilege('anon', 'public.bio_pages', 'select');
  assert not has_function_privilege('anon', 'public.save_bio_page(jsonb,jsonb,text)', 'execute');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
do $$ begin
  assert (select count(*) from public.bio_pages) = 0;
  assert not has_table_privilege('authenticated', 'public.bio_pages', 'update');
end $$;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.save_bio_page('{"title":"Changed"}', null, 'unpublish');
do $$ begin
  assert public.public_bio_page('biofixture') is null;
  assert (select draft ->> 'title' from public.bio_pages) = 'Changed';
end $$;
rollback;
