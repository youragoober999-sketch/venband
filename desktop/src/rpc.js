// Venband rich presence bridge.
//
// Real desktop apps (the VS Code Discord Presence extension, games using the
// Discord Game SDK, YouTube/soundtrack bridges, …) connect to the Discord
// desktop client over a local socket that only exists when the client is
// installed. Venband speaks the same protocol, so those apps connect to
// Venband instead and feed it rich presence. The web app can then show "what
// you're playing" on your profile, and friends see it live everywhere.
//
// Wire format (Windows named pipe / Unix domain socket):
//   [4-byte little-endian length][UTF-8 JSON]  (a "frame")
// Like discord-rpc, Venband listens on the first free pipe:
//   win32   -> \\.\pipe\discord-ipc-0 .. discord-ipc-9
//   macos/x -> $XDG_RUNTIME_DIR/discord-ipc-0 .. or $TMPDIR
//
// Only the frame codec + protocol handling is here (kept free of Electron so
// it runs under `node --test`); the server is created by createRpcServer().

'use strict';

const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const PIPE_COUNT = 10; // discord-ipc-0 .. discord-ipc-9
const MAX_FRAME_BYTES = 1024 * 1024;

// ------------------------------------------------------------ frame codec --

/** Encode a JSON object as a length-prefixed frame Buffer. */
function encodeFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

/**
 * Feed raw bytes into a decoder; returns complete frames in order.
 * A frame carries no opcode marker, so clients are expected to send no other
 * traffic before every frame is fully consumed (which discord-rpc does).
 */
function makeFrameDecoder(onFrame, maxBytes = MAX_FRAME_BYTES) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 4) return;
      const size = buf.readUInt32LE(0);
      if (size <= 0 || size > maxBytes) {
        buf = Buffer.alloc(0);
        onFrame({ error: 'bad frame size' });
        return;
      }
      if (buf.length < 4 + size) return;
      const body = buf.subarray(4, 4 + size).toString('utf8');
      buf = buf.subarray(4 + size);
      try {
        onFrame(JSON.parse(body));
      } catch {
        onFrame({ error: 'bad json' });
      }
    }
  };
}

// ------------------------------------------------------------ pipe lookup --

/** Candidate pipe paths for `index`, in the order clients try them. */
function pipePath(index) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\discord-ipc-${index}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir();
  return path.join(base, `discord-ipc-${index}`);
}

/**
 * Listen on the first free discord-ipc pipe. Resolves {server, index}, or
 * rejects with an Error (with .code 'EEXHAUSTED') when every pipe is taken.
 */
function listenOnFreePipe() {
  return new Promise((resolve, reject) => {
    let index = -1;
    const tryNext = () => {
      index += 1;
      if (index >= PIPE_COUNT) {
        const err = new Error('all discord-ipc pipes are in use');
        err.code = 'EEXHAUSTED';
        reject(err);
        return;
      }
      const server = net.createServer();
      server.once('error', (e) => {
        if (e && (e.code === 'EADDRINUSE' || e.code === 'EEXIST')) {
          tryNext();
        } else {
          reject(e);
        }
      });
      server.listen(pipePath(index), () => resolve({ server, index }));
    };
    tryNext();
  });
}

// --------------------------------------------------------- activity model --

/** Discord SET_ACTIVITY payload -> Venband activity (or null to clear). */
function normalizeActivity(activity, fallbackClientId = '') {
  if (!activity) return null;
  const a = activity.assets || {};
  const t = activity.timestamps || {};
  const p = activity.party || {};
  const size = Array.isArray(p.size) ? p.size : [];
  const name = String(activity.name || '').trim();
  return {
    client_id: String(activity.application_id || fallbackClientId || ''),
    name: name || undefined,
    type: typeof activity.type === 'number' ? activity.type : 0,
    url: typeof activity.url === 'string' ? activity.url : undefined,
    details: typeof activity.details === 'string' ? activity.details : undefined,
    state: typeof activity.state === 'string' ? activity.state : undefined,
    timestamps_start: typeof t.start === 'number' ? t.start : undefined,
    timestamps_end: typeof t.end === 'number' ? t.end : undefined,
    assets_large_key: typeof a.large_image === 'string' ? a.large_image : undefined,
    assets_large_text: typeof a.large_text === 'string' ? a.large_text : undefined,
    assets_small_key: typeof a.small_image === 'string' ? a.small_image : undefined,
    assets_small_text: typeof a.small_text === 'string' ? a.small_text : undefined,
    party_id: typeof p.id === 'string' ? p.id : undefined,
    party_cur: size[0],
    party_max: size[1],
    buttons: Array.isArray(activity.buttons) ? activity.buttons.filter((b) => typeof b === 'string').slice(0, 2) : undefined,
    created_at: typeof activity.created_at === 'number' ? activity.created_at : Date.now(),
  };
}

/** A stable key so consecutive identical updates collapse into one emit. */
function activityKey(a) {
  return a
    ? [
        a.client_id,
        a.name,
        a.details,
        a.state,
        a.timestamps_start,
        a.timestamps_end,
        a.assets_large_key,
        a.assets_large_text,
        a.assets_small_key,
        a.assets_small_text,
        a.party_id,
        (a.party_cur ?? '') + (a.party_max ?? ''),
        a.url,
      ].join('|')
    : 'none';
}

// ------------------------------------------------------------ connection --

/**
 * One connected client. Progresses HANDSHAKE -> ready, routes commands, and
 * reports {type:'activity', activity} events (clearing with null).
 */
function Connection({ onFrame, onError, getServerState, emit }) {
  const state = { handshaken: false, clientId: '', pid: 0, subscribed: new Set(), activity: null };
  const feed = makeFrameDecoder((frame) => {
    if (frame && frame.error) return onError(new Error(frame.error));
    const out = handleFrame(frame, state, getServerState, emit);
    for (const f of out.frames) {
      try {
        onFrame(f);
      } catch {
        break;
      }
    }
    for (const e of out.events) emit(e);
  });
  return {
    feed,
    close() {
      if (state.handshaken && state.activity) emit({ type: 'activity', activity: null, clientId: state.clientId });
      state.handshaken = false;
    },
    state,
  };
}

/** Handle a single decoded frame; pure so it is easy to test. */
function handleFrame(frame, state, getServerState, emit) {
  const frames = [];
  const events = [];
  if (!frame || typeof frame !== 'object') return { frames, events };

  if (!frame.cmd && frame.evt === 'DISPATCH') return { frames, events }; // ignore dispatches
  const cmd = frame.cmd;

  // A client may send HANDSHAKE, then a burst of commands; it can also send
  // PING to check the connection. Reply to PING with PONG by nonce.
  if (cmd === 'PING') {
    frames.push(pong(frame));
    return { frames, events };
  }

  if (!state.handshaken) {
    if (cmd !== 'HANDSHAKE') {
      frames.push(ack(frame, 'ERR_NO_HANDSHAKE'));
      return { frames, events };
    }
    const a = frame.args || {};
    state.clientId = String(a.client_id || '');
    state.pid = Number(a.pid) || 0;
    state.handshaken = true;
    const user = (getServerState && getServerState().user) || { id: '0', username: 'Venband', discriminator: '0', global_name: 'Venband', avatar: null };
    frames.push({
      cmd: 'DISPATCH',
      evt: 'READY',
      data: {
        v: 1,
        config: { cdn_host: 'cdn.venband.com', api_endpoint: 'https://www.venband.com/api', environment: 'production' },
        user: { id: user.id, username: user.username, discriminator: '0', global_name: user.global_name || user.username, avatar: null },
        session_id: user.session_id || '',
      },
      nonce: null,
    });
    return { frames, events };
  }

  switch (cmd) {
    case 'SET_ACTIVITY': {
      const a = frame.args || {};
      const act = normalizeActivity(a.activity, state.clientId);
      state.activity = act;
      events.push({ type: 'activity', activity: act, clientId: state.clientId, pid: state.pid });
      frames.push({
        cmd,
        evt: null,
        data: {
          application_id: state.clientId,
          pid: state.pid,
          activities: act ? [{ name: act.name, type: act.type, application_id: act.client_id, state: act.state, details: act.details }] : [],
        },
        nonce: frame.nonce ?? null,
      });
      break;
    }
    case 'SUBSCRIBE': {
      const evt = frame.args && frame.args.evt;
      if (evt) state.subscribed.add(evt);
      frames.push(ack(frame));
      break;
    }
    case 'UNSUBSCRIBE': {
      const evt = frame.args && frame.args.evt;
      if (evt) state.subscribed.delete(evt);
      frames.push(ack(frame));
      break;
    }
    case 'GET_ACTIVITY': {
      frames.push(ack(frame, null, { application_id: state.clientId, pid: state.pid, activities: state.activity ? [state.activity] : [] }));
      break;
    }
    // Presence extensions probe these; there is no Venband-side UI yet, so
    // acknowledge as empty rather than erroring.
    case 'GET_SELECTED_VOICE_CHANNEL':
    case 'SELECT_VOICE_CHANNEL':
    case 'GET_GUILDS':
    case 'GET_GUILD':
    case 'GET_CHANNELS':
    case 'GET_CHANNEL':
    case 'GET_CURRENT_USER':
      frames.push(ack(frame, null, null));
      break;
    case 'SET_USER_SERVICE_DETAILS':
    case 'SEND_ACTIVITY_JOIN_INVITE':
    case 'OPEN_ACTIVITY_OVERLAY':
    case 'SET_CONFIG':
      frames.push(ack(frame));
      break;
    default:
      frames.push(ack(frame)); // stay tolerant: unknown commands ack quietly
      break;
  }
  return { frames, events };
}

function pong(frame) {
  return { cmd: 'PONG', evt: null, data: frame.data ?? null, nonce: frame.nonce ?? null };
}

function ack(frame, data = null, dataOverride) {
  return {
    cmd: frame.cmd,
    evt: null,
    data: dataOverride === undefined ? data : dataOverride,
    nonce: frame.nonce ?? null,
  };
}

// ---------------------------------------------------------------- server --

/**
 * Start the bridge. `emit({type:'activity', activity})` fires on every change,
 * `onConnection(tag)` on connect and disconnect (tag = client id). Returns
 * { server, index, close(), broadcast() }.
 */
function createRpcServer({ emit, onConnection, userProvider } = {}) {
  const subscribers = new Set();
  const serverState = { user: null, pipeIndex: -1 };
  let connections = new Set();
  let server = null;

  const getServerState = () => serverState;
  const broadcast = (frame) => {
    const data = encodeFrame(frame);
    for (const c of connections) c.write(data);
  };

  function attach(sock) {
    let conn;
    const onFrame = (f) => {
      try {
        sock.write(encodeFrame(f));
      } catch {
        /* write errors handled by socket 'error' */
      }
    };
    const onError = () => {
      try {
        sock.destroy();
      } catch {}
    };
    conn = Connection({ onFrame, onError, getServerState, emit: (e) => emit(e) });
    sock.on('data', conn.feed);
    const drop = () => {
      if (conn) {
        conn.close();
        connections.delete(sock);
        conn = null;
        onConnection && onConnection({ up: false });
      }
    };
    sock.on('error', drop);
    sock.on('close', drop);
    sock.on('end', drop);
    connections.add(sock);
    onConnection && onConnection({ up: true });
  }

  const start = () =>
    listenOnFreePipe().then(({ server: s, index }) => {
      server = s;
      serverState.pipeIndex = index;
      server.on('connection', attach);
      return { index };
    });

  const close = async () => {
    for (const c of connections) {
      try {
        c.destroy();
      } catch {}
    }
    connections = new Set();
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
    return serverState.pipeIndex;
  };

  // The web app tells us who's logged in so READY carries a real user.
  const setUser = (u) => {
    serverState.user = u ? { id: String(u.id), username: String(u.username || 'Venband'), global_name: String(u.global_name || u.username || 'Venband'), session_id: String(u.session_id || '') } : null;
  };

  return { start, close, broadcast, setUser, state: serverState, get stateRef() { return serverState; }, onConnection };
}

module.exports = {
  encodeFrame,
  makeFrameDecoder,
  pipePath,
  listenOnFreePipe,
  normalizeActivity,
  activityKey,
  handleFrame,
  Connection,
  createRpcServer,
  PIPE_COUNT,
};