-- =============================================================================
-- Cosmetics + badges (20261106040000)
--
--   * new nameplates (starfield, koi, fireflies, snowfall, synthwave, storm) and
--     avatar frames (galaxy, lightning, crystal)
--   * profile effects: profiles.profile_effect — particles over your profile card
--   * new badges: developer (Venband dev team, always shown), verified (user),
--     verified_bot, verified_server, contributor, beta_tester. Developer and the
--     verified badges can only be handed out by admins, like staff badges.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.profiles drop constraint if exists profiles_nameplate_check;
alter table public.profiles add constraint profiles_nameplate_check
  check (nameplate in ('none', 'aurora', 'ember', 'ocean', 'sakura', 'circuit', 'noir', 'gold', 'custom',
                       'starfield', 'koi', 'fireflies', 'snowfall', 'synthwave', 'storm'));

alter table public.profiles drop constraint if exists profiles_avatar_frame_check;
alter table public.profiles add constraint profiles_avatar_frame_check
  check (avatar_frame in ('none', 'neon', 'flame', 'frost', 'rainbow', 'gold', 'sakura', 'pixel', 'orbit', 'hearts', 'glitch',
                          'galaxy', 'lightning', 'crystal'));

alter table public.profiles add column if not exists profile_effect text not null default 'none';
alter table public.profiles drop constraint if exists profiles_profile_effect_check;
alter table public.profiles add constraint profiles_profile_effect_check
  check (profile_effect in ('none', 'sparkles', 'hearts', 'sakura', 'snow', 'embers', 'leaves', 'bubbles', 'confetti',
                            'shooting_stars', 'fireflies', 'aurora'));
grant update (profile_effect) on public.profiles to authenticated;

-- ------------------------------------------------------------------ badges --
create or replace function public.all_badges()
returns text[] language sql stable security definer set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'developer', 'partner', 'verified', 'verified_bot',
               'verified_server', 'verified_dev', 'bug_hunter', 'bug_hunter_gold', 'og', 'early_supporter', 'supporter',
               'translator', 'contributor', 'beta_tester', 'event_winner']::text[]
         || coalesce((select array_agg(id order by created_at) from public.custom_badges), '{}');
$$;

-- staff badges always show (the holder can't hide them)
create or replace function public.protected_badges()
returns text[] language sql immutable set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'developer']::text[];
$$;

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['owner', 'admin', 'moderator', 'staff', 'developer', 'verified', 'verified_bot', 'verified_server'];
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select badges into v_old from public.profiles where id = p_user;
  if not public.is_top_staff() then
    if public.platform_rank() < 2 and (
         (select coalesce(array_agg(b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
         is distinct from
         (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
      raise exception 'only admins can change staff and verification badges';
    end if;
    if public.platform_rank() < 3 and (('owner' = any (v_new)) <> ('owner' = any (v_old))) then
      raise exception 'only the owner can change the owner badge';
    end if;
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

notify pgrst, 'reload schema';
