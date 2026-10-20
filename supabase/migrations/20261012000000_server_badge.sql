-- Server tags can be 2–4 letters/numbers OR a single emoji badge (⭐ 🔥 …)
-- so servers (and the members wearing the tag) can show a small badge.
-- The shape is still enforced by the UI; the column just caps the length.

alter table public.servers
  drop constraint if exists servers_tag_check;

alter table public.servers
  add constraint servers_tag_check check (tag is null or char_length(tag) between 1 and 8);