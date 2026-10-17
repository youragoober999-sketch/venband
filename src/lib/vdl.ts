// Venband Data Layer (VDL) client — fast, on-site backend on Vercel.
// Auth is cookie-based (httpOnly); all requests are same-origin.
const BASE = '/api/vdl';

export interface VdlUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_color: string;
  badges: string[];
  platform_role: string;
  account_status: string;
  created_at: string;
}

export async function vdlSignup(email: string, password: string, username: string) {
  const r = await fetch(`${BASE}?r=auth&action=signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, username }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'signup failed');
  return j.user as VdlUser;
}

export async function vdlSignin(email: string, password: string) {
  const r = await fetch(`${BASE}?r=auth&action=signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'signin failed');
  return j.user as VdlUser;
}

export async function vdlSignout() {
  await fetch(`${BASE}?r=auth&action=signout`, { method: 'POST', credentials: 'include' });
}

export async function vdlMe(): Promise<VdlUser | null> {
  const r = await fetch(`${BASE}?r=auth`, { credentials: 'include' });
  if (!r.ok) return null;
  const j = await r.json();
  return j.user as VdlUser;
}

export async function vdlListUsers(q = ''): Promise<VdlUser[]> {
  const r = await fetch(q ? `${BASE}?r=users&q=${encodeURIComponent(q)}` : `${BASE}?r=users`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.users as VdlUser[];
}

export async function vdlListServers(): Promise<any[]> {
  const r = await fetch(`${BASE}?r=servers`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.servers;
}

export async function vdlBanUser(id: string, reason = ''): Promise<void> {
  const r = await fetch(`${BASE}?r=users`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'ban', id, reason }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'ban failed');
}

export async function vdlEraseUser(id: string): Promise<void> {
  const r = await fetch(`${BASE}?r=users`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'erase', id }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'erase failed');
}

export async function vdlListAudit(): Promise<any[]> {
  const r = await fetch(`${BASE}?r=audit`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.rows;
}

export async function vdlListLedger(): Promise<any[]> {
  const r = await fetch(`${BASE}?r=ledger`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.rows;
}

export async function vdlRebuildLedger(): Promise<void> {
  const r = await fetch(`${BASE}?r=ledger`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'rebuild' }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'rebuild failed');
}

export async function vdlQueueEmail(to: string, subject: string, body: string): Promise<void> {
  const r = await fetch(`${BASE}?r=emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'queue', to, subject, body }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'queue failed');
}

export async function vdlSendQueuedEmails(): Promise<{ sent: number; total: number }> {
  const r = await fetch(`${BASE}?r=emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'send' }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'send failed');
  return j;
}

export async function vdlListEmails(): Promise<any[]> {
  const r = await fetch(`${BASE}?r=emails`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.rows;
}

export async function vdlStats(): Promise<{ users: number; servers: number; objects: number; blocks: number }> {
  const r = await fetch(`${BASE}?r=stats`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'stats failed');
  return j;
}

export async function vdlToken(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}?r=auth`, { credentials: 'include' });
    if (!r.ok) return null;
    // VDL uses cookie auth; return null (cookie sent automatically)
    return null;
  } catch { return null; }
}

export async function vdlListMessages(channel: string, since?: string): Promise<any[]> {
  const qs = new URLSearchParams({ channel });
  if (since) qs.set('since', since);
  const r = await fetch(`${BASE}?r=messages&${qs}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.messages;
}

export async function vdlSendMessage(channelId: string, content: string): Promise<any> {
  const r = await fetch(`${BASE}?r=messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel_id: channelId, content }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'send failed');
  return j.message;
}


