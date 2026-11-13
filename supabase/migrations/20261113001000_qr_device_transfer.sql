-- Share the receiver public key with the approving device and consume each approval once.
create or replace function public.qr_login_status(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.qr_logins;
  v_out jsonb;
begin
  select * into r from public.qr_logins where code_hash = public.qr_code_hash(p_code) and expires_at >= now() for update;
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
  return jsonb_build_object('device', r.device, 'created_at', r.created_at, 'expires_at', r.expires_at, 'public_key', r.pubkey);
end;
$$;

notify pgrst, 'reload schema';
