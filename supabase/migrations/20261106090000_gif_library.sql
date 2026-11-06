-- =============================================================================
-- Your GIF library (20261106090000)
--
-- GIFs you save ("Save as GIF" on a picture, the star on a GIF someone sent you,
-- /gif on a reply) are stored here so they show in your GIF favourites on every
-- device. Messages stay end-to-end encrypted: only what YOU choose to save
-- lands here, under an unguessable name in your own folder.
--
-- Safe to run more than once.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('gifs', 'gifs', true, 15728640)
on conflict (id) do update set public = true, file_size_limit = 15728640;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/gif'] where id = 'gifs';
exception when undefined_column then null; end $$;

-- How many GIFs someone has saved. A definer function, because a policy on
-- storage.objects that reads storage.objects itself recurses forever — and as
-- all insert policies are checked together, that broke EVERY upload.
create or replace function public.my_gif_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = 'gifs' and split_part(o.name, '/', 1) = auth.uid()::text;
$$;
revoke execute on function public.my_gif_count() from public, anon;
grant execute on function public.my_gif_count() to authenticated;

drop policy if exists venband_gifs_write on storage.objects;
create policy venband_gifs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'gifs' and split_part(name, '/', 1) = auth.uid()::text
              and public.my_gif_count() < 500); -- at most 500 saved GIFs each
drop policy if exists venband_gifs_delete on storage.objects;
create policy venband_gifs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gifs' and split_part(name, '/', 1) = auth.uid()::text);

notify pgrst, 'reload schema';
