-- =============================================================================
-- Profile self-healing
--
-- * my_profile(): returns the signed-in user's profile, creating it if it is
--   missing (e.g. the account was created before the schema existed, or from
--   the Supabase dashboard). The app calls this right after login.
-- * handle_new_user(): no longer rejects signups without a valid username
--   (dashboard-created users); it derives a unique one from the email instead.
--
-- Safe to run more than once.
-- =============================================================================

create or replace function public.unique_username(p_base text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g'), 26);
  v_name text;
  i integer := 1;
begin
  if char_length(v_base) < 2 then v_base := 'user'; end if;
  v_name := v_base;
  while exists (select 1 from public.profiles where username = v_name) loop
    i := i + 1;
    v_name := v_base || i::text;
  end loop;
  return v_name;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_wanted   text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username text;
  v_display  text;
begin
  if v_wanted ~ '^[a-z0-9_.]{2,32}$' and not exists (select 1 from public.profiles where username = v_wanted) then
    v_username := v_wanted;
  else
    v_username := public.unique_username(coalesce(nullif(v_wanted, ''), split_part(coalesce(new.email, ''), '@', 1)));
  end if;
  v_display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  insert into public.profiles (id, username, display_name, avatar_color)
  values (new.id, v_username, left(v_display, 32),
          (array['#e0795b','#6aa2d8','#8fbf6a','#d8a14a','#b88ad8','#d86a8f','#5fb8a8','#c9b458'])
            [1 + floor(random() * 8)::int])
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.my_profile()
returns public.profiles language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.profiles;
  v_meta jsonb;
  v_mail text;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.profiles where id = v_uid;
  if found then return v_row; end if;

  select raw_user_meta_data, email into v_meta, v_mail from auth.users where id = v_uid;
  v_name := public.unique_username(coalesce(nullif(v_meta ->> 'username', ''), split_part(coalesce(v_mail, ''), '@', 1)));
  insert into public.profiles (id, username, display_name)
  values (v_uid, v_name, left(coalesce(nullif(btrim(v_meta ->> 'display_name'), ''), v_name), 32))
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.unique_username(text) from anon, public, authenticated;
revoke execute on function public.my_profile() from anon, public;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
