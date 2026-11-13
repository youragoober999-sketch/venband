// Vercel Function: finishes QR-code logins (action 'qr-approve', below) and "Connect" for providers that can't be finished in
// the browser — a client secret is needed (GitHub, Google/YouTube, TikTok),
// the provider's token endpoint has no CORS (Microsoft/Xbox, Steam), or the
// result must be verified server-side (Twitch, Steam).
//
// POST /api/oauth  { provider, code?, redirect_uri?, code_verifier?, access_token?, query? }
//   -> { external_id, display_name, avatar_url }
//
// Secrets come ONLY from Vercel environment variables (Project → Settings →
// Environment Variables). They are never in the repository, the app bundle or
// a response. Provider access tokens are used once to read the profile and
// then dropped — none are returned to the browser or stored.
import { json, preflight, readJson } from './_lib/rpc.js';
import { userFromRequest } from './_lib/net.js';

const env = (k) => (process.env[k] || '').trim();

// Public client ids (these are not secret — they appear in every sign-in URL).
const IDS = {
  github: env('GITHUB_CLIENT_ID') || 'Iv23liN3W4bPnHUOj45w',
  google: env('GOOGLE_CLIENT_ID') || '319530075746-jvmsth0p5h4c36cdiu2q0spl1ccli8sf.apps.googleusercontent.com',
  tiktok: env('TIKTOK_CLIENT_KEY') || 'aw3rf61cawh6b01a',
  xbox: env('XBOX_CLIENT_ID') || 'fb0e8566-ac50-467e-bef4-9df4bd5f16e5',
  twitch: env('TWITCH_CLIENT_ID') || 'fj02sot13ldczefa3za7hcc3ryw9fe',
};

// Only these return addresses are accepted, so a code can't be replayed through
// someone else's site.
const ORIGINS = ['https://www.venband.com', 'https://venband.com', 'http://localhost:5173', 'http://localhost:5174'];
const okRedirect = (u) => {
  try {
    return ORIGINS.includes(new URL(u).origin);
  } catch {
    return false;
  }
};

class Fail extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const need = (v, what) => {
  if (!v || typeof v !== 'string' || v.length > 4096) throw new Fail(400, `${what} missing`);
  return v;
};
const secret = (k, name) => {
  const v = env(k);
  if (!v) throw new Fail(503, `${name} isn’t set up on this server yet (missing ${k}).`);
  return v;
};

async function call(url, init, what) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!r.ok) {
    const why = (body && (body.error_description || body.message || body.error?.message || body.error)) || `HTTP ${r.status}`;
    throw new Fail(400, `${what}: ${typeof why === 'string' ? why : JSON.stringify(why)}`.slice(0, 300));
  }
  return body;
}
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(o) });

// ---------------------------------------------------------------- providers --

async function github({ code, redirect_uri, code_verifier }) {
  const tok = await call(
    'https://github.com/login/oauth/access_token',
    form({ client_id: IDS.github, client_secret: secret('GITHUB_CLIENT_SECRET', 'GitHub'), code: need(code, 'code'), redirect_uri, ...(code_verifier ? { code_verifier } : {}) }),
    'GitHub sign-in',
  );
  if (!tok.access_token) throw new Fail(400, `GitHub sign-in: ${tok.error_description || tok.error || 'no token'}`);
  const u = await call('https://api.github.com/user', { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Venband' } }, 'GitHub profile');
  return { external_id: String(u.id), display_name: u.name || u.login, handle: u.login, avatar_url: u.avatar_url || null };
}

async function youtube({ code, redirect_uri, code_verifier }) {
  const tok = await call(
    'https://oauth2.googleapis.com/token',
    form({
      client_id: IDS.google,
      client_secret: secret('GOOGLE_CLIENT_SECRET', 'YouTube'),
      grant_type: 'authorization_code',
      code: need(code, 'code'),
      redirect_uri,
      ...(code_verifier ? { code_verifier } : {}),
    }),
    'Google sign-in',
  );
  const r = await call('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${tok.access_token}` } }, 'YouTube channel');
  const ch = r.items?.[0];
  if (!ch) throw new Fail(400, 'That Google account has no YouTube channel yet.');
  const th = ch.snippet?.thumbnails ?? {};
  return { external_id: ch.id, display_name: ch.snippet?.title || 'YouTube', handle: ch.snippet?.customUrl || '', avatar_url: th.medium?.url || th.default?.url || null };
}

async function tiktok({ code, redirect_uri, code_verifier }) {
  const tok = await call(
    'https://open.tiktokapis.com/v2/oauth/token/',
    form({
      client_key: IDS.tiktok,
      client_secret: secret('TIKTOK_CLIENT_SECRET', 'TikTok'),
      grant_type: 'authorization_code',
      code: need(code, 'code'),
      redirect_uri,
      ...(code_verifier ? { code_verifier } : {}),
    }),
    'TikTok sign-in',
  );
  if (!tok.access_token) throw new Fail(400, `TikTok sign-in: ${tok.error_description || tok.error || 'no token'}`);
  const r = await call('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name', { headers: { authorization: `Bearer ${tok.access_token}` } }, 'TikTok profile');
  const u = r.data?.user ?? {};
  return { external_id: u.open_id || tok.open_id, display_name: u.display_name || 'TikTok', avatar_url: u.avatar_url || null };
}

async function twitch({ access_token }) {
  need(access_token, 'access_token');
  // make sure the token was issued to OUR app before trusting it
  const v = await call('https://id.twitch.tv/oauth2/validate', { headers: { authorization: `OAuth ${access_token}` } }, 'Twitch sign-in');
  if (v.client_id !== IDS.twitch) throw new Fail(400, 'That Twitch token belongs to a different app.');
  const r = await call('https://api.twitch.tv/helix/users', { headers: { authorization: `Bearer ${access_token}`, 'client-id': IDS.twitch } }, 'Twitch profile');
  const u = r.data?.[0];
  if (!u) throw new Fail(400, 'Twitch returned no profile.');
  return { external_id: u.id, display_name: u.display_name || u.login, handle: u.login, avatar_url: u.profile_image_url || null };
}

async function xbox({ code, redirect_uri, code_verifier }) {
  // 1. Microsoft account sign-in (public client: PKCE, no secret).
  const ms = await call(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    form({ client_id: IDS.xbox, grant_type: 'authorization_code', code: need(code, 'code'), redirect_uri, code_verifier: need(code_verifier, 'code_verifier'), scope: 'XboxLive.signin' }),
    'Microsoft sign-in',
  );
  const xjson = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-xbl-contract-version': '1' }, body: JSON.stringify(body) });
  // 2. Xbox user token.
  const user = await call(
    'https://user.auth.xboxlive.com/user/authenticate',
    xjson({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.access_token}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }),
    'Xbox sign-in',
  );
  // 3. XSTS token — its claims carry the gamertag and Xbox user id.
  let xsts;
  try {
    xsts = await call(
      'https://xsts.auth.xboxlive.com/xsts/authorize',
      xjson({ Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] }, RelyingParty: 'http://xboxlive.com', TokenType: 'JWT' }),
      'Xbox profile',
    );
  } catch (e) {
    throw new Fail(400, /2148916233/.test(String(e.message)) ? 'That Microsoft account has no Xbox profile yet — sign in to xbox.com once to create one.' : e.message);
  }
  const claim = xsts.DisplayClaims?.xui?.[0] ?? {};
  if (!claim.xid && !claim.gtg) throw new Fail(400, 'Xbox returned no gamertag.');
  let avatar = null;
  try {
    const p = await call(
      `https://profile.xboxlive.com/users/xuid(${claim.xid})/profile/settings?settings=GameDisplayPicRaw`,
      { headers: { authorization: `XBL3.0 x=${claim.uhs};${xsts.Token}`, 'x-xbl-contract-version': '2', accept: 'application/json' } },
      'Xbox picture',
    );
    avatar = p.profileUsers?.[0]?.settings?.find((s) => s.id === 'GameDisplayPicRaw')?.value || null;
  } catch {
    /* the picture is optional */
  }
  return { external_id: String(claim.xid || claim.gtg), display_name: claim.gtg || 'Xbox player', handle: claim.gtg || '', avatar_url: avatar };
}

async function steam({ query }) {
  const p = new URLSearchParams(need(query, 'query'));
  if (!String(p.get('openid.mode') || '').includes('id_res')) throw new Fail(400, 'Steam didn’t confirm the sign-in.');
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(p.get('openid.claimed_id') || '');
  if (!m) throw new Fail(400, 'Steam gave back an unreadable profile id.');
  if (!okRedirect(p.get('openid.return_to') || '')) throw new Fail(400, 'That Steam sign-in was meant for another site.');
  // ask Steam to confirm the signature
  const check = new URLSearchParams({ 'openid.ns': p.get('openid.ns') || 'http://specs.openid.net/auth/2.0' });
  for (const k of String(p.get('openid.signed') || '').split(',').filter(Boolean)) {
    const v = p.get(`openid.${k}`);
    if (v !== null) check.set(`openid.${k}`, v);
  }
  check.set('openid.sig', p.get('openid.sig') || '');
  check.set('openid.signed', p.get('openid.signed') || '');
  check.set('openid.assoc_handle', p.get('openid.assoc_handle') || '');
  check.set('openid.mode', 'check_authentication');
  const r = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: check, signal: AbortSignal.timeout(10_000) });
  if (!/is_valid\s*:\s*true/.test(await r.text())) throw new Fail(400, 'Steam rejected the sign-in signature.');
  let name = `Steam ${m[1].slice(-6)}`;
  let avatar = null;
  try {
    const xml = await (await fetch(`https://steamcommunity.com/profiles/${m[1]}/?xml=1`, { signal: AbortSignal.timeout(8000) })).text();
    const pick = (tag) => (new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(xml)?.[1] || '').trim();
    if (pick('steamID')) name = pick('steamID').slice(0, 80);
    if (pick('avatarFull').startsWith('https://')) avatar = pick('avatarFull');
  } catch {
    /* the profile is optional; the id is enough */
  }
  return { external_id: m[1], display_name: name, avatar_url: avatar };
}

const HANDLERS = { github, youtube, tiktok, twitch, xbox, steam };

// ------------------------------------------------------------- QR login ----
// POST /api/oauth { action: 'qr-approve', code } with the APPROVING device's
// sign-in token. Makes a brand-new sign-in for that same account and seals it
// to the waiting device's one-time key, so only that device can use it.
// Needs SUPABASE_SERVICE_ROLE_KEY (Vercel env only — it can create sign-ins).

const SUPA = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function admin(path, body) {
  const key = secret('SUPABASE_SERVICE_ROLE_KEY', 'QR login');
  const r = await fetch(`${SUPA()}${path}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!r.ok) throw new Fail(r.status === 404 ? 503 : 400, (data && (data.message || data.msg || data.error_description)) || 'QR login failed on the server.');
  return data;
}

/** ECIES: P-256 ECDH with a throwaway key -> HKDF -> AES-GCM, to the waiting device's public key. */
async function sealTo(pubkeyB64, text) {
  const { subtle } = globalThis.crypto;
  const P256 = { name: 'ECDH', namedCurve: 'P-256' };
  const them = await subtle.importKey('spki', Buffer.from(pubkeyB64, 'base64'), P256, false, []);
  const eph = await subtle.generateKey(P256, true, ['deriveBits']);
  const ephPub = new Uint8Array(await subtle.exportKey('spki', eph.publicKey));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: them }, eph.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ephPub, info: new TextEncoder().encode('venband/v1/qr-login') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({ e: b64(ephPub), iv: b64(iv), ct: b64(ct) });
}

async function qrApprove(request, b) {
  const code = String(b.code || '');
  if (!/^[0-9a-f]{64}$/.test(code)) throw new Fail(400, 'That QR code isn’t valid.');
  const user = await userFromRequest(request);
  if (!user?.id) throw new Fail(401, 'Log in on this device first.');
  if (!user.email) throw new Fail(400, 'This account has no email, so it can’t use QR login.');
  const pubkey = await admin('/rest/v1/rpc/qr_login_pubkey', { p_code: code, p_user: user.id });
  if (!pubkey || typeof pubkey !== 'string') throw new Fail(404, 'This QR code expired. Scan the new one on the login screen.');
  const identity = b.identity;
  if (identity != null && (
    identity.userId !== user.id ||
    typeof identity.publicKey !== 'string' || identity.publicKey.length > 150 ||
    typeof identity.sealed?.keyId !== 'string' || identity.sealed.keyId.length > 64 ||
    typeof identity.sealed.iv !== 'string' || identity.sealed.iv.length > 32 ||
    typeof identity.sealed.ciphertext !== 'string' || identity.sealed.ciphertext.length > 2200
  )) throw new Fail(400, 'That encrypted device transfer isn’t valid.');
  // A one-time sign-in link for this account (nothing is emailed).
  const link = await admin('/auth/v1/admin/generate_link', { type: 'magiclink', email: user.email });
  const tokenHash = link.hashed_token || link.properties?.hashed_token;
  if (!tokenHash) throw new Fail(500, 'Couldn’t create the sign-in.');
  const transfer = identity && { userId: user.id, publicKey: identity.publicKey, sealed: { keyId: identity.sealed.keyId, iv: identity.sealed.iv, ciphertext: identity.sealed.ciphertext } };
  const sealed = await sealTo(pubkey, JSON.stringify({ token_hash: tokenHash, type: 'magiclink', identity: transfer }));
  const ok = await admin('/rest/v1/rpc/qr_login_finish', { p_code: code, p_user: user.id, p_sealed: sealed });
  if (ok !== true) throw new Fail(404, 'This QR code expired. Scan the new one on the login screen.');
  return { ok: true };
}

export function OPTIONS() {
  return preflight();
}

export async function POST(request) {
  try {
    const b = await readJson(request).catch(() => {
      throw new Fail(400, 'bad request');
    });
    if (b.action === 'qr-approve') return json(200, await qrApprove(request, b));
    const run = HANDLERS[b.provider];
    if (!run) throw new Fail(400, 'unknown provider');
    if (b.redirect_uri !== undefined && !okRedirect(b.redirect_uri)) throw new Fail(400, 'redirect_uri not allowed');
    const out = await run(b);
    return json(200, {
      external_id: String(out.external_id).slice(0, 128),
      display_name: String(out.display_name || '').slice(0, 80),
      handle: /^[\w@.\- ]{1,80}$/.test(out.handle || '') ? out.handle : '',
      avatar_url: out.avatar_url && String(out.avatar_url).startsWith('https://') && out.avatar_url.length <= 500 ? out.avatar_url : null,
    });
  } catch (e) {
    return json(e instanceof Fail ? e.status : 500, { error: e instanceof Fail ? e.message : 'Connecting failed. Try again in a minute.' });
  }
}
