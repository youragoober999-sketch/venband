// Bots: applications people make at /bots and add to servers.
// Bots never get message keys, so they can't read encrypted messages; what
// they post is plain text and is labelled as not end-to-end encrypted.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Preset = 'custom' | 'verification' | 'management' | 'site' | 'wordle' | 'venband';

export interface Application {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  preset: Preset;
  icon_url: string | null;
  banner_url: string | null;
  color: string;
  token_hint: string | null;
  status: 'active' | 'disabled';
  created_at: string;
}

export interface ServerBot {
  id: string;
  server_id: string;
  app_id: string;
  added_by: string | null;
  settings: { welcome_channel?: string; welcome_text?: string; auto_roles?: string[]; log_channel?: string };
  webhook_channel: string | null;
  created_at: string;
}

export interface BotEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: string;
  footer?: string;
  fields?: { name: string; value: string }[];
}

export interface BotMessage {
  id: string;
  server_id: string;
  channel_id: string;
  app_id: string;
  username: string | null;
  content: string;
  embed: BotEmbed | null;
  created_at: string;
}

export const APP_COLUMNS = 'id, owner_id, name, description, preset, icon_url, banner_url, color, token_hint, status, created_at';
// Columns that exist even before the wordle migration (applications.banner_url)
// is applied, so lists and dashboards keep working against an older schema.
export const APP_COLUMNS_BASE = 'id, owner_id, name, description, preset, icon_url, color, token_hint, status, created_at';
export async function appQuery<T>(q: (cols: string) => PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const full = await q(APP_COLUMNS);
  if (!full.error) return full;
  return q(APP_COLUMNS_BASE);
}

export const PRESETS: { id: Preset; name: string; blurb: string; features: string[] }[] = [
  {
    id: 'verification',
    name: 'Verification',
    blurb: 'Keep alts, ban evaders and raiders out with Voogle.',
    features: ['Members verify before they can talk', 'Blocks too many accounts from one device or network', 'Catches ban evasion', '/verify command'],
  },
  {
    id: 'management',
    name: 'Server management',
    blurb: 'Welcome new members, hand out roles and log joins and leaves.',
    features: ['Welcome messages with {user} and {server}', 'Up to 5 automatic roles', 'Join / leave log channel', '/serverinfo and /rules'],
  },
  {
    id: 'site',
    name: 'Connect a site',
    blurb: 'Post updates from your website, store or service into a channel.',
    features: ['A secret webhook URL per server', 'Text and rich embeds', 'Works with anything that can send a web request'],
  },
  {
    id: 'wordle',
    name: 'Wordle',
    blurb: 'Play a shared Wordle with the whole channel.',
    features: ['/wordle starts a game', 'Guess with /guess WORD', 'Green, yellow and grey feedback every guess', 'New word each game'],
  },
  {
    id: 'venband',
    name: 'Venband',
    blurb: 'An official moderation toolkit for your server staff.',
    features: ['/ban, /kick and /purge', '/info and /serverinfo profile & server cards', '/lock and /unlock any channel', 'Made by the Venband team'],
  },
  {
    id: 'custom',
    name: 'Custom bot',
    blurb: 'Write your own bot with the Venband bot API.',
    features: ['Token-based HTTP API', 'Slash commands', 'Member join events', 'Voogle risk checks'],
  },
];

const appCache = new Map<string, Promise<Application | null>>();
export function getApp(id: string): Promise<Application | null> {
  let p = appCache.get(id);
  if (!p) {
    p = appQuery((cols) => supabase.from('applications').select(cols).eq('id', id).maybeSingle()).then(({ data }) => (data as Application | null) ?? null);
    appCache.set(id, p);
  }
  return p;
}

export function useApps(ids: string[]): Record<string, Application> {
  const [apps, setApps] = useState<Record<string, Application>>({});
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    Promise.all(key ? key.split(',').map(getApp) : []).then((list) => {
      if (!cancelled) setApps(Object.fromEntries(list.filter((a): a is Application => Boolean(a)).map((a) => [a.id, a])));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return apps;
}

/** Bot posts in a channel, live. */
export function useBotMessages(channelId: string | null): BotMessage[] {
  const [rows, setRows] = useState<BotMessage[]>([]);
  useEffect(() => {
    setRows([]);
    if (!channelId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('bot_messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(100);
      if (!cancelled) setRows(((data ?? []) as BotMessage[]).reverse());
    };
    load();
    const ch = supabase
      .channel(`dbc:${channelId}:bots`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_messages', filter: `channel_id=eq.${channelId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [channelId]);
  return rows;
}

export interface BotCommand {
  app_id: string;
  app_name: string;
  name: string;
  description: string;
}

/** Bumps when bots join or leave a server (live). */
function useBotsVersion(serverId: string | null) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!serverId) return;
    const ch = supabase
      .channel(`dbs:${serverId}:bots:${Math.random().toString(36).slice(2, 8)}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_bots', filter: `server_id=eq.${serverId}` }, () => setV((x) => x + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [serverId]);
  return v;
}

export function useServerCommands(serverId: string | null): BotCommand[] {
  const [rows, setRows] = useState<BotCommand[]>([]);
  const live = useBotsVersion(serverId);
  useEffect(() => {
    if (!serverId) return setRows([]);
    supabase.rpc('server_commands', { p_server: serverId }).then(({ data }) => setRows((data ?? []) as BotCommand[]));
  }, [serverId, live]);
  return rows;
}

export function useServerBots(serverId: string | null, version = 0): ServerBot[] {
  const [rows, setRows] = useState<ServerBot[]>([]);
  const live = useBotsVersion(serverId);
  useEffect(() => {
    if (!serverId) return setRows([]);
    supabase
      .from('server_bots')
      .select('id, server_id, app_id, added_by, settings, webhook_channel, created_at')
      .eq('server_id', serverId)
      .then(({ data }) => setRows((data ?? []) as ServerBot[]));
  }, [serverId, version, live]);
  return rows;
}

export function apiBase() {
  return `${window.location.origin}${import.meta.env.BASE_URL}api`;
}
