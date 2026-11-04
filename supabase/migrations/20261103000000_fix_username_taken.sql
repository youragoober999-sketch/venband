-- Fix "username already taken" signup failures.
--
-- 20261101000000_disposable_accounts.sql replaced handle_new_user() and lost
-- the self-healing behaviour from 20260930000000_profile_self_heal.sql: an
-- invalid username raised, and a taken one crashed the insert with a unique
-- violation ("Database error saving new user"). This restores the fallback to
-- a safe unique username while keeping the disposable-account fields.
--
-- Safe to run more than once.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_wanted     text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_username   text;
  v_display    text;
  v_disposable boolean := coalesce((new.raw_user_meta_data ->> 'disposable')::boolean, false);
  v_try        integer := 0;
begin
  loop
    if v_try = 0 and v_wanted ~ '^[a-z0-9_.]{2,32}$'
       and not exists (select 1 from public.profiles where username = v_wanted) then
      v_username := v_wanted;
    else
      v_username := public.unique_username(coalesce(nullif(v_wanted, ''), split_part(coalesce(new.email, ''), '@', 1)));
    end if;
    v_display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
    begin
      insert into public.profiles (id, username, display_name, avatar_color, disposable, expires_at)
      values (new.id, v_username, left(v_display, 32),
              (array['#7c5cff','#e5484d','#30a46c','#f76b15','#0090ff','#d6409f','#ffb224','#12a594'])
                [1 + floor(random() * 8)::int],
              v_disposable,
              case when v_disposable then now() + interval '7 days' else null end)
      on conflict (id) do nothing;
      return new;
    exception when unique_violation then
      -- someone grabbed the same name a moment ago: pick another and retry
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
end;
$$;

grant execute on function public.handle_new_user() to supabase_auth_admin;
