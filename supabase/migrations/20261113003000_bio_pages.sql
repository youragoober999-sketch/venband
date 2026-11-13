create table if not exists public.bio_pages (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 16384),
  check (published is null or (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 16384))
);
alter table public.bio_pages enable row level security;
revoke all on public.bio_pages from public, anon;
grant select on public.bio_pages to authenticated;
drop policy if exists bio_pages_own on public.bio_pages;
create policy bio_pages_own on public.bio_pages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.save_bio_page(p_draft jsonb, p_published jsonb, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or not exists (
    select 1 from public.profiles where id = owner_id and account_status = 'active'
  ) then raise exception 'An active account is required'; end if;
  if p_action is null or p_action not in ('draft', 'publish', 'unpublish')
    or (p_action = 'publish' and p_published is null) then raise exception 'Invalid bio page action'; end if;
  insert into public.bio_pages as b (user_id, draft, published)
  values (owner_id, p_draft, case when p_action = 'publish' then p_published end)
  on conflict (user_id) do update set
    draft = excluded.draft,
    published = case when p_action = 'draft' then b.published else excluded.published end;
end;
$$;
revoke execute on function public.save_bio_page(jsonb, jsonb, text) from public, anon;
grant execute on function public.save_bio_page(jsonb, jsonb, text) to authenticated;

create or replace function public.public_bio_page(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', p.username, 'displayName', p.display_name, 'avatar', p.avatar_url,
    'avatarColor', p.avatar_color,
    'page', b.published,
    'connections', case when b.published -> 'showConnections' = 'true'::jsonb then
      coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider, 'external_id', c.external_id,
        'display_name', c.display_name, 'handle', left(c.metadata ->> 'handle', 80)))
        from (select * from public.connections where user_id = p.id and show_on_profile
          and provider in ('steam', 'twitch', 'discord', 'github', 'youtube', 'xbox', 'tiktok')
          order by created_at limit 20) c), '[]'::jsonb)
      else '[]'::jsonb end
  )
  from public.bio_pages b join public.profiles p on p.id = b.user_id
  where p.username = lower(p_username) and b.published is not null
    and p.account_status = 'active';
$$;
revoke execute on function public.public_bio_page(text) from public;
grant execute on function public.public_bio_page(text) to anon, authenticated;

-- Files chosen for bio pages are public by URL. Writes are scoped to the owner's folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bio-assets', 'bio-assets', true, 8388608) on conflict (id) do nothing;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage'
    and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/ogg']
    where id = 'bio-assets';
  end if;
end $$;
drop policy if exists bio_assets_insert on storage.objects;
create policy bio_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bio-assets' and split_part(name, '/', 1) = auth.uid()::text
    and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(webp|png|jpeg|mp3|ogg)$');
drop policy if exists bio_assets_delete on storage.objects;
create policy bio_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bio-assets' and split_part(name, '/', 1) = auth.uid()::text);
notify pgrst, 'reload schema';
