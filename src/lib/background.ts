// A picture from your files as the app's background. The picture stays on
// this device (in the browser's storage); only the on/off, dim and blur
// settings sync.
import { getSettings, settingsStore } from './settings';
import { themeStore } from './themes';
import { safeMode } from './customCss';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('venband-background', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function getBlob(): Promise<Blob | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const g = d.transaction('kv', 'readonly').objectStore('kv').get('bg');
      g.onsuccess = () => res((g.result as Blob | undefined) ?? null);
      g.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

async function putBlob(b: Blob | null) {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    if (b) tx.objectStore('kv').put(b, 'bg');
    else tx.objectStore('kv').delete('bg');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

let url: string | null = null;
let cached: Blob | null | undefined;

export async function hasBackground() {
  if (cached === undefined) cached = await getBlob();
  return Boolean(cached);
}

export async function applyBackground() {
  const s = getSettings().background;
  const root = document.documentElement;
  if (cached === undefined) cached = await getBlob();
  if (!s.enabled || !cached || safeMode()) {
    root.classList.remove('user-bg');
    return;
  }
  if (!url) url = URL.createObjectURL(cached);
  const dim = Math.min(0.9, Math.max(0, s.dim / 100));
  root.style.setProperty('--wallpaper', `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${url}") center / cover no-repeat`);
  root.style.setProperty('--user-bg-blur', `${Math.min(40, Math.max(0, s.blur))}px`);
  root.dataset.glass = 'true';
  root.classList.add('user-bg');
}

/** Shrink, store and use a picture as the background. */
export async function setBackgroundFile(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.88));
  if (!blob) throw new Error('Could not read that picture.');
  await putBlob(blob);
  cached = blob;
  if (url) URL.revokeObjectURL(url);
  url = null;
}

export async function clearBackground() {
  await putBlob(null);
  cached = null;
  if (url) URL.revokeObjectURL(url);
  url = null;
  document.documentElement.classList.remove('user-bg');
}

let started = false;
/** Keep the background on top of whatever theme is active. */
export function startBackground() {
  if (started) return;
  started = true;
  applyBackground();
  themeStore.subscribe(() => applyBackground());
  settingsStore.subscribe(() => applyBackground());
}
