// Memories: story-style photos and short videos pinned to a profile.
// Limits (also enforced by the database): 10 per account, videos up to 30 s.
import { supabase } from './supabase';
import { sessionStore } from './session';

export const MAX_MEMORIES = 10;
export const MAX_VIDEO_MS = 30_000;
export const IMAGE_MS = 6_000;
const MAX_BYTES = 25 * 1024 * 1024;
const BUCKET = 'memories';

export interface Memory {
  id: string;
  user_id: string;
  path: string;
  media_type: 'image' | 'video';
  duration_ms: number;
  caption: string;
  width: number | null;
  height: number | null;
  created_at: string;
  url?: string;
}

const cache = new Map<string, { at: number; list: Memory[] }>();
const listeners = new Set<() => void>();
export function onMemoriesChanged(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const changed = () => listeners.forEach((f) => f());

function me(): string {
  const id = sessionStore.get().session?.user.id;
  if (!id) throw new Error('Sign in first.');
  return id;
}

/** A user's memories, oldest first, with signed media URLs (valid 1 hour). */
export async function listMemories(userId: string, force = false): Promise<Memory[]> {
  const hit = cache.get(userId);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  const { data, error } = await supabase.from('memories').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(MAX_MEMORIES);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return []; // migration not run yet
    throw error;
  }
  const list = (data ?? []) as Memory[];
  if (list.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((m) => m.path), 3600);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const m of list) m.url = byPath.get(m.path) ?? undefined;
  }
  cache.set(userId, { at: Date.now(), list });
  return list;
}

/** Ids the current device has already watched, for the "unseen" ring. */
const SEEN_KEY = 'venband:memories:seen';
function seenSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
export function hasUnseen(list: Memory[]) {
  const seen = seenSet();
  return list.some((m) => !seen.has(m.id));
}
export async function markSeen(m: Memory) {
  const seen = seenSet();
  if (!seen.has(m.id)) {
    seen.add(m.id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500))); } catch { /* storage blocked */ }
  }
  const uid = sessionStore.get().session?.user.id;
  if (uid && uid !== m.user_id) await supabase.from('memory_views').upsert({ memory_id: m.id, viewer_id: uid }, { onConflict: 'memory_id,viewer_id', ignoreDuplicates: true });
}

export async function memoryViewers(memoryId: string): Promise<{ viewer_id: string; seen_at: string }[]> {
  const { data } = await supabase.from('memory_views').select('viewer_id, seen_at').eq('memory_id', memoryId).order('seen_at', { ascending: false }).limit(200);
  return (data ?? []) as { viewer_id: string; seen_at: string }[];
}

function videoInfo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ duration: v.duration * 1000, width: v.videoWidth, height: v.videoHeight }); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That video can’t be played in this browser. Try an MP4.')); };
    v.src = url;
  });
}

/** Re-encode images: max 1440 px, WebP, and the canvas drops EXIF/GPS metadata. */
async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'image/gif') return { blob: file, width: 0, height: 0 }; // keep animation
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1440 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process that image.'))), 'image/webp', 0.86));
  return { blob, width: w, height: h };
}

export async function addMemory(file: File, caption = '', onStage?: (s: string) => void): Promise<Memory> {
  const uid = me();
  const existing = await listMemories(uid, true);
  if (existing.length >= MAX_MEMORIES) throw new Error(`You can have up to ${MAX_MEMORIES} memories at a time. Delete one to add another.`);
  const isVideo = file.type.startsWith('video/');
  if (!isVideo && !file.type.startsWith('image/')) throw new Error('Memories can be photos or videos.');
  if (file.size > MAX_BYTES) throw new Error('That file is over 25 MB.');

  let blob: Blob = file, width = 0, height = 0, duration = IMAGE_MS, ext = 'webp';
  onStage?.('Preparing…');
  if (isVideo) {
    const info = await videoInfo(file);
    if (info.duration > MAX_VIDEO_MS + 250) throw new Error(`Videos can be up to 30 seconds (that one is ${Math.round(info.duration / 1000)} s).`);
    width = info.width; height = info.height; duration = Math.max(1000, Math.round(info.duration));
    ext = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
  } else {
    ({ blob, width, height } = await prepareImage(file));
    if (file.type === 'image/gif') ext = 'gif';
  }
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  onStage?.('Uploading…');
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: isVideo ? file.type : ext === 'gif' ? 'image/gif' : 'image/webp' });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('memories').insert({
    user_id: uid, path, media_type: isVideo ? 'video' : 'image', duration_ms: duration,
    caption: caption.trim().slice(0, 200), width: width || null, height: height || null,
  }).select('*').single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  cache.delete(uid);
  changed();
  return data as Memory;
}

export async function deleteMemory(m: Memory) {
  const { error } = await supabase.from('memories').delete().eq('id', m.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([m.path]);
  cache.delete(m.user_id);
  changed();
}
