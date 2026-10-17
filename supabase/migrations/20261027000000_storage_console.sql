-- Storage Console: owner/founder-only control plane tables + RPCs.
-- Append-only ledger of user stats (hash chain) + outbound email queue.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- outbound_emails: queued messages composed in the console.
-- ---------------------------------------------------------------------------
create table if not exists public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  to_addr text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.outbound_emails enable row level security;

drop policy if exists outbound_emails_select on public.outbound_emails;
create policy outbound_emails_select on public.outbound_emails for select to authenticated
  using (public.is_top_staff());
drop policy if exists outbound_emails_insert on public.outbound_emails;
create policy outbound_emails_insert on public.outbound_emails for insert to authenticated
  with check (public.is_top_staff() and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- storage_ledger: append-only hash chain of user stats.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  prev_hash text not null,
  hash text not null,
  payload text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists storage_ledger_seq_idx on public.storage_ledger (seq);
alter table public.storage_ledger enable row level security;

drop policy if exists storage_ledger_select on public.storage_ledger;
create policy storage_ledger_select on public.storage_ledger for select to authenticated
  using (public.is_top_staff());

-- ---------------------------------------------------------------------------
-- storage_console_stats()
-- ---------------------------------------------------------------------------
create or replace function public.storage_console_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_top_staff() then raise exception 'top staff only'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'servers', (select count(*) from public.servers),
    'objects', (select count(*) from storage.objects),
    'blocks', (select count(*) from public.storage_ledger)
  );
end;
$$;
revoke execute on function public.storage_console_stats() from public, anon;
grant execute on function public.storage_console_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- storage_list_auth_users(): email + stats, top staff only.
-- ---------------------------------------------------------------------------
create or replace function public.storage_list_auth_users()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_top_staff() then raise exception 'top staff only'; end if;
  select coalesce(jsonb_agg(u order by u.created_at desc), '[]') into v from (
    select au.id,
           au.email,
           p.username,
           au.created_at,
           au.last_sign_in_at
    from auth.users au
    left join public.profiles p on p.id = au.id
  ) u;
  return v;
end;
$$;
revoke execute on function public.storage_list_auth_users() from public, anon;
grant execute on function public.storage_list_auth_users() to authenticated;

-- ---------------------------------------------------------------------------
-- storage_queue_email()
-- ---------------------------------------------------------------------------
create or replace function public.storage_queue_email(p_to text, p_subject text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_top_staff() then raise exception 'top staff only'; end if;
  if coalesce(btrim(p_to), '') = '' then raise exception 'recipient required'; end if;
  if length(coalesce(p_subject, '')) > 200 then raise exception 'subject too long'; end if;
  if length(coalesce(p_body, '')) > 10000 then raise exception 'body too long'; end if;
  insert into public.outbound_emails (to_addr, subject, body, created_by)
  values (btrim(p_to), btrim(p_subject), p_body, auth.uid());
end;
$$;
revoke execute on function public.storage_queue_email(text, text, text) from public, anon;
grant execute on function public.storage_queue_email(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- storage_ledger_list()
-- ---------------------------------------------------------------------------
create or replace function public.storage_ledger_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_top_staff() then raise exception 'top staff only'; end if;
  select coalesce(jsonb_agg(l order by l.seq), '[]') into v from (
    select id, seq, prev_hash, hash, payload, created_at from public.storage_ledger
  ) l;
  return v;
end;
$$;
revoke execute on function public.storage_ledger_list() from public, anon;
grant execute on function public.storage_ledger_list() to authenticated;

-- ---------------------------------------------------------------------------
-- storage_ledger_rebuild(): snapshot current users into a fresh chain.
-- Payload is base64-encoded JSON of user stats (email, username, userID, created_at).
-- ---------------------------------------------------------------------------
create or replace function public.storage_ledger_rebuild()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := repeat('0', 64);
  v_seq bigint := 0;
  v_payload text;
  v_hash text;
  r record;
begin
  if not public.is_top_staff() then raise exception 'top staff only'; end if;
  delete from public.storage_ledger;
  for r in
    select au.id, au.email, p.username, au.created_at
    from auth.users au
    left join public.profiles p on p.id = au.id
    order by au.created_at
  loop
    v_seq := v_seq + 1;
    v_payload := encode(
      convert_to(jsonb_build_object(
        'userID', r.id,
        'email', r.email,
        'username', r.username,
        'created_at', r.created_at
      )::text, 'UTF8'), 'base64');
    v_hash := encode(digest(v_prev || v_payload, 'sha256'), 'hex');
    insert into public.storage_ledger (seq, prev_hash, hash, payload, created_by)
    values (v_seq, v_prev, v_hash, v_payload, auth.uid());
    v_prev := v_hash;
  end loop;
end;
$$;
revoke execute on function public.storage_ledger_rebuild() from public, anon;
grant execute on function public.storage_ledger_rebuild() to authenticated;

-- storage_run_sql is intentionally NOT provided: arbitrary SQL execution from the
-- browser is a critical risk even for owners. Use the Table Editor instead.
