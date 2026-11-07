-- Owner-only Special set (20261106160000_owner_special.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('5c000000-0000-4000-8000-000000000001', 'sp-owner@example.com', '{"username":"spowner"}'),
  ('5c000000-0000-4000-8000-000000000002', 'sp-user@example.com', '{"username":"spuser"}');
update public.profiles set platform_role = 'owner' where id = '5c000000-0000-4000-8000-000000000001';

set role authenticated;
-- an ordinary user can't equip or collect any of it
select set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"sub":"5c000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
do $t$
declare col text;
begin
  foreach col in array array['avatar_frame = ''deco.sovereign.owner''', 'profile_effect = ''effect.sovereign.owner''', 'nameplate = ''plate.sovereign.owner''', 'name_style = ''{"effect":"sovereign"}'''] loop
    begin
      execute format('update public.profiles set %s where id = auth.uid()', col);
      raise exception 'a user equipped %', col;
    exception when others then
      if sqlerrm not like '%owners only%' then raise; end if;
    end;
  end loop;
  begin
    perform public.claim_cosmetics(array['effect.sovereign.owner']);
    raise exception 'a user collected an owner item';
  exception when others then
    if sqlerrm not like 'that item isn%' then raise; end if;
  end;
  -- ordinary items still work
  update public.profiles set avatar_frame = 'deco.kitty_ears.blush', name_style = '{"effect":"glow"}' where id = auth.uid();
end $t$;

-- the owner can wear the whole set
select set_config('request.jwt.claim.sub', '5c000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"sub":"5c000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $t$
begin
  update public.profiles set avatar_frame = 'deco.sovereign.owner', profile_effect = 'effect.sovereign.owner',
    nameplate = 'plate.sovereign.owner', name_style = '{"effect":"sovereign"}' where id = auth.uid();
  assert (select profile_effect from public.profiles where id = auth.uid()) = 'effect.sovereign.owner';
end $t$;
reset role;
