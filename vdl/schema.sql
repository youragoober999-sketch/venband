-- Venband Data Layer (VDL) schema for Vercel Postgres.
-- Run once in Vercel Postgres (or any Postgres) to bootstrap the fast on-site backend.

create extension if not exists "uuid-ossp";

create table if not exists vdl_users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text not null,
  username text unique not null,
  display_name text,
  avatar_color text not null default '#5865f2',
  badges text[] not null default '{}',
  platform_role text not null default 'user',
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table if not exists vdl_servers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references vdl_users(id) on delete cascade,
  icon_color text not null default '#5865f2',
  status text not null default 'active',
  verified boolean not null default false,
  description text not null default '',
  members integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists vdl_channels (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid references vdl_servers(id) on delete cascade,
  name text not null,
  type text not null default 'text',
  created_at timestamptz not null default now()
);

create table if not exists vdl_messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid references vdl_channels(id) on delete cascade,
  author_id uuid references vdl_users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists vdl_messages_channel_idx on vdl_messages(channel_id, created_at);

create table if not exists vdl_memberships (
  user_id uuid references vdl_users(id) on delete cascade,
  server_id uuid references vdl_servers(id) on delete cascade,
  primary key (user_id, server_id)
);
