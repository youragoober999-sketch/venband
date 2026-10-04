// Message search that keeps end-to-end encryption: the server can't read
// messages, so we fetch the encrypted rows you can access, decrypt them on
// this device and match here. Filters that don't need the text (who sent it,
// where, when) are applied by the database to keep it fast.
import { supabase } from './supabase';
import { sessionStore } from './session';
import { loadProfiles } from './directory';
import type { DecryptedMessage } from './keyring';
import type { MessageRow } from './types';

export interface SearchQuery {
  /** words that must all appear (case-insensitive) */
  words: string[];
  /** "exact phrases" */
  phrases: string[];
  from: string[]; // usernames
  mentions: string[]; // usernames
  in: string[]; // channel or server names
  has: ('image' | 'video' | 'audio' | 'file' | 'link' | 'gif' | 'embed' | 'poll' | 'code')[];
  before: Date | null;
  after: Date | null;
  during: Date | null;
  pinned: boolean | null;
  raw: string;
}

const HAS = ['image', 'video', 'audio', 'file', 'link', 'gif', 'embed', 'poll', 'code'] as const;

/** Parse `from:sam in:general has:image before:2026-05-01 "exact phrase" words`. */
export function parseQuery(raw: string): SearchQuery {
  const q: SearchQuery = { words: [], phrases: [], from: [], mentions: [], in: [], has: [], before: null, after: null, during: null, pinned: null, raw };
  const re = /(\w+):("[^"]*"|\S+)|"([^"]+)"|(\S+)/g;
  for (const m of raw.matchAll(re)) {
    if (m[3]) {
      q.phrases.push(m[3].toLowerCase());
      continue;
    }
    if (m[4]) {
      q.words.push(m[4].toLowerCase());
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2].replace(/^"|"$/g, '');
    const date = () => {
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(val) ? `${val}T00:00:00` : val);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    if (key === 'from') q.from.push(val.replace(/^@/, '').toLowerCase());
    else if (key === 'mentions') q.mentions.push(val.replace(/^@/, '').toLowerCase());
    else if (key === 'in') q.in.push(val.replace(/^#/, '').toLowerCase());
    else if (key === 'has' && (HAS as readonly string[]).includes(val.toLowerCase())) q.has.push(val.toLowerCase() as SearchQuery['has'][number]);
    else if (key === 'before') q.before = date();
    else if (key === 'after') q.after = date();
    else if (key === 'during' || key === 'on') q.during = date();
    else if (key === 'pinned') q.pinned = val === 'true' || val === 'yes';
    else q.words.push(m[0].toLowerCase());
  }
  return q;
}

export interface SearchTarget {
  channelId: string;
  label: string; // "#general · My Server" or "Sam"
  serverId: string | null;
  serverName?: string;
}

export interface SearchHit {
  m: DecryptedMessage;
  target: SearchTarget;
  snippet: string;
}

const textCache = new Map<string, DecryptedMessage>();

function matches(d: DecryptedMessage, q: SearchQuery, mentionIds: string[]): boolean {
  const p = d.payload;
  if (!p) return false;
  const text = (p.text ?? '').toLowerCase();
  const files = (p.attachments ?? []).map((a) => `${a.name} ${a.alt ?? ''}`.toLowerCase()).join(' ');
  const pollText = p.poll ? `${p.poll.question} ${p.poll.options.join(' ')}`.toLowerCase() : '';
  const hay = `${text} ${files} ${pollText}`;
  for (const w of q.words) if (!hay.includes(w)) return false;
  for (const ph of q.phrases) if (!hay.includes(ph)) return false;
  for (const id of mentionIds) if (!text.includes(`<@${id}>`)) return false;
  for (const h of q.has) {
    const atts = p.attachments ?? [];
    const ok =
      h === 'image' ? atts.some((a) => a.mime.startsWith('image/')) :
      h === 'video' ? atts.some((a) => a.mime.startsWith('video/')) :
      h === 'audio' ? atts.some((a) => a.mime.startsWith('audio/')) :
      h === 'file' ? atts.length > 0 :
      h === 'link' ? /https?:\/\//.test(text) :
      h === 'gif' ? /\.gif(\?|$)|tenor|giphy|klipy/.test(text) || atts.some((a) => a.mime === 'image/gif') :
      h === 'embed' ? /youtube\.com|youtu\.be|spotify\.com|tiktok\.com|instagram\.com/.test(text) :
      h === 'poll' ? Boolean(p.poll) :
      h === 'code' ? /```|`[^`]+`/.test(p.text ?? '') : true;
    if (!ok) return false;
  }
  return true;
}

function snippetOf(d: DecryptedMessage, q: SearchQuery): string {
  const text = d.payload?.text ?? '';
  const needle = q.phrases[0] ?? q.words[0];
  if (!needle) return text.slice(0, 220);
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 220) || (d.payload?.attachments?.map((a) => `📎 ${a.name}`).join(' ') ?? '');
  const start = Math.max(0, i - 80);
  return (start ? '…' : '') + text.slice(start, i + needle.length + 140);
}

/**
 * Search `targets` newest-first. Calls `onHit` as results are found; stops
 * after `limit` hits or `maxScan` messages. Returns a cursor to continue.
 */
export async function searchMessages(
  q: SearchQuery,
  targets: SearchTarget[],
  opts: { limit?: number; maxScan?: number; before?: string | null; onHit?: (h: SearchHit) => void; onProgress?: (scanned: number) => void; signal?: AbortSignal },
): Promise<{ hits: SearchHit[]; cursor: string | null; scanned: number }> {
  const keyring = sessionStore.get().keyring;
  if (!keyring || !targets.length) return { hits: [], cursor: null, scanned: 0 };
  const limit = opts.limit ?? 50;
  const maxScan = opts.maxScan ?? 3000;
  let scanned = 0;
  const hits: SearchHit[] = [];
  const byChannel = new Map(targets.map((t) => [t.channelId, t]));

  // resolve from: / mentions: usernames to ids
  const names = [...new Set([...q.from, ...q.mentions])];
  const ids = new Map<string, string>();
  if (names.length) {
    const { data } = await supabase.from('profiles').select('id, username').in('username', names);
    for (const r of data ?? []) ids.set(r.username, r.id);
  }
  const fromIds = q.from.map((u) => ids.get(u)).filter(Boolean) as string[];
  if (q.from.length && !fromIds.length) return { hits: [], cursor: null, scanned: 0 };
  const mentionIds = q.mentions.map((u) => ids.get(u)).filter(Boolean) as string[];

  let pinned: Set<string> | null = null;
  if (q.pinned) {
    const { data } = await supabase.from('pins').select('message_id').in('channel_id', [...byChannel.keys()]);
    pinned = new Set((data ?? []).map((r) => r.message_id));
  }

  let cursor: string | null = opts.before ?? null;
  const channelIds = [...byChannel.keys()];
  for (const id of channelIds) await keyring.loadChannel(id).catch(() => {});
  while (scanned < maxScan && hits.length < limit) {
    if (opts.signal?.aborted) break;
    let req = supabase.from('messages').select('*').in('channel_id', channelIds).order('created_at', { ascending: false }).limit(200);
    if (cursor) req = req.lt('created_at', cursor);
    const before = q.during ? new Date(q.during.getTime() + 86_400_000) : q.before;
    const after = q.during ?? q.after;
    if (before) req = req.lt('created_at', before.toISOString());
    if (after) req = req.gte('created_at', after.toISOString());
    if (fromIds.length) req = req.in('author_id', fromIds);
    const { data, error } = await req;
    if (error) throw error;
    const rows = (data ?? []) as MessageRow[];
    if (!rows.length) {
      cursor = null;
      break;
    }
    await loadProfiles(rows.map((r) => r.author_id));
    for (const r of rows) {
      const key = `${r.id}|${r.signature}`;
      let d = textCache.get(key);
      if (!d) {
        d = await keyring.decrypt(r);
        if (d.payload) textCache.set(key, d);
      }
      scanned++;
      if (pinned && !pinned.has(r.id)) continue;
      if (!matches(d, q, mentionIds)) continue;
      const hit = { m: d, target: byChannel.get(r.channel_id)!, snippet: snippetOf(d, q) };
      hits.push(hit);
      opts.onHit?.(hit);
      if (hits.length >= limit) break;
    }
    cursor = rows[rows.length - 1].created_at;
    opts.onProgress?.(scanned);
    if (rows.length < 200) {
      cursor = null;
      break;
    }
  }
  if (textCache.size > 20_000) textCache.clear();
  return { hits, cursor, scanned };
}

/** Every conversation you can read: DMs, groups and server channels. */
export async function allTargets(): Promise<SearchTarget[]> {
  const me = sessionStore.get().me;
  if (!me) return [];
  const out: SearchTarget[] = [];
  const { data: parts } = await supabase.from('dm_participants').select('channel_id, user_id');
  const byChannel = new Map<string, string[]>();
  for (const p of parts ?? []) byChannel.set(p.channel_id, [...(byChannel.get(p.channel_id) ?? []), p.user_id]);
  const dmIds = [...byChannel.keys()];
  const { data: dmChans } = dmIds.length ? await supabase.from('channels').select('id, name, is_group').in('id', dmIds) : { data: [] };
  await loadProfiles([...byChannel.values()].flat());
  const { displayName } = await import('./directory');
  for (const c of (dmChans ?? []) as { id: string; name: string; is_group: boolean }[]) {
    const others = (byChannel.get(c.id) ?? []).filter((u) => u !== me.id);
    out.push({ channelId: c.id, label: c.is_group ? c.name : displayName(others[0] ?? ''), serverId: null });
  }
  const { data: mem } = await supabase.from('server_members').select('server_id').eq('user_id', me.id);
  const sids = (mem ?? []).map((x) => x.server_id);
  if (sids.length) {
    const [{ data: servers }, { data: chans }] = await Promise.all([
      supabase.from('servers').select('id, name').in('id', sids),
      supabase.from('channels').select('id, name, server_id, type').in('server_id', sids),
    ]);
    const sname = new Map(((servers ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    for (const c of (chans ?? []) as { id: string; name: string; server_id: string; type: string }[])
      out.push({ channelId: c.id, label: `#${c.name}`, serverId: c.server_id, serverName: sname.get(c.server_id) });
  }
  return out;
}

/** Narrow targets with in:name (matches channel, conversation or server names). */
export function filterTargets(targets: SearchTarget[], q: SearchQuery): SearchTarget[] {
  if (!q.in.length) return targets;
  return targets.filter((t) =>
    q.in.some((n) => t.label.toLowerCase().replace(/^#/, '').includes(n) || (t.serverName ?? '').toLowerCase().includes(n)),
  );
}
