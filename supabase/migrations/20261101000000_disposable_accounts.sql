-- Disposable accounts: anonymous sign-ins that expire after 7 days unless an
-- email is added. All data is removed on expiry.
alter table public.profiles
  add column if not exists disposable boolean not null default false,
  add column if not exists expires_at timestamptz;

create index if not exists profiles_disposable_expires_idx
  on public.profiles (expires_at) where disposable = true;

-- Bootstrap: read the disposable flag from signup metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_display  text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  v_disposable boolean := coalesce((new.raw_user_meta_data ->> 'disposable')::boolean, false);
begin
  if v_username !~ '^[a-z0-9_.]{2,32}$' then
    raise exception 'invalid username';
  end if;
  insert into public.profiles (id, username, display_name, avatar_color, disposable, expires_at)
  values (new.id, v_username, left(v_display, 32),
          (array['#7c5cff','#e5484d','#30a46c','#f76b15','#0090ff','#d6409f','#ffb224','#12a594'])
            [1 + floor(random() * 8)::int],
          v_disposable,
          case when v_disposable then now() + interval '7 days' else null end);
  return new;
end;
$$;

-- Disposable accounts cannot change their username.
create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
  v_disposable boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select disposable into v_disposable from public.profiles where id = auth.uid();
  if v_disposable then raise exception 'disposable accounts cannot change their username'; end if;
  if not public.username_available(v) then
    raise exception 'that username is taken or invalid';
  end if;
  update public.profiles set username = v where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
end;
$$;

-- Promote a disposable account to permanent once an email is verified.
create or replace function public.make_account_permanent()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.profiles
     set disposable = false, expires_at = null
   where id = auth.uid();
end;
$$;

-- Remove expired disposable accounts' data.
create or replace function public.purge_expired_disposable()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in select id from public.profiles where disposable = true and expires_at is not null and expires_at < now() loop
    delete from public.profiles where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.make_account_permanent() from public, anon;
grant execute on function public.make_account_permanent() to authenticated;
revoke execute on function public.purge_expired_disposable() from public, anon, authenticated;
grant execute on function public.purge_expired_disposable() to service_role;
