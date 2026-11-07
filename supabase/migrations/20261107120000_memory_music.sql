-- =============================================================================
-- Memory music (20261107120000)
--
-- A memory can have one song playing over it, picked from the music search in
-- "New memory" (/api/music). Only the song's id and labels are stored — the
-- audio link is fetched fresh when the memory is watched, because the music
-- service's links expire.
--
-- Safe to run more than once.
-- =============================================================================
alter table public.memories add column if not exists music jsonb;

alter table public.memories drop constraint if exists memories_music_check;
alter table public.memories add constraint memories_music_check check (
  music is null or (
    jsonb_typeof(music) = 'object'
    and pg_column_size(music) <= 2048
    and (music ->> 'provider') in ('soundstripe', 'freetouse')
    and char_length(coalesce(music ->> 'id', '')) between 1 and 64
    and char_length(coalesce(music ->> 'title', '')) between 1 and 120
    and char_length(coalesce(music ->> 'artist', '')) <= 120
    and (music ->> 'artwork' is null or (char_length(music ->> 'artwork') <= 500 and (music ->> 'artwork') like 'https://%'))
    and coalesce(music ->> 'start', '0') ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$'
    and coalesce((music ->> 'start')::numeric, 0) <= 900
  )
);

-- the owner can change or remove the song later
grant update (caption, active, expires_at, audience, music) on public.memories to authenticated;

notify pgrst, 'reload schema';
