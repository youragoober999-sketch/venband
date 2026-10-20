create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid,
  channel_id uuid,
  question text not null,
  options jsonb not null default '[]',
  multiple boolean not null default false,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_votes (
  poll_id uuid references public.polls(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  option_index integer not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_index)
);
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
create policy polls_read on public.polls for select to authenticated using (true);
create policy polls_insert on public.polls for insert to authenticated with check (created_by = auth.uid());
create policy votes_read on public.poll_votes for select to authenticated using (true);
create policy votes_insert on public.poll_votes for insert to authenticated with check (user_id = auth.uid());
create policy votes_delete on public.poll_votes for delete to authenticated using (user_id = auth.uid());

create or replace function public.create_poll(p_channel uuid, p_question text, p_options text[], p_multiple boolean default false, p_expires_hours integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.polls (channel_id, question, options, multiple, expires_at, created_by)
  values (p_channel, p_question, (select coalesce(jsonb_agg(jsonb_build_object('text', o)), '[]') from unnest(p_options) o), p_multiple,
    case when p_expires_hours is null then null else now() + (p_expires_hours || ' hours')::interval end, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.create_poll(uuid, text, text[], boolean, integer) to authenticated;

create or replace function public.vote_poll(p_poll uuid, p_option integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.polls where id = p_poll) then raise exception 'poll not found'; end if;
  -- toggle: if already voted this option, remove; else add (respecting multiple)
  if exists (select 1 from public.poll_votes where poll_id = p_poll and user_id = auth.uid() and option_index = p_option) then
    delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid() and option_index = p_option;
  else
    -- if single-choice, remove other votes first
    if not (select multiple from public.polls where id = p_poll) then
      delete from public.poll_votes where poll_id = p_poll and user_id = auth.uid();
    end if;
    insert into public.poll_votes (poll_id, user_id, option_index) values (p_poll, auth.uid(), p_option) on conflict do nothing;
  end if;
end;
$$;
grant execute on function public.vote_poll(uuid, integer) to authenticated;

create or replace function public.poll_results(p_poll uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'poll', (select row_to_json(p) from public.polls p where p.id = p_poll),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object('option', v.option_index, 'user', v.user_id)), '[]') from public.poll_votes v where v.poll_id = p_poll),
    'mine', (select coalesce(jsonb_agg(v.option_index), '[]') from public.poll_votes v where v.poll_id = p_poll and v.user_id = auth.uid())
  ) into v;
  return v;
end;
$$;
grant execute on function public.poll_results(uuid) to authenticated;
