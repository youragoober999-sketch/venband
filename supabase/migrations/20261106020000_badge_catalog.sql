-- =============================================================================
-- Badges: display choices, categories, rarity, limited editions (20261106020000)
--
--   * profiles.badge_display: which of YOUR badges you show, in your order.
--     NULL = show all (default). Staff badges (founder, owner, admin, moderator,
--     staff) always show — people need to be able to recognise real staff — so
--     they're never stored here. Only set through set_badge_display(), which only
--     accepts badges you actually hold. Nobody can award themselves a badge:
--     `badges` itself is still changed only by staff (mod_set_badges).
--   * custom badges get a category, a rarity, an optional "awardable until" date
--     (limited editions) and can be retired (kept by holders, no new awards).
--   * awarding a badge sends the holder a notification; removing one also
--     removes it from their display list.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.profiles add column if not exists badge_display text[];
do $$ begin
  alter table public.profiles add constraint profiles_badge_display_size check (badge_display is null or cardinality(badge_display) <= 20);
exception when duplicate_object then null; end $$;

alter table public.custom_badges
  add column if not exists category text not null default 'special',
  add column if not exists rarity text not null default 'rare',
  add column if not exists awardable_until timestamptz,
  add column if not exists retired boolean not null default false;
do $$ begin
  alter table public.custom_badges add constraint custom_badges_category_check
    check (category in ('staff', 'community', 'developer', 'creator', 'supporter', 'achievement', 'event', 'seasonal', 'special'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.custom_badges add constraint custom_badges_rarity_check
    check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary'));
exception when duplicate_object then null; end $$;

create or replace function public.protected_badges()
returns text[] language sql immutable set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff']::text[];
$$;

-- ---------------------------------------------------------- your display --
create or replace function public.set_badge_display(p_ids text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_have text[];
  v_out text[] := '{}';
  b text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select badges into v_have from public.profiles where id = auth.uid();
  if p_ids is null then
    update public.profiles set badge_display = null where id = auth.uid();
    return null;
  end if;
  if cardinality(p_ids) > 20 then raise exception 'you can show up to 20 badges'; end if;
  foreach b in array p_ids loop
    if b = any (public.protected_badges()) then continue; end if; -- always shown anyway
    if not (b = any (coalesce(v_have, '{}'))) then raise exception 'you don''t have the % badge', b; end if;
    if not (b = any (v_out)) then v_out := v_out || b; end if;
  end loop;
  update public.profiles set badge_display = v_out where id = auth.uid();
  return v_out;
end;
$$;

-- --------------------------------------------- awards, limits, notifications --
create or replace function public.guard_badge_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_added text[];
  b text;
  c public.custom_badges%rowtype;
begin
  if new.badges is not distinct from old.badges then return new; end if;
  v_added := array(select x from unnest(coalesce(new.badges, '{}')) x where not (x = any (coalesce(old.badges, '{}'))));
  foreach b in array v_added loop
    select * into c from public.custom_badges where id = b;
    if found and (c.retired or (c.awardable_until is not null and c.awardable_until < now())) then
      raise exception 'the “%” badge can''t be awarded any more', c.name;
    end if;
  end loop;
  -- a removed badge also leaves the display list
  if new.badge_display is not null then
    new.badge_display := array(select x from unnest(new.badge_display) x where x = any (coalesce(new.badges, '{}')));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_badges_guard on public.profiles;
create trigger profiles_badges_guard before update of badges on public.profiles
  for each row execute function public.guard_badge_changes();

create or replace function public.notify_badge_awarded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b text;
  v_name text;
begin
  foreach b in array array(select x from unnest(coalesce(new.badges, '{}')) x where not (x = any (coalesce(old.badges, '{}')))) loop
    select name into v_name from public.custom_badges where id = b;
    v_name := coalesce(v_name, initcap(replace(b, '_', ' ')));
    perform public.notify(new.id, 'platform', 'badge_awarded', 'You got the ' || v_name || ' badge',
      'It now shows on your profile. Choose which badges you show in Settings → Profile.', 'info', '{}',
      jsonb_build_object('badge', b), false, '[]'::jsonb, 'badge:' || b);
  end loop;
  return null;
end;
$$;
drop trigger if exists profiles_badges_notify on public.profiles;
create trigger profiles_badges_notify after update of badges on public.profiles
  for each row execute function public.notify_badge_awarded();

-- ------------------------------------------------- the badge designer --
drop function if exists public.save_custom_badge(text, text, text, text);
create or replace function public.save_custom_badge(
  p_id text, p_name text, p_description text, p_image_url text,
  p_category text default 'special', p_rarity text default 'rare',
  p_awardable_until timestamptz default null, p_retired boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id text := 'c_' || regexp_replace(lower(btrim(coalesce(p_id, ''))), '^c_', '');
begin
  if not public.can_design_badges() then raise exception 'only Venband owners and founders can make badges'; end if;
  if p_image_url !~ '/storage/v1/object/public/badges/' then raise exception 'upload the badge picture first'; end if;
  insert into public.custom_badges (id, name, description, image_url, created_by, category, rarity, awardable_until, retired)
  values (v_id, btrim(p_name), btrim(coalesce(p_description, '')), p_image_url, auth.uid(),
          coalesce(p_category, 'special'), coalesce(p_rarity, 'rare'), p_awardable_until, coalesce(p_retired, false))
  on conflict (id) do update
    set name = excluded.name, description = excluded.description, image_url = excluded.image_url,
        category = excluded.category, rarity = excluded.rarity, awardable_until = excluded.awardable_until,
        retired = excluded.retired;
  insert into public.mod_actions (actor_id, action, detail) values (auth.uid(), 'badge_design', v_id);
  return v_id;
end;
$$;

-- ------------------------------------------------------------------ grants --
revoke execute on function public.set_badge_display(text[]) from public, anon;
grant execute on function public.set_badge_display(text[]) to authenticated;
revoke execute on function public.save_custom_badge(text, text, text, text, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.save_custom_badge(text, text, text, text, text, text, timestamptz, boolean) to authenticated;
revoke execute on function public.guard_badge_changes() from public, anon, authenticated;
revoke execute on function public.notify_badge_awarded() from public, anon, authenticated;

notify pgrst, 'reload schema';
