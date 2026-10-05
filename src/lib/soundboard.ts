// Soundboard: built-in sounds (made on the fly with Web Audio, so there are no
// files to download) plus server sounds. In a call, pressing a sound tells the
// others which sound to play; each person plays it locally at their own
// volume for you (or not at all if they muted your soundboard).
import { getSettings } from './settings';
import { supabase } from './supabase';

export interface SoundRef {
  kind: 'default' | 'custom';
  id: string;
  name: string;
  emoji: string;
  url?: string;
}

export const DEFAULT_SOUNDS: SoundRef[] = [
  { kind: 'default', id: 'airhorn', name: 'Airhorn', emoji: '📯' },
  { kind: 'default', id: 'fart', name: 'Fart', emoji: '💨' },
  { kind: 'default', id: 'quack', name: 'Quack', emoji: '🦆' },
  { kind: 'default', id: 'cricket', name: 'Cricket', emoji: '🦗' },
  { kind: 'default', id: 'clap', name: 'Clap', emoji: '👏' },
  { kind: 'default', id: 'sadhorn', name: 'Sad Horn', emoji: '🎺' },
  { kind: 'default', id: 'badumtss', name: 'Ba Dum Tss', emoji: '🥁' },
];

const RATE = 44100;
let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function noise(c: OfflineAudioContext, dur: number) {
  const buf = c.createBuffer(1, Math.ceil(RATE * dur), RATE);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(c: OfflineAudioContext, at: number, attack: number, hold: number, release: number, peak = 1) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  return g;
}

/** Build each built-in sound once. */
async function synth(id: string): Promise<AudioBuffer> {
  const len = { airhorn: 1.6, fart: 0.9, quack: 0.6, cricket: 1.6, clap: 0.5, sadhorn: 2.4, badumtss: 1.6 }[id] ?? 1;
  const c = new OfflineAudioContext(1, Math.ceil(RATE * len), RATE);
  const out = c.createDynamicsCompressor();
  out.connect(c.destination);
  const osc = (type: OscillatorType, freq: number, at: number, dur: number, g: AudioNode) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    o.connect(g);
    o.start(at);
    o.stop(at + dur);
    return o;
  };
  if (id === 'airhorn') {
    // three bursts of a brassy chord
    for (const [at, dur] of [[0, 0.22], [0.27, 0.22], [0.54, 0.95]]) {
      const g = env(c, at, 0.01, dur - 0.05, 0.08, 0.25);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      g.connect(lp).connect(out);
      for (const f of [311, 466, 622, 932]) osc('sawtooth', f, at, dur + 0.1, g);
    }
  } else if (id === 'fart') {
    const g = env(c, 0, 0.03, 0.5, 0.3, 0.9);
    const bp = c.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 400;
    g.connect(bp).connect(out);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, 0);
    o.frequency.linearRampToValueAtTime(70, 0.8);
    const wobble = c.createOscillator();
    const wg = c.createGain();
    wobble.frequency.value = 23;
    wg.gain.value = 30;
    wobble.connect(wg).connect(o.frequency);
    o.connect(g);
    const n = noise(c, 0.85);
    const ng = c.createGain();
    ng.gain.value = 0.25;
    n.connect(ng).connect(g);
    o.start(0);
    wobble.start(0);
    n.start(0);
    o.stop(0.85);
    wobble.stop(0.85);
  } else if (id === 'quack') {
    for (const at of [0, 0.28]) {
      const g = env(c, at, 0.01, 0.1, 0.1, 0.5);
      const f1 = c.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 1100;
      f1.Q.value = 3;
      g.connect(f1).connect(out);
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(420, at);
      o.frequency.exponentialRampToValueAtTime(260, at + 0.2);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.25);
    }
  } else if (id === 'cricket') {
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < 6; i++) {
        const at = k * 0.75 + i * 0.045;
        const g = env(c, at, 0.004, 0.015, 0.02, 0.18);
        g.connect(out);
        osc('sine', 4400, at, 0.05, g);
      }
  } else if (id === 'clap') {
    for (const at of [0, 0.012, 0.024, 0.04]) {
      const n = noise(c, 0.25);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 0.8;
      const g = env(c, at, 0.002, 0.005, at > 0.03 ? 0.25 : 0.03, 0.9);
      n.connect(bp).connect(g).connect(out);
      n.start(at);
    }
  } else if (id === 'sadhorn') {
    // wah wah wah waaah
    const notes: [number, number, number][] = [[392, 0, 0.42], [370, 0.46, 0.42], [349, 0.92, 0.42], [330, 1.38, 0.95]];
    for (const [f, at, dur] of notes) {
      const g = env(c, at, 0.04, dur - 0.12, 0.1, 0.3);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, at);
      lp.frequency.linearRampToValueAtTime(1600, at + 0.15);
      lp.frequency.linearRampToValueAtTime(500, at + dur);
      g.connect(lp).connect(out);
      const o = osc('sawtooth', f, at, dur, g);
      if (f === 330) {
        const vib = c.createOscillator();
        const vg = c.createGain();
        vib.frequency.value = 6;
        vg.gain.value = 9;
        vib.connect(vg).connect(o.frequency);
        vib.start(at + 0.2);
        vib.stop(at + dur);
      }
    }
  } else if (id === 'badumtss') {
    const drum = (at: number, f: number) => {
      const g = env(c, at, 0.003, 0.02, 0.18, 0.9);
      g.connect(out);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.8, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.08);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.25);
    };
    drum(0, 180);
    drum(0.22, 120);
    const n = noise(c, 1.2);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = env(c, 0.44, 0.002, 0.03, 1, 0.5);
    n.connect(hp).connect(g).connect(out);
    n.start(0.44);
  }
  return c.startRendering();
}

const buffers = new Map<string, Promise<AudioBuffer>>();

async function bufferFor(s: SoundRef): Promise<AudioBuffer | null> {
  const key = s.kind === 'default' ? `d:${s.id}` : `u:${s.url}`;
  let b = buffers.get(key);
  if (!b) {
    if (s.kind === 'default') b = synth(s.id);
    else {
      if (!s.url || !isOurAsset(s.url)) return null;
      b = fetch(s.url)
        .then((r) => {
          if (!r.ok || Number(r.headers.get('content-length') ?? 0) > 1.5 * 1024 * 1024) throw new Error('bad sound');
          return r.arrayBuffer();
        })
        .then((a) => audio().decodeAudioData(a));
    }
    buffers.set(key, b);
    b.catch(() => buffers.delete(key));
  }
  return b;
}

/** Only sounds stored by Venband (never arbitrary URLs that would leak your IP). */
export function isOurAsset(url: string) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return Boolean(base) && url.startsWith(`${base.replace(/\/$/, '')}/storage/v1/object/public/server-assets/`);
}

/** Play a sound locally. `from` is who played it (for per-person volume / mute). */
export async function playSound(s: SoundRef, from?: string) {
  const sb = getSettings().soundboard;
  if (from && sb.muted.includes(from)) return;
  const vol = (sb.volume / 100) * ((from ? (sb.perUser[from] ?? 100) : 100) / 100);
  if (vol <= 0) return;
  const buf = await bufferFor(s).catch(() => null);
  if (!buf) return;
  const a = audio();
  const src = a.createBufferSource();
  src.buffer = buf;
  // even out loud and quiet uploads so nobody's headphones get blasted
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  const g = a.createGain();
  g.gain.value = Math.min(1, vol) * 0.8;
  src.connect(comp).connect(g).connect(a.destination);
  src.start();
}

export function playExpressionSound(url: string, volume = 1) {
  return playSound({ kind: 'custom', id: url, name: '', emoji: '', url }).then(() => void volume);
}

/** Sounds from servers you're in. */
export async function serverSounds(): Promise<(SoundRef & { server: string })[]> {
  const { data } = await supabase.rpc('my_expressions');
  return ((data ?? []) as { id: string; kind: string; name: string; url: string; emoji: string | null; server_name: string }[])
    .filter((x) => x.kind === 'sound')
    .map((x) => ({ kind: 'custom' as const, id: x.id, name: x.name, emoji: x.emoji ?? '🔊', url: x.url, server: x.server_name }));
}
