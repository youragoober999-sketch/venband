-- QR approvals expose only the receiver public key, expire and are consumed once.
begin;
reset role;
do $$
declare
  recipient uuid := 'd0000000-0000-4000-8000-000000000002';
  code text := repeat('b', 64);
  public_key text := repeat('x', 120);
begin
  perform public.qr_login_start(code, public_key, 'Test browser');
  perform set_config('request.jwt.claim.sub', recipient::text, true);
  assert public.qr_login_scan(code) ->> 'public_key' = public_key;
  assert public.qr_login_finish(code, recipient, 'sealed fixture');
  assert public.qr_login_status(code) ->> 'sealed' = 'sealed fixture';
  assert public.qr_login_status(code) ->> 'state' = 'expired';
  perform public.qr_login_start(code, public_key, 'Test browser');
  perform public.qr_login_scan(code);
  assert public.qr_login_finish(code, recipient, 'expired fixture');
  update public.qr_logins set expires_at = now() - interval '1 second';
  assert public.qr_login_status(code) ->> 'state' = 'expired';
end $$;
rollback;
