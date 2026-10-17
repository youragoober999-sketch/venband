// Venband Blob (VBB) client SDK — custom, on-site object storage.
export interface VbbObject {
  id: string;
  name: string;
  content_type: string;
  size: number;
  sha256: string;
  storage: string;
  public: boolean;
  created_at: string;
}

export interface VbbUploadResult {
  id: string;
  name: string;
  size: number;
  sha256: string;
  storage: string;
  public: boolean;
  url: string;
  dedup?: boolean;
}

async function authToken(): Promise<string | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

async function vbbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await authToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers, credentials: 'include' });
}

export async function vbbUpload(file: File, isPublic = false, onProgress?: (loaded: number, total: number) => void): Promise<VbbUploadResult> {
  // small files: single-shot
  if (file.size <= 3 * 1024 * 1024) {
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const r = await vbbFetch(`/api/vbb?action=upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: file.name, data: b64, contentType: file.type, public: isPublic }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'upload failed');
    return j as VbbUploadResult;
  }
  // large files: chunked
  return vbbUploadChunked(file, isPublic, onProgress);
}

export async function vbbUploadChunked(
  file: File,
  isPublic = false,
  onProgress?: (loaded: number, total: number) => void,
): Promise<VbbUploadResult> {
  // 1. init
  const initRes = await vbbFetch(`/api/vbb?action=init-chunked`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, public: isPublic }),
  });
  const init = await initRes.json();
  if (!initRes.ok) throw new Error(init.error || 'init failed');
  const { uploadId, chunkSize, totalChunks } = init;

  // 2. upload chunks in parallel (concurrency 4)
  const CONC = 4;
  let loaded = 0;
  const runChunk = async (i: number) => {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    const buf = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const r = await vbbFetch(`/api/vbb?action=upload-chunk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ uploadId, chunkIndex: i, data: b64 }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `chunk ${i} failed`);
    loaded += (end - start);
    onProgress?.(loaded, file.size);
  };
  // queue
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONC; w++) {
    workers.push((async () => {
      while (next < totalChunks) {
        const i = next++;
        await runChunk(i);
      }
    })());
  }
  await Promise.all(workers);

  // 3. complete
  const compRes = await vbbFetch(`/api/vbb?action=complete-chunked`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ uploadId }),
  });
  const comp = await compRes.json();
  if (!compRes.ok) throw new Error(comp.error || 'complete failed');
  return comp as VbbUploadResult;
}

export async function vbbList(prefix = ''): Promise<VbbObject[]> {
  const r = await vbbFetch(`/api/vbb?action=list&prefix=${encodeURIComponent(prefix)}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.objects as VbbObject[];
}

export async function vbbMeta(id: string): Promise<VbbObject> {
  const r = await vbbFetch(`/api/vbb?action=meta&id=${encodeURIComponent(id)}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'meta failed');
  return j.object as VbbObject;
}

export async function vbbDelete(id: string): Promise<void> {
  const r = await vbbFetch(`/api/vbb?action=delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'delete failed');
}

export async function vbbPublish(id: string, isPublic: boolean): Promise<void> {
  const r = await vbbFetch(`/api/vbb?action=publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id, public: isPublic }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'publish failed');
}

export function vbbDownloadUrl(id: string): string {
  return `/api/vbb?action=download&id=${encodeURIComponent(id)}`;
}

export interface VbbShard {
  id: number;
  subdomain: string;
  base_url: string;
  capacity_bytes: number;
  used_bytes: number;
  active: boolean;
}

export async function vbbListShards(): Promise<VbbShard[]> {
  const r = await vbbFetch('/api/vbb-shards', { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.shards as VbbShard[];
}

export async function vbbRegisterShard(subdomain: string, baseUrl: string, capacityBytes = 0): Promise<void> {
  const r = await vbbFetch('/api/vbb-shards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'register', subdomain, base_url: baseUrl, capacity_bytes: capacityBytes }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'register failed');
}

// Content-addressable helper: hash a file client-side (for dedup checks)
export async function vbbHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}


