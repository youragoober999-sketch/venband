'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const {
  encodeFrame,
  makeFrameDecoder,
  normalizeActivity,
  activityKey,
  handleFrame,
  createRpcServer,
  pipePath,
} = require('../src/rpc');
const { spotifyStatusToActivity } = require('../src/spotify');

test('frame codec round-trips JSON', () => {
  const frames = [];
  const feed = makeFrameDecoder((f) => frames.push(f));
  const obj = { cmd: 'SET_ACTIVITY', nonce: 'abc', args: { activity: { name: 'Code' } } };
  feed(encodeFrame(obj));
  assert.deepStrictEqual(frames, [obj]);
});

test('decoder splits frames across chunks', () => {
  const frames = [];
  const feed = makeFrameDecoder((f) => frames.push(f));
  const wire = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ a: 2 })]);
  // middle of the first frame's body
  feed(wire.subarray(0, 8));
  feed(wire.subarray(8));
  assert.deepStrictEqual(frames, [{ a: 1 }, { a: 2 }]);
});

test('oversized frames are dropped', () => {
  const frames = [];
  const feed = makeFrameDecoder((f) => frames.push(f), 64);
  const body = JSON.stringify({ x: 'y'.repeat(100) });
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  feed(Buffer.concat([len, Buffer.from(body)]));
  assert.deepStrictEqual(frames, [{ error: 'bad frame size' }]);
});

test('handshake returns READY with the provided user', () => {
  const events = [];
  const out = handleFrame({ cmd: 'HANDSHAKE', args: { v: 1, client_id: '123' }, nonce: null }, { handshaken: false }, () => ({ user: { id: '9', username: 'zed', global_name: 'Zed' } }), (e) => events.push(e));
  const ready = out.frames.find((f) => f.evt === 'READY');
  assert.ok(ready, 'expected a READY frame');
  assert.strictEqual(ready.data.user.id, '9');
  assert.strictEqual(ready.data.user.username, 'zed');
});

test('commands before handshake are rejected', () => {
  const out = handleFrame({ cmd: 'SET_ACTIVITY', args: {}, nonce: 'n' }, { handshaken: false }, null, () => {});
  assert.strictEqual(out.frames[0].nonce, 'n');
});

test('SET_ACTIVITY normalizes and acks', () => {
  const state = { handshaken: true, clientId: '123', pid: 7 };
  const frame = {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: 7,
      activity: {
        name: 'Visual Studio Code',
        type: 0,
        details: 'Editing main.js',
        state: 'Working Directory: venband',
        timestamps: { start: 1000 },
        assets: { large_image: 'vscode', large_text: 'Code', small_image: 'vercel' },
        party: { size: [1, 1] },
      },
    },
    nonce: 'n1',
  };
  const out = handleFrame(frame, state);
  const ack = out.frames.find((f) => f.nonce === 'n1');
  assert.strictEqual(ack.cmd, 'SET_ACTIVITY');
  assert.strictEqual(out.frames[0].data.activities[0].name, 'Visual Studio Code');
  assert.strictEqual(out.events[0].activity.details, 'Editing main.js');
  assert.strictEqual(out.events[0].activity.timestamps_start, 1000);
  assert.strictEqual(out.events[0].activity.assets_large_key, 'vscode');
  assert.strictEqual(out.events[0].activity.party_cur, 1);
});

test('empty SET_ACTIVITY clears', () => {
  const out = handleFrame({ cmd: 'SET_ACTIVITY', args: { pid: 1, activity: null }, nonce: 'x' }, { handshaken: true, clientId: '', pid: 1 });
  assert.strictEqual(out.events[0].activity, null);
  assert.strictEqual(out.frames[0].data.activities.length, 0);
});

test('SUBSCRIBE and unknown commands ack tolerantly', () => {
  const state = { handshaken: true, clientId: '', pid: 0, subscribed: new Set() };
  const sub = handleFrame({ cmd: 'SUBSCRIBE', args: { evt: 'ACTIVITY_JOIN' }, nonce: 's' }, state, null, () => {});
  assert.strictEqual(sub.frames[0].cmd, 'SUBSCRIBE');
  assert.ok(state.subscribed.has('ACTIVITY_JOIN'));
  const picklegate = handleFrame({ cmd: 'GET_GUILD', args: {}, nonce: 'g' }, state, null, () => {});
  assert.strictEqual(picklegate.frames[0].cmd, 'GET_GUILD');
});

test('connection emits a clear when it drops', () => {
  const events = [];
  let sent = [];
  const conn = new (require('../src/rpc').Connection)({
    onFrame: (f) => sent.push(f),
    onError: () => {},
    getServerState: () => ({}),
    emit: (e) => events.push(e),
  });
  const st = conn.state;
  st.handshaken = true;
  st.clientId = '9';
  st.activity = { name: 'X' };
  conn.close();
  assert.deepStrictEqual(events, [{ type: 'activity', activity: null, clientId: '9' }]);
});

test('normalizeActivity keeps only known fields', () => {
  const a = normalizeActivity({ name: 'Fall Guys', type: 0, bogus: 1, assets: { large_image: 'icon', small_text: 'x' }, party: { size: [2, 8] } }, '42');
  assert.strictEqual(a.name, 'Fall Guys');
  assert.strictEqual(a.bogus, undefined);
  assert.strictEqual(a.party_cur, 2);
  assert.strictEqual(a.party_max, 8);
  assert.strictEqual(a.client_id, '42');
});

test('activityKey treats identical activities as equal', () => {
  const a = normalizeActivity({ name: 'X', details: 'd' }, '1');
  const b = normalizeActivity({ name: 'X', details: 'd' }, '1');
  assert.strictEqual(activityKey(a), activityKey(b));
  assert.notStrictEqual(activityKey(a), activityKey(normalizeActivity({ name: 'Y', details: 'd' }, '1')));
});

test('pipe paths are platform-appropriate', () => {
  const p = pipePath(0);
  assert.ok(typeof p === 'string' && p.includes('discord-ipc-0'));
});

test('full server handshake over a real socket', async () => {
  const emitted = [];
  const server = createRpcServer({ emit: (e) => e && e.type === 'activity' && emitted.push(e) });
  const { index } = await server.start();
  await new Promise((resolve, reject) => {
    const sock = net.connect(pipePath(index));
    sock.on('connect', () => {
      sock.write(encodeFrame({ cmd: 'HANDSHAKE', args: { v: 1, client_id: 'test' }, nonce: null }));
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) return;
        const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        if (msg.evt === 'READY') {
          sock.write(encodeFrame({ cmd: 'SET_ACTIVITY', args: { pid: 1, activity: { name: 'Code', details: 'hi' } }, nonce: 'z' }));
        } else if (msg.cmd === 'SET_ACTIVITY' && msg.nonce === 'z') {
          sock.end();
        }
      }
    });
    sock.on('close', () => resolve());
    sock.on('error', reject);
  });
  await server.close();
  const sets = emitted.filter((e) => e.activity);
  assert.strictEqual(sets.length, 1);
  assert.strictEqual(sets[0].activity.details, 'hi');
});

test('spotify status maps to a listening activity', () => {
  const now = Date.now();
  const act = spotifyStatusToActivity(
    {
      playing: true,
      position: 90000,
      track: {
        track_resource: { name: 'Peaches', uri: 'spotify:track:a1b2' },
        artist_resource: { name: 'Justin Bieber' },
        album_resource: { name: 'Justice' },
      },
    },
    now,
  );
  assert.strictEqual(act.name, 'Spotify');
  assert.strictEqual(act.details, 'Peaches');
  assert.strictEqual(act.state, 'by Justin Bieber · on Justice');
  assert.strictEqual(act.uri, 'spotify:track:a1b2');
  assert.strictEqual(act.timestamps_start, now - 90000);
  assert.strictEqual(act.type, 2);
});

test('spotify idle returns null', () => {
  assert.strictEqual(spotifyStatusToActivity({ playing: false }), null);
});