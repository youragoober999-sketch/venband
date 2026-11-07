// Comet, Venband's server-management bot. Its commands run in the database
// (supabase/migrations/20261107160000_comet_bot.sql); this file has what the
// app needs around them:
//   * the / menu metadata — usage, typed options (member / role / channel /
//     duration / choice) and ready-made variants like "/purge all"
//   * the parts that need to read messages, which only your device can do
//     because messages are end-to-end encrypted: purging by content, the word
//     logger and the swear jar (the server only ever gets ids or a count).
import { supabase } from './supabase';
import type { DecryptedMessage } from './keyring';

export type CometOptionType = 'user' | 'role' | 'channel' | 'duration' | 'choice' | 'number' | 'text';
export interface CometOption {
  name: string;
  type: CometOptionType;
  description: string;
  choices?: string[];
  optional?: boolean;
}
export interface CometMeta {
  category: 'Moderation' | 'Messages' | 'Roles' | 'Channels' | 'Server' | 'Fun';
  options: CometOption[];
  /** extra rows in the / menu that insert a ready-made start, e.g. "/purge all" */
  variants?: { insert: string; description: string }[];
}

const user = (d = 'A member — mention, username or id'): CometOption => ({ name: 'user', type: 'user', description: d });
const role = (d = 'A role'): CometOption => ({ name: 'role', type: 'role', description: d });
const channel = (d = 'A channel', optional = false): CometOption => ({ name: 'channel', type: 'channel', description: d, optional });
const duration = (d = '30s · 1h · 1d · 1w · 1mo · 1y — leave empty for “until undone”'): CometOption => ({ name: 'duration', type: 'duration', description: d, optional: true });
const text = (name: string, d: string, optional = false): CometOption => ({ name, type: 'text', description: d, optional });

export const COMET: Record<string, CometMeta> = {
  ban: { category: 'Moderation', options: [user(), text('reason', 'Why (optional)', true)] },
  unban: { category: 'Moderation', options: [user()] },
  kick: { category: 'Moderation', options: [user(), text('reason', 'Why (optional)', true)] },
  timeout: { category: 'Moderation', options: [user(), duration(), text('reason', 'Why (optional)', true)] },
  untimeout: { category: 'Moderation', options: [user()] },
  mute: { category: 'Moderation', options: [user('Who to mute in voice'), duration()] },
  unmute: { category: 'Moderation', options: [user()] },
  deafen: { category: 'Moderation', options: [user('Who to deafen in voice'), duration()] },
  undeafen: { category: 'Moderation', options: [user()] },
  warn: { category: 'Moderation', options: [user(), text('reason', 'They see this in a pop-up')] },
  warnings: { category: 'Moderation', options: [user()] },
  clearwarns: { category: 'Moderation', options: [user()] },
  purge: {
    category: 'Messages',
    options: [{ name: 'what', type: 'choice', description: 'How many, or which messages', choices: ['10', '50', 'all', 'links', 'images', 'files', 'embeds', 'mentions', 'reactions', 'human', 'bots'] }, text('amount', 'For filters: how many (default 50, or all)', true)],
    variants: [
      { insert: '/purge all', description: 'Delete every message in this channel' },
      { insert: '/purge links ', description: 'Delete messages with links' },
      { insert: '/purge images ', description: 'Delete messages with images' },
      { insert: '/purge files ', description: 'Delete messages with files' },
      { insert: '/purge embeds ', description: 'Delete messages with embeds' },
      { insert: '/purge mentions ', description: 'Delete messages that mention someone' },
      { insert: '/purge reactions ', description: 'Delete messages that have reactions' },
      { insert: '/purge human ', description: 'Delete the last N human messages' },
    ],
  },
  cleanup: { category: 'Messages', options: [] },
  say: { category: 'Messages', options: [text('text', 'What Comet should say')] },
  announce: { category: 'Messages', options: [text('text', 'The announcement')] },
  role: { category: 'Roles', options: [user(), role('The role to add (other roles stay)')] },
  unrole: { category: 'Roles', options: [user(), role('The role to take away')] },
  roll: { category: 'Roles', options: [{ name: 'all', type: 'choice', description: 'Give every member a role', choices: ['all'] }, role()], variants: [{ insert: '/roll all ', description: 'Give every member a role' }] },
  autorole: { category: 'Roles', options: [role('Given to everyone who joins (or type off)')] },
  roleinfo: { category: 'Roles', options: [role()] },
  pauseinvites: { category: 'Server', options: [] },
  wordlogger: { category: 'Server', options: [] },
  staff: { category: 'Server', options: [{ name: 'log', type: 'choice', description: 'Mod log', choices: ['log set'] }, channel('Where mod actions and reports go')], variants: [{ insert: '/staff log set ', description: 'Choose the mod log channel' }] },
  server: { category: 'Server', options: [{ name: 'count', type: 'choice', description: 'Count members', choices: ['count'] }, text('filters', 'humans, bots, @role — comma separated', true)], variants: [{ insert: '/server count ', description: 'Count humans, bots or a role' }] },
  serverinfo: { category: 'Server', options: [] },
  userinfo: { category: 'Server', options: [{ ...user(), optional: true }] },
  lock: { category: 'Channels', options: [channel('Which channel (this one if empty)', true)] },
  unlock: { category: 'Channels', options: [channel('Which channel (this one if empty)', true)] },
  lockdown: { category: 'Channels', options: [] },
  unlockdown: { category: 'Channels', options: [] },
  slowmode: { category: 'Channels', options: [channel('Which channel', true), { name: 'delay', type: 'duration', description: '5s · 30s · 1m · 0 to turn off' }] },
  topic: { category: 'Channels', options: [channel(), text('topic', 'The new topic')] },
  rename: { category: 'Channels', options: [channel(), text('name', '"new name"')] },
  delete: { category: 'Channels', options: [channel('The channel to delete')] },
  levels: { category: 'Fun', options: [{ name: 'action', type: 'choice', description: 'Leaderboard, or turn levels on/off', choices: ['enable', 'disable'], optional: true }], variants: [{ insert: '/levels enable', description: 'Turn on XP, levels and quests' }] },
  rank: { category: 'Fun', options: [{ ...user(), optional: true }] },
  level: { category: 'Fun', options: [{ name: 'set', type: 'choice', description: 'Set a level', choices: ['set'] }, user(), { name: 'level', type: 'number', description: 'The level' }], variants: [{ insert: '/level set ', description: 'Set someone’s level' }] },
  xp: { category: 'Fun', options: [{ name: 'set', type: 'choice', description: 'Set XP', choices: ['set'] }, user(), { name: 'xp', type: 'number', description: 'XP amount' }], variants: [{ insert: '/xp set ', description: 'Set someone’s XP' }] },
  swear: {
    category: 'Fun',
    options: [{ name: 'jar', type: 'choice', description: 'Swear jar', choices: ['jar enable', 'jar disable', 'jar leaderboard', 'jar global'] }],
    variants: [
      { insert: '/swear jar enable', description: 'Turn on the swear jar' },
      { insert: '/swear jar leaderboard', description: 'Who swears most in this server' },
      { insert: '/swear jar global', description: 'Who swears most everywhere' },
    ],
  },
  birthday: { category: 'Fun', options: [{ name: 'action', type: 'choice', description: 'list · set MM/DD · remove', choices: ['list', 'set', 'remove'] }], variants: [{ insert: '/birthday list', description: 'Whose birthday is it today?' }, { insert: '/birthday set ', description: 'Share your birthday (day and month only)' }] },
  help: { category: 'Server', options: [] },
};

export const isCometApp = (appName: string) => appName === 'Comet';

// --------------------------------------------------------- device side ----
interface ClientConfig {
  installed: boolean;
  swearjar?: boolean;
  words?: string[];
  wordlog?: boolean;
}
const cfgCache = new Map<string, { at: number; cfg: ClientConfig }>();
export async function cometConfig(serverId: string): Promise<ClientConfig> {
  const hit = cfgCache.get(serverId);
  if (hit && Date.now() - hit.at < 60_000) return hit.cfg;
  const { data } = await supabase.rpc('comet_client_config', { p_server: serverId });
  const cfg = (data ?? { installed: false }) as ClientConfig;
  cfgCache.set(serverId, { at: Date.now(), cfg });
  return cfg;
}
export const forgetCometConfig = (serverId: string) => cfgCache.delete(serverId);

// a short, common list — the swear jar is for fun, not a filter
const SWEARS = ['fuck', 'fucking', 'fucked', 'fucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'ass', 'asshole', 'bastard', 'damn', 'dammit', 'crap', 'dick', 'piss', 'pissed', 'bollocks', 'wtf', 'stfu', 'motherfucker', 'goddamn', 'hell'];
const words = (t: string): string[] => [...(t.toLowerCase().replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}']+/gu) ?? [])];

/** Before a message is encrypted and sent: word logger + swear jar (fire and forget). */
export async function cometBeforeSend(serverId: string, channelId: string, text: string) {
  if (!text.trim() || text.startsWith('/')) return;
  const cfg = await cometConfig(serverId).catch(() => null);
  if (!cfg?.installed) return;
  const ws = words(text);
  if (cfg.wordlog && cfg.words?.length) {
    const lower = ` ${ws.join(' ')} `;
    const hits = cfg.words.filter((w) => (w.includes(' ') ? lower.includes(` ${w} `) : ws.includes(w)));
    if (hits.length) supabase.rpc('comet_word_hit', { p_channel: channelId, p_words: hits, p_excerpt: text.slice(0, 300) }).then(() => {}); // builders are lazy: .then sends it
  }
  if (cfg.swearjar) {
    const n = ws.filter((w) => SWEARS.includes(w)).length;
    if (n) supabase.rpc('comet_swear', { p_channel: channelId, p_n: n }).then(() => {});
  }
}

export const CONTENT_PURGES = ['links', 'images', 'files', 'embeds', 'mentions'] as const;
export type ContentPurge = (typeof CONTENT_PURGES)[number];
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i;
/** Which of the loaded (decrypted) messages match a content filter, newest first. */
export function pickForPurge(kind: ContentPurge, messages: DecryptedMessage[], limit: number): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    const p = m.payload;
    if (!p) continue;
    const t = p.text ?? '';
    const atts = p.attachments ?? [];
    const has =
      kind === 'links' ? /https?:\/\/\S+/i.test(t) :
      kind === 'images' ? atts.some((a) => /^image\//.test(a.mime) || IMAGE_RE.test(a.name)) || /https?:\/\/\S+\.(gif|png|jpe?g|webp)/i.test(t) || /klipy\.com/i.test(t) :
      kind === 'files' ? atts.length > 0 :
      kind === 'embeds' ? Boolean((p as { preview?: unknown }).preview) || /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|open\.spotify\.com|klipy\.com)/i.test(t) :
      /<@[!&]?[0-9a-f-]{36}>|(^|\s)@(everyone|here)\b/.test(t);
    if (has) out.push(m.row.id);
  }
  return out;
}

/** Is this a "purge by content" command the device has to work out? */
export function contentPurgeOf(args: string): { kind: ContentPurge; limit: number } | null {
  const [what, amount] = args.trim().toLowerCase().split(/\s+/);
  if (!(CONTENT_PURGES as readonly string[]).includes(what)) return null;
  const limit = amount === 'all' ? 500 : Math.min(500, Math.max(1, Number(amount) || 50));
  return { kind: what as ContentPurge, limit };
}
