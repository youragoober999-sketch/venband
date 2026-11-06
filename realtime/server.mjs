// Venband Realtime — a small self-hosted WebSocket server for the live,
// short-lived traffic: typing, presence, call signalling and games.
// (Database change feeds stay on Supabase until the database itself moves;
// see docs/AUDIT.md §19.)
//
// It holds no secrets. Each connection signs in with the user's own Supabase
// access token; the server asks Supabase who that is (/auth/v1/user) and
// whether they may join a topic (rpc realtime_topic_allowed, run as them) —
// the same rule Supabase Realtime uses. Joins are re-checked every few
// minutes, so someone kicked from a server drops out.
//
// Protocol (JSON text frames), client -> server:
//   {t:'auth', token}                         first frame, and after each token refresh
//   {t:'join', topic, key?, self?}            subscribe; key = presence key
//   {t:'leave', topic}
//   {t:'bc', topic, event, payload}           broadcast to the topic
//   {t:'track', topic, meta} / {t:'untrack', topic}
//   {t:'ping'}
// server -> client:
//   {t:'ok'|'err', ...}  {t:'joined', topic, state}  {t:'denied', topic, reason}
//   {t:'bc', topic, event, payload, from}     from = sender's user id (can't be faked)
//   {t:'pjoin', topic, key, meta} {t:'pleave', topic, key, ref}   {t:'kicked', topic}
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const MAX_FRAME = 64 * 1024; // call offers with many candidates fit easily
const MAX_TOPICS = 200; // per connection
const MAX_CONN_PER_USER = 30;
const MAX_CONN_PER_IP = 60;
const RATE = { perSec: 40, burst: 120 }; // frames per connection
const RECHECK_MS = 4 * 60_000;
const TOPIC_RE = /^(chan|act|call|scope):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[A-Za-z0-9_-]{1,40})?$/;
const EVENT_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Supabase-backed checks. Replaceable in tests. */
export function supabaseAuth({ url, anonKey, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  return {
    async user(token) {
      const r = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const u = await r.json();
      return u?.id ? { id: u.id } : null;
    },
    async allowed(token, topic) {
      const r = await fetchImpl(`${base}/rest/v1/rpc/realtime_topic_allowed`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_topic: topic }),
      });
      if (!r.ok) return false;
      return (await r.json()) === true;
    },
  };
}

function tokenExpiry(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof p.exp === 'number' ? p.exp * 1000 : Date.now() + 3600_000;
  } catch {
    return 0;
  }
}

export function createRealtimeServer({ auth, port = 0, host = '0.0.0.0', allowOrigins = null, log = () => {} }) {
  /** topic -> Set<conn> */
  const topics = new Map();
  const perUser = new Map();
  const perIp = new Map();
  const stats = { connections: 0, frames: 0 };

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connections: stats.connections, topics: topics.size }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME });

  const send = (c, msg) => {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  };
  const members = (topic) => topics.get(topic) ?? new Set();

  function stateOf(topic) {
    const st = {};
    for (const c of members(topic)) {
      const sub = c.subs.get(topic);
      if (sub?.meta) (st[sub.key] ??= []).push({ ...sub.meta, presence_ref: sub.ref });
    }
    return st;
  }

  function untrack(c, topic) {
    const sub = c.subs.get(topic);
    if (!sub?.meta) return;
    sub.meta = null;
    for (const o of members(topic)) send(o, { t: 'pleave', topic, key: sub.key, ref: sub.ref });
  }

  function leave(c, topic) {
    if (!c.subs.has(topic)) return;
    untrack(c, topic);
    c.subs.delete(topic);
    const set = topics.get(topic);
    set?.delete(c);
    if (set && !set.size) topics.delete(topic);
  }

  async function join(c, topic, key, self) {
    if (!TOPIC_RE.test(topic)) return send(c, { t: 'denied', topic, reason: 'bad topic' });
    if (c.subs.has(topic)) return send(c, { t: 'joined', topic, state: stateOf(topic) });
    if (c.pending.has(topic)) return;
    if (c.subs.size + c.pending.size >= MAX_TOPICS) return send(c, { t: 'denied', topic, reason: 'too many topics' });
    let ok = false;
    c.pending.add(topic);
    try {
      ok = await auth.allowed(c.token, topic);
    } catch (e) {
      log('allowed() failed', e?.message);
    }
    c.pending.delete(topic);
    if (c.closed) return;
    if (!ok) return send(c, { t: 'denied', topic, reason: 'not allowed' });
    const ref = crypto.randomBytes(6).toString('base64url');
    c.subs.set(topic, { key: typeof key === 'string' && key.length <= 80 ? key : ref, ref, meta: null, self: !!self, checked: Date.now() });
    if (!topics.has(topic)) topics.set(topic, new Set());
    topics.get(topic).add(c);
    send(c, { t: 'joined', topic, state: stateOf(topic) });
  }

  async function recheck(c) {
    for (const [topic, sub] of c.subs) {
      if (Date.now() - sub.checked < RECHECK_MS) continue;
      sub.checked = Date.now();
      let ok = true;
      try {
        ok = await auth.allowed(c.token, topic);
      } catch {
        ok = true; // Supabase hiccup: don't drop everyone
      }
      if (!ok && c.subs.has(topic)) {
        leave(c, topic);
        send(c, { t: 'kicked', topic });
      }
    }
  }

  function bump(map, k, d) {
    const n = (map.get(k) ?? 0) + d;
    if (n <= 0) map.delete(k);
    else map.set(k, n);
    return n;
  }

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (allowOrigins && origin && !allowOrigins.includes(origin)) return ws.close(4003, 'origin not allowed');
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || '').trim();
    if (bump(perIp, ip, 1) > MAX_CONN_PER_IP) {
      bump(perIp, ip, -1);
      return ws.close(4029, 'too many connections');
    }
    stats.connections++;
    const c = { ws, ip, user: null, token: null, exp: 0, subs: new Map(), pending: new Set(), tokens: RATE.burst, last: Date.now(), closed: false };
    const authTimer = setTimeout(() => !c.user && ws.close(4001, 'sign in first'), 10_000);
    const tick = setInterval(() => {
      if (c.user && Date.now() > c.exp + 60_000) ws.close(4001, 'token expired');
      else if (c.user) recheck(c);
    }, 30_000);

    ws.on('message', async (raw) => {
      stats.frames++;
      const now = Date.now();
      c.tokens = Math.min(RATE.burst, c.tokens + ((now - c.last) / 1000) * RATE.perSec);
      c.last = now;
      if (c.tokens < 1) return send(c, { t: 'err', reason: 'slow down' });
      c.tokens--;
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;

      if (m.t === 'auth') {
        if (typeof m.token !== 'string' || m.token.length > 8192) return send(c, { t: 'err', reason: 'bad token' });
        let u = null;
        try {
          u = await auth.user(m.token);
        } catch (e) {
          log('user() failed', e?.message);
        }
        if (!u) return send(c, { t: 'err', reason: 'sign-in failed' });
        if (c.user && c.user !== u.id) return ws.close(4001, 'user changed');
        if (!c.user) {
          if (bump(perUser, u.id, 1) > MAX_CONN_PER_USER) {
            bump(perUser, u.id, -1);
            return ws.close(4029, 'too many connections');
          }
          c.user = u.id;
        }
        c.token = m.token;
        c.exp = tokenExpiry(m.token);
        clearTimeout(authTimer);
        return send(c, { t: 'ok', user: u.id });
      }
      if (m.t === 'ping') return send(c, { t: 'pong' });
      if (!c.user) return send(c, { t: 'err', reason: 'sign in first' });
      const topic = typeof m.topic === 'string' ? m.topic : '';

      switch (m.t) {
        case 'join':
          return join(c, topic, m.key, m.self);
        case 'leave':
          return leave(c, topic);
        case 'bc': {
          if (!c.subs.has(topic) || typeof m.event !== 'string' || !EVENT_RE.test(m.event)) return;
          for (const o of members(topic)) if (o !== c || c.subs.get(topic).self) send(o, { t: 'bc', topic, event: m.event, payload: m.payload ?? null, from: c.user });
          return;
        }
        case 'track': {
          const sub = c.subs.get(topic);
          if (!sub || !m.meta || typeof m.meta !== 'object' || Array.isArray(m.meta)) return;
          const meta = { ...m.meta, user_id: c.user }; // the user id in presence is always the real one
          if (JSON.stringify(meta).length > 4096) return send(c, { t: 'err', reason: 'presence too big' });
          sub.meta = meta;
          for (const o of members(topic)) send(o, { t: 'pjoin', topic, key: sub.key, meta: { ...meta, presence_ref: sub.ref } });
          return;
        }
        case 'untrack':
          return untrack(c, topic);
      }
    });

    ws.on('close', () => {
      c.closed = true;
      clearTimeout(authTimer);
      clearInterval(tick);
      for (const topic of [...c.subs.keys()]) leave(c, topic);
      if (c.user) bump(perUser, c.user, -1);
      bump(perIp, ip, -1);
      stats.connections--;
    });
    ws.on('error', () => {});
  });

  // drop dead sockets
  const alive = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        stats,
        close: () =>
          new Promise((r) => {
            clearInterval(alive);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => server.close(() => r()));
          }),
      });
    });
  });
}

// run directly: node realtime/server.mjs
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key; no secret keys are needed).');
    process.exit(1);
  }
  const allowOrigins = process.env.ALLOW_ORIGINS ? process.env.ALLOW_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const srv = await createRealtimeServer({
    auth: supabaseAuth({ url, anonKey }),
    port: Number(process.env.PORT || 4010),
    allowOrigins,
    log: (...a) => console.warn(new Date().toISOString(), ...a),
  });
  console.log(`Venband Realtime listening on :${srv.port}${allowOrigins ? ` (origins: ${allowOrigins.join(', ')})` : ''}`);
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
