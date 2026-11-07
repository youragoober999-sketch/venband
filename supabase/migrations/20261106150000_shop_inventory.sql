-- =============================================================================
-- The Venband Shop (20261106150000)
--
-- Hundreds of avatar decorations, profile effects, nameplates, themes and
-- bundles (catalog in src/lib/shop.ts). Everything is free: "Get" adds an
-- item to your collection, and you can equip anything in your collection.
--
--   * cosmetic_inventory: what each person has collected (private to them)
--   * claim_cosmetics(ids): add items (bundles send their items too)
--   * profiles.avatar_frame / nameplate / profile_effect now take shop ids
--     ("deco.kitty_ears.blush"); equipping needs the item in your collection.
--     The originals (ids without a dot) and the starter set are free for all.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.cosmetic_inventory (
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  item_id     text not null check (item_id ~ '^(deco|effect|plate|theme|bundle)\.[a-z0-9_]{1,40}(\.[a-z0-9_]{1,24})?$'),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.cosmetic_inventory enable row level security;
drop policy if exists cosmetic_inventory_own on public.cosmetic_inventory;
create policy cosmetic_inventory_own on public.cosmetic_inventory for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.cosmetic_inventory from authenticated;
grant select on public.cosmetic_inventory to authenticated;

-- Free for everyone. Keep the starter list in sync with STARTER_ITEMS in src/lib/shop.ts.
create or replace function public.cosmetic_free(p_id text)
returns boolean language sql immutable set search_path = '' as $$
  select p_id is null or p_id in ('none', 'custom') or position('.' in p_id) = 0
      or p_id = any (array[
        'deco.kitty_ears.blush', 'deco.headset.neon', 'deco.halo_wings.gold', 'deco.party_hat.candy',
        'effect.stardust.gold', 'effect.snowfall.snow', 'effect.hearts.rose',
        'plate.gradient.sunset', 'plate.night_sky.midnight', 'plate.equalizer.neon',
        'theme.midnight_violet', 'theme.daylight'
      ]);
$$;

create or replace function public.claim_cosmetics(p_items text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_added integer;
begin
  if v_me is null then raise exception 'sign in first'; end if;
  if p_items is null or cardinality(p_items) = 0 then return 0; end if;
  if cardinality(p_items) > 60 then raise exception 'too many items at once'; end if;
  if exists (select 1 from unnest(p_items) i where i !~ '^(deco|effect|plate|theme|bundle)\.[a-z0-9_]{1,40}(\.[a-z0-9_]{1,24})?$') then
    raise exception 'unknown item';
  end if;
  if (select count(*) from public.cosmetic_inventory where user_id = v_me) + cardinality(p_items) > 3000 then
    raise exception 'your collection is full';
  end if;
  insert into public.cosmetic_inventory (user_id, item_id)
    select v_me, i from unnest(p_items) i
    on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
revoke execute on function public.claim_cosmetics(text[]) from public, anon;
grant execute on function public.claim_cosmetics(text[]) to authenticated;
grant execute on function public.cosmetic_free(text) to authenticated;

-- Shop ids on profiles: the original names, or a shop id of the right kind.
alter table public.profiles drop constraint if exists profiles_avatar_frame_check;
alter table public.profiles drop constraint if exists profiles_nameplate_check;
alter table public.profiles drop constraint if exists profiles_profile_effect_check;
-- anything that isn't an original name or a well-formed Shop id goes back to 'none' first
update public.profiles set avatar_frame = 'none'
 where avatar_frame is null or (avatar_frame not in ('none', 'neon', 'flame', 'frost', 'rainbow', 'gold', 'sakura', 'pixel', 'orbit', 'hearts', 'glitch', 'galaxy', 'lightning', 'crystal')
                                and avatar_frame !~ '^deco\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');
update public.profiles set nameplate = 'none'
 where nameplate is null or (nameplate not in ('none', 'aurora', 'ember', 'ocean', 'sakura', 'circuit', 'noir', 'gold', 'custom', 'starfield', 'koi', 'fireflies', 'snowfall', 'synthwave', 'storm')
                             and nameplate !~ '^plate\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');
update public.profiles set profile_effect = 'none'
 where profile_effect is null or (profile_effect not in ('none', 'sparkles', 'hearts', 'sakura', 'snow', 'embers', 'leaves', 'bubbles', 'confetti', 'shooting_stars', 'fireflies', 'aurora')
                                  and profile_effect !~ '^effect\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');
alter table public.profiles add constraint profiles_avatar_frame_check
  check (avatar_frame in ('none', 'neon', 'flame', 'frost', 'rainbow', 'gold', 'sakura', 'pixel', 'orbit', 'hearts', 'glitch',
                          'galaxy', 'lightning', 'crystal')
         or avatar_frame ~ '^deco\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');
alter table public.profiles add constraint profiles_nameplate_check
  check (nameplate in ('none', 'aurora', 'ember', 'ocean', 'sakura', 'circuit', 'noir', 'gold', 'custom',
                       'starfield', 'koi', 'fireflies', 'snowfall', 'synthwave', 'storm')
         or nameplate ~ '^plate\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');
alter table public.profiles add constraint profiles_profile_effect_check
  check (profile_effect in ('none', 'sparkles', 'hearts', 'sakura', 'snow', 'embers', 'leaves', 'bubbles', 'confetti',
                            'shooting_stars', 'fireflies', 'aurora')
         or profile_effect ~ '^effect\.[a-z0-9_]{1,40}\.[a-z0-9_]{1,24}$');

create or replace function public.check_cosmetic_equip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if auth.uid() is null then return new; end if; -- service / maintenance
  foreach v in array array[
    case when new.avatar_frame is distinct from old.avatar_frame then new.avatar_frame end,
    case when new.nameplate is distinct from old.nameplate then new.nameplate end,
    case when new.profile_effect is distinct from old.profile_effect then new.profile_effect end
  ] loop
    if v is not null and not public.cosmetic_free(v)
       and not exists (select 1 from public.cosmetic_inventory where user_id = new.id and item_id = v) then
      raise exception 'Get it from the Shop first (it’s free).';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists profiles_cosmetic_equip on public.profiles;
create trigger profiles_cosmetic_equip before update of avatar_frame, nameplate, profile_effect on public.profiles
  for each row execute function public.check_cosmetic_equip();

notify pgrst, 'reload schema';
