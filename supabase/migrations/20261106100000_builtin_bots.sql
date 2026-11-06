-- =============================================================================
-- Built-in bots + the official bot's look (20261106100000)
--
--   * the official Venband bot gets the Venband logo (512×512) as its picture
--     and its own banner
--   * Venband's own bots appear in App Discovery for every server, each with its
--     own picture (public/bots/*.svg): Greeter (welcome + auto roles),
--     Gatekeeper (verification), Word Guess (a word game), Announcer (website /
--     webhook posts) and Mod Toolkit (moderation). They're owned by the Venband
--     system account, so they show as official.
--
-- Safe to run more than once.
-- =============================================================================

update public.applications
   set icon_url = '/icon-512.png',
       banner_url = '/bots/venband-banner.svg',
       description = 'The official Venband bot. It sends account notices, security alerts and staff messages — and never asks for your password.'
 where owner_id = '3fff0000-0000-4000-8000-0000000000bd' and name = 'Venband';

insert into public.applications (owner_id, name, preset, description, color, icon_url, tags)
select '3fff0000-0000-4000-8000-0000000000bd', v.name, v.preset, v.description, v.color, v.icon, v.tags
  from (values
    ('Greeter', 'management', 'Welcomes new members with a message, gives them starter roles and logs who joins and leaves.', '#ff7a45', '/bots/greeter.svg', array['welcome', 'servermanagement', 'roles']),
    ('Gatekeeper', 'verification', 'Keeps raiders and alt accounts out: new members verify before they can talk.', '#22c55e', '/bots/gatekeeper.svg', array['verification', 'security', 'antiraid']),
    ('Word Guess', 'wordle', 'A shared word game for your channel — six guesses to find the five-letter word.', '#4caf50', '/bots/wordguess.svg', array['games', 'fun']),
    ('Announcer', 'site', 'Posts updates from your website, stream or service into a channel through a webhook.', '#ec4899', '/bots/announcer.svg', array['webhooks', 'announcements', 'notifications']),
    ('Mod Toolkit', 'venband', 'Moderation for your staff — purge messages, ban, kick, time out, lock channels and look people up.', '#ef4444', '/bots/modtoolkit.svg', array['moderation', 'servermanagement', 'security'])
  ) as v(name, preset, description, color, icon, tags)
 where exists (select 1 from public.profiles where id = '3fff0000-0000-4000-8000-0000000000bd')
   and not exists (select 1 from public.applications a
                    where a.owner_id = '3fff0000-0000-4000-8000-0000000000bd' and a.name = v.name);

notify pgrst, 'reload schema';
