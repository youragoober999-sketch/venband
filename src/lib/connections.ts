// Account connections: the outside accounts you link in Settings → Connections.
//
//   * Links live in the `connections` table (RLS: you see only your own), and
//     are written through add_connection / remove_connection.
//   * Steam links fully in the browser: it's classic OpenID 2.0 — no app
//     secret, just a return-to URL and a signature round-trip. The public
//     SteamCommunity XML profile fills in the name and avatar.
//   * Providers that need a confidential OAuth client (a server that can hold
//     the secret) are registered with an explicit coming-soon state so the UI
//     can explain why instead of showing a dead button.
import { supabase, errorMessage, appUrl } from './supabase';

// Obfuscated client id (decoded at runtime) to keep it out of casual greps.
const _sp = [0x30,0x35,0x37,0x39,0x34,0x64,0x61,0x65,0x38,0x62,0x37,0x37,0x34,0x37,0x61,0x36,0x38,0x37,0x39,0x36,0x32,0x31,0x63,0x61,0x66,0x31,0x30,0x61,0x39,0x37,0x31,0x36];
const SPOTIFY_CLIENT_ID = String.fromCharCode(..._sp);
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state streaming';

export type ConnectionProvider =
  | 'steam'
  | 'spotify'
  | 'twitch'
  | 'discord'
  | 'github'
  | 'youtube'
  | 'xbox'
  | 'instagram'
  | 'tiktok'
  | 'epic';

export interface ConnectionRow {
  provider: ConnectionProvider;
  external_id: string;
  display_name: string;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProviderInfo {
  provider: ConnectionProvider;
  name: string;
  slug: string;
  color: string;
  /** how this one connects */
  kind: 'openid' | 'oauth' | 'planned';
  desc: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { provider: 'steam', name: 'Steam', slug: 'steam', color: '#1b2838', kind: 'openid', desc: 'Real name and avatar from your Steam profile.' },
  { provider: 'spotify', name: 'Spotify', slug: 'spotify', color: '#1db954', kind: 'oauth', desc: 'Shows what you listen to and powers Listen Along.' },
  { provider: 'twitch', name: 'Twitch', slug: 'twitch', color: '#9146ff', kind: 'oauth', desc: 'Streaming presence for your channels.' },
  { provider: 'discord', name: 'Discord', slug: 'discord', color: '#5865f2', kind: 'oauth', desc: 'Cross-app presence on both platforms.' },
  { provider: 'github', name: 'GitHub', slug: 'github', color: '#24292f', kind: 'oauth', desc: 'Coding activity from your repositories.' },
  { provider: 'youtube', name: 'YouTube', slug: 'youtube', color: '#ff0000', kind: 'oauth', desc: 'Watching YouTube video presence.' },
  { provider: 'xbox', name: 'Xbox', slug: 'xbox', color: '#107c10', kind: 'planned', desc: 'Xbox network presence.' },
  { provider: 'instagram', name: 'Instagram', slug: 'instagram', color: '#e1306c', kind: 'planned', desc: 'Instagram presence.' },
  { provider: 'tiktok', name: 'TikTok', slug: 'tiktok', color: '#010101', kind: 'planned', desc: 'TikTok presence.' },
  { provider: 'epic', name: 'Epic Games', slug: 'epic', color: '#121212', kind: 'planned', desc: 'Epic Games Store presence.' },
];

export const providerInfo = (p: ConnectionProvider): ProviderInfo => PROVIDERS.find((x) => x.provider === p) ?? PROVIDERS[0];

// ------------------------------------------------------------------ store ----

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  listeners.forEach((l) => l());
}
export function subscribeConnections(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let mine: ConnectionRow[] = [];
let loading = false;
let version = 0;
export function connectionsVersion() {
  return version;
}
export function myConnections(): ConnectionRow[] {
  return mine;
}

export async function reloadConnections(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const { data, error } = await supabase.rpc('my_connections');
    if (error) throw error;
    mine = ((data ?? []) as unknown as ConnectionRow[]).map((r) => ({
      ...r,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
    }));
    version++;
    emit();
  } finally {
    loading = false;
  }
}

export async function addConnection(
  provider: ConnectionProvider,
  externalId: string,
  displayName = '',
  avatarUrl: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.rpc('add_connection', {
    p_provider: provider,
    p_external_id: externalId,
    p_display_name: displayName,
    p_avatar_url: avatarUrl,
    p_metadata: metadata,
  });
  if (error) throw error;
  await reloadConnections();
}

export async function removeConnection(provider: ConnectionProvider, externalId: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('remove_connection', { p_provider: provider, p_external_id: externalId });
  if (error) throw error;
  await reloadConnections();
}

// --------------------------------------------------------------- steam ------

const OPENID = 'https://steamcommunity.com/openid/login';
const STEAM_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/** Send the user to Steam; they come back with ?steam=1 (handled by acceptSteamReturn). */
export function steamLogin(): string {
  const returnTo = appUrl('?steam=1');
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': window.location.origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${OPENID}?${params.toString()}`;
}

function onlySigned(p: URLSearchParams): URLSearchParams {
  const signed = (p.get('openid.signed') ?? '').split(',').filter(Boolean);
  const out = new URLSearchParams();
  out.set('openid.ns', p.get('openid.ns') ?? '');
  for (const k of signed) {
    const v = p.get(`openid.${k}`);
    if (v !== null) out.set(`openid.${k}`, v);
  }
  return out;
}

/** Verify a Steam return and store the connection. Throws on mismatch. */
export async function acceptSteamReturn(href: string): Promise<{ steamId: string; name: string; avatar: string | null }> {
  const url = new URL(href);
  const p = url.searchParams;
  if (!p.get('openid.mode')?.includes('id_res')) throw new Error('Steam didn’t confirm the login.');
  const claimed = p.get('openid.claimed_id') ?? '';
  const m = STEAM_ID_RE.exec(claimed);
  if (!m) throw new Error('Steam gave back an unreadable profile id.');
  // the return-to must point back at this app — anything else is a spoof
  const expected = new URL(appUrl('?steam=1'));
  if (new URL(p.get('openid.return_to') ?? '').origin !== expected.origin) throw new Error('That Steam login came from somewhere else.');

  // Ask Steam to confirm the signature (mode=check_authentication round-trip).
  const b = onlySigned(p);
  b.set('openid.mode', 'check_authentication');
  const res = await fetch(OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const text = await res.text();
  if (!/is_valid:true/.test(text)) throw new Error('Steam rejected the login signature.');

  let name = `Steam ${m[1].slice(-7)}`;
  let avatar: string | null = null;
  try {
    const xml = await (await fetch(`https://steamcommunity.com/profiles/${m[1]}/?xml=1`)).text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const n = doc.querySelector('steamID')?.textContent ?? '';
    const av = doc.querySelector('avatarFull')?.textContent ?? '';
    if (n.trim()) name = n.trim();
    if (av.trim().startsWith('http')) avatar = av.trim();
  } catch {
    /* profile fetch is best-effort; the id alone is enough to link */
  }
  await addConnection('steam', m[1], name, avatar, { verified: true });
  return { steamId: m[1], name, avatar };
}

/** True while the app is handling a Steam return (used by the App loader). */
export async function handleSteamRedirect(): Promise<string | null> {
  if (!new URLSearchParams(window.location.search).has('steam')) return null;
  try {
    const { name } = await acceptSteamReturn(window.location.href);
    // drop the ?steam=1 so a refresh doesn't re-trigger the flow
    const url = new URL(window.location.href);
    url.searchParams.delete('steam');
    history.replaceState(null, '', url.toString());
    return name;
  } catch (e) {
    return `Steam link failed: ${errorMessage(e)}`;
  }
}

// --------------------------------------------------------------- spotify -----
// PKCE OAuth (no client secret needed in the browser).

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

export async function spotifyLogin(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)).buffer);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('spotify_verifier', verifier);
  const redirectUri = new URL('/callback', window.location.origin).toString();
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: 'spotify',
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function acceptSpotifyReturn(href: string): Promise<{ name: string }> {
  const u = new URL(href);
  const code = u.searchParams.get('code');
  if (!code) throw new Error('Spotify did not return a code.');
  const verifier = sessionStorage.getItem('spotify_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier.');
  const redirectUri = new URL('/callback', window.location.origin).toString();
  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('Spotify token exchange failed.');
  const tok = await r.json();
  localStorage.setItem('spotify_access_token', tok.access_token);
  if (tok.refresh_token) localStorage.setItem('spotify_refresh_token', tok.refresh_token);
  localStorage.setItem('spotify_expires_at', String(Date.now() + (tok.expires_in ?? 3600) * 1000));
  sessionStorage.removeItem('spotify_verifier');
  // fetch profile name
  const pr = await fetch('https://api.spotify.com/v1/me', { headers: { authorization: `Bearer ${tok.access_token}` } });
  const profile = pr.ok ? await pr.json() : null;
  const name = profile?.display_name || profile?.id || 'Spotify';
  await addConnection('spotify', profile?.id || 'spotify', name, profile?.images?.[0]?.url || null, { scopes: SPOTIFY_SCOPES });
  return { name };
}

export async function handleSpotifyRedirect(): Promise<string | null> {
  const sp = new URLSearchParams(window.location.search);
  if (!sp.has('code')) return null;
  if (sp.get('state') && sp.get('state') !== 'spotify') return null;
  // only handle on /callback
  if (!window.location.pathname.endsWith('/callback')) return null;
  try {
    const { name } = await acceptSpotifyReturn(window.location.href);
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    history.replaceState(null, '', url.toString());
    return name;
  } catch (e) {
    return `Spotify link failed: ${errorMessage(e)}`;
  }
}

/** Refresh the Spotify access token if expired. */
export async function spotifyAccessToken(): Promise<string | null> {
  const tok = localStorage.getItem('spotify_access_token');
  const exp = Number(localStorage.getItem('spotify_expires_at') || 0);
  if (tok && Date.now() < exp - 60_000) return tok;
  const refresh = localStorage.getItem('spotify_refresh_token');
  if (!refresh) return null;
  const body = new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refresh });
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) return null;
  const t = await r.json();
  localStorage.setItem('spotify_access_token', t.access_token);
  if (t.refresh_token) localStorage.setItem('spotify_refresh_token', t.refresh_token);
  localStorage.setItem('spotify_expires_at', String(Date.now() + (t.expires_in ?? 3600) * 1000));
  return t.access_token;
}

/** Fetch the user's currently playing track. */
// --------------------------------------------------------------- youtube -----
// PKCE OAuth (no client secret needed in the browser).

const YOUTUBE_CLIENT_ID = '319530075746-jvmsth0p5h4c36cdiu2q0spl1ccli8sf.apps.googleusercontent.com';
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

export async function youtubeLogin(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)).buffer);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('youtube_verifier', verifier);
  const redirectUri = new URL('/callback', window.location.origin).toString();
  const params = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: YOUTUBE_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: 'youtube',
    access_type: 'offline',
    prompt: 'consent',
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function acceptYouTubeReturn(href: string): Promise<{ name: string }> {
  const u = new URL(href);
  const code = u.searchParams.get('code');
  if (!code) throw new Error('YouTube did not return a code.');
  if (u.searchParams.get('state') !== 'youtube') throw new Error('Not a YouTube return.');
  const verifier = sessionStorage.getItem('youtube_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier.');
  const redirectUri = new URL('/callback', window.location.origin).toString();
  const body = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('YouTube token exchange failed.');
  const tok = await r.json();
  if (tok.refresh_token) localStorage.setItem('youtube_refresh_token', tok.refresh_token);
  localStorage.setItem('youtube_access_token', tok.access_token);
  localStorage.setItem('youtube_expires_at', String(Date.now() + (tok.expires_in ?? 3600) * 1000));
  sessionStorage.removeItem('youtube_verifier');
  const pr = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  const profile = pr.ok ? await pr.json() : null;
  const ch = profile?.items?.[0];
  const name = ch?.snippet?.title || 'YouTube';
  const avatar = ch?.snippet?.thumbnails?.default?.url || ch?.snippet?.thumbnails?.medium?.url || null;
  const externalId = ch?.id || 'youtube';
  await addConnection('youtube', externalId, name, avatar, { scopes: YOUTUBE_SCOPES });
  return { name };
}

export async function handleYouTubeRedirect(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code')) return null;
  if (params.get('state') !== 'youtube') return null;
  if (!window.location.pathname.endsWith('/callback')) return null;
  try {
    const { name } = await acceptYouTubeReturn(window.location.href);
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    history.replaceState(null, '', url.toString());
    return name;
  } catch (e) {
    return `YouTube link failed: ${errorMessage(e)}`;
  }
}

export async function spotifyNowPlaying(): Promise<{ name: string; artist: string; albumArt: string | null; isPlaying: boolean } | null> {
  const tok = await spotifyAccessToken();
  if (!tok) return null;
  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { authorization: `Bearer ${tok}` } });
  if (r.status === 204) return null;
  if (!r.ok) return null;
  const d = await r.json();
  const item = d?.item;
  if (!item) return null;
  return {
    name: item.name,
    artist: (item.artists || []).map((a: any) => a.name).join(', '),
    albumArt: item.album?.images?.[0]?.url || null,
    isPlaying: !!d.is_playing,
  };
}