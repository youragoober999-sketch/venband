-- The Shop (20261106150000_shop_inventory.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e000000-0000-4000-8000-000000000001', 'shop-a@example.com', '{"username":"shopa"}'),
  ('5e000000-0000-4000-8000-000000000002', 'shop-b@example.com', '{"username":"shopb"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"sub":"5e000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $t$
begin
  -- originals and starters equip without owning them
  update public.profiles set avatar_frame = 'neon', nameplate = 'plate.gradient.sunset', profile_effect = 'effect.stardust.gold' where id = auth.uid();
  -- a shop item you don't have is refused
  begin
    update public.profiles set avatar_frame = 'deco.raven.void' where id = auth.uid();
    raise exception 'equipped an item that was not collected';
  exception when others then
    if sqlerrm not like 'Get it from the Shop first%' then raise; end if;
  end;
  -- get it (free), then it equips
  assert public.claim_cosmetics(array['deco.raven.void', 'effect.raven_feathers.void']) = 2;
  assert public.claim_cosmetics(array['deco.raven.void']) = 0, 'claiming twice adds nothing';
  update public.profiles set avatar_frame = 'deco.raven.void', profile_effect = 'effect.raven_feathers.void' where id = auth.uid();
  assert (select avatar_frame from public.profiles where id = auth.uid()) = 'deco.raven.void';
  -- junk ids and direct inserts are refused
  begin
    perform public.claim_cosmetics(array['deco.raven.void; drop table x']);
    raise exception 'accepted a junk id';
  exception when others then
    if sqlerrm <> 'unknown item' then raise; end if;
  end;
  begin
    insert into public.cosmetic_inventory (item_id) values ('deco.crown.gold');
    raise exception 'inserted into the inventory directly';
  exception when insufficient_privilege then null;
  end;
end $t$;

-- someone else's collection is private
select set_config('request.jwt.claim.sub', '5e000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"sub":"5e000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
do $t$
begin
  assert (select count(*) from public.cosmetic_inventory) = 0, 'another collection is visible';
end $t$;
reset role;
