// Reporting. Messages are end-to-end encrypted, so Venband staff can only see
// what the reporter chooses to share: their app decrypts the messages and
// attaches the text to the report as evidence.
import { supabase } from './supabase';
import { createStore } from './store';
import { sessionStore } from './session';
import { displayName, loadProfiles } from './directory';
import type { DecryptedMessage } from './keyring';
import type { MessageRow } from './types';
import { downloadDecrypted } from './files';
import { containsSlur } from './automod';

export type EvidenceKind = 'text' | 'image' | 'video' | 'gif' | 'file' | 'slur';

export interface EvidenceItem {
  id: string;
  author_id: string;
  author: string;
  text: string;
  at: string;
  reported?: boolean;
  /** what the message contains (for filters) */
  kinds?: EvidenceKind[];
  /** report-evidence/<reporter>/<report>/<n>.webp copies of the pictures, readable only by moderators */
  images?: string[];
}

const GIF_URL = /https?:\/\/\S+?(\.gif\b|klipy\.com|tenor\.com|giphy\.com)/i;

function kindsOf(m: DecryptedMessage): EvidenceKind[] {
  const p = m.payload!;
  const out = new Set<EvidenceKind>();
  if (p.text.trim()) out.add('text');
  if (GIF_URL.test(p.text)) out.add('gif');
  if (containsSlur(p.text)) out.add('slur');
  for (const a of p.attachments ?? []) {
    if (a.mime === 'image/gif') out.add('gif');
    else if (a.mime.startsWith('image/')) out.add('image');
    else if (a.mime.startsWith('video/')) out.add('video');
    else out.add('file');
  }
  return [...out];
}

/** Re-encode a picture as a small webp (drops hidden metadata too). */
async function shrink(blob: Blob, max = 1280): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((res) => c.toBlob((b) => res(b), 'image/webp', 0.85));
  } catch {
    return null;
  }
}

/** Upload copies of the reported message's pictures (moderators can't decrypt the originals). */
async function attachPictures(m: DecryptedMessage, reportId: string): Promise<string[]> {
  const me = sessionStore.get().me!;
  const out: string[] = [];
  const pics = (m.payload?.attachments ?? []).filter((a) => a.mime.startsWith('image/') && a.size < 30 * 1024 * 1024).slice(0, 4);
  for (const [i, a] of pics.entries()) {
    try {
      const small = await shrink(await downloadDecrypted(a));
      if (!small) continue;
      const path = `${me.id}/${reportId}/${i}.webp`;
      const { error } = await supabase.storage.from('report-evidence').upload(path, small, { contentType: 'image/webp', upsert: false });
      if (!error) out.push(path);
    } catch {
      /* a picture that can't be read is skipped; the text still goes */
    }
  }
  return out;
}

/** Signed links for moderators to look at evidence pictures. */
export async function evidenceUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from('report-evidence').createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
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
    kinds: kindsOf(m),
    ...(reported ? { reported: true } : {}),
  };
}

/** Report one message, with a few messages around it for context. */
export async function reportMessage(m: DecryptedMessage, context: DecryptedMessage[], reason: string, serverId: string | null) {
  const me = sessionStore.get().me!;
  const i = context.findIndex((x) => x.row.id === m.row.id);
  const around = context.slice(Math.max(0, i - 5), i + 3);
  const evidence = around.map((x) => toEvidence(x, x.row.id === m.row.id)).filter(Boolean) as EvidenceItem[];
  const reportId = crypto.randomUUID();
  const images = await attachPictures(m, reportId);
  const target = evidence.find((e) => e.reported);
  if (target && images.length) target.images = images;
  const { error } = await supabase.from('reports').insert({
    id: reportId,
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
