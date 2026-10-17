-- Venband Blob (VBB) — custom object storage schema for Vercel Postgres.
create extension if not exists "uuid-ossp";

create table if not exists vbb_objects (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  content_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  sha256 text not null,
  storage text not null default 'postgres', -- 'postgres' | 'blob' | 'chunked'
  public boolean not null default false,
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vbb_objects_sha_idx on vbb_objects(sha256) where storage = 'postgres';
create index if not exists vbb_objects_name_idx on vbb_objects(name);
create index if not exists vbb_objects_owner_idx on vbb_objects(owner_id);

create table if not exists vbb_data (
  object_id uuid primary key references vbb_objects(id) on delete cascade,
  bytes bytea not null
);

create table if not exists vbb_chunks (
  id uuid primary key default uuid_generate_v4(),
  object_id uuid references vbb_objects(id) on delete cascade,
  chunk_index integer not null,
  bytes bytea not null,
  size integer not null,
  unique (object_id, chunk_index)
);
create index if not exists vbb_chunks_obj_idx on vbb_chunks(object_id, chunk_index);

create table if not exists vbb_shards (
  id serial primary key,
  subdomain text not null unique,
  base_url text not null,
  capacity_bytes bigint not null default 0,
  used_bytes bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
