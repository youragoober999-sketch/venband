// Venband Realtime server (realtime/server.mjs) with a fake Supabase:
// tokens "tok-<user>" sign in as <user>; topics listed in ALLOW[user] may be joined.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeServer } from '../realtime/server.mjs';

const T1 = `chan:${'11111111-1111-4111-8111-111111111111'}`;
const T2 = `call:${'22222222-2222-4222-8222-222222222222'}`;
const ALLOW: Record<string, string[]> = { alice: [T1, T2], bob: [T1, T2], eve: [] };
const auth = {
  async user(token: string) {
    const name = token.replace(/^tok-/, '');
    return name in ALLOW ? { id: name } : null;
  },
  async allowed(token: string, topic: string) {
    const name = token.replace(/^tok-/, '');
    return (ALLOW[name] ?? []).includes(topic);
  },
};

type Msg = Record<string, any>;
async function client(port: number, token: string | null) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const w = waiters.findIndex((x) => x.pred(m));
    if (w >= 0) waiters.splice(w, 1)[0].res(m);
    else inbox.push(m);
  };
  await new Promise((r) => (ws.onopen = r));
  const next = (pred: (m: Msg) => boolean, ms = 2000) =>
    new Promise<Msg>((res, rej) => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return res(inbox.splice(i, 1)[0]);
      const t = setTimeout(() => rej(new Error('timed out waiting')), ms);
      waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
    });
  const sendJ = (m: Msg) => ws.send(JSON.stringify(m));
  let hello: Msg | null = null;
  if (token) {
    sendJ({ t: 'auth', token });
    hello = await next((m) => m.t === 'ok' || m.t === 'err');
  }
  return { ws, send: sendJ, next, inbox, hello };
}

test('sign-in, join rules, broadcast with a real sender id, presence', async () => {
  const srv = await createRealtimeServer({ auth, port: 0, host: '127.0.0.1' });
  try {
    const a = await client(srv.port, 'tok-alice');
    const b = await client(srv.port, 'tok-bob');
    const e = await client(srv.port, 'tok-eve');

    // eve can't join; a bad topic is refused before asking Supabase
    e.send({ t: 'join', topic: T1 });
    assert.equal((await e.next((m) => m.topic === T1)).t, 'denied');
    e.send({ t: 'join', topic: 'dbu:whatever' });
    assert.equal((await e.next((m) => m.t === 'denied')).reason, 'bad topic');

    a.send({ t: 'join', topic: T1, key: 'tab-a' });
    b.send({ t: 'join', topic: T1, key: 'tab-b' });
    assert.equal((await a.next((m) => m.t === 'joined')).topic, T1);
    await b.next((m) => m.t === 'joined');

    // broadcast reaches others (not yourself) and carries the real sender
    a.send({ t: 'bc', topic: T1, event: 'typing', payload: { user_id: 'someone-else' } });
    const got = await b.next((m) => m.t === 'bc');
    assert.equal(got.event, 'typing');
    assert.equal(got.from, 'alice');
    await assert.rejects(a.next((m) => m.t === 'bc', 200));

    // eve, not joined, can't broadcast into the topic
    e.send({ t: 'bc', topic: T1, event: 'typing', payload: {} });
    await assert.rejects(b.next((m) => m.t === 'bc', 200));

    // presence: tracked metas reach everyone with the real user id; a late joiner gets the state
    a.send({ t: 'track', topic: T1, meta: { user_id: 'forged', session: 'tab-a' } });
    const pj = await b.next((m) => m.t === 'pjoin');
    assert.equal(pj.key, 'tab-a');
    assert.equal(pj.meta.user_id, 'alice');
    const late = await client(srv.port, 'tok-bob');
    late.send({ t: 'join', topic: T1, key: 'tab-c' });
    const st = await late.next((m) => m.t === 'joined');
    assert.equal(st.state['tab-a'][0].user_id, 'alice');

    // closing a socket removes its presence
    a.ws.close();
    const pl = await b.next((m) => m.t === 'pleave');
    assert.equal(pl.key, 'tab-a');

    // frames before sign-in are refused
    const anon = await client(srv.port, null);
    anon.send({ t: 'join', topic: T1 });
    assert.equal((await anon.next((m) => m.t === 'err')).reason, 'sign in first');
    const bad = await client(srv.port, 'tok-mallory');
    assert.equal(bad.hello?.t, 'err');
    assert.equal((await client(srv.port, 'tok-alice')).hello?.user, 'alice');

  } finally {
    await srv.close();
  }
});
