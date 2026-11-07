-- =============================================================================
-- QR code login (20261107150000)
--
-- The login page shows a QR code for www.venband.com/login/qr/code/<code>,
-- where <code> is 64 random hex characters (256 bits — unguessable). A new code
-- replaces it every 30 seconds and the old one is thrown away. Scanning it on a
-- device where you're signed in asks "Log in on that device?"; approving signs
-- the other device in.
--
--   * Only a SHA-256 hash of each code is stored, never the code itself.
--   * Nobody can read this table directly; only the functions below touch it.
--   * Once scanned, the code is locked to the person who scanned it and gets
--     2 minutes to be approved. After approval, the sign-in is handed over once
--     and the row is deleted.
--   * The hand-over itself is sealed (encrypted) to a one-time key that only the
--     waiting device holds, so even this table never contains a usable sign-in.
--
-- Safe to run more than once.
-- =============================================================================
create table if not exists public.qr_logins (
  code_hash    text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  pubkey       text not null check (char_length(pubkey) between 80 and 300),
  device       text not null default '' check (char_length(device) <= 120),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  scanned_by   uuid references public.profiles (id) on delete cascade,
  scanned_at   timestamptz,
  approved_at  timestamptz,
  denied       boolean not null default false,
  sealed       text check (sealed is null or char_length(sealed) <= 4000)
);
create index if not exists qr_logins_expires_idx on public.qr_logins (expires_at);
alter table public.qr_logins enable row level security;
revoke all on public.qr_logins from public, anon, authenticated;

create or replace function public.qr_code_hash(p_code text)
returns text language sql immutable set search_path = '' as $$
  select case when p_code ~ '^[0-9a-f]{64}$' then encode(sha256(convert_to(p_code, 'UTF8')), 'hex') end;
$$;

-- The login page: put up a new code (and drop the one it replaces).
create or replace function public.qr_login_start(p_code text, p_pubkey text, p_device text default '', p_previous text default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := public.qr_code_hash(p_code);
  v_until timestamptz := now() + interval '30 seconds';
begin
  if v_hash is null then raise exception 'bad code'; end if;
  delete from public.qr_logins where expires_at < now() - interval '1 minute';
  if p_previous is not null then
    delete from public.qr_logins where code_hash = public.qr_code_hash(p_previous) and scanned_by is null;
  end if;
  if (select count(*) from public.qr_logins) > 20000 then
    raise exception 'Too many people are logging in right now. Try again in a minute.';
  end if;
  insert into public.qr_logins (code_hash, pubkey, device, expires_at)
  values (v_hash, left(coalesce(p_pubkey, ''), 300), left(coalesce(p_device, ''), 120), v_until);
  return v_until;
end;
$$;

-- The login page polls this with its own code: waiting / scanned / approved / denied / expired.
-- On "approved" it gets the sealed sign-in exactly once, and the row is deleted.
create or replace function public.qr_login_status(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.qr_logins;
  v_out jsonb;
begin
  select * into r from public.qr_logins where code_hash = public.qr_code_hash(p_code);
  if not found then return jsonb_build_object('state', 'expired'); end if;
  if r.denied then
    delete from public.qr_logins where code_hash = r.code_hash;
    return jsonb_build_object('state', 'denied');
  end if;
  if r.sealed is not null then
    delete from public.qr_logins where code_hash = r.code_hash;
    return jsonb_build_object('state', 'approved', 'sealed', r.sealed);
  end if;
  if r.expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  if r.scanned_by is not null then
    select jsonb_build_object('state', 'scanned', 'name', coalesce(nullif(p.display_name, ''), p.username), 'avatar_url', p.avatar_url, 'avatar_color', p.avatar_color)
      into v_out from public.profiles p where p.id = r.scanned_by;
    return coalesce(v_out, jsonb_build_object('state', 'scanned'));
  end if;
  return jsonb_build_object('state', 'waiting');
end;
$$;

-- The signed-in device that scanned the code claims it (first scanner only).
create or replace function public.qr_login_scan(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.qr_logins;
begin
  if auth.uid() is null then raise exception 'Log in on this device first.'; end if;
  update public.qr_logins
     set scanned_by = auth.uid(), scanned_at = coalesce(scanned_at, now()),
         expires_at = case when scanned_by is null then now() + interval '2 minutes' else expires_at end
   where code_hash = public.qr_code_hash(p_code)
     and expires_at > now() and not denied and sealed is null
     and (scanned_by is null or scanned_by = auth.uid())
  returning * into r;
  if not found then raise exception 'This QR code expired or was already used. Scan the new one on the login screen.'; end if;
  return jsonb_build_object('device', r.device, 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;

create or replace function public.qr_login_deny(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.qr_logins set denied = true
   where code_hash = public.qr_code_hash(p_code) and scanned_by = auth.uid() and sealed is null;
end;
$$;

-- Called only by the server (/api/oauth, service role) after it made the sign-in.
create or replace function public.qr_login_finish(p_code text, p_user uuid, p_sealed text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.qr_logins
     set sealed = p_sealed, approved_at = now(), expires_at = now() + interval '1 minute'
   where code_hash = public.qr_code_hash(p_code) and scanned_by = p_user
     and expires_at > now() and not denied and sealed is null;
  return found;
end;
$$;

-- The waiting device's one-time public key, for the server to seal the sign-in to.
create or replace function public.qr_login_pubkey(p_code text, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pubkey from public.qr_logins
   where code_hash = public.qr_code_hash(p_code) and scanned_by = p_user
     and expires_at > now() and not denied and sealed is null;
$$;

revoke execute on function public.qr_login_start(text, text, text, text), public.qr_login_status(text),
  public.qr_login_scan(text), public.qr_login_deny(text), public.qr_login_finish(text, uuid, text),
  public.qr_login_pubkey(text, uuid), public.qr_code_hash(text) from public, anon, authenticated;
grant execute on function public.qr_login_start(text, text, text, text), public.qr_login_status(text) to anon, authenticated;
grant execute on function public.qr_login_scan(text), public.qr_login_deny(text) to authenticated;
grant execute on function public.qr_login_finish(text, uuid, text), public.qr_login_pubkey(text, uuid) to service_role;

notify pgrst, 'reload schema';
