// End-to-end encrypted file transfer, for files up to 5 GB.
//
// A file is encrypted on this device in 8 MiB pieces with its own random
// AES-256-GCM key (the key travels inside the encrypted message). Every piece
// has its own IV (base IV + piece number) and is bound to its position and
// the piece count, so pieces can't be swapped, reordered, dropped or added.
// Each piece is uploaded as its own object, so the server's per-file size
// limit never applies to the whole file.
import { supabase } from './supabase';
import { fromB64, randomBytes, toB64, decryptBlob, type Attachment } from './crypto';

export const MAX_FILE = 5 * 1024 * 1024 * 1024; // 5 GB
export const CHUNK = 8 * 1024 * 1024;
const PARALLEL = 3;
const BUCKET = 'attachments';
const te = new TextEncoder();

function chunkIv(base: Uint8Array<ArrayBuffer>, i: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(base);
  const v = new DataView(iv.buffer);
  v.setUint32(8, v.getUint32(8) ^ i);
  return iv;
}
const chunkAad = (i: number, total: number) => te.encode(`venband/file-chunk|${i}|${total}`);
const chunkPath = (a: Pick<Attachment, 'path'>, i: number) => `${a.path}/${i}.bin`;

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export async function uploadEncrypted(channelId: string, file: File, onProgress?: (fraction: number) => void): Promise<Attachment> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is larger than 5 GB.`);
  const raw = randomBytes(32);
  const baseIv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  const att: Attachment = {
    path: `${channelId}/${crypto.randomUUID()}`,
    name: file.name,
    mime: file.type || guessMime(file.name),
    size: file.size,
    key: toB64(raw),
    iv: toB64(baseIv),
    chunks: total,
    chunkSize: CHUNK,
  };
  let done = 0;
  await pool([...Array(total).keys()], PARALLEL, async (i) => {
    const plain = await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(baseIv, i), additionalData: chunkAad(i, total) }, key, plain);
    for (let attempt = 0; ; attempt++) {
      const { error } = await supabase.storage.from(BUCKET).upload(chunkPath(att, i), new Blob([ct]), { contentType: 'application/octet-stream', upsert: true });
      if (!error) break;
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
    onProgress?.(++done / total);
  });
  return att;
}

async function downloadChunk(a: Attachment, i: number): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.storage.from(BUCKET).download(chunkPath(a, i));
    if (!error && data) return data.arrayBuffer();
    if (attempt >= 3) throw error ?? new Error('download failed');
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
}

/** Decrypt a file into memory (a Blob). For very large files prefer saveDecrypted. */
export async function downloadDecrypted(a: Attachment, onProgress?: (fraction: number) => void): Promise<Blob> {
  const type = a.mime || 'application/octet-stream';
  if (!a.chunks) {
    // files sent before chunking: one object
    const { data, error } = await supabase.storage.from(BUCKET).download(a.path);
    if (error || !data) throw error ?? new Error('download failed');
    onProgress?.(1);
    return new Blob([await decryptBlob(await data.arrayBuffer(), a.key, a.iv)], { type });
  }
  const key = await crypto.subtle.importKey('raw', fromB64(a.key), 'AES-GCM', false, ['decrypt']);
  const base = fromB64(a.iv);
  const parts: ArrayBuffer[] = new Array(a.chunks);
  let done = 0;
  await pool([...Array(a.chunks).keys()], PARALLEL, async (i) => {
    const ct = await downloadChunk(a, i);
    parts[i] = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(base, i), additionalData: chunkAad(i, a.chunks!) }, key, ct);
    onProgress?.(++done / a.chunks!);
  });
  return new Blob(parts, { type });
}

/** Save to disk. Big files stream straight to a file (where the browser allows it). */
export async function saveDecrypted(a: Attachment, onProgress?: (fraction: number) => void) {
  const picker = (window as unknown as { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (a.chunks && a.size > 512 * 1024 * 1024 && picker) {
    const handle = await picker({ suggestedName: safeFileName(a.name) });
    const out = await handle.createWritable();
    const key = await crypto.subtle.importKey('raw', fromB64(a.key), 'AES-GCM', false, ['decrypt']);
    const base = fromB64(a.iv);
    try {
      for (let i = 0; i < a.chunks; i++) {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(base, i), additionalData: chunkAad(i, a.chunks) }, key, await downloadChunk(a, i));
        await out.write(plain);
        onProgress?.((i + 1) / a.chunks);
      }
    } finally {
      await out.close();
    }
    return;
  }
  const blob = await downloadDecrypted(a, onProgress);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  // keep the name it was sent with (some browsers ignore download= unless the
  // link is in the document, and then name the file after the blob's id)
  link.download = safeFileName(a.name);
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function removeAttachment(a: Attachment) {
  const paths = a.chunks ? [...Array(a.chunks).keys()].map((i) => chunkPath(a, i)) : [a.path];
  for (let i = 0; i < paths.length; i += 100) await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
}

/** Forwarding: copy the (still encrypted) pieces into another conversation. */
export async function copyAttachment(a: Attachment, toChannel: string): Promise<Attachment> {
  const next: Attachment = { ...a, path: `${toChannel}/${crypto.randomUUID()}` };
  if (!a.chunks) next.path = `${toChannel}/${crypto.randomUUID()}.bin`;
  const pairs = a.chunks ? [...Array(a.chunks).keys()].map((i) => [chunkPath(a, i), chunkPath(next, i)]) : [[a.path, next.path]];
  await pool(pairs, PARALLEL, async ([from, to]) => {
    const { error } = await supabase.storage.from(BUCKET).copy(from, to);
    if (error) throw error;
  });
  return next;
}

// ------------------------------------------------------------ file types --

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : name.toLowerCase().replace(/^\./, ''));

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  tiff: 'image/tiff', tif: 'image/tiff', ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg',
  mpg: 'video/mpeg', ogv: 'video/ogg', flv: 'video/x-flv', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
  mid: 'audio/midi', midi: 'audio/midi', pdf: 'application/pdf',
};
export function guessMime(name: string): string {
  return MIME[ext(name)] ?? 'application/octet-stream';
}

// what browsers can actually show / play
const IMAGE_OK = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
const VIDEO_OK = new Set(['mp4', 'webm', 'mov', 'ogv', 'mkv', 'm4v']);
const AUDIO_OK = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus', 'oga', 'weba']);

/** Code / text files and the highlighter language to start with. */
export const CODE_LANGS: Record<string, string> = {
  txt: 'plaintext', log: 'plaintext', csv: 'plaintext', md: 'markdown', markdown: 'markdown', rtf: 'plaintext',
  py: 'python', pyw: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  java: 'java', kt: 'kotlin', kts: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', rs: 'rust', go: 'go',
  rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  bat: 'dos', cmd: 'dos', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'json', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'bash',
  gitignore: 'bash', gitattributes: 'bash', gitmodules: 'ini', git: 'plaintext', dockerfile: 'dockerfile', makefile: 'makefile',
  vue: 'xml', dart: 'dart', r: 'r', pl: 'perl', scala: 'scala', hs: 'haskell', ex: 'elixir', erl: 'erlang', clj: 'clojure',
  meta: 'yaml', unity: 'yaml', prefab: 'yaml', asset: 'yaml', mat: 'yaml', anim: 'yaml', controller: 'yaml', scene: 'yaml',
  obj: 'plaintext', gltf: 'json', dae: 'xml', glsl: 'glsl', hlsl: 'cpp', shader: 'cpp', gd: 'python', cmake: 'cmake',
};

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'code' | 'other';

export function fileKind(a: Pick<Attachment, 'name' | 'mime'>): FileKind {
  const e = ext(a.name);
  if (IMAGE_OK.has(e)) return 'image';
  if (VIDEO_OK.has(e) || /^video\/(mp4|webm|ogg|quicktime)$/.test(a.mime)) return 'video';
  if (AUDIO_OK.has(e) || /^audio\/(mpeg|ogg|wav|flac|mp4|aac|opus|webm|x-wav)$/.test(a.mime)) return 'audio';
  if (e === 'pdf' || a.mime === 'application/pdf') return 'pdf';
  if (e in CODE_LANGS || a.mime.startsWith('text/') || a.mime === 'application/json') return 'code';
  return 'other';
}

export function fileIcon(name: string): string {
  const e = ext(name);
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(e)) return '🗜️';
  if (['exe', 'msi', 'app', 'apk', 'dll', 'bin', 'dmg', 'iso', 'img'].includes(e)) return '⚙️';
  if (['doc', 'docx', 'odt', 'rtf', 'pdf'].includes(e)) return '📄';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(e)) return '📊';
  if (['ppt', 'pptx', 'odp'].includes(e)) return '📽️';
  if (['blend', 'fbx', 'obj', 'glb', 'gltf', 'dae', '3ds', 'stl'].includes(e)) return '🧊';
  if (['unitypackage', 'unity', 'prefab', 'asset', 'meta', 'scene', 'mat', 'anim', 'controller'].includes(e)) return '🎮';
  if (['mid', 'midi'].includes(e)) return '🎹';
  if (['heic', 'heif', 'tiff', 'tif'].includes(e)) return '🖼️';
  if (['mpeg', 'mpg', 'avi', 'flv', '3gp'].includes(e)) return '🎞️';
  if (e === 'torrent') return '🧲';
  return '📎';
}

export function extOf(name: string) {
  return ext(name);
}

/** The original file name, minus characters no file system accepts. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned || 'download';
}
