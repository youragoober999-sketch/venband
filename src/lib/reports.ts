// Reporting. Messages are end-to-end encrypted, so Venband staff can only see
// what the reporter chooses to share: their app decrypts the messages and
// attaches the text to the report as evidence.
import { supabase } from './supabase';
import { createStore } from './store';
import { sessionStore } from './session';
import { displayName, loadProfiles } from './directory';
import type { DecryptedMessage } from './keyring';
import type { MessageRow } from './types';

export interface EvidenceItem {
  id: string;
  author_id: string;
  author: string;
  text: string;
  at: string;
  reported?: boolean;
}

export type ReportStatus = 'under_review' | 'actioned' | 'dismissed';

/** message id -> status of my report about it */
export const myReports = createStore<{ byMessage: Record<string, ReportStatus>; loaded: boolean }>({ byMessage: {}, loaded: false });

export async function loadMyReports() {
  const me = sessionStore.get().me;
  if (!me || myReports.get().loaded) return;
  const { data } = await supabase.from('reports').select('message_id, status').eq('reporter_id', me.id).not('message_id', 'is', null);
  const byMessage: Record<string, ReportStatus> = {};
  for (const r of (data ?? []) as { message_id: string; status: ReportStatus }[]) byMessage[r.message_id] = r.status;
  myReports.set({ byMessage, loaded: true });
}

function toEvidence(m: DecryptedMessage, reported = false): EvidenceItem | null {
  if (!m.payload) return null;
  const files = m.payload.attachments?.length ? ` [${m.payload.attachments.length} file(s): ${m.payload.attachments.map((a) => a.name).join(', ')}]` : '';
  return {
    id: m.row.id,
    author_id: m.row.author_id,
    author: displayName(m.row.author_id),
    text: (m.payload.text + files).slice(0, 4000),
    at: m.row.created_at,
    ...(reported ? { reported: true } : {}),
  };
}

/** Report one message, with a few messages around it for context. */
export async function reportMessage(m: DecryptedMessage, context: DecryptedMessage[], reason: string, serverId: string | null) {
  const me = sessionStore.get().me!;
  const i = context.findIndex((x) => x.row.id === m.row.id);
  const around = context.slice(Math.max(0, i - 5), i + 3);
  const evidence = around.map((x) => toEvidence(x, x.row.id === m.row.id)).filter(Boolean);
  const { error } = await supabase.from('reports').insert({
    reporter_id: me.id,
    kind: 'message',
    target_user: m.row.author_id,
    message_id: m.row.id,
    channel_id: m.row.channel_id,
    server_id: serverId,
    reason: reason.slice(0, 1000),
    evidence,
  });
  if (error) throw error;
  myReports.set((s) => ({ byMessage: { ...s.byMessage, [m.row.id]: 'under_review' } }));
}

/** Report a person. Optionally attach your recent DMs with them (decrypted on your device). */
export async function reportUser(userId: string, reason: string, includeDms: boolean) {
  const { me, keyring } = sessionStore.get();
  if (!me || !keyring) return;
  let evidence: EvidenceItem[] = [];
  let channelId: string | null = null;
  if (includeDms) {
    const { data: mine } = await supabase.from('dm_participants').select('channel_id').eq('user_id', me.id);
    const ids = (mine ?? []).map((r) => r.channel_id);
    if (ids.length) {
      const { data: theirs } = await supabase.from('dm_participants').select('channel_id').eq('user_id', userId).in('channel_id', ids);
      const shared = (theirs ?? []).map((r) => r.channel_id);
      const { data: dm } = shared.length
        ? await supabase.from('channels').select('id').in('id', shared).eq('is_group', false).limit(1).maybeSingle()
        : { data: null };
      channelId = dm?.id ?? null;
    }
    if (channelId) {
      const { data: rows } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(60);
      await keyring.loadChannel(channelId);
      await loadProfiles([me.id, userId]);
      const dec = await Promise.all(((rows ?? []) as MessageRow[]).reverse().map((r) => keyring.decrypt(r)));
      evidence = dec.map((d) => toEvidence(d)).filter(Boolean) as EvidenceItem[];
    }
  }
  const { error } = await supabase.from('reports').insert({
    reporter_id: me.id,
    kind: 'user',
    target_user: userId,
    channel_id: channelId,
    reason: reason.slice(0, 1000),
    evidence,
  });
  if (error) throw error;
  return evidence.length;
}
