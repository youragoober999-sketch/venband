// Live, short-lived traffic (typing, presence, call signalling, games).
//
// With VITE_REALTIME_URL set (e.g. wss://rt.venband.com), these topics go to
// Venband's own realtime server (realtime/server.mjs, on a VPS). Without it,
// everything stays on Supabase Realtime exactly as before. Database change
// feeds always use Supabase for now.
//
// `rtChannel` returns an object with the small part of Supabase's channel API
// the app uses (on / subscribe / send / track / untrack / presenceState), so
// call sites read the same either way.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
type Meta = Record<string, unknown> & { presence_ref?: string };
type Opts = { config?: { private?: boolean; presence?: { key?: string }; broadcast?: { self?: boolean } } };

export interface RtChannel {
  topic: string;
  on(type: 'broadcast', filter: { event: string }, cb: (msg: { event: string; payload: any; from?: string }) => void): RtChannel;
  on(type: 'presence', filter: { event: 'sync' | 'join' | 'leave' }, cb: (msg?: unknown) => void): RtChannel;
  subscribe(cb?: (status: Status) => void): RtChannel;
  send(msg: { type: 'broadcast'; event: string; payload?: unknown }): Promise<unknown>;
  track(meta: object): Promise<unknown>;
  untrack(): Promise<unknown>;
  presenceState<T = Meta>(): Record<string, (T & { presence_ref: string })[]>;
}

const URL_ = (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim() || '';
const OWN_KINDS = new Set(['chan', 'act', 'call', 'scope']);

export const ownRealtime = () => Boolean(URL_);

/** A channel for a live topic: our server when configured, Supabase otherwise. */
export function rtChannel(topic: string, opts: Opts = {}): RtChannel {
  if (URL_ && OWN_KINDS.has(topic.split(':')[0])) return new OwnChannel(topic, opts);
  return supabase.channel(topic, opts as Parameters<typeof supabase.channel>[1]) as unknown as RtChannel;
}

export function rtRemove(ch: RtChannel | null | undefined) {
  if (!ch) return;
  if (ch instanceof OwnChannel) ch.close();
  else void supabase.removeChannel(ch as unknown as RealtimeChannel);
}

// ------------------------------------------------------------- connection --

class Connection {
  ws: WebSocket | null = null;
  ready: Promise<void> | null = null;
  channels = new Map<string, Set<OwnChannel>>();
  private pinger: ReturnType<typeof setInterval> | null = null;
  private unsubAuth: (() => void) | null = null;

  open(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(URL_);
      this.ws = ws;
      let signedIn = false;
      const fail = () => {
        if (this.ws !== ws) return;
        this.reset();
        if (!signedIn) reject(new Error('realtime unavailable'));
      };
      ws.onopen = async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return ws.close();
        ws.send(JSON.stringify({ t: 'auth', token }));
      };
      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === 'ok' && !signedIn) {
          signedIn = true;
          this.pinger = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25_000);
          const sub = supabase.auth.onAuthStateChange((_ev, session) => {
            if (session?.access_token && ws.readyState === 1) ws.send(JSON.stringify({ t: 'auth', token: session.access_token }));
          });
          this.unsubAuth = () => sub.data.subscription.unsubscribe();
          resolve();
          return;
        }
        if (m.t === 'err' && !signedIn) return ws.close();
        if (typeof m.topic === 'string') for (const ch of this.channels.get(m.topic) ?? []) ch.handle(m);
      };
      ws.onerror = fail;
      ws.onclose = fail;
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  /** The socket dropped: every channel reports CHANNEL_ERROR and reconnects on its own, like Supabase's. */
  private reset() {
    if (this.pinger) clearInterval(this.pinger);
    this.unsubAuth?.();
    this.pinger = null;
    this.unsubAuth = null;
    this.ws = null;
    this.ready = null;
    const all = [...this.channels.values()].flatMap((s) => [...s]);
    this.channels.clear();
    for (const ch of all) ch.dropped();
  }

  send(m: Record<string, unknown>) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  add(ch: OwnChannel) {
    let set = this.channels.get(ch.topic);
    if (!set) this.channels.set(ch.topic, (set = new Set()));
    set.add(ch);
  }

  remove(ch: OwnChannel) {
    const set = this.channels.get(ch.topic);
    if (!set?.delete(ch)) return;
    if (!set.size) {
      this.channels.delete(ch.topic);
      this.send({ t: 'leave', topic: ch.topic });
    } else if (ch.tracked) {
      // another channel object still uses this topic on this socket; just drop our presence
      this.send({ t: 'untrack', topic: ch.topic });
    }
    if (!this.channels.size && this.ws) {
      // nothing left: close after a moment (a quick re-open often follows)
      setTimeout(() => !this.channels.size && this.ws?.close(), 5000);
    }
  }
}

const conn = new Connection();

// ---------------------------------------------------------------- channel --

class OwnChannel implements RtChannel {
  topic: string;
  tracked = false;
  private key: string | undefined;
  private self: boolean;
  private bc = new Map<string, ((m: { event: string; payload: any; from?: string }) => void)[]>();
  private pres: Record<'sync' | 'join' | 'leave', ((m?: unknown) => void)[]> = { sync: [], join: [], leave: [] };
  private state: Record<string, (Meta & { presence_ref: string })[]> = {};
  private status?: (s: Status) => void;
  private joined = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(topic: string, opts: Opts) {
    this.topic = topic;
    this.key = opts.config?.presence?.key;
    this.self = Boolean(opts.config?.broadcast?.self);
  }

  on(type: 'broadcast' | 'presence', filter: { event: string }, cb: (m?: any) => void): RtChannel {
    if (type === 'broadcast') this.bc.set(filter.event, [...(this.bc.get(filter.event) ?? []), cb]);
    else if (filter.event === 'sync' || filter.event === 'join' || filter.event === 'leave') this.pres[filter.event].push(cb);
    return this;
  }

  subscribe(cb?: (status: Status) => void): RtChannel {
    this.status = cb;
    this.timer = setTimeout(() => !this.joined && !this.closed && this.fail('TIMED_OUT'), 10_000);
    conn
      .open()
      .then(() => {
        if (this.closed) return;
        conn.add(this);
        conn.send({ t: 'join', topic: this.topic, key: this.key, self: this.self });
      })
      .catch(() => this.fail('CHANNEL_ERROR'));
    return this;
  }

  private fail(s: Status) {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed) return;
    this.joined = false;
    this.status?.(s);
  }

  dropped() {
    if (!this.closed) this.fail('CHANNEL_ERROR');
  }

  handle(m: any) {
    switch (m.t) {
      case 'joined': {
        if (this.joined) return;
        this.joined = true;
        if (this.timer) clearTimeout(this.timer);
        this.state = {};
        for (const [k, metas] of Object.entries(m.state ?? {})) this.state[k] = metas as (Meta & { presence_ref: string })[];
        this.status?.('SUBSCRIBED');
        this.emit('sync');
        return;
      }
      case 'denied':
      case 'kicked':
        conn.remove(this);
        return this.fail('CHANNEL_ERROR');
      case 'bc':
        for (const cb of this.bc.get(m.event) ?? []) cb({ event: m.event, payload: m.payload, from: m.from });
        return;
      case 'pjoin': {
        const list = (this.state[m.key] ?? []).filter((x) => x.presence_ref !== m.meta.presence_ref);
        this.state[m.key] = [...list, m.meta];
        this.emit('join', { key: m.key, newPresences: [m.meta] });
        this.emit('sync');
        return;
      }
      case 'pleave': {
        const left = (this.state[m.key] ?? []).filter((x) => x.presence_ref === m.ref);
        const rest = (this.state[m.key] ?? []).filter((x) => x.presence_ref !== m.ref);
        if (rest.length) this.state[m.key] = rest;
        else delete this.state[m.key];
        this.emit('leave', { key: m.key, leftPresences: left });
        this.emit('sync');
        return;
      }
    }
  }

  private emit(ev: 'sync' | 'join' | 'leave', arg?: unknown) {
    for (const cb of this.pres[ev]) cb(arg);
  }

  async send(msg: { type: 'broadcast'; event: string; payload?: unknown }) {
    if (!this.joined) return 'error';
    conn.send({ t: 'bc', topic: this.topic, event: msg.event, payload: msg.payload ?? null });
    return 'ok';
  }

  async track(meta: object) {
    if (!this.joined) return 'error';
    this.tracked = true;
    conn.send({ t: 'track', topic: this.topic, meta });
    return 'ok';
  }

  async untrack() {
    this.tracked = false;
    conn.send({ t: 'untrack', topic: this.topic });
    return 'ok';
  }

  presenceState<T = Meta>() {
    return this.state as unknown as Record<string, (T & { presence_ref: string })[]>;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    conn.remove(this);
    this.status?.('CLOSED');
  }
}
