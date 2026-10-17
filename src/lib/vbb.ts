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

export async function vbbUpload(file: File, isPublic = false): Promise<VbbUploadResult> {
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const r = await fetch(`/api/vbb?action=upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: file.name, data: b64, contentType: file.type, public: isPublic }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'upload failed');
  return j as VbbUploadResult;
}

export async function vbbList(prefix = ''): Promise<VbbObject[]> {
  const r = await fetch(`/api/vbb?action=list&prefix=${encodeURIComponent(prefix)}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.objects as VbbObject[];
}

export async function vbbMeta(id: string): Promise<VbbObject> {
  const r = await fetch(`/api/vbb?action=meta&id=${encodeURIComponent(id)}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'meta failed');
  return j.object as VbbObject;
}

export async function vbbDelete(id: string): Promise<void> {
  const r = await fetch(`/api/vbb?action=delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'delete failed');
}

export async function vbbPublish(id: string, isPublic: boolean): Promise<void> {
  const r = await fetch(`/api/vbb?action=publish`, {
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

// Content-addressable helper: hash a file client-side (for dedup checks)
export async function vbbHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
