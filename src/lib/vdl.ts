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
  const r = await fetch(`${BASE}/auth?action=signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, username }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'signup failed');
  return j.user as VdlUser;
}

export async function vdlSignin(email: string, password: string) {
  const r = await fetch(`${BASE}/auth?action=signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'signin failed');
  return j.user as VdlUser;
}

export async function vdlSignout() {
  await fetch(`${BASE}/auth?action=signout`, { method: 'POST', credentials: 'include' });
}

export async function vdlMe(): Promise<VdlUser | null> {
  const r = await fetch(`${BASE}/auth`, { credentials: 'include' });
  if (!r.ok) return null;
  const j = await r.json();
  return j.user as VdlUser;
}

export async function vdlListUsers(q = ''): Promise<VdlUser[]> {
  const r = await fetch(`${BASE}/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.users as VdlUser[];
}

export async function vdlListServers(): Promise<any[]> {
  const r = await fetch(`${BASE}/servers`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.servers;
}

export async function vdlListMessages(channel: string, since?: string): Promise<any[]> {
  const qs = new URLSearchParams({ channel });
  if (since) qs.set('since', since);
  const r = await fetch(`${BASE}/messages?${qs}`, { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list failed');
  return j.messages;
}

export async function vdlSendMessage(channelId: string, content: string): Promise<any> {
  const r = await fetch(`${BASE}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel_id: channelId, content }), credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'send failed');
  return j.message;
}
