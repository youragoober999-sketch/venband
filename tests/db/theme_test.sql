-- Theme ownership, versions, drafts, validation and install counts
-- (20261106000000_theme_versions.sql). Runs after all migrations; self-contained.
create function pg_temp.tt_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
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
create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false);
$$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('7e000000-0000-4000-8000-000000000001', 'maker@example.com', '{"username":"thememaker"}'),
  ('7e000000-0000-4000-8000-000000000002', 'fan@example.com',   '{"username":"themefan"}'),
  ('7e000000-0000-4000-8000-000000000003', 'fan2@example.com',  '{"username":"themefan2"}'),
  ('7e000000-0000-4000-8000-000000000004', 'mod@example.com',   '{"username":"thememod"}');
update public.profiles set platform_role = 'moderator' where id = '7e000000-0000-4000-8000-000000000004';

set role authenticated;

-- ---------------------------------------------------- owner creates a draft --
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
select set_config('tt.theme', public.theme_save(null, 'theme', 'Ocean', 'Blue and calm',
  '{"vars": {"bg-0": "#001122", "bg-1": "#002233", "bg-2": "#003344", "text": "#ffffff"}}'::jsonb, 'dark')::text, false);
do $t$ begin
  assert (select status from public.themes where id = current_setting('tt.theme')::uuid) = 'draft', 'new items start as drafts';
  assert (select version from public.themes where id = current_setting('tt.theme')::uuid) = 0;
  assert (select count(*) from public.theme_drafts where theme_id = current_setting('tt.theme')::uuid) = 1, 'owner sees the draft';
end $t$;

-- someone else can't see a draft at all
select pg_temp.as_user('7e000000-0000-4000-8000-000000000002');
do $t$ begin
  assert (select count(*) from public.themes where id = current_setting('tt.theme')::uuid) = 0, 'drafts are private';
  assert (select count(*) from public.theme_drafts where theme_id = current_setting('tt.theme')::uuid) = 0, 'draft data is private';
end $t$;

-- ---------------------------------------------------------- publish v1 / v2 --
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
do $t$ begin
  assert public.theme_publish(current_setting('tt.theme')::uuid, 'First release') = 1;
  assert (select status from public.themes where id = current_setting('tt.theme')::uuid) = 'published';
  assert (select count(*) from public.theme_drafts where theme_id = current_setting('tt.theme')::uuid) = 0, 'publishing clears the draft';
end $t$;
-- nothing to publish without changes
select pg_temp.tt_must_fail($$select public.theme_publish(current_setting('tt.theme')::uuid, 'again')$$, 'no unpublished changes');
-- edit the published theme: saved as a draft, the live version is untouched
select public.theme_save(current_setting('tt.theme')::uuid, null, 'Ocean', 'Bluer',
  '{"vars": {"bg-0": "#000a1f", "bg-1": "#00142e", "bg-2": "#001f40", "text": "#e8f4ff"}}'::jsonb, 'dark');
do $t$ begin
  assert (select data #>> '{vars,bg-0}' from public.themes where id = current_setting('tt.theme')::uuid) = '#001122', 'live version unchanged by a draft';
end $t$;
-- publishing twice within 15 s is refused (spam guard); age the history and retry
select pg_temp.tt_must_fail($$select public.theme_publish(current_setting('tt.theme')::uuid, 'v2')$$, 'wait a few seconds');
reset role;
update public.theme_versions set created_at = created_at - interval '1 minute' where theme_id = current_setting('tt.theme')::uuid;
set role authenticated;
do $t$ begin
  assert public.theme_publish(current_setting('tt.theme')::uuid, 'Bluer background') = 2;
  assert (select data #>> '{vars,bg-0}' from public.themes where id = current_setting('tt.theme')::uuid) = '#000a1f';
end $t$;

-- ------------------------------------------------- others: read, never write --
select pg_temp.as_user('7e000000-0000-4000-8000-000000000002');
do $t$ begin
  assert (select count(*) from public.theme_versions where theme_id = current_setting('tt.theme')::uuid) = 2, 'history of a published theme is public';
  assert (select changelog from public.theme_versions where theme_id = current_setting('tt.theme')::uuid and version = 2) = 'Bluer background';
end $t$;
select pg_temp.tt_must_fail($$select public.theme_save(current_setting('tt.theme')::uuid, null, 'Hijacked', '', '{"vars": {"bg-0": "#ff0000", "bg-1": "#ff0000", "bg-2": "#ff0000", "text": "#ff0000"}}'::jsonb)$$, 'only the creator');
select pg_temp.tt_must_fail($$select public.theme_publish(current_setting('tt.theme')::uuid, 'x')$$, 'only the creator');
select pg_temp.tt_must_fail($$select public.theme_rollback(current_setting('tt.theme')::uuid, 1)$$, 'only the creator');
select pg_temp.tt_must_fail($$select public.theme_set_status(current_setting('tt.theme')::uuid, 'unpublished')$$, 'only the creator');
-- no UPDATE policy: the stub refuses it, real Supabase changes 0 rows; either way it isn't changed
do $t$ begin
  begin
    update public.themes set name = 'Hijacked' where id = current_setting('tt.theme')::uuid;
  exception when insufficient_privilege then null;
  end;
end $t$;
reset role;
do $t$ begin
  assert (select name from public.themes where id = current_setting('tt.theme')::uuid) <> 'Hijacked', 'others can''t edit a theme';
end $t$;
set role authenticated;
select pg_temp.tt_must_fail($$insert into public.theme_versions (theme_id, version, name, data) values (current_setting('tt.theme')::uuid, 99, 'Fake', '{}'::jsonb)$$);
select pg_temp.tt_must_fail($$insert into public.theme_drafts (theme_id, name, data) values (current_setting('tt.theme')::uuid, 'Fake', '{}'::jsonb)$$);
do $t$ begin
  assert (select name from public.themes where id = current_setting('tt.theme')::uuid) = 'Ocean', 'nothing changed';
end $t$;

-- --------------------------------------------------------------- installs --
do $t$ begin
  perform public.install_theme(current_setting('tt.theme')::uuid);
  perform public.install_theme(current_setting('tt.theme')::uuid);
  perform public.install_theme(current_setting('tt.theme')::uuid);
  assert (select installs from public.themes where id = current_setting('tt.theme')::uuid) = 1, 'repeat installs count once';
end $t$;
select pg_temp.as_user('7e000000-0000-4000-8000-000000000003');
do $t$ begin
  perform public.install_theme(current_setting('tt.theme')::uuid);
  assert (select installs from public.themes where id = current_setting('tt.theme')::uuid) = 2;
  perform public.uninstall_theme(current_setting('tt.theme')::uuid);
  assert (select installs from public.themes where id = current_setting('tt.theme')::uuid) = 1;
end $t$;
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
do $t$ begin
  perform public.install_theme(current_setting('tt.theme')::uuid);
  assert (select installs from public.themes where id = current_setting('tt.theme')::uuid) = 1, 'the creator''s own install doesn''t count';
end $t$;

-- --------------------------------------------------------------- rollback --
reset role;
update public.theme_versions set created_at = created_at - interval '1 minute' where theme_id = current_setting('tt.theme')::uuid;
set role authenticated;
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
do $t$ begin
  assert public.theme_rollback(current_setting('tt.theme')::uuid, 1) = 3, 'rollback publishes a new version';
  assert (select data #>> '{vars,bg-0}' from public.themes where id = current_setting('tt.theme')::uuid) = '#001122', 'with the old data';
  assert (select changelog from public.theme_versions where theme_id = current_setting('tt.theme')::uuid and version = 3) = 'Restored version 1';
  assert (select count(*) from public.theme_versions where theme_id = current_setting('tt.theme')::uuid) = 3, 'history is never lost';
end $t$;

-- ------------------------------------------------------------- validation --
select pg_temp.tt_must_fail($$select public.theme_save(null, 'theme', 'Bad', '', '{"vars": {"bg-0": "#000", "bg-1": "#000", "bg-2": "#000", "evil": "#000"}}'::jsonb)$$, 'unknown colour variable');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'theme', 'Bad', '', '{"vars": {"bg-0": "url(https://evil.example/x)", "bg-1": "#000", "bg-2": "#000", "text": "#fff"}}'::jsonb)$$, 'invalid colour');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'theme', 'Bad', '', '{"vars": {"bg-0": "#000", "bg-1": "#000", "bg-2": "#000", "text": "#fff"}, "wallpaper": "url(https://evil.example/track.png)"}'::jsonb)$$, 'gradient');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'theme', 'Bad', '', '{"vars": {"bg-0": "#000"}, "script": "alert(1)"}'::jsonb)$$, 'unknown theme field');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'css', 'Bad', '', '{"css": "body { background: url(https://evil.example/leak) }"}'::jsonb)$$, 'data:image');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'css', 'Bad', '', '{"css": "@import url(https://evil.example/x.css);"}'::jsonb)$$, 'blocked code');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'css', 'Bad', '', '{"css": "div { background: url(javascript:alert(1)) }"}'::jsonb)$$);
select pg_temp.tt_must_fail($$select public.theme_save(null, 'nameplate', 'Bad', '', '{"colors": ["red"]}'::jsonb)$$, 'must be hex');
select pg_temp.tt_must_fail($$select public.theme_save(null, 'theme', '', '', '{"vars": {}}'::jsonb)$$, 'name');
-- what the app's sanitizers produce is accepted
do $t$ begin
  perform public.theme_save(null, 'css', 'Clean CSS', '', '{"css": "/* @import removed */\n.message { background: url(data:image/png;base64,iVBORw0KGgo=) }"}'::jsonb);
  perform public.theme_save(null, 'theme', 'Gradient', '', '{"vars": {"bg-0": "#101010", "bg-1": "rgba(0, 0, 0, 0.5)", "bg-2": "hsl(200, 50%, 20%)", "text": "#fff"}, "glass": true, "wallpaper": "linear-gradient(135deg, #1f1c2c, #3a2f5b, #12101a)"}'::jsonb);
  perform public.theme_save(null, 'name_style', 'Neon', '', '{"font": "display", "effect": "glow", "colors": ["#00e5ff", "#ff00aa"]}'::jsonb);
end $t$;

-- ---------------------------------------------- unpublish / moderation --
select public.theme_set_status(current_setting('tt.theme')::uuid, 'unpublished');
select pg_temp.as_user('7e000000-0000-4000-8000-000000000002');
do $t$ begin
  assert (select count(*) from public.themes where id = current_setting('tt.theme')::uuid) = 0, 'unpublished items are hidden';
  assert (select count(*) from public.theme_versions where theme_id = current_setting('tt.theme')::uuid) = 0, 'and so is their history';
end $t$;
select pg_temp.tt_must_fail($$select public.install_theme(current_setting('tt.theme')::uuid)$$, 'isn''t available');
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
select public.theme_set_status(current_setting('tt.theme')::uuid, 'published');
-- a creator can't "remove" (that's a moderation action) and staff must give a reason
select pg_temp.tt_must_fail($$select public.theme_set_status(current_setting('tt.theme')::uuid, 'removed', 'nah')$$, 'only Venband staff');
select pg_temp.as_user('7e000000-0000-4000-8000-000000000004');
select pg_temp.tt_must_fail($$select public.theme_set_status(current_setting('tt.theme')::uuid, 'removed', '')$$, 'give a reason');
select public.theme_set_status(current_setting('tt.theme')::uuid, 'removed', 'Hateful imagery in the wallpaper');
reset role;
do $t$ begin
  assert (select status from public.themes where id = current_setting('tt.theme')::uuid) = 'removed';
  assert exists (select 1 from public.mod_actions where action = 'marketplace_remove' and target_user = '7e000000-0000-4000-8000-000000000001'
                 and reason = 'Hateful imagery in the wallpaper'), 'removals are logged';
end $t$;
set role authenticated;
select pg_temp.as_user('7e000000-0000-4000-8000-000000000001');
do $t$ begin
  assert (select removed_reason from public.themes where id = current_setting('tt.theme')::uuid) = 'Hateful imagery in the wallpaper', 'the creator sees why';
end $t$;
select pg_temp.tt_must_fail($$select public.theme_set_status(current_setting('tt.theme')::uuid, 'published')$$, 'only Venband staff');
select pg_temp.tt_must_fail($$select public.theme_save(current_setting('tt.theme')::uuid, null, 'Ocean', '', '{"vars": {"bg-0": "#000", "bg-1": "#000", "bg-2": "#000", "text": "#fff"}}'::jsonb)$$, 'removed by Venband');
select pg_temp.as_user('7e000000-0000-4000-8000-000000000004');
select public.theme_set_status(current_setting('tt.theme')::uuid, 'published', 'Appeal accepted');
reset role;
do $t$ begin
  assert (select status from public.themes where id = current_setting('tt.theme')::uuid) = 'published', 'staff can restore';
  assert exists (select 1 from public.mod_actions where action = 'marketplace_restore');
end $t$;

-- ------------------------------------------- older app versions (direct insert) --
set role authenticated;
select pg_temp.as_user('7e000000-0000-4000-8000-000000000002');
insert into public.themes (author_id, name, description, data, kind)
values ('7e000000-0000-4000-8000-000000000002', 'Old client theme', '', '{"vars": {"bg-0": "#111111", "bg-1": "#222222", "bg-2": "#333333", "text": "#eeeeee"}}', 'theme');
do $t$ begin
  assert (select status || ':' || version from public.themes where name = 'Old client theme') = 'published:1';
  assert exists (select 1 from public.theme_versions v join public.themes t on t.id = v.theme_id where t.name = 'Old client theme' and v.version = 1), 'direct inserts get a version 1';
end $t$;
select pg_temp.tt_must_fail($$insert into public.themes (author_id, name, description, data, kind) values ('7e000000-0000-4000-8000-000000000002', 'Sneaky', '', '{"vars": {"bg-0": "#111", "bg-1": "#222", "bg-2": "#333", "text": "#eee"}, "onload": "x"}', 'theme')$$, 'unknown theme field');
select pg_temp.tt_must_fail($$insert into public.themes (author_id, name, description, data, kind, status, version) values ('7e000000-0000-4000-8000-000000000002', 'Fake history', '', '{"vars": {"bg-0": "#111", "bg-1": "#222", "bg-2": "#333", "text": "#eee"}}', 'theme', 'removed', 50) returning (case when status = 'published' and version = 1 then 1/0 else 1 end)$$);
reset role;
