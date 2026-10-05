-- =============================================================================
-- Messaging: reactions, edit history, deleted-message log, pins, saved
-- messages, read markers, threads, polls, scheduled messages, more permission
-- bits. Safe to run more than once (it is also part of supabase/repair.sql).
--
-- Everything that carries words stays end-to-end encrypted:
--   * reactions are encrypted with the reacted message's channel key; the
--     server only sees an opaque tag (HMAC) used to group identical reactions
--   * edit history keeps the old ciphertext, not plaintext
--   * polls: the question and options live in the encrypted message; the
--     server only stores option numbers
-- =============================================================================

-- ------------------------------------------------------- permission bits ----
--   ADD_REACTIONS      4096        CREATE_THREADS   8192
--   MANAGE_THREADS     16384       CREATE_POLLS     32768
--   ATTACH_FILES       65536       EMBED_LINKS      131072
--   MENTION_EVERYONE   262144      USE_SOUNDBOARD   524288
--   MANAGE_EXPRESSIONS 1048576     MODERATE_MEMBERS 2097152
--   VIEW_AUDIT_LOG     4194304     MANAGE_EVENTS    8388608
--   MANAGE_INTEGRATIONS 16777216   MUTE_MEMBERS     33554432
--   DEAFEN_MEMBERS     67108864    MOVE_MEMBERS     134217728
--   MANAGE_NICKNAMES   268435456   CHANGE_NICKNAME  536870912
--   REQUEST_TO_SPEAK   1073741824
--   ALL                2147483647
alter table public.roles drop constraint if exists roles_permissions_check;
alter table public.roles add constraint roles_permissions_check check (permissions >= 0 and permissions <= 2147483647);

-- Give existing @everyone roles the new everyday permissions once.
do $$
begin
  if not exists (select 1 from public.platform_config where key = 'perm_bits_v2') then
    update public.roles
       set permissions = permissions | 4096 | 8192 | 32768 | 65536 | 131072 | 524288 | 536870912 | 1073741824
     where is_default;
    -- roles that could manage messages can now also manage threads
    update public.roles set permissions = permissions | 16384 where (permissions & 256) = 256;
    insert into public.platform_config (key, value) values ('perm_bits_v2', 'true'::jsonb);
  end if;
end $$;

create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_perms bigint;
begin
  select owner_id, status into v_owner, v_status from public.servers where id = p_server;
  if v_owner is null or v_status <> 'active' then return 0; end if;
  if v_owner = p_user then return 2147483647; end if;
  if not public.is_server_member(p_server, p_user) then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 2147483647; end if;
  return v_perms;
end;
$$;

-- New servers start with the new everyday permissions too.
create or replace function public.create_server(p_name text, p_icon_color text default '#7c5cff')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
  v_welcome uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create servers right now'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then
    raise exception 'server limit reached';
  end if;
  insert into public.servers (name, owner_id, icon_color)
  values (btrim(p_name), v_uid, p_icon_color) returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  -- @everyone: the everyday permissions (see the bit list at the top of this file)
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', 128 | 64 | 512 | 1024 | 2048 | 4096 | 8192 | 32768 | 65536 | 131072 | 524288 | 536870912 | 1073741824, 0, true);
  insert into public.channels (server_id, type, name, category, position, topic)
  values (v_server, 'text', 'welcome', 'Information', 0, 'Say hi to new members!')
  returning id into v_welcome;
  insert into public.channels (server_id, type, name, category, position)
  values (v_server, 'text', 'chat', 'Text Channels', 1),
         (v_server, 'voice', 'General', 'Voice Channels', 2);
  perform set_config('venband.mod', 'on', true);
  update public.servers set welcome_channel_id = v_welcome where id = v_server;
  perform set_config('venband.mod', 'off', true);
  return v_server;
end;
$$;

-- ------------------------------------------------------------- threads ----
alter table public.messages add column if not exists thread_root uuid references public.messages (id) on delete cascade;
create index if not exists messages_thread_idx on public.messages (thread_root, created_at) where thread_root is not null;

create table if not exists public.threads (
  root_id         uuid primary key references public.messages (id) on delete cascade,
  channel_id      uuid not null references public.channels (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  created_by      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  locked          boolean not null default false,
  archived        boolean not null default false,
  last_message_at timestamptz not null default now(),
  message_count   integer not null default 0
);
create index if not exists threads_channel_idx on public.threads (channel_id, last_message_at desc);
alter table public.threads enable row level security;

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads for select to authenticated
  using (public.can_view_channel(channel_id));
drop policy if exists threads_insert on public.threads;
create policy threads_insert on public.threads for insert to authenticated
  with check (created_by = auth.uid()
              and public.channel_has_permission(channel_id, 8192)
              and exists (select 1 from public.messages m where m.id = root_id and m.channel_id = threads.channel_id and m.thread_root is null));
drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads for update to authenticated
  using (created_by = auth.uid() or public.channel_has_permission(channel_id, 16384))
  with check (created_by = auth.uid() or public.channel_has_permission(channel_id, 16384));
drop policy if exists threads_delete on public.threads;
create policy threads_delete on public.threads for delete to authenticated
  using (public.channel_has_permission(channel_id, 16384));

-- Only managers can lock or unlock; renaming/archiving is allowed for the creator.
create or replace function public.guard_thread_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.root_id <> old.root_id or new.channel_id <> old.channel_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'immutable column';
  end if;
  if new.locked <> old.locked and not public.channel_has_permission(new.channel_id, 16384) then
    raise exception 'you need Manage Threads to lock a thread';
  end if;
  if old.locked and not public.channel_has_permission(new.channel_id, 16384) then
    raise exception 'this thread is locked';
  end if;
  if current_setting('venband.thread_bump', true) is distinct from 'on' then
    new.message_count := old.message_count;
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end;
$$;
drop trigger if exists threads_guard on public.threads;
create trigger threads_guard before update on public.threads
  for each row execute function public.guard_thread_update();

-- Thread replies: same channel as the root, thread must exist and be open.
create or replace function public.check_thread_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.threads%rowtype;
begin
  if new.thread_root is null then return new; end if;
  select * into t from public.threads where root_id = new.thread_root;
  if not found or t.channel_id <> new.channel_id then raise exception 'thread not found'; end if;
  if t.locked and not public.channel_has_permission(new.channel_id, 16384, new.author_id) then
    raise exception 'this thread is locked';
  end if;
  perform set_config('venband.thread_bump', 'on', true);
  update public.threads set message_count = message_count + 1, last_message_at = now(), archived = false
   where root_id = new.thread_root;
  perform set_config('venband.thread_bump', 'off', true);
  return new;
end;
$$;
drop trigger if exists messages_thread_check on public.messages;
create trigger messages_thread_check before insert on public.messages
  for each row execute function public.check_thread_message();

-- thread_root can't change after sending
create or replace function public.guard_message_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.channel_id <> old.channel_id or new.author_id <> old.author_id
     or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to
     or new.thread_root is distinct from old.thread_root then
    raise exception 'immutable column';
  end if;
  new.edited_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------- edit history ----
create table if not exists public.message_revisions (
  id            bigint generated always as identity primary key,
  message_id    uuid not null references public.messages (id) on delete cascade,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null,
  author_key_id text not null,
  epoch         integer not null,
  iv            text not null,
  ciphertext    text not null,
  signature     text not null,
  written_at    timestamptz not null,
  replaced_at   timestamptz not null default now()
);
create index if not exists message_revisions_msg_idx on public.message_revisions (message_id, replaced_at);
alter table public.message_revisions enable row level security;
drop policy if exists message_revisions_select on public.message_revisions;
create policy message_revisions_select on public.message_revisions for select to authenticated
  using (public.can_view_channel(channel_id));

create or replace function public.keep_message_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ciphertext is distinct from old.ciphertext then
    insert into public.message_revisions (message_id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, written_at)
    values (old.id, old.channel_id, old.author_id, old.author_key_id, old.epoch, old.iv, old.ciphertext, old.signature,
            coalesce(old.edited_at, old.created_at));
  end if;
  return new;
end;
$$;
drop trigger if exists messages_keep_revision on public.messages;
create trigger messages_keep_revision after update on public.messages
  for each row execute function public.keep_message_revision();

-- ------------------------------------------------- deleted message log ----
-- Server messages that get deleted are kept (still encrypted) for moderators
-- with Manage Messages, for the server's retention period (default 30 days,
-- 0 = don't keep). DMs and groups are never kept.
alter table public.servers add column if not exists log_retention_days integer not null default 30
  check (log_retention_days between 0 and 365);

create table if not exists public.deleted_messages (
  id            uuid primary key,
  server_id     uuid not null references public.servers (id) on delete cascade,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null,
  author_key_id text not null,
  epoch         integer not null,
  iv            text not null,
  ciphertext    text not null,
  signature     text not null,
  created_at    timestamptz not null,
  deleted_at    timestamptz not null default now(),
  deleted_by    uuid,
  purge_after   timestamptz not null
);
create index if not exists deleted_messages_server_idx on public.deleted_messages (server_id, deleted_at desc);
alter table public.deleted_messages enable row level security;
drop policy if exists deleted_messages_select on public.deleted_messages;
create policy deleted_messages_select on public.deleted_messages for select to authenticated
  using (purge_after > now() and public.channel_has_permission(channel_id, 256));

create or replace function public.log_deleted_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_days integer;
begin
  -- only direct deletes: when a whole channel or server is deleted, the
  -- messages cascade away with it (pg_trigger_depth() > 1 inside cascades)
  if pg_trigger_depth() > 1 then return old; end if;
  select c.server_id, s.log_retention_days into v_server, v_days
    from public.channels c left join public.servers s on s.id = c.server_id
   where c.id = old.channel_id;
  if v_server is not null and coalesce(v_days, 0) > 0 then
    insert into public.deleted_messages (id, server_id, channel_id, author_id, author_key_id, epoch, iv, ciphertext,
                                         signature, created_at, deleted_by, purge_after)
    values (old.id, v_server, old.channel_id, old.author_id, old.author_key_id, old.epoch, old.iv, old.ciphertext,
            old.signature, old.created_at, auth.uid(), now() + make_interval(days => v_days))
    on conflict (id) do nothing;
  end if;
  delete from public.deleted_messages where purge_after < now();
  return old;
end;
$$;
drop trigger if exists messages_log_delete on public.messages;
create trigger messages_log_delete before delete on public.messages
  for each row execute function public.log_deleted_message();

-- ------------------------------------------------------------ reactions ----
create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  epoch      integer not null,
  tag        text not null check (char_length(tag) between 8 and 64),
  iv         text not null check (char_length(iv) < 64),
  ciphertext text not null check (char_length(ciphertext) < 600),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, tag)
);
create index if not exists reactions_channel_idx on public.reactions (channel_id, message_id);
alter table public.reactions enable row level security;
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (public.can_view_channel(channel_id));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and public.account_can('send')
              and public.channel_has_permission(channel_id, 4096)
              and not public.dm_blocked(channel_id)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = reactions.channel_id)
              and (select count(*) from public.reactions r where r.message_id = reactions.message_id) < 200);
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid() or public.channel_has_permission(channel_id, 256));

-- ----------------------------------------------------------------- pins ----
create table if not exists public.pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  pinned_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pinned_at  timestamptz not null default now()
);
create index if not exists pins_channel_idx on public.pins (channel_id, pinned_at desc);
alter table public.pins enable row level security;
drop policy if exists pins_select on public.pins;
create policy pins_select on public.pins for select to authenticated
  using (public.can_view_channel(channel_id));
-- DMs and groups: anyone in the conversation. Servers: Manage Messages.
drop policy if exists pins_insert on public.pins;
create policy pins_insert on public.pins for insert to authenticated
  with check (pinned_by = auth.uid()
              and public.channel_has_permission(channel_id, 256)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = pins.channel_id)
              and (select count(*) from public.pins p where p.channel_id = pins.channel_id) < 250);
drop policy if exists pins_delete on public.pins;
create policy pins_delete on public.pins for delete to authenticated
  using (public.channel_has_permission(channel_id, 256));

-- Row counts for per-user limits (a policy can't query its own table).
create or replace function public.my_row_count(p_table text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare n bigint;
begin
  if p_table = 'saved_messages' then select count(*) into n from public.saved_messages where user_id = auth.uid();
  elsif p_table = 'scheduled_messages' then select count(*) into n from public.scheduled_messages where author_id = auth.uid();
  else raise exception 'unknown table';
  end if;
  return n;
end;
$$;
grant execute on function public.my_row_count(text) to authenticated;

-- ------------------------------------------------------- saved messages ----
create table if not exists public.saved_messages (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.saved_messages enable row level security;
drop policy if exists saved_messages_own on public.saved_messages;
create policy saved_messages_own on public.saved_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_view_channel(channel_id)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = saved_messages.channel_id)
              and public.my_row_count('saved_messages') < 1000);

-- ---------------------------------------------------------- read states ----
-- Synced across devices: where you stopped reading in each conversation.
create table if not exists public.read_states (
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  manual_unread boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.read_states enable row level security;
drop policy if exists read_states_own on public.read_states;
create policy read_states_own on public.read_states for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_view_channel(channel_id));

-- ---------------------------------------------------------------- polls ----
create table if not exists public.polls (
  message_id   uuid primary key references public.messages (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  created_by   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option_count smallint not null check (option_count between 2 and 10),
  multi        boolean not null default false,
  anonymous    boolean not null default false,
  expires_at   timestamptz
);
alter table public.polls enable row level security;
drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls for select to authenticated using (public.can_view_channel(channel_id));
drop policy if exists polls_insert on public.polls;
create policy polls_insert on public.polls for insert to authenticated
  with check (created_by = auth.uid() and public.channel_has_permission(channel_id, 32768)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = polls.channel_id
                          and m.author_id = auth.uid()));
drop policy if exists polls_update on public.polls;
create policy polls_update on public.polls for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create table if not exists public.poll_votes (
  message_id uuid not null references public.polls (message_id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  options    smallint[] not null check (cardinality(options) between 1 and 10),
  voted_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.poll_votes enable row level security;
-- you always see your own vote; others' votes only on non-anonymous polls
drop policy if exists poll_votes_select on public.poll_votes;
create policy poll_votes_select on public.poll_votes for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.polls p where p.message_id = poll_votes.message_id
                    and not p.anonymous and public.can_view_channel(p.channel_id)));
drop policy if exists poll_votes_write on public.poll_votes;
create policy poll_votes_write on public.poll_votes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.polls p
     where p.message_id = poll_votes.message_id
       and p.channel_id = poll_votes.channel_id
       and public.can_view_channel(p.channel_id)
       and (p.expires_at is null or p.expires_at > now())
       and (p.multi or cardinality(poll_votes.options) = 1)
       and poll_votes.options <@ (select array_agg(i::smallint) from generate_series(0, p.option_count - 1) i)));

-- Live counts without revealing who voted (works for anonymous polls).
create or replace function public.poll_results(p_message uuid)
returns table (option smallint, votes bigint) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.polls p where p.message_id = p_message and public.can_view_channel(p.channel_id)) then
    raise exception 'forbidden';
  end if;
  return query select o::smallint, count(*) from public.poll_votes v, unnest(v.options) o
               where v.message_id = p_message group by o order by o;
end;
$$;

-- ---------------------------------------------------- scheduled messages ----
-- Already encrypted on the sender's device; delivered at send_at.
create table if not exists public.scheduled_messages (
  id            uuid primary key,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  author_key_id text not null references public.user_keys (key_id),
  epoch         integer not null,
  iv            text not null check (char_length(iv) < 64),
  ciphertext    text not null check (char_length(ciphertext) <= 20000),
  signature     text not null check (char_length(signature) < 200),
  reply_to      uuid references public.messages (id) on delete set null,
  send_at       timestamptz not null check (send_at < now() + interval '366 days'),
  created_at    timestamptz not null default now(),
  foreign key (channel_id, epoch) references public.channel_epochs (channel_id, epoch)
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages (send_at);
alter table public.scheduled_messages enable row level security;
drop policy if exists scheduled_messages_own on public.scheduled_messages;
create policy scheduled_messages_own on public.scheduled_messages for all to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.channel_has_permission(channel_id, 128)
              and public.my_row_count('scheduled_messages') < 100);

-- Move due messages into the channel. Re-checks that the author may still send.
create or replace function public.deliver_scheduled_messages()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.scheduled_messages%rowtype;
  n integer := 0;
begin
  for s in select * from public.scheduled_messages where send_at <= now() order by send_at limit 500 for update skip locked loop
    delete from public.scheduled_messages where id = s.id;
    if public.channel_has_permission(s.channel_id, 128, s.author_id)
       and public.account_can('send', s.author_id)
       and not public.dm_blocked(s.channel_id, s.author_id)
       and exists (select 1 from public.user_keys k where k.key_id = s.author_key_id and k.revoked_at is null) then
      insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, reply_to)
      values (s.id, s.channel_id, s.author_id, s.author_key_id, s.epoch, s.iv, s.ciphertext, s.signature, s.reply_to)
      on conflict (id) do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Run every minute with pg_cron (turned on here when the database allows it;
-- otherwise: Supabase → Database → Extensions → pg_cron, then run this again).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-scheduled-messages';
    perform cron.schedule('venband-scheduled-messages', '* * * * *', 'select public.deliver_scheduled_messages()');
  end if;
exception when others then null;
end $$;

-- ------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['reactions', 'pins', 'threads', 'poll_votes', 'read_states'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null; -- no realtime publication (plain Postgres tests)
end $$;

-- ---------------------------------------------------------------- grants ----
grant select, insert, delete         on public.reactions          to authenticated;
grant select, insert, delete         on public.pins               to authenticated;
grant select, insert, delete         on public.saved_messages     to authenticated;
grant select, insert, update, delete on public.read_states        to authenticated;
grant select, insert                 on public.threads            to authenticated;
grant update (name, locked, archived) on public.threads           to authenticated;
grant delete                         on public.threads            to authenticated;
grant select                         on public.message_revisions  to authenticated;
grant select                         on public.deleted_messages   to authenticated;
grant select, insert                 on public.polls              to authenticated;
grant update (expires_at)            on public.polls              to authenticated;
grant select, insert, update, delete on public.poll_votes         to authenticated;
grant select, insert, delete         on public.scheduled_messages to authenticated;
grant update (log_retention_days)    on public.servers            to authenticated;
grant execute on function public.poll_results(uuid) to authenticated;
grant execute on function public.deliver_scheduled_messages() to authenticated;
