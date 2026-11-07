-- =============================================================================
-- Owner-only "Special" cosmetics (20261106160000)
--
-- Settings → Special (owners only) has the Sovereign set: the Genesis profile
-- effect, the Sovereign Halo avatar decoration, the Throne Room nameplate, the
-- Sovereign name style and theme. They're not in the Shop and can't be
-- collected; only accounts with platform_role = 'owner' can equip them.
--
-- Safe to run more than once.
-- =============================================================================

create or replace function public.cosmetic_owner_only(p_id text)
returns boolean language sql immutable set search_path = '' as $$
  select p_id is not null and (p_id like '%.owner' or p_id = 'theme.sovereign');
$$;
grant execute on function public.cosmetic_owner_only(text) to authenticated;

-- the Shop can't hand these out
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
  if exists (select 1 from unnest(p_items) i where public.cosmetic_owner_only(i)) then
    raise exception 'that item isn’t available';
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

-- equipping: owner-only items need the owner role; everything else as before
create or replace function public.check_cosmetic_equip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v text;
  v_owner boolean := coalesce(old.platform_role, 'user') = 'owner';
begin
  if auth.uid() is null then return new; end if; -- service / maintenance
  if new.name_style is distinct from old.name_style and new.name_style ->> 'effect' = 'sovereign' and not v_owner then
    raise exception 'That name style is for Venband owners only.';
  end if;
  foreach v in array array[
    case when new.avatar_frame is distinct from old.avatar_frame then new.avatar_frame end,
    case when new.nameplate is distinct from old.nameplate then new.nameplate end,
    case when new.profile_effect is distinct from old.profile_effect then new.profile_effect end
  ] loop
    if v is null then continue; end if;
    if public.cosmetic_owner_only(v) then
      if not v_owner then raise exception 'That’s for Venband owners only.'; end if;
    elsif not public.cosmetic_free(v)
       and not exists (select 1 from public.cosmetic_inventory where user_id = new.id and item_id = v) then
      raise exception 'Get it from the Shop first (it’s free).';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists profiles_cosmetic_equip on public.profiles;
create trigger profiles_cosmetic_equip before update of avatar_frame, nameplate, profile_effect, name_style on public.profiles
  for each row execute function public.check_cosmetic_equip();

notify pgrst, 'reload schema';
