-- Relax account-creation limits: 25 accounts per network (was 6) and raise
-- the Supabase auth sign-in/sign-up rate limit in config.toml accordingly.
create or replace function public.before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := nullif(event -> 'metadata' ->> 'ip_address', '');
  v_hash text;
  v_used integer;
begin
  if v_ip is null then return '{}'::jsonb; end if;
  v_hash := encode(extensions.digest(
    (select value from public.platform_config where key = 'ip_pepper') || '|' || v_ip, 'sha256'), 'hex');
  select count(*) into v_used from public.signup_ips s
  where s.ip_hash = v_hash and (s.user_id is null or exists (select 1 from auth.users u where u.id = s.user_id));
  if v_used >= 25 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429, 'message', 'Too many accounts have been created from this network. Try again later.'));
  end if;
  insert into public.signup_ips (ip_hash, user_id)
  values (v_hash, nullif(event -> 'user' ->> 'id', '')::uuid);
  return '{}'::jsonb;
end;
$$;
