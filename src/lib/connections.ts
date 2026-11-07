// Account connections: the outside accounts you link in Settings → Connections.
//
//   * Links live in the `connections` table (RLS: only you can see your own),
//     written through add_connection / remove_connection.
//   * "Connect" sends you to the provider's own sign-in page. The provider sends
//     you back to one of Venband's registered return addresses (REDIRECTS below —
//     these must match the provider's developer console EXACTLY), and
//     handleOAuthReturn() finishes the link.
//   * Anything that needs a client secret, or a token endpoint without CORS, is
//     finished by /api/oauth on the server. Secrets live only in Vercel's
//     environment variables — never in this file, the bundle or the repository.
//     Client ids below are public by design (they're in every sign-in URL).
import { supabase, errorMessage } from './supabase';

export type ConnectionProvider = 'steam' | 'spotify' | 'twitch' | 'discord' | 'github' | 'youtube' | 'xbox' | 'instagram' | 'tiktok';

export interface ConnectionRow {
  provider: ConnectionProvider;
  external_id: string;
  display_name: string;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  /** shown in the Connections section of your profile */
  show_on_profile?: boolean;
}

/** A connection as other people see it on a profile. */
export interface ProfileConnection {
  provider: ConnectionProvider;
  external_id: string;
  display_name: string;
  handle: string | null;
  created_at: string;
}

/** The account's public page on that service, when there is one. */
export function profileUrl(c: { provider: ConnectionProvider; external_id: string; display_name: string; handle?: string | null }): string | null {
  const h = encodeURIComponent((c.handle || '').replace(/^@/, ''));
  switch (c.provider) {
    case 'steam':
      return /^\d{17}$/.test(c.external_id) ? `https://steamcommunity.com/profiles/${c.external_id}` : null;
    case 'twitch':
      return `https://www.twitch.tv/${h || encodeURIComponent(c.display_name.toLowerCase())}`;
    case 'github':
      return h ? `https://github.com/${h}` : null;
    case 'youtube':
      return h ? `https://www.youtube.com/@${h}` : `https://www.youtube.com/channel/${encodeURIComponent(c.external_id)}`;
    case 'spotify':
      return `https://open.spotify.com/user/${encodeURIComponent(c.external_id)}`;
    case 'xbox':
      return `https://www.xbox.com/play/user/${h || encodeURIComponent(c.display_name)}`;
    default:
      return null;
  }
}

/** Accounts someone shows on their profile (only what the database lets you see). */
export async function profileConnections(userId: string): Promise<ProfileConnection[]> {
  const { data, error } = await supabase.rpc('profile_connections', { p_user: userId });
  if (error) return []; // database not updated yet: just show nothing
  return ((data ?? []) as ProfileConnection[]).filter((r) => PROVIDERS.some((p) => p.provider === r.provider));
}

export async function setConnectionVisibility(provider: ConnectionProvider, externalId: string, show: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_connection_visibility', { p_provider: provider, p_external_id: externalId, p_show: show });
  if (error) throw error;
  await reloadConnections();
}

export interface ProviderInfo {
  provider: ConnectionProvider;
  name: string;
  color: string;
  /** can be connected now, or not yet */
  kind: 'ready' | 'planned';
  desc: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { provider: 'spotify', name: 'Spotify', color: '#1db954', kind: 'ready', desc: 'Show what you’re listening to and host Listen Along.' },
  { provider: 'steam', name: 'Steam', color: '#171a21', kind: 'ready', desc: 'Your Steam name and avatar on your profile.' },
  { provider: 'xbox', name: 'Xbox', color: '#107c10', kind: 'ready', desc: 'Show your gamertag.' },
  { provider: 'twitch', name: 'Twitch', color: '#9146ff', kind: 'ready', desc: 'Link your channel for when you go live.' },
  { provider: 'youtube', name: 'YouTube', color: '#ff0000', kind: 'ready', desc: 'Link your YouTube channel.' },
  { provider: 'tiktok', name: 'TikTok', color: '#000000', kind: 'ready', desc: 'Link your TikTok profile.' },
  { provider: 'github', name: 'GitHub', color: '#24292f', kind: 'ready', desc: 'Show off your GitHub profile.' },
  { provider: 'discord', name: 'Discord', color: '#5865f2', kind: 'planned', desc: 'Coming soon.' },
  { provider: 'instagram', name: 'Instagram', color: '#e1306c', kind: 'planned', desc: 'Coming soon.' },
];

export const providerInfo = (p: ConnectionProvider): ProviderInfo => PROVIDERS.find((x) => x.provider === p) ?? PROVIDERS[0];

// ----------------------------------------------------------- return paths ----

/** Production always uses www.venband.com, so the address never depends on how you got to the site. */
const SITE = typeof location !== 'undefined' && /(^|\.)venband\.com$/i.test(location.hostname) ? 'https://www.venband.com' : typeof location !== 'undefined' ? location.origin : '';
const PROD = SITE === 'https://www.venband.com';

/** Register exactly these in each provider's developer console. */
export const REDIRECTS: Record<Exclude<ConnectionProvider, 'discord' | 'instagram'>, string> = {
  spotify: `${SITE}/callback`,
  youtube: `${SITE}/callback`,
  tiktok: `${SITE}/callback`,
  github: `${SITE}/github/auth`,
  xbox: `${SITE}/auth/xbox/`,
  twitch: PROD ? 'https://venband.com/auth/twitch' : `${SITE}/auth/twitch`,
  steam: `${SITE}/auth/steam`,
};

const CLIENT = {
  spotify: '05794dae8b7747a6879621caf10a9716',
  youtube: '319530075746-jvmsth0p5h4c36cdiu2q0spl1ccli8sf.apps.googleusercontent.com',
  tiktok: 'aw3rf61cawh6b01a',
  github: 'Iv23liN3W4bPnHUOj45w',
  xbox: 'fb0e8566-ac50-467e-bef4-9df4bd5f16e5',
  twitch: 'fj02sot13ldczefa3za7hcc3ryw9fe',
};
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state streaming';

/** Paths that mean "a provider just sent you back here". */
export const isOAuthReturnPath = (path = location.pathname) => /^\/(callback|auth\/(xbox|twitch|steam|github|youtube|tiktok|spotify)|github\/auth)\/?$/i.test(path);

// ------------------------------------------------------------------ store ----

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
export function subscribeConnections(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let mine: ConnectionRow[] = [];
let loading = false;
let version = 0;
export const connectionsVersion = () => version;
export const myConnections = (): ConnectionRow[] => mine;

export async function reloadConnections(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const { data, error } = await supabase.rpc('my_connections');
    if (error) throw error;
    mine = ((data ?? []) as unknown as ConnectionRow[]).filter((r) => PROVIDERS.some((p) => p.provider === r.provider)).map((r) => ({ ...r, metadata: (r.metadata ?? {}) as Record<string, unknown> }));
    version++;
    emit();
  } finally {
    loading = false;
  }
}

export async function addConnection(provider: ConnectionProvider, externalId: string, displayName = '', avatarUrl: string | null = null, metadata: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.rpc('add_connection', { p_provider: provider, p_external_id: externalId, p_display_name: displayName, p_avatar_url: avatarUrl, p_metadata: metadata });
  if (error) throw error;
  await reloadConnections();
}

export async function removeConnection(provider: ConnectionProvider, externalId: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('remove_connection', { p_provider: provider, p_external_id: externalId });
  if (error) throw error;
  if (provider === 'spotify') for (const k of ['spotify_access_token', 'spotify_refresh_token', 'spotify_expires_at']) localStorage.removeItem(k);
  await reloadConnections();
}

// ---------------------------------------------------------------- start -----

const b64url = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/, '');
};
const random = () => b64url(crypto.getRandomValues(new Uint8Array(24)).buffer);

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/** Remember what we sent, so the return can be checked. */
function remember(provider: ConnectionProvider, verifier?: string) {
  const state = `${provider}.${random()}`;
  sessionStorage.setItem('vb_oauth', JSON.stringify({ provider, state, verifier: verifier ?? null, at: Date.now() }));
  return state;
}

/** Send the browser to the provider's sign-in page. */
export async function connect(provider: ConnectionProvider): Promise<void> {
  const to = (base: string, params: Record<string, string>) => window.location.assign(`${base}?${new URLSearchParams(params)}`);
  switch (provider) {
    case 'steam': {
      remember('steam');
      return to('https://steamcommunity.com/openid/login', {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': REDIRECTS.steam,
        'openid.realm': SITE,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      });
    }
    case 'spotify': {
      const { verifier, challenge } = await pkce();
      return to('https://accounts.spotify.com/authorize', {
        client_id: CLIENT.spotify,
        response_type: 'code',
        redirect_uri: REDIRECTS.spotify,
        scope: SPOTIFY_SCOPES,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state: remember('spotify', verifier),
      });
    }
    case 'youtube': {
      const { verifier, challenge } = await pkce();
      return to('https://accounts.google.com/o/oauth2/v2/auth', {
        client_id: CLIENT.youtube,
        response_type: 'code',
        redirect_uri: REDIRECTS.youtube,
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state: remember('youtube', verifier),
        prompt: 'select_account',
      });
    }
    case 'tiktok':
      return to('https://www.tiktok.com/v2/auth/authorize/', {
        client_key: CLIENT.tiktok,
        response_type: 'code',
        scope: 'user.info.basic',
        redirect_uri: REDIRECTS.tiktok,
        state: remember('tiktok'),
      });
    case 'github': {
      const { verifier, challenge } = await pkce();
      return to('https://github.com/login/oauth/authorize', {
        client_id: CLIENT.github,
        redirect_uri: REDIRECTS.github,
        state: remember('github', verifier),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        allow_signup: 'true',
      });
    }
    case 'xbox': {
      const { verifier, challenge } = await pkce();
      return to('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize', {
        client_id: CLIENT.xbox,
        response_type: 'code',
        redirect_uri: REDIRECTS.xbox,
        response_mode: 'query',
        scope: 'XboxLive.signin',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: remember('xbox', verifier),
        prompt: 'select_account',
      });
    }
    case 'twitch':
      // Twitch "Public" client: the token comes straight back in the #fragment.
      return to('https://id.twitch.tv/oauth2/authorize', {
        client_id: CLIENT.twitch,
        redirect_uri: REDIRECTS.twitch,
        response_type: 'token',
        scope: '',
        state: remember('twitch'),
        force_verify: 'true',
      });
    default:
      throw new Error('That one isn’t available yet.');
  }
}

// --------------------------------------------------------------- return -----

const NAMES: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.provider, p.name]));

async function serverFinish(body: Record<string, unknown>): Promise<{ external_id: string; display_name: string; avatar_url: string | null; handle?: string }> {
  const r = await fetch('/api/oauth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `The server couldn’t finish connecting (HTTP ${r.status}).`);
  return data;
}

async function spotifyFinish(code: string, verifier: string) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT.spotify, grant_type: 'authorization_code', code, redirect_uri: REDIRECTS.spotify, code_verifier: verifier }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(tok?.error_description || 'Spotify didn’t accept the sign-in.');
  // the "now playing" token stays on this device
  localStorage.setItem('spotify_access_token', tok.access_token);
  if (tok.refresh_token) localStorage.setItem('spotify_refresh_token', tok.refresh_token);
  localStorage.setItem('spotify_expires_at', String(Date.now() + (tok.expires_in ?? 3600) * 1000));
  const pr = await fetch('https://api.spotify.com/v1/me', { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (pr.status === 403) throw new Error('Spotify only lets accounts added to the Venband app’s user list connect while it’s in development mode.');
  const me = pr.ok ? await pr.json() : null;
  return { external_id: me?.id || 'spotify', display_name: me?.display_name || me?.id || 'Spotify', avatar_url: me?.images?.[0]?.url || null };
}

export type OAuthResult = { ok: true; provider: ConnectionProvider; name: string } | { ok: false; provider: ConnectionProvider | null; error: string };

/**
 * Finish a "Connect" if the page is a provider's return. Returns null when it
 * isn't one. Always clears the code/token from the address bar.
 */
export async function handleOAuthReturn(): Promise<OAuthResult | null> {
  const path = location.pathname.toLowerCase();
  const search = location.search;
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const legacySteam = q.has('steam') && q.has('openid.mode');
  if (!isOAuthReturnPath(path) && !legacySteam) return null;

  let saved: { provider: ConnectionProvider; state: string; verifier: string | null; at: number } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem('vb_oauth') || 'null');
  } catch {
    /* ignore */
  }
  sessionStorage.removeItem('vb_oauth');
  const state = q.get('state') || h.get('state') || '';
  const provider: ConnectionProvider | null =
    path.startsWith('/auth/xbox') ? 'xbox'
    : path.startsWith('/auth/twitch') ? 'twitch'
    : path.startsWith('/auth/steam') || legacySteam ? 'steam'
    : path.startsWith('/github/auth') || path.startsWith('/auth/github') ? 'github'
    : ((state.split('.')[0] || saved?.provider || null) as ConnectionProvider | null);

  // tidy the address bar right away so a refresh can't replay the code
  history.replaceState(null, '', location.pathname);

  const name = (provider && NAMES[provider]) || 'That account';
  const fail = (error: string): OAuthResult => ({ ok: false, provider, error });
  const providerError = q.get('error_description') || q.get('error') || h.get('error_description') || h.get('error');
  if (providerError) return fail(/access_denied|cancel/i.test(providerError) ? `${name} sign-in was cancelled.` : `${name} said: ${providerError.replace(/\+/g, ' ')}`);
  if (!provider || !NAMES[provider]) return fail('That sign-in link wasn’t recognised. Try connecting again from Settings → Connections.');

  // The state must be the one we sent. (GitHub's "install the app" flow starts
  // on GitHub, so it has no state — that one only proves who you are.)
  const githubInstall = provider === 'github' && !state && q.has('installation_id');
  if (provider !== 'steam' && !githubInstall && (!saved || saved.state !== state)) return fail(`${name} sign-in expired or was started in another tab. Please try again.`);
  if (saved && Date.now() - saved.at > 15 * 60_000) return fail(`${name} sign-in took too long. Please try again.`);

  try {
    let got: { external_id: string; display_name: string; avatar_url: string | null; handle?: string };
    const code = q.get('code') || '';
    switch (provider) {
      case 'spotify':
        got = await spotifyFinish(code, saved?.verifier || '');
        break;
      case 'twitch':
        got = await serverFinish({ provider, access_token: h.get('access_token') || '' });
        break;
      case 'steam':
        got = await serverFinish({ provider, query: search });
        break;
      default:
        if (githubInstall && !code) return fail('GitHub didn’t send a sign-in code.');
        got = await serverFinish({ provider, code, redirect_uri: REDIRECTS[provider as keyof typeof REDIRECTS], code_verifier: saved?.verifier || undefined });
    }
    await addConnection(provider, got.external_id, got.display_name, got.avatar_url, { verified: true, ...(got.handle ? { handle: got.handle } : {}) });
    return { ok: true, provider, name: got.display_name };
  } catch (e) {
    return fail(`${name} link failed: ${errorMessage(e)}`);
  }
}

// --------------------------------------------------------------- spotify ----

/** A fresh Spotify access token for this device, or null. */
export async function spotifyAccessToken(): Promise<string | null> {
  const tok = localStorage.getItem('spotify_access_token');
  const exp = Number(localStorage.getItem('spotify_expires_at') || 0);
  if (tok && Date.now() < exp - 60_000) return tok;
  const refresh = localStorage.getItem('spotify_refresh_token');
  if (!refresh) return null;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT.spotify, grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  localStorage.setItem('spotify_access_token', t.access_token);
  if (t.refresh_token) localStorage.setItem('spotify_refresh_token', t.refresh_token);
  localStorage.setItem('spotify_expires_at', String(Date.now() + (t.expires_in ?? 3600) * 1000));
  return t.access_token;
}

export async function spotifyNowPlaying(): Promise<{ name: string; artist: string; albumArt: string | null; isPlaying: boolean } | null> {
  const tok = await spotifyAccessToken();
  if (!tok) return null;
  const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { authorization: `Bearer ${tok}` } });
  if (r.status === 204 || !r.ok) return null;
  const d = await r.json();
  const item = d?.item;
  if (!item) return null;
  return {
    name: item.name,
    artist: (item.artists || []).map((a: { name: string }) => a.name).join(', '),
    albumArt: item.album?.images?.[0]?.url || null,
    isPlaying: !!d.is_playing,
  };
}
