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
  tags?: string[];
}

/** A command one of your bots answers itself (no-code responder). */
export interface BotCommandResponse {
  content?: string;
  embed?: { title?: string; description?: string; color?: string };
  actions?: ('kick' | 'ban' | 'purge')[];
}

export interface BotCommandRow {
  name: string;
  description: string;
  response: BotCommandResponse | null;
}

export interface BotTemplate {
  slug: string;
  name: string;
  blurb: string;
  preset: Preset;
  tags: string[];
  commands: { name: string; description: string; response?: BotCommandResponse }[];
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
  server_id: string | null;
  channel_id: string;
  app_id: string;
  username: string | null;
  content: string;
  embed: BotEmbed | null;
  created_at: string;
}

export const APP_COLUMNS = 'id, owner_id, name, description, preset, icon_url, banner_url, color, token_hint, status, created_at, tags';
// Columns that exist even before the wordle migration (applications.banner_url)
// is applied, so lists and dashboards keep working against an older schema.
export const APP_COLUMNS_BASE = 'id, owner_id, name, description, preset, icon_url, color, token_hint, status, created_at';

/** Normalize free-form tag input into clean, deduped, lowercase tags. */
export function normalizeTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const t = part.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
    if (t && /^[a-z0-9_-]{1,32}$/.test(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length === 12) break;
    }
  }
  return out;
}
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

// ------------------------------------------------------------ bot DMs ------

/** A DM whose channel is bound to an app (slash commands live in the DM). */
export interface DmBotLink {
  app_id: string;
  app_name: string;
  app_color: string;
  preset: Preset;
}

const DM_BOTS_COLUMNS = `app_id, applications(${APP_COLUMNS_BASE})`;

async function dmBotRow(channelId: string): Promise<Application | null> {
  const { data } = await supabase.from('dm_bots').select(DM_BOTS_COLUMNS).eq('channel_id', channelId).maybeSingle();
  const row = data as unknown as { applications?: unknown } | null;
  return (row?.applications as unknown as Application | undefined) ?? null;
}

/** Which DMs are bound to a bot, batched (for the DM list / settings). */
export async function dmBotLinksFor(channelIds: string[]): Promise<Map<string, DmBotLink>> {
  const out = new Map<string, DmBotLink>();
  if (!channelIds.length) return out;
  const { data } = await supabase.from('dm_bots').select(DM_BOTS_COLUMNS).in('channel_id', channelIds);
  const rows = (data ?? []) as unknown as { channel_id: string; applications?: unknown }[];
  for (const row of rows) {
    const a = row.applications as unknown as Application | undefined;
    if (!a) continue;
    out.set(row.channel_id, { app_id: a.id, app_name: a.name, app_color: a.color, preset: a.preset });
  }
  return out;
}

/** The app a DM is bound to (null when it's a normal person DM). */
export function useDmBot(channelId: string | null): Application | null {
  const [app, setApp] = useState<Application | null>(null);
  useEffect(() => {
    setApp(null);
    if (!channelId) return;
    let cancelled = false;
    const load = () => dmBotRow(channelId).then((a) => !cancelled && setApp(a));
    load();
    const ch = supabase
      .channel(`dmb:${channelId}:${Math.random().toString(36).slice(2, 8)}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_bots', filter: `channel_id=eq.${channelId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [channelId]);
  return app;
}

/** The slash commands a bot answers inside its DM (mobile-friendly mirror kept live). */
export function useDmCommands(channelId: string | null): BotCommand[] {
  const [rows, setRows] = useState<BotCommand[]>([]);
  useEffect(() => {
    if (!channelId) return setRows([]);
    let cancelled = false;
    const load = () =>
      supabase.rpc('dm_commands', { p_channel: channelId }).then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as BotCommand[]);
      });
    load();
    const ch = supabase
      .channel(`dmc:${channelId}:${Math.random().toString(36).slice(2, 8)}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_bots', filter: `channel_id=eq.${channelId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [channelId]);
  return rows;
}

/** One row of list_my_bots() — an app you connected or own. */
export interface MyBotRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  preset: Preset;
  color: string;
  icon_url: string | null;
  channel_id: string | null;
  created_at: string | null;
}

/** Connect a bot to your account for DM slash commands; returns the DM channel id. */
export async function connectBot(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('connect_bot', { p_app: appId });
  if (error) throw error;
  if (!data) throw new Error('That bot couldn’t be connected right now.');
  return data as string;
}

export async function disconnectBot(appId: string): Promise<void> {
  const { error } = await supabase.rpc('disconnect_bot', { p_app: appId });
  if (error) throw error;
}

export interface ListMyBotsResult {
  rows: MyBotRow[];
  /** the RPC doesn't exist yet on this server */
  missing?: boolean;
}
export async function listMyBots(): Promise<ListMyBotsResult> {
  const { data, error } = await supabase.rpc('list_my_bots');
  if (error && /PGRST202/.test(error.message)) return { rows: [], missing: true };
  if (error) throw error;
  return { rows: (data ?? []) as MyBotRow[] };
}

/** True when an RPC or column doesn't exist yet on this server (pending SQL not pasted). */
export function isRpcMissing(e: unknown): boolean {
  return /PGRST202|PGRST204/.test((e as { message?: string })?.message ?? String(e ?? ''));
}

export async function deleteApp(appId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_app', { p_app: appId });
  if (error) throw error;
}
