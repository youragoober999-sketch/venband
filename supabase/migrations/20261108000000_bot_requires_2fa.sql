-- Bot ownership requires two-factor authentication.
-- A verified authenticator-app factor must be enrolled before an account
-- can create (and therefore own) a bot/application.
create or replace function public.create_application(p_name text, p_preset text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create applications right now'; end if;
  if not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified') then
    raise exception 'two-factor authentication is required to create bots — turn it on in Settings → Security first';
  end if;
  if (select count(*) from public.applications where owner_id = auth.uid()) >= 25 then
    raise exception 'you can have up to 25 applications';
  end if;
  insert into public.applications (owner_id, name, preset, description, color)
  values (auth.uid(), btrim(p_name), coalesce(p_preset, 'custom'),
          case p_preset
            when 'verification' then 'Keeps alt accounts and raiders out with Voogle verification.'
            when 'management' then 'Welcomes new members, gives them roles and logs joins and leaves.'
            when 'site' then 'Posts updates from your website or service into a channel.'
            else '' end,
          case p_preset when 'verification' then '#3ba55d' when 'management' then '#5865f2' when 'site' then '#eb459e' else '#7c5cff' end)
  returning id into v_id;
  return v_id;
end;
$$;